import type { Server } from 'socket.io';
import { childLogger } from '../logger';
import {
  applyMatchResult,
  isConcurrentMatchChange,
  cancelTournamentIfBracketUnchanged,
  closeTournamentRoom,
  decideUnstartedMatchByAttendance,
  noShowStatusReason,
  peekMatchRoom,
  resolveInProgressMatchFromRoom,
  selectHigherSeedWinner,
  unjoinedHumans,
  type InProgressResolutionLabels,
} from './engine';
import { isBotOnlyMatch, isBotUserId } from './matchDispatch';
import { defaultEnginePersistence, type EnginePersistence } from './persistenceInterface';
import { alertTournamentAnomaly } from './tournamentAlerts';
import type { MatchRow, ScheduledTournamentRow } from './types';

const log = childLogger('tournament:backstop');

/** status_reason labels for in-progress matches the backstop decides. */
export const EVENT_BACKSTOP_LABELS: InProgressResolutionLabels = {
  higherScore: 'event_backstop_higher_score',
  higherSeed: 'event_backstop_higher_seed',
  missingSessionHigherSeed: 'event_backstop_missing_session_higher_seed',
  pregameHigherSeed: 'event_backstop_pregame_higher_seed',
  unrecoverableResultHigherSeed: 'event_backstop_unrecoverable_result_higher_seed',
};

/**
 * Errors that mean the event's rows cannot be resolved by the normal result
 * path (a corrupt or inconsistent bracket), as opposed to a transient failure
 * (a timeout, a network error) that the next tick should simply retry.
 */
const UNRECOVERABLE_ERRORS = new Set([
  'tournament_seat_mismatch',
  'winner_not_participant',
  'no_advance_target',
  'score_inconsistent',
  'game_over_on_non_started_match',
  'invalid_source_for_status',
  'match_not_playable',
  'invalid_promotion',
  'match_not_found',
  'match_players_missing',
  'backstop_no_resolvable_match',
  'backstop_step_limit',
]);

/** A 7-match bracket needs at most 7 results; anything past this is a loop. */
const MAX_BACKSTOP_STEPS = 16;

export type ExpiredTournamentOutcome =
  | { kind: 'completed'; resolved: number }
  | { kind: 'not_in_progress' }
  | { kind: 'cancelled_unrecoverable'; reason: string; resolved: number }
  /** Judged unrecoverable, but the bracket changed before the cancel: nothing written. */
  | { kind: 'deferred_bracket_changed'; resolved: number };

function isDone(match: MatchRow): boolean {
  return match.status === 'completed' || match.status === 'bye';
}

/** Earliest unresolved match whose two players are known, in bracket order. */
function nextResolvableMatch(matches: MatchRow[]): MatchRow | null {
  return [...matches]
    .filter((m) => !isDone(m) && m.player1_id && m.player2_id)
    .sort((a, b) => a.round - b.round || a.match_number - b.match_number)[0] ?? null;
}

/**
 * Two-hour backstop for an event still `in_progress` past its active window.
 * Instead of cancelling it (which discarded every result), finish it round by
 * round through the normal result path (`applyMatchResult` →
 * `complete_tournament_match`, so placements are written when the final
 * completes):
 *
 *  - bot-only pairs: the higher seed advances (`bot_simulated`), as at start;
 *  - matches that never started and whose dispatched join window had expired:
 *    attendance / no-show rules (`decideUnstartedMatchByAttendance`),
 *    status_reason prefixed `event_backstop_`;
 *  - matches that never started and were never dispatched (made ready by an
 *    earlier result, including one this sweep recorded) or whose window is
 *    still open: an administrative advance, never a no-show — a human against
 *    Fritz advances, two humans go by seed
 *    (`event_backstop_undispatched_human_advanced` / `…_higher_seed`,
 *    `event_backstop_window_open_…`);
 *  - matches in progress: live score, then seed; a lost live session is
 *    alerted and labelled (`EVENT_BACKSTOP_LABELS`).
 *
 * Next-round matches are not dispatched while it runs (no new rooms or
 * match_ready for an event that is being closed). Only if the rows cannot be
 * resolved (corrupt or inconsistent bracket) is the event cancelled, with
 * `active_window_unrecoverable:<reason>` and a loud alert. Transient errors are
 * rethrown so the next tick retries; every step is idempotent.
 */
export async function resolveExpiredTournament(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
  now: Date = new Date(),
  /** The row the scheduler tick just read; omit it and it is fetched. */
  knownTournament?: ScheduledTournamentRow,
): Promise<ExpiredTournamentOutcome> {
  const tournament = knownTournament?.id === tournamentId
    ? knownTournament
    : await persistence.fetchTournamentById(tournamentId);
  if (!tournament || tournament.status !== 'in_progress') return { kind: 'not_in_progress' };

  let resolved = 0;
  let current: MatchRow | null = null;
  // The bracket as read for the step that failed: the state the
  // "unrecoverable" conclusion was drawn from.
  let seen: MatchRow[] = [];
  try {
    for (let step = 0; ; step += 1) {
      const matches = await persistence.fetchMatches(tournamentId);
      seen = matches;
      const final = matches.find((m) => m.round === 3);
      if (final && isDone(final)) break;
      if (step >= MAX_BACKSTOP_STEPS) throw new Error('backstop_step_limit');
      current = nextResolvableMatch(matches);
      if (!current) throw new Error('backstop_no_resolvable_match');
      try {
        await resolveOne(io, current, tournament.win_target, persistence, now);
      } catch (err) {
        // The match changed after it was decided (a player joined, or it
        // started): decide again from fresh state.
        if (isConcurrentMatchChange(err)) continue;
        throw err;
      }
      resolved += 1;
    }
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    if (!UNRECOVERABLE_ERRORS.has(code)) throw err;
    const reason = `active_window_unrecoverable:${code}`;
    // Some of these refusals are exactly what a concurrent change produces (a
    // match started, decided or repaired by another process). Cancel only if
    // the whole bracket is still as seen — atomically at the database — and
    // otherwise leave the tournament to the next tick's fresh determination.
    const cancelled = await cancelTournamentIfBracketUnchanged(io, tournamentId, seen, reason, persistence);
    if (!cancelled) {
      log.warn({ tournamentId, matchId: current?.id, code }, 'backstop judged the bracket unrecoverable, but it changed since: not cancelled, re-deciding next tick');
      return { kind: 'deferred_bracket_changed', resolved };
    }
    alertTournamentAnomaly(
      'event_backstop_unrecoverable',
      { tournamentId, matchId: current?.id, roomCode: current?.room_code ?? undefined },
      { reason, resolvedBeforeFailure: resolved },
    );
    return { kind: 'cancelled_unrecoverable', reason, resolved };
  }
  log.info({ tournamentId, resolved }, 'expired tournament finished through the result path');
  return { kind: 'completed', resolved };
}

/**
 * Did this match have a real, finished chance to be joined? Dispatch
 * (dispatchTournamentMatch) is the only writer of `ready_deadline_at`: bracket
 * advancement (complete_tournament_match) makes a match `ready` without one,
 * and so does the backstop's own promotion. So a match without it was never
 * offered to its players; one whose deadline is still ahead was offered but its
 * window has not closed.
 */
function hadExpiredJoinWindow(match: MatchRow, now: Date): boolean {
  if (!match.ready_deadline_at) return false;
  const deadlineMs = Date.parse(match.ready_deadline_at);
  return Number.isFinite(deadlineMs) && deadlineMs <= now.getTime();
}

/**
 * The administrative result for a match nobody could have missed: a human
 * against Fritz advances (a player is never eliminated by a match they were
 * not given); two humans go by seed. No no-show is recorded. winner_source is
 * `no_show` with no no-show user, the only administrative source the result
 * RPC accepts for a match that was never played (the same shape as
 * double_no_show_higher_seed_advanced); the status_reason says what happened.
 * Scores are the RPC's canonical administrative scores.
 */
async function administrativeAdvance(
  match: MatchRow,
  winTarget: number,
  persistence: EnginePersistence,
  why: 'undispatched' | 'window_open',
): Promise<{ winnerId: string; player1Score: number; player2Score: number; winnerSource: 'no_show'; statusReason: string }> {
  const p1 = match.player1_id!;
  const p2 = match.player2_id!;
  let winnerId: string;
  let outcome: string;
  if (isBotUserId(p1) !== isBotUserId(p2)) {
    winnerId = isBotUserId(p1) ? p2 : p1;
    outcome = 'human_advanced';
  } else {
    winnerId = await selectHigherSeedWinner(match.tournament_id, p1, p2, persistence);
    outcome = 'higher_seed';
  }
  return {
    winnerId,
    player1Score: p1 === winnerId ? winTarget : 0,
    player2Score: p2 === winnerId ? winTarget : 0,
    winnerSource: 'no_show',
    statusReason: `event_backstop_${why}_${outcome}`,
  };
}

async function resolveOne(
  io: Server,
  match: MatchRow,
  winTarget: number,
  persistence: EnginePersistence,
  now: Date,
): Promise<void> {
  if (!match.player1_id || !match.player2_id) throw new Error('match_players_missing');

  if (match.status === 'in_progress') {
    const recorded = await resolveInProgressMatchFromRoom(io, match, persistence, now, EVENT_BACKSTOP_LABELS, {
      dispatchAdvanced: false,
    });
    if (!recorded) {
      // The game ended and its own game-over persist is still in flight (it
      // takes seconds): the next tick sees it recorded, or records it itself.
      throw new Error('backstop_game_over_persist_in_flight');
    }
    return;
  }

  if (match.status === 'waiting') {
    await persistence.promoteTournamentMatch(match.id, 'ready', { readyAt: now.toISOString(), actor: 'event_backstop' });
  }

  if (isBotOnlyMatch(match)) {
    const winnerId = await selectHigherSeedWinner(match.tournament_id, match.player1_id, match.player2_id, persistence);
    await applyMatchResult(io, {
      matchId: match.id,
      winnerId,
      player1Score: match.player1_id === winnerId ? winTarget : 0,
      player2Score: match.player2_id === winnerId ? winTarget : 0,
      winnerSource: 'game_over',
      statusReason: 'bot_simulated',
      dispatchAdvanced: false,
    }, persistence);
    return;
  }

  if (!hadExpiredJoinWindow(match, now)) {
    // Nobody can have missed a match they were never given (or whose join
    // window is still open): an administrative advance, not a no-show.
    await applyMatchResult(io, {
      matchId: match.id,
      ...(await administrativeAdvance(match, winTarget, persistence, match.ready_deadline_at ? 'window_open' : 'undispatched')),
      noShowUserId: null,
      // Decided as a match nobody played: it must still be unplayed when it commits.
      expectStatus: 'ready',
      dispatchAdvanced: false,
    }, persistence);
  } else {
    const decided = await decideUnstartedMatchByAttendance(match, persistence);
    const bothJoined = Boolean(match.player1_joined_at && match.player2_joined_at);
    // The absentees this was decided from must still be absent when it commits.
    const base = decided.noShowUserId
      ? noShowStatusReason(match, decided.noShowUserId)
      : bothJoined
        ? 'not_started_higher_seed_advanced'
        : 'double_no_show_higher_seed_advanced';
    await applyMatchResult(io, {
      matchId: match.id,
      winnerId: decided.winnerId,
      player1Score: match.player1_id === decided.winnerId ? winTarget : 0,
      player2Score: match.player2_id === decided.winnerId ? winTarget : 0,
      winnerSource: 'no_show',
      statusReason: `event_backstop_${base}`,
      noShowUserId: decided.noShowUserId,
      expectStatus: 'ready',
      requireUnjoined: bothJoined ? [] : unjoinedHumans(match),
      dispatchAdvanced: false,
    }, persistence);
  }
  // A room may exist (players waiting in it, or in the pre-game draw): close it.
  const room = peekMatchRoom(persistence, match);
  if (room) closeTournamentRoom(room, now);
}
