import type { Server } from 'socket.io';
import { childLogger } from '../logger';
import {
  applyMatchResult,
  cancelTournament,
  closeTournamentRoom,
  decideUnstartedMatchByAttendance,
  noShowStatusReason,
  peekTournamentRoom,
  resolveInProgressMatchFromRoom,
  selectHigherSeedWinner,
  type InProgressResolutionLabels,
} from './engine';
import { isBotOnlyMatch } from './matchDispatch';
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
  | { kind: 'cancelled_unrecoverable'; reason: string; resolved: number };

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
 *  - matches that never started: attendance / no-show rules
 *    (`decideUnstartedMatchByAttendance`), status_reason prefixed
 *    `event_backstop_`;
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
  try {
    for (let step = 0; ; step += 1) {
      const matches = await persistence.fetchMatches(tournamentId);
      const final = matches.find((m) => m.round === 3);
      if (final && isDone(final)) break;
      if (step >= MAX_BACKSTOP_STEPS) throw new Error('backstop_step_limit');
      current = nextResolvableMatch(matches);
      if (!current) throw new Error('backstop_no_resolvable_match');
      await resolveOne(io, current, tournament.win_target, persistence, now);
      resolved += 1;
    }
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    if (!UNRECOVERABLE_ERRORS.has(code)) throw err;
    const reason = `active_window_unrecoverable:${code}`;
    alertTournamentAnomaly(
      'event_backstop_unrecoverable',
      { tournamentId, matchId: current?.id, roomCode: current?.room_code ?? undefined },
      { reason, resolvedBeforeFailure: resolved },
    );
    await cancelTournament(io, tournamentId, persistence, reason);
    return { kind: 'cancelled_unrecoverable', reason, resolved };
  }
  log.info({ tournamentId, resolved }, 'expired tournament finished through the result path');
  return { kind: 'completed', resolved };
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
      // The game ended in its room but the result is not recorded yet: record it
      // from the final live score (the game-over path would record the same).
      throw new Error('backstop_game_over_unrecorded');
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

  const decided = await decideUnstartedMatchByAttendance(match, persistence);
  const bothJoined = Boolean(match.player1_joined_at && match.player2_joined_at);
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
    dispatchAdvanced: false,
  }, persistence);
  // A room may exist (players waiting in it, or in the pre-game draw): close it.
  const room = match.room_code ? peekTournamentRoom(persistence, match.room_code) : null;
  if (room) closeTournamentRoom(room, now);
}
