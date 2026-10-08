import * as Sentry from '@sentry/node';
import { childLogger } from '../logger';
import type { Server } from 'socket.io';
import { supabaseFetch } from '../supabaseUtils';
import { writeTournamentActivity } from '../social/activityWriter';
import { pairSeededEntrants, sortBySeedRating } from './bracket';
import {
  alertTournamentAnomaly,
  alertTournamentMatchStepFailed,
  alertTournamentStepFailed,
  clearTournamentMatchStepAlert,
  clearTournamentStepAlert,
} from './tournamentAlerts';
import { defaultEnginePersistence, type EnginePersistence } from './persistenceInterface';
import { archiveBelongsToMatch } from './archiveIdentity';
import { tournamentMatchCapMs } from './tournamentTimeouts';
import type { Room } from '../rooms';
import type { GameState } from '../game/types';
import { getRoomRoster } from '../multiplayer/roomSession';
import { disarmTournamentTurnClock } from '../multiplayer/tournamentTurnClock';
import { markGameOverPersistSucceeded } from '../multiplayer/gameOverPersistPolicy';
import type { ScheduledTournamentRow } from './types';
import type { BracketQfPair, BracketSeed } from './persistence';
import {
  TOURNAMENT_MATCH_READY_WINDOW_MS,
  allHumanPlayersJoined,
  dispatchTournamentMatch,
  isBotOnlyMatch,
  isBotUserId,
} from './matchDispatch';
import type { MatchRow, SeededPlayer } from './types';

const log = childLogger('tournament:engine');

/**
 * T-15: bracket-integrity invariant violations (T-INV-2 / T-INV-5 / T-INV-6).
 * These "should be impossible" — the atomic completion RPC enforces them — but
 * if one ever fires in prod it means the bracket is corrupt and a player is
 * stranded, so it must page rather than sit silently in `log.warn`. Each is
 * fingerprinted per match so a single bad bracket is one Sentry issue, not N.
 */
export const TOURNAMENT_INVARIANT_RPC_ERRORS = new Set([
  'winner_not_participant',
  'no_advance_target',
]);

function alertTournamentInvariantViolation(
  kind: string,
  match: { id: string; tournament_id: string; round?: number | null; match_number?: number | null },
  extra: Record<string, unknown>,
): void {
  Sentry.captureMessage(`[tournament] bracket invariant violation — ${kind}`, {
    level: 'error',
    fingerprint: ['tournament-invariant-violation', kind, match.id],
    tags: {
      tournament_alert: 'invariant_violation',
      tournament_invariant: kind,
      tournament_id: match.tournament_id,
      match_id: match.id,
    },
    extra: {
      matchId: match.id,
      tournamentId: match.tournament_id,
      round: match.round ?? null,
      matchNumber: match.match_number ?? null,
      ...extra,
    },
  });
}

const MIN_HUMANS_TO_START = 1;
const BOT_ID_PREFIX = 'bot:fritz:';
type BotTier = NonNullable<MatchRow['bot_tier']>;
type TournamentEntrant = SeededPlayer & { isBot?: boolean; botTier?: BotTier };

/** Roughly 800 = Glicko default for players without a profile rating. */
const DEFAULT_RATING = 800;

function botTierForRound(round: 1 | 2 | 3): BotTier {
  if (round === 3) return 'master';
  if (round === 2) return 'elite';
  return 'standard';
}

function matchBotTier(round: 1 | 2 | 3, player1Id: string | null, player2Id: string | null): BotTier | null {
  return isBotUserId(player1Id) || isBotUserId(player2Id) ? botTierForRound(round) : null;
}

function buildBotEntrants(tournamentId: string, count: number): TournamentEntrant[] {
  return Array.from({ length: count }, (_, idx) => ({
    userId: `${BOT_ID_PREFIX}${tournamentId}:${idx + 1}`,
    username: 'Fritz',
    rating: 0,
    isBot: true,
    botTier: 'standard',
  }));
}

/**
 * Bracket order: humans by rating (highest = seed 1, ties by registration
 * order), then Fritz bots in the remaining bottom seeds. Index + 1 is the seed.
 */
function buildOrderedEntrants(
  tournamentId: string,
  maxPlayers: number,
  registrations: Array<{ user_id: string; username: string | null; rating: number | null }>,
): TournamentEntrant[] {
  const humans = sortBySeedRating(
    registrations.map((r) => ({
      userId: r.user_id,
      username: r.username ?? r.user_id.slice(0, 6),
      rating: r.rating ?? DEFAULT_RATING,
    })),
  );
  return [...humans, ...buildBotEntrants(tournamentId, Math.max(0, maxPlayers - humans.length))];
}

/**
 * The generate_tournament_bracket input, built from one ordered entrant list:
 * the quarterfinal pairs (via the shared QF_SEED_PAIRS pairing) and each
 * human's seed = their bracket position, so the stored seed is the seed the
 * bracket was built from (review B8).
 */
function buildBracketRpcInput(entrants: TournamentEntrant[]): {
  qfPairs: BracketQfPair[];
  seeds: BracketSeed[];
} {
  const qfPairs = pairSeededEntrants(entrants).map((slot) => {
    const player1Id = slot.player1?.userId ?? null;
    const player2Id = slot.player2?.userId ?? null;
    return {
      match_number: slot.matchNumber,
      player1_id: player1Id,
      player2_id: player2Id,
      bot_tier: matchBotTier(1, player1Id, player2Id),
    };
  });
  const seeds = entrants
    .map((entrant, idx) => ({ user_id: entrant.userId, seed: idx + 1 }))
    .filter((seed) => !isBotUserId(seed.user_id));
  return { qfPairs, seeds };
}

export function placementLabelForRank(placement: number | null): string | null {
  if (placement == null) return null;
  if (placement === 1) return 'Champion';
  if (placement === 2) return 'Runner-up';
  if (placement === 3) return 'Semifinalist';
  if (placement === 5) return 'Quarterfinalist';
  const mod10 = placement % 10;
  const mod100 = placement % 100;
  let suffix = 'th';
  if (mod10 === 1 && mod100 !== 11) suffix = 'st';
  else if (mod10 === 2 && mod100 !== 12) suffix = 'nd';
  else if (mod10 === 3 && mod100 !== 13) suffix = 'rd';
  return `${placement}${suffix} Place`;
}

function emitToUserIds(io: Server, userIds: Array<string | null | undefined>, event: string, payload: unknown): void {
  const targets = new Set(userIds.filter((userId): userId is string => Boolean(userId) && !isBotUserId(userId)));
  if (targets.size === 0) return;
  for (const sock of io.sockets.sockets.values()) {
    const userId: string | undefined = (sock.data as { userId?: string }).userId;
    if (!userId || !targets.has(userId)) continue;
    sock.emit(event, payload);
  }
}

async function selectHigherSeedWinner(
  tournamentId: string,
  player1Id: string,
  player2Id: string,
  persistence: EnginePersistence,
): Promise<string> {
  const regs = await persistence.fetchRegistrations(tournamentId);
  const player1Seed = regs.find((reg) => reg.user_id === player1Id)?.seed ?? Number.POSITIVE_INFINITY;
  const player2Seed = regs.find((reg) => reg.user_id === player2Id)?.seed ?? Number.POSITIVE_INFINITY;
  return player1Seed <= player2Seed ? player1Id : player2Id;
}

function playerNoShowReason(match: MatchRow, noShowUserId: string | null): string {
  if (!noShowUserId) return 'double_no_show';
  if (match.player1_id === noShowUserId) return 'player1_no_show';
  if (match.player2_id === noShowUserId) return 'player2_no_show';
  return 'no_show';
}

function isTournamentPlayable(
  tournament: { scheduled_start: string },
  now: Date = new Date(),
): boolean {
  return Date.parse(tournament.scheduled_start) <= now.getTime();
}

/**
 * A round-N match is fed by exactly two round-(N-1) matches: numbers 2M-1 and
 * 2M, where M is this match's number (SF1 ← QF1+QF2, SF2 ← QF3+QF4, F ← SF1+SF2).
 *
 * This is the bracket-exact gate (invariant T-INV-6). It is deliberately NOT
 * "the whole previous round is done" — SF1 may resolve while QF3/QF4 still play.
 * For human matches this is already how advancement works (a target reaches
 * `ready` only once both its slots are filled); this function applies the same
 * rule to bot-only auto-simulation, where there is no advancement trigger.
 */
async function areFeederMatchesComplete(
  tournamentId: string,
  round: 1 | 2 | 3,
  matchNumber: number,
  persistence: EnginePersistence,
): Promise<boolean> {
  if (round <= 1) return true;
  const feederNumbers = [matchNumber * 2 - 1, matchNumber * 2];
  const matches = await persistence.fetchMatches(tournamentId);
  const feeders = matches.filter(
    (m) => m.round === round - 1 && feederNumbers.includes(m.match_number),
  );
  if (feeders.length < 2) return false;
  return feeders.every((m) => m.status === 'completed' || m.status === 'bye');
}

/** Bot-vs-bot matches only auto-resolve after scheduled_start and once both feeder matches have finished. */
async function canAutoSimulateBotOnlyMatch(
  match: MatchRow,
  persistence: EnginePersistence,
  now: Date = new Date(),
): Promise<boolean> {
  const tournament = await persistence.fetchTournamentById(match.tournament_id);
  if (!tournament) return false;
  if (!isTournamentPlayable(tournament, now)) return false;
  if (!match.player1_id || !match.player2_id) return false;
  if (!isBotOnlyMatch(match)) return false;
  return areFeederMatchesComplete(
    match.tournament_id,
    match.round as 1 | 2 | 3,
    match.match_number,
    persistence,
  );
}

async function resolveBotOnlyMatch(
  io: Server,
  match: MatchRow,
  persistence: EnginePersistence,
  now: Date = new Date(),
): Promise<boolean> {
  if (!(await canAutoSimulateBotOnlyMatch(match, persistence, now))) return false;
  if (!match.player1_id || !match.player2_id) return false;
  if (!isBotOnlyMatch(match)) {
    if (isBotUserId(match.player1_id) || isBotUserId(match.player2_id)) {
      log.info({
        matchId: match.id,
        player1Id: match.player1_id,
        player2Id: match.player2_id,
      }, 'skipped auto-resolve because human participant exists');
    }
    return false;
  }
  if (match.status === 'completed' || match.status === 'bye') return false;
  const tournament = await persistence.fetchTournamentById(match.tournament_id);
  if (!tournament) return false;

  const winnerId = await selectHigherSeedWinner(
    match.tournament_id,
    match.player1_id,
    match.player2_id,
    persistence,
  );
  log.info({
    matchId: match.id,
    winnerId,
  }, 'auto-resolved bot-vs-bot');

  // `complete_tournament_match` only accepts a match in `ready`/`in_progress`
  // (state-machine transition T-f). A bot pair may still be `waiting` when a
  // reconcile/dispatch tick reaches it — promote it first.
  if (match.status === 'waiting') {
    await persistence.promoteTournamentMatch(match.id, 'ready', {
      readyAt: now.toISOString(),
      actor: 'bot_simulated',
    });
  }

  await applyMatchResult(io, {
    matchId: match.id,
    winnerId,
    player1Score: match.player1_id === winnerId ? tournament.win_target : 0,
    player2Score: match.player2_id === winnerId ? tournament.win_target : 0,
    winnerSource: 'game_over',
    statusReason: 'bot_simulated',
  }, persistence);
  return true;
}

async function writeTournamentCompletionActivity(
  tournamentId: string,
  placements: Array<{ userId: string; placement: number }>,
): Promise<void> {
  await Promise.all(
    placements.map(({ userId, placement }) =>
      writeTournamentActivity({
        userId,
        placement: placementLabelForRank(placement) ?? 'Tournament result',
        tournamentId,
      }),
    ),
  );
}

/**
 * Generate the full bracket for a tournament that's just hit start time.
 *
 *  1. Fetch registrations + profile ratings
 *  2. Seed players (highest rating = seed 1)
 *  3. Create 4 QF rows + 2 SF rows + 1 Final row (all rooms reserved)
 *  4. Auto-advance any QF that has a bye (player vs null) → the human wins by walkover
 *  5. Update tournament status to in_progress; emit bracket_generated
 *
 * `persistence` is injectable for tests; production passes nothing and gets
 * the real Supabase + in-memory rooms implementation.
 */
export async function generateBracket(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
  providedEntrants?: TournamentEntrant[],
): Promise<MatchRow[]> {
  const tournament = await persistence.fetchTournamentById(tournamentId);
  if (!tournament) throw new Error('Tournament not found');

  if (tournament.status === 'in_progress') {
    const existing = await persistence.fetchMatches(tournamentId);
    if (existing.length >= 7) return existing;
  }

  // A registration can land or leave between our read and the RPC's lock; the
  // RPC then raises registrations_changed and we re-read once. A second change
  // in the same breath is left to the next scheduler tick.
  for (let attempt = 1; ; attempt += 1) {
    const registrations = await persistence.fetchRegistrationsWithProfile(tournamentId);
    const eligible = registrations.filter((r) =>
      tournament.status === 'in_progress'
        ? r.status === 'registered' || r.status === 'active'
        : r.status === 'registered',
    );
    if (eligible.length < MIN_HUMANS_TO_START) {
      throw new Error('Not enough players to start');
    }
    const entrants = attempt === 1 && providedEntrants
      ? providedEntrants
      : buildOrderedEntrants(tournamentId, tournament.max_players, eligible);
    const { qfPairs, seeds } = buildBracketRpcInput(entrants);
    try {
      const result = await persistence.generateTournamentBracket({
        tournamentId,
        qfPairs,
        seeds,
        actor: 'scheduler',
      });
      if (result.repaired) {
        log.warn({ tournamentId, created: result.created }, 'repaired a partial bracket');
      }
      if (result.created || result.repaired) {
        // Broadcast — rooms dispatch at scheduled_start (humans) or immediately for bot-only pairs.
        io.emit('tournament:bracket_generated', { tournamentId });
      }
      return result.matches;
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'registrations_changed' && attempt === 1) continue;
      throw err;
    }
  }
}

/**
 * At scheduled_start, resolve bot-only quarterfinals that do not involve humans.
 * Later-round bot-only matches wait until the previous round is fully complete.
 */
export async function resolveWaitingBotOnlyQuarterfinals(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
  now: Date = new Date(),
): Promise<number> {
  const tournament = await persistence.fetchTournamentById(tournamentId);
  if (!tournament || !isTournamentPlayable(tournament, now)) return 0;

  const matches = await persistence.fetchMatches(tournamentId);
  let resolved = 0;
  for (const match of matches) {
    if (match.round !== 1) continue;
    if (match.status === 'completed' || match.status === 'bye') continue;
    if (!isBotOnlyMatch(match)) continue;
    const fresh = await persistence.fetchMatchById(match.id);
    if (fresh && (await resolveBotOnlyMatch(io, fresh, persistence, now))) {
      resolved += 1;
    }
  }
  if (resolved > 0) {
    log.info({
      tournamentId,
      resolved,
    }, 'resolved waiting quarterfinal bot pairs');
  }
  return resolved;
}

function matchHasHuman(match: Pick<MatchRow, 'player1_id' | 'player2_id'>): boolean {
  return !isBotOnlyMatch(match);
}

/**
 * At scheduled_start, dispatch waiting matches that involve at least one human.
 * Idempotent: skips matches already ready/in_progress/completed.
 */
export async function dispatchScheduledStartMatches(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
  now: Date = new Date(),
): Promise<number> {
  const tournament = await persistence.fetchTournamentById(tournamentId);
  if (!tournament || tournament.status !== 'in_progress') return 0;
  if (Date.parse(tournament.scheduled_start) > now.getTime()) return 0;

  const matches = await persistence.fetchMatches(tournamentId);
  let dispatched = 0;
  for (const match of matches) {
    let matchFailed = false;
    try {
      if (!match.player1_id || !match.player2_id) continue;
      if (match.status === 'completed' || match.status === 'bye') continue;
      if (!matchHasHuman(match)) continue;
      if (match.status === 'ready' || match.status === 'in_progress') continue;
      if (match.status !== 'waiting') continue;
      await dispatchTournamentMatch(io, match.id, { reason: 'bracket_generated', now }, persistence);
      if (isBotUserId(match.player1_id) || isBotUserId(match.player2_id)) {
        log.info({
          tournamentId,
          matchId: match.id,
        }, 'human-vs-bot playable match ready');
      }
      dispatched += 1;
      const updated = await persistence.fetchMatchById(match.id);
      if (updated) {
        await resolveBotOnlyMatch(io, updated, persistence, now);
      }
    } catch (err) {
      // One match must not stop this tournament's other dispatches; the next tick retries it.
      matchFailed = true;
      alertTournamentMatchStepFailed('start_dispatch', match, err);
    } finally {
      if (!matchFailed) clearTournamentMatchStepAlert('start_dispatch', match.id);
    }
  }
  const botResolved = await resolveWaitingBotOnlyQuarterfinals(io, tournamentId, persistence, now);
  if (dispatched > 0 || botResolved > 0) {
    log.info({ tournamentId, dispatched, botResolved }, 'scheduled_start batch');
  }
  return dispatched;
}

/**
 * Record a tournament-match result and propagate the winner forward.
 *
 * All of the state change — completion, participant + score validation, loser
 * elimination, bracket advancement, and (for the final) tournament completion —
 * happens inside ONE Postgres transaction via `complete_tournament_match`,
 * which locks the match row `FOR UPDATE`. Concurrent producers for the same
 * match therefore serialise at the DB: the first writes, the rest come back
 * with `applied: false`. This function is now just: call the RPC, then emit
 * sockets / dispatch the advanced match from its structured result.
 *
 * Idempotent: re-submitting the same winner on a completed match is a no-op.
 * A *different* winner on a completed match returns `conflict: true`; we accept
 * the recorded outcome and log it (should be impossible — see T-INV-2 / D-3).
 */
export async function applyMatchResult(
  io: Server,
  params: {
    matchId: string;
    winnerId: string;
    player1Score: number;
    player2Score: number;
    byeWalkover?: boolean;
    winnerSource?: 'game_over' | 'no_show' | 'forfeit';
    statusReason?: string | null;
    noShowUserId?: string | null;
    forfeitUserId?: string | null;
    /**
     * Default true: a next-round match this result makes ready is dispatched
     * (room + match_ready) and bot-only pairs resolved. The event backstop
     * passes false: it resolves the rest of the bracket itself.
     */
    dispatchAdvanced?: boolean;
  },
  persistence: EnginePersistence = defaultEnginePersistence,
): Promise<void> {
  const match = await persistence.fetchMatchById(params.matchId);
  if (!match) throw new Error('Match not found');

  let result: Awaited<ReturnType<typeof persistence.completeTournamentMatch>>;
  try {
    result = await persistence.completeTournamentMatch({
      matchId: match.id,
      winnerId: params.winnerId,
      winnerSource: params.winnerSource ?? (params.byeWalkover ? null : 'game_over'),
      statusReason: params.statusReason ?? null,
      reportedPlayer1Score: params.player1Score,
      reportedPlayer2Score: params.player2Score,
      noShowUserId: params.noShowUserId ?? null,
      forfeitUserId: params.forfeitUserId ?? null,
      byeWalkover: params.byeWalkover ?? false,
      actor: params.winnerSource ?? (params.byeWalkover ? 'bye_walkover' : 'game_over'),
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    if (TOURNAMENT_INVARIANT_RPC_ERRORS.has(code)) {
      log.error({
        event: 'tournament_invariant_violation',
        kind: code,
        matchId: match.id,
        tournamentId: match.tournament_id,
        attemptedWinnerId: params.winnerId,
      }, `tournament invariant violation (T-15): ${code}`);
      alertTournamentInvariantViolation(code, match, {
        attemptedWinnerId: params.winnerId,
        attemptedSource: params.winnerSource ?? 'game_over',
        player1Id: match.player1_id,
        player2Id: match.player2_id,
      });
    }
    throw err;
  }

  if (!result.applied) {
    if (result.conflict) {
      // T-INV-3 / Decisions D-3: a genuine winner disagreement between two
      // producers should be impossible if the participant check and the state
      // machine are correct. Not fatal — we take the RPC's recorded answer —
      // but it must be greppable/alertable in production if it ever happens.
      log.warn({
        event: 'tournament_match_winner_conflict',
        matchId: match.id,
        tournamentId: match.tournament_id,
        recordedWinnerId: result.winner_id,
        attemptedWinnerId: params.winnerId,
        attemptedSource: params.winnerSource ?? 'game_over',
      }, 'tournament_match_winner_conflict');
      // T-15: was log-only, so it surfaced only when someone read the logs after
      // a player complained. Fingerprinted by matchId so N retries of the same
      // conflict collapse into one Sentry issue rather than a burst of unrelated
      // alerts; a spike *across* matches (many issues) is the systemic signal.
      // Not user-attributed — this is a state-machine/concurrency bug, not a
      // tamper, and tournament conflicts have no queryable store to count per
      // tournament (log-only), so per-actor escalation à la DF-G2 doesn't apply.
      Sentry.captureMessage('[tournament] winner conflict — two producers disagreed on a completed match', {
        level: 'warning',
        fingerprint: ['tournament-winner-conflict', match.id],
        tags: {
          tournament_alert: 'match_winner_conflict',
          tournament_id: match.tournament_id,
          match_id: match.id,
        },
        extra: {
          recordedWinnerId: result.winner_id,
          attemptedWinnerId: params.winnerId,
          attemptedSource: params.winnerSource ?? 'game_over',
        },
      });
    } else {
      log.info({
        matchId: match.id,
        tournamentId: match.tournament_id,
        winnerId: params.winnerId,
      }, 'result already applied by a concurrent writer');
    }
    return;
  }

  // ── this call is the one that completed the match ──
  emitToUserIds(io, [match.player1_id, match.player2_id], 'tournament:match_completed', {
    tournamentId: match.tournament_id,
    matchId: match.id,
    round: match.round,
    roomCode: match.room_code,
    winnerId: result.winner_id,
    winnerSource: result.winner_source ?? 'game_over',
  });

  if (result.round_now_complete) {
    const regs = await persistence.fetchRegistrations(match.tournament_id);
    emitToUserIds(io, regs.map((reg) => reg.user_id), 'tournament:round_completed', {
      tournamentId: match.tournament_id,
      round: match.round,
    });
  }

  if (result.tournament_completed) {
    await finalizeCompletedTournament(
      io,
      match.tournament_id,
      result.winner_id ?? params.winnerId,
      result.placements ?? [],
    );
    return;
  }

  if (result.advance_target_missing) {
    log.warn({
      event: 'tournament_advance_target_missing',
      matchId: match.id,
      tournamentId: match.tournament_id,
      round: match.round,
      matchNumber: match.match_number,
    }, 'match completed but its next-round row is missing — bracket may be corrupt');
    alertTournamentInvariantViolation('advance_target_missing', match, {
      round: match.round,
      matchNumber: match.match_number,
      winnerId: result.winner_id,
    });
    return;
  }

  if (result.advanced_to_match_id) {
    if (!result.advanced_to_status) {
      // The advance UPDATE matched no row: the fed slot is already occupied by a
      // *different* winner (double advancement / T-INV-5). The completion above
      // is durable, so we do not roll back — but this bracket is now corrupt.
      log.error({
        event: 'tournament_invariant_violation',
        kind: 'double_advancement',
        matchId: match.id,
        tournamentId: match.tournament_id,
        nextMatchId: result.advanced_to_match_id,
      }, 'tournament invariant violation (T-15): double_advancement');
      alertTournamentInvariantViolation('double_advancement', match, {
        nextMatchId: result.advanced_to_match_id,
        slot: result.advanced_to_slot,
        winnerId: result.winner_id,
      });
    }
    log.info({
      fromMatchId: match.id,
      nextMatchId: result.advanced_to_match_id,
      slot: result.advanced_to_slot,
      winnerId: result.winner_id,
    }, 'winner advanced');
    io.emit('tournament:match_updated', {
      tournamentId: match.tournament_id,
      matchId: result.advanced_to_match_id,
    });
    if (result.advanced_to_status === 'ready' && params.dispatchAdvanced !== false) {
      await dispatchTournamentMatch(
        io,
        result.advanced_to_match_id,
        { reason: 'winner_advanced' },
        persistence,
      );
      const refreshed = await persistence.fetchMatchById(result.advanced_to_match_id);
      if (refreshed) {
        await resolveBotOnlyMatch(io, refreshed, persistence, new Date());
      }
    }
  }
}

/**
 * After `complete_tournament_match` has finished the round-3 match, the DB
 * transaction has already written: every placement, the tournament's
 * `status='completed'` + `winner_id`, and the champion's registration
 * `status='winner'`. All that's left is the two side effects the RPC can't do:
 * the social activity feed and the `tournament:completed` broadcast.
 */
async function finalizeCompletedTournament(
  io: Server,
  tournamentId: string,
  winnerUserId: string,
  placements: Array<{ user_id: string; placement: number }>,
): Promise<void> {
  await writeTournamentCompletionActivity(
    tournamentId,
    placements
      .filter((p) => !isBotUserId(p.user_id))
      .map((p) => ({ userId: p.user_id, placement: p.placement })),
  );
  log.info({ tournamentId, winnerId: winnerUserId }, 'champion');
  io.emit('tournament:completed', { tournamentId, winnerId: winnerUserId });
}

export async function cancelTournament(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
  /** Recorded on the row (cancel_reason) so a cancelled event says why. */
  reason: string | null = null,
): Promise<void> {
  await persistence.updateTournamentStatus(tournamentId, 'cancelled', { cancel_reason: reason });
  io.emit('tournament:cancelled', { tournamentId });
}

/** Helper for the scheduler: open registration on a tournament. */
export async function openRegistration(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
): Promise<void> {
  await persistence.updateTournamentStatus(tournamentId, 'registration_open');
  io.emit('tournament:registration_open', { tournamentId });
}

/**
 * Helper for the scheduler: close registration and either start the bracket
 * or cancel if too few players.
 */
export async function closeRegistrationAndStart(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
): Promise<{ started: boolean; reason?: string }> {
  const regs = await persistence.fetchRegistrations(tournamentId);
  const active = regs.filter((r) => r.status === 'registered');
  if (active.length < MIN_HUMANS_TO_START) {
    // Registrations leave 'registered' when the bracket is generated (one
    // transaction also moves the tournament to in_progress). Another starter
    // (the Fritz Cup route, or a second tick) may have just done that: only a
    // tournament still in registration is cancelled for lack of players.
    const current = await persistence.fetchTournamentById(tournamentId);
    if (current && current.status !== 'upcoming' && current.status !== 'registration_open') {
      return { started: current.status === 'in_progress', reason: 'already_left_registration' };
    }
    await cancelTournament(io, tournamentId, persistence, 'not_enough_players');
    return { started: false, reason: 'not_enough_players' };
  }
  const tournament = await persistence.fetchTournamentById(tournamentId);
  if (!tournament) throw new Error('Tournament not found');
  const regsWithProfile = await persistence.fetchRegistrationsWithProfile(tournamentId);
  const eligible = regsWithProfile.filter((r) => r.status === 'registered');
  const entrants = buildOrderedEntrants(tournamentId, tournament.max_players, eligible);
  await generateBracket(io, tournamentId, persistence, entrants);
  return { started: true };
}

/** status_reason marking the single A6 deadline extension (see below). */
export const BOTH_JOINED_START_RETRY_REASON = 'all_joined_start_retry';

/** status_reason labels for an in-progress match decided without a finished game. */
export type InProgressResolutionLabels = {
  /** Decided by the live score. */
  higherScore: string;
  /** Live score tied: the higher seed advances. */
  higherSeed: string;
  /** No live game could be found or restored: the higher seed advances. */
  missingSessionHigherSeed: string;
  /** The game never got past the pre-game draw: the higher seed advances. */
  pregameHigherSeed: string;
  /** The room's game finished but its result is internally inconsistent: the higher seed advances. */
  unrecoverableResultHigherSeed: string;
};

export const MATCH_CAP_LABELS: InProgressResolutionLabels = {
  higherScore: 'match_cap_higher_score',
  higherSeed: 'match_cap_higher_seed',
  missingSessionHigherSeed: 'match_cap_missing_session_higher_seed',
  pregameHigherSeed: 'match_cap_pregame_higher_seed',
  unrecoverableResultHigherSeed: 'match_cap_unrecoverable_result_higher_seed',
};

/**
 * Errors that mean a finished room game cannot be this match's result (the
 * room is not this match's game, or its outcome is inconsistent): retrying
 * cannot help.
 */
const TERMINAL_RESULT_CORRUPT_ERRORS = new Set([
  'tournament_seat_mismatch',
  'tournament_room_match_mismatch',
  'tournament_game_over_without_winner',
  'tournament_terminal_state_inconsistent',
  'winner_not_participant',
  'score_inconsistent',
]);

/**
 * A finished game: from the live room, or (no room in memory: after a restart,
 * or after room cleanup) from its stored terminal live session or its
 * room_match_logs archive.
 */
type FinishedGame = {
  roomCode: string;
  source: 'room' | 'live_session' | 'archive';
  /** Set when the stored copy says the game ended but is not a readable finished game. */
  corrupt?: string;
  /** The tournament match the room says it belongs to, if it says. */
  roomMatchId: string | null;
  state: GameState;
  /** Seat id → tournament user id (null for Fritz seats: their seat id is their id). */
  rosterUserIdOf: (seatId: string) => string | null | undefined;
  /** The live room, if any (its game-over persist status is honoured and updated). */
  room: Room | null;
};

/**
 * Record a finished game whose tournament result never reached the database
 * (the game-over persist gave up, or the process restarted before it ran),
 * through the same finalizer the game-over path uses
 * (applyTournamentGameOverFromRoom: seat orientation, identity check, locked
 * idempotent RPC, bracket advancement, placements). The winner is the engine's
 * `state.winnerId`, mapped to its tournament id exactly as the game-over path
 * maps it. Returns false (nothing done) while the room's own game-over persist
 * is still in flight. Transient failures throw (the next tick retries); a
 * result that is internally corrupt is alerted and the higher seed advances
 * under `unrecoverableResultHigherSeed`, so it is never retried forever.
 */
async function recordFinishedGame(
  io: Server,
  match: MatchRow,
  game: FinishedGame,
  persistence: EnginePersistence,
  labels: InProgressResolutionLabels,
  options: { dispatchAdvanced?: boolean },
): Promise<boolean> {
  if (game.room?.gameOverPersistStatus === 'pending') return false;
  const { state } = game;
  try {
    if (game.corrupt) throw new Error(game.corrupt);
    if (game.roomMatchId && game.roomMatchId !== match.id) throw new Error('tournament_room_match_mismatch');
    if (!state.winnerId) throw new Error('tournament_game_over_without_winner');
    if (state.playerIds.length !== 2 || !state.playerIds.includes(state.winnerId) || state.playerIds.some((id) => !state.players[id])) {
      throw new Error('tournament_terminal_state_inconsistent');
    }
    const tournamentIdOf = (seatId: string): string | null =>
      game.rosterUserIdOf(seatId) ?? (isBotUserId(seatId) ? seatId : null);
    const winnerUserId = tournamentIdOf(state.winnerId);
    if (!winnerUserId) throw new Error('tournament_seat_mismatch');
    log.info({ matchId: match.id, roomCode: game.roomCode, winnerUserId, source: game.source }, 'recording a finished game whose tournament result was never recorded');
    await applyTournamentGameOverFromRoom(io, { code: game.roomCode, scheduledTournamentMatchId: match.id, scheduledTournamentId: match.tournament_id }, {
      winnerUserId,
      player1Score: 0,
      player2Score: 0,
      seatScores: state.playerIds.map((seatId) => ({ playerId: tournamentIdOf(seatId), score: state.players[seatId]?.score ?? 0 })),
      dispatchAdvanced: options.dispatchAdvanced,
    }, persistence);
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    if (!TERMINAL_RESULT_CORRUPT_ERRORS.has(code) || !match.player1_id || !match.player2_id) throw err;
    alertTournamentAnomaly(
      'terminal_result_unrecoverable',
      { tournamentId: match.tournament_id, matchId: match.id, roomCode: game.roomCode },
      { error: code, source: game.source, resolution: labels.unrecoverableResultHigherSeed },
    );
    await applyMatchResult(io, {
      matchId: match.id,
      winnerId: await selectHigherSeedWinner(match.tournament_id, match.player1_id, match.player2_id, persistence),
      player1Score: 0,
      player2Score: 0,
      winnerSource: 'game_over',
      statusReason: labels.unrecoverableResultHigherSeed,
      dispatchAdvanced: options.dispatchAdvanced,
    }, persistence);
  }
  if (game.room) markGameOverPersistSucceeded(game.room);
  return true;
}

function finishedGameFromRoom(room: Room): FinishedGame {
  const roster = getRoomRoster(room.code);
  return {
    roomCode: room.code,
    source: 'room',
    roomMatchId: room.scheduledTournamentMatchId ?? null,
    state: room.state!,
    rosterUserIdOf: (seatId) => roster.find((p) => p.id === seatId)?.userId,
    room,
  };
}

const TERMINAL_SESSION_ERRORS = new Set(['snapshot_terminal', 'snapshot_terminal_state']);

/** What the persisted copies of a match's room hold. */
type PersistedGame = {
  /** This match's finished game, if a trustworthy persisted copy has one. */
  finished: FinishedGame | null;
  /** The live session under the room code belongs to another tournament match. */
  foreignLiveSession: boolean;
};

/** How many archives under one room code are considered (newest first). */
const ARCHIVE_CANDIDATES = 5;

/**
 * The finished game of a match whose room is not in memory, from what was
 * persisted. A finished game is never restored into a room (restore refuses
 * terminal sessions); its final state and roster are read instead. Most
 * trusted first:
 *
 *  1. the live session (room_live_sessions) when it names this match
 *     (`scheduled_tournament_match_id`), written `game_over` by the game-over
 *     commit. One that names another match is foreign (a room-code collision):
 *     alerted, never used, and the archive is consulted instead;
 *  2. an archive (room_match_logs, written by room cleanup before it deletes
 *     the live session; completed archives are never deleted) whose
 *     `summary.scheduledTournamentMatchId` is this match. An archive that names
 *     another match is never used, whatever its players;
 *  3. only for archives written before that field existed: same room code,
 *     completed, exactly this match's two players, archived after the match
 *     started.
 *
 * `finished` is null when no trustworthy copy holds a finished game for this
 * match (a game in progress, nothing stored, or only foreign copies). Throws
 * when persistence cannot be read (retried later).
 */
async function persistedGameFor(match: MatchRow): Promise<PersistedGame> {
  const roomCode = match.room_code!.trim().toUpperCase();
  const { loadLiveRoomSession } = await import('../multiplayer/roomLivePersistence');
  const loaded = await loadLiveRoomSession(roomCode);
  if (loaded.kind === 'persistence_unavailable') throw new Error('room_persistence_unavailable');
  let foreignLiveSession = false;
  if (loaded.kind === 'found') {
    const { row } = loaded;
    if (row.scheduled_tournament_match_id && row.scheduled_tournament_match_id !== match.id) {
      foreignLiveSession = true;
      alertTournamentAnomaly(
        'tournament_foreign_live_session',
        { tournamentId: match.tournament_id, matchId: match.id, roomCode },
        { foreignMatchId: row.scheduled_tournament_match_id, foreignStatus: row.status },
      );
    } else {
      const ended = row.status === 'game_over' || Boolean(row.game_state?.gameOver);
      if (!ended) return { finished: null, foreignLiveSession };
      const consistent = row.status === 'game_over' && row.game_state?.gameOver === true;
      return {
        foreignLiveSession,
        finished: {
          roomCode: row.room_code,
          source: 'live_session',
          corrupt: consistent ? undefined : 'tournament_terminal_state_inconsistent',
          roomMatchId: row.scheduled_tournament_match_id,
          state: row.game_state ?? ({ playerIds: [], players: {}, winnerId: null } as unknown as GameState),
          rosterUserIdOf: (seatId) => row.roster.find((p) => p.seatId === seatId)?.userId,
          room: null,
        },
      };
    }
  }
  // No live session of this match (cleanup deleted it after archiving), an
  // unreadable one, or a foreign one.
  const { queryRecentPersistedRoomMatchLogsByRoomCode } = await import('../multiplayer/roomMatchLogPersistence');
  const archives = await queryRecentPersistedRoomMatchLogsByRoomCode(roomCode, ARCHIVE_CANDIDATES);
  for (const archived of archives) {
    const state = archived.state_snapshot as GameState | null | undefined;
    if (archived.status !== 'completed' || !state?.gameOver) continue;
    // Exact match id when the archive records one; legacy identity otherwise.
    if (!archiveBelongsToMatch(archived, match)) continue;
    const archivedMatchId = archived.summary?.scheduledTournamentMatchId;
    return {
      foreignLiveSession,
      finished: {
        roomCode,
        source: 'archive',
        roomMatchId: typeof archivedMatchId === 'string' ? archivedMatchId : null,
        state,
        rosterUserIdOf: (seatId) => archived.participants.find((p) => p.id === seatId)?.userId,
        room: null,
      },
    };
  }
  return { finished: null, foreignLiveSession };
}

/**
 * An in-progress match whose game has finished: record it now (each reconcile
 * tick, and boot recovery) rather than waiting for the cap. The live room if
 * the process holds it; otherwise the persisted finished game, never a
 * restored room. True when this call recorded the result.
 */
export async function recordFinishedGameIfAny(
  io: Server,
  match: MatchRow,
  persistence: EnginePersistence,
  labels: InProgressResolutionLabels = MATCH_CAP_LABELS,
  options: { dispatchAdvanced?: boolean } = {},
): Promise<boolean> {
  if (match.status !== 'in_progress' || !match.room_code || !match.player1_id || !match.player2_id) return false;
  const room = peekMatchRoom(persistence, match);
  if (room) {
    if (!room.state?.gameOver) return false;
    return recordFinishedGame(io, match, finishedGameFromRoom(room), persistence, labels, options);
  }
  const { finished } = await persistedGameFor(match);
  if (!finished) return false;
  return recordFinishedGame(io, match, finished, persistence, labels, options);
}

/**
 * Decide an in-progress match that has no finished game, from its live room:
 * higher score wins, a tie goes to the higher seed. A room lost to a restart is
 * restored first (dispatch with reason `repair` restores before it creates), so
 * the live score counts. If there is still no live game after that, the live
 * session is gone: that is reported as an anomaly and recorded under its own
 * status_reason (`missingSessionHigherSeed`), never passed off as a tied score.
 * A room still in the pre-game draw gets `pregameHigherSeed` likewise.
 *
 * Recorded through applyMatchResult like any result (locked, idempotent,
 * advances the bracket, the final writes placements); the room is then closed
 * to further play. A game that already ended is recorded from its own result
 * (recordFinishedGame), also after a restart from its stored session; false only while its game-over persist is still in
 * flight. Throws tournament_seat_mismatch if a live room's seats are not the
 * match's players.
 */
export async function resolveInProgressMatchFromRoom(
  io: Server,
  match: MatchRow,
  persistence: EnginePersistence,
  now: Date,
  labels: InProgressResolutionLabels,
  options: { dispatchAdvanced?: boolean } = {},
): Promise<boolean> {
  if (!match.player1_id || !match.player2_id || !match.room_code) return false;

  let room = peekMatchRoom(persistence, match);
  if (!room) {
    // A game that finished before a restart (or before room cleanup) is
    // recorded from what was persisted, not restored and never re-decided.
    const persisted = await persistedGameFor(match);
    if (persisted.finished) return recordFinishedGame(io, match, persisted.finished, persistence, labels, options);
    // A foreign live session under this room code is not this match's game:
    // it is never restored or overwritten here; with no exact copy of this
    // match's game, the session is lost (the missing-session path below).
    if (!persisted.foreignLiveSession) {
      try {
        await dispatchTournamentMatch(io, match.id, { reason: 'repair', now }, persistence);
      } catch (err) {
        const code = err instanceof Error ? err.message : String(err);
        if (!TERMINAL_SESSION_ERRORS.has(code) && code !== 'tournament_room_session_mismatch') throw err;
        // The stored session became terminal, or foreign, meanwhile.
        const stored = await persistedGameFor(match);
        if (stored.finished) return recordFinishedGame(io, match, stored.finished, persistence, labels, options);
        // Refused as another match's session or room: this match's is lost.
        if (!stored.foreignLiveSession && code !== 'tournament_room_session_mismatch') throw err;
      }
    }
    room = peekMatchRoom(persistence, match);
  }
  // A game that already ended is recorded from its own result (the game-over
  // finalizer), never decided again by score or seed.
  if (room?.state?.gameOver) return recordFinishedGame(io, match, finishedGameFromRoom(room), persistence, labels, options);

  let player1Score = 0;
  let player2Score = 0;
  let statusReason: string;
  let winnerId: string;
  if (!room?.state) {
    // In progress in the database, but no live game here even after a restore
    // attempt: the session was lost. Do not hide it.
    alertTournamentAnomaly(
      'missing_live_session',
      { tournamentId: match.tournament_id, matchId: match.id, roomCode: match.room_code },
      { roomFound: Boolean(room), resolution: labels.missingSessionHigherSeed },
    );
    statusReason = labels.missingSessionHigherSeed;
    winnerId = await selectHigherSeedWinner(match.tournament_id, match.player1_id, match.player2_id, persistence);
  } else if (room.preGameDraw) {
    alertTournamentAnomaly(
      'pregame_never_completed',
      { tournamentId: match.tournament_id, matchId: match.id, roomCode: match.room_code },
      { resolution: labels.pregameHigherSeed },
    );
    statusReason = labels.pregameHigherSeed;
    winnerId = await selectHigherSeedWinner(match.tournament_id, match.player1_id, match.player2_id, persistence);
  } else {
    const state = room.state;
    const roster = getRoomRoster(room.code);
    const oriented = orientSeatScoresToMatch(
      match,
      state.playerIds.map((seatId) => ({
        playerId: roster.find((p) => p.id === seatId)?.userId ?? (isBotUserId(seatId) ? seatId : null),
        score: state.players[seatId]?.score ?? 0,
      })),
    );
    if (!oriented) {
      log.warn({ matchId: match.id, roomCode: room.code, seats: state.playerIds }, 'in-progress resolution: room seats do not match the tournament match players');
      throw new Error('tournament_seat_mismatch');
    }
    ({ player1Score, player2Score } = oriented);
    const byScore = player1Score !== player2Score;
    winnerId = byScore
      ? (player1Score > player2Score ? match.player1_id : match.player2_id)
      : await selectHigherSeedWinner(match.tournament_id, match.player1_id, match.player2_id, persistence);
    statusReason = byScore ? labels.higherScore : labels.higherSeed;
  }
  log.info({ matchId: match.id, winnerId, player1Score, player2Score, statusReason }, 'deciding an in-progress match without a finished game');

  await applyMatchResult(io, {
    matchId: match.id,
    winnerId,
    player1Score,
    player2Score,
    winnerSource: 'game_over',
    statusReason,
    dispatchAdvanced: options.dispatchAdvanced,
  }, persistence);

  if (room) closeTournamentRoom(room, now);
  return true;
}

/** No further play in a decided match's room (the same latch a forfeit uses). */
export function closeTournamentRoom(room: Room, now: Date): void {
  if (!room.abandonedAt) {
    room.abandonedAt = now.toISOString();
    room.abandonedReason = 'abandon';
  }
  disarmTournamentTurnClock(room.code);
}

/**
 * Per-match hard cap. A match in progress for longer than
 * TOURNAMENT_MATCH_CAP_MS since its persisted `started_at` is decided from the
 * live room (resolveInProgressMatchFromRoom, MATCH_CAP_LABELS). `started_at`
 * is in the database, so a restart cannot reset the cap.
 * True when this call recorded the result.
 */
async function enforceTournamentMatchCap(
  io: Server,
  match: MatchRow,
  persistence: EnginePersistence,
  now: Date,
): Promise<boolean> {
  const startedMs = Date.parse(match.started_at ?? '');
  if (!Number.isFinite(startedMs) || now.getTime() - startedMs < tournamentMatchCapMs()) return false;
  return resolveInProgressMatchFromRoom(io, match, persistence, now, MATCH_CAP_LABELS);
}

/**
 * The in-memory room of this match: the room under its code, unless that room
 * belongs to another match (a legacy room-code collision), which is never
 * read, recorded or closed as this match's room. Alerted.
 */
export function peekMatchRoom(
  persistence: EnginePersistence,
  match: Pick<MatchRow, 'id' | 'tournament_id' | 'room_code'>,
): Room | null {
  if (!match.room_code) return null;
  const room = peekTournamentRoom(persistence, match.room_code);
  if (room?.scheduledTournamentMatchId && room.scheduledTournamentMatchId !== match.id) {
    alertTournamentAnomaly(
      'tournament_foreign_live_session',
      { tournamentId: match.tournament_id, matchId: match.id, roomCode: match.room_code },
      { foreignMatchId: room.scheduledTournamentMatchId, stage: 'in_memory_room' },
    );
    return null;
  }
  return room;
}

export function peekTournamentRoom(persistence: EnginePersistence, roomCode: string): Room | null {
  try {
    return persistence.getRoom(roomCode);
  } catch {
    return null;
  }
}

/**
 * Who advances from a match whose game never started, by attendance: the one
 * player who joined beats the one who did not; an absent human never beats
 * Fritz (Fritz advances, the human is the no-show); otherwise (both humans
 * absent, or both present but the game never started) the higher seed advances
 * administratively with no no-show recorded.
 */
export async function decideUnstartedMatchByAttendance(
  match: MatchRow,
  persistence: EnginePersistence,
): Promise<{ winnerId: string; noShowUserId: string | null }> {
  if (!match.player1_id || !match.player2_id) throw new Error('match_players_missing');
  if (match.player1_joined_at && !match.player2_joined_at) {
    return { winnerId: match.player1_id, noShowUserId: match.player2_id };
  }
  if (match.player2_joined_at && !match.player1_joined_at) {
    return { winnerId: match.player2_id, noShowUserId: match.player1_id };
  }
  if (isBotUserId(match.player1_id) && !isBotUserId(match.player2_id)) {
    return { winnerId: match.player1_id, noShowUserId: match.player2_id };
  }
  if (isBotUserId(match.player2_id) && !isBotUserId(match.player1_id)) {
    return { winnerId: match.player2_id, noShowUserId: match.player1_id };
  }
  return {
    winnerId: await selectHigherSeedWinner(match.tournament_id, match.player1_id, match.player2_id, persistence),
    noShowUserId: null,
  };
}

/** The status_reason a no-show records (player1_no_show / player2_no_show). */
export function noShowStatusReason(match: MatchRow, noShowUserId: string): string {
  return playerNoShowReason(match, noShowUserId);
}

export { selectHigherSeedWinner };

/**
 * Single-instance first-release reconciliation for expired ready matches.
 *
 * This uses DB-persisted `ready_deadline_at` values and polling instead of
 * process-local timers so it survives restarts. Before multi-instance scale,
 * this must move behind a DB lease/lock so only one worker resolves deadlines.
 */
export async function reconcileExpiredReadyMatches(
  io: Server,
  now: Date = new Date(),
  persistence: EnginePersistence = defaultEnginePersistence,
  /**
   * In-progress tournaments the caller already read. The scheduler tick
   * fetches exactly this set immediately before calling here, so without it
   * the same query runs twice every 30 seconds — 2,880 duplicates a day,
   * players or no players. Omit it and the standalone read still happens.
   */
  inProgressTournaments?: ScheduledTournamentRow[],
): Promise<number> {
  const tournaments = inProgressTournaments
    ?? (persistence.fetchTournamentsByStatus
      ? await persistence.fetchTournamentsByStatus(['in_progress'])
      : []);
  let resolvedCount = 0;
  for (const tournament of tournaments) {
    let tournamentFailed = false;
    try {
      const matches = await persistence.fetchMatches(tournament.id);
      for (const match of matches) {
        let matchFailed = false;
        try {
          if (match.status === 'in_progress') {
            if (await recordFinishedGameIfAny(io, match, persistence)) {
              resolvedCount += 1;
              continue;
            }
            if (await enforceTournamentMatchCap(io, match, persistence, now)) resolvedCount += 1;
            continue;
          }
          if (match.status !== 'ready' || !match.ready_deadline_at) continue;
          if (Date.parse(tournament.scheduled_start) > now.getTime()) continue;
          if (await resolveBotOnlyMatch(io, match, persistence, now)) {
            resolvedCount += 1;
            continue;
          }
          if (Date.parse(match.ready_deadline_at) >= now.getTime()) continue;
          if (!match.player1_id || !match.player2_id) continue;
          const everyoneJoined = allHumanPlayersJoined(match);
          if (everyoneJoined && match.room_code) {
            let roomExists = false;
            let roomStarted = false;
            try {
              const room = persistence.getRoom(match.room_code);
              roomExists = true;
              roomStarted = Boolean(room.state);
            } catch {
              /* room missing — fall through to the rehydrate branch below */
            }
            if (roomStarted) {
              await persistence.updateMatch(match.id, {
                status: 'in_progress',
                started_at: match.started_at ?? now.toISOString(),
                status_reason: null,
              });
              continue;
            }
            // A6: every player is here but the game never started (a slow or
            // failed start). That is not a no-show. Extend the deadline once and
            // re-send match_ready: the clients re-attach, and the attach handler's
            // normal start path runs again. Only a second expiry resolves.
            if (roomExists && match.status_reason !== BOTH_JOINED_START_RETRY_REASON) {
              await persistence.updateMatch(match.id, {
                ready_deadline_at: new Date(now.getTime() + TOURNAMENT_MATCH_READY_WINDOW_MS).toISOString(),
                status_reason: BOTH_JOINED_START_RETRY_REASON,
              });
              await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true }, persistence);
              log.warn({ matchId: match.id, roomCode: match.room_code }, 'all players joined but game not started; deadline extended once, match_ready re-sent');
              continue;
            }
          }

          const hasHumanPlayer = !isBotOnlyMatch(match);
          if (hasHumanPlayer && match.room_code) {
            try {
              persistence.getRoom(match.room_code);
            } catch {
              await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true }, persistence);
              await persistence.updateMatch(match.id, {
                ready_deadline_at: new Date(now.getTime() + TOURNAMENT_MATCH_READY_WINDOW_MS).toISOString(),
                status_reason: 'room_rehydrated_deadline_extended',
              });
              log.info({
                matchId: match.id,
                roomCode: match.room_code,
              }, 'ready room missing; rehydrated before no-show');
              continue;
            }
          }

          const decided = await decideUnstartedMatchByAttendance(match, persistence);
          log.info({
            matchId: match.id,
            userId: decided.noShowUserId,
            reason: playerNoShowReason(match, decided.noShowUserId),
          }, 'marking loss');

          await applyMatchResult(
            io,
            {
              matchId: match.id,
              winnerId: decided.winnerId,
              player1Score: match.player1_id === decided.winnerId ? tournament.win_target : 0,
              player2Score: match.player2_id === decided.winnerId ? tournament.win_target : 0,
              winnerSource: 'no_show',
              statusReason: decided.noShowUserId
                ? playerNoShowReason(match, decided.noShowUserId)
                : everyoneJoined
                  // Present players whose game would not start even after the one
                  // extension: resolved, but never recorded as a no-show.
                  ? 'start_failed_after_retry_higher_seed_advanced'
                  : 'double_no_show_higher_seed_advanced',
              noShowUserId: decided.noShowUserId,
            },
            persistence,
          );
          resolvedCount += 1;
        } catch (err) {
          // One match must not stop the rest of the tick; the next tick retries it.
          matchFailed = true;
          alertTournamentMatchStepFailed('reconcile', match, err);
        } finally {
          if (!matchFailed) clearTournamentMatchStepAlert('reconcile', match.id);
        }
      }
    } catch (err) {
      // One tournament (e.g. its matches could not be read) must not stop the others.
      tournamentFailed = true;
      alertTournamentStepFailed('reconcile', tournament.id, err);
    } finally {
      if (!tournamentFailed) clearTournamentStepAlert('reconcile', tournament.id);
    }
  }
  return resolvedCount;
}

export const TOURNAMENT_CONFIG = {
  MIN_HUMANS_TO_START,
  DEFAULT_RATING,
  REGISTRATION_OPEN_LEAD_MIN: 30,
  REGISTRATION_CLOSE_LEAD_MIN: 2,
} as const;

/** Registration window timestamps aligned with seed SQL and TOURNAMENT_CONFIG. */
export function computeTournamentRegistrationTimestamps(scheduledStartMs: number): {
  registration_open_at: string;
  registration_close_at: string;
} {
  const { REGISTRATION_OPEN_LEAD_MIN, REGISTRATION_CLOSE_LEAD_MIN } = TOURNAMENT_CONFIG;
  return {
    registration_open_at: new Date(scheduledStartMs - REGISTRATION_OPEN_LEAD_MIN * 60_000).toISOString(),
    registration_close_at: new Date(scheduledStartMs - REGISTRATION_CLOSE_LEAD_MIN * 60_000).toISOString(),
  };
}

export function isTournamentRegistrationWindowOpen(input: {
  status: string;
  registration_close_at: string;
  nowMs: number;
}): boolean {
  return input.status === 'registration_open' && input.nowMs < Date.parse(input.registration_close_at);
}

export function isTournamentBracketLobbyPhase(input: {
  registration_close_at: string;
  scheduled_start: string;
  nowMs: number;
}): boolean {
  const closeMs = Date.parse(input.registration_close_at);
  const startMs = Date.parse(input.scheduled_start);
  return input.nowMs >= closeMs && input.nowMs < startMs;
}

/** A room seat's tournament identity (user id, or the bot's seat id) and its final score. */
export type TournamentSeatScore = { playerId: string | null; score: number };

/**
 * Put seat scores into the match row's player1/player2 order. Room seats are
 * in join order (Fritz is seated at dispatch, before the human attaches), which
 * need not match the row. Null unless the two seats are exactly the row's two
 * players.
 */
function orientSeatScoresToMatch(
  match: Pick<MatchRow, 'player1_id' | 'player2_id'>,
  seats: ReadonlyArray<TournamentSeatScore>,
): { player1Score: number; player2Score: number } | null {
  if (seats.length !== 2 || !match.player1_id || !match.player2_id) return null;
  const p1 = seats.find((seat) => seat.playerId === match.player1_id);
  const p2 = seats.find((seat) => seat.playerId === match.player2_id);
  if (!p1 || !p2 || p1 === p2) return null;
  return { player1Score: p1.score, player2Score: p2.score };
}

/**
 * Apply tournament match result after multiplayer game-over.
 * Uses in-memory match id when present; otherwise resolves by room code in DB.
 * With `seatScores`, the scores are oriented to the match row's player order;
 * without it, player1Score/player2Score are taken as already in row order.
 */
export async function applyTournamentGameOverFromRoom(
  io: Server,
  room: { code: string; scheduledTournamentMatchId?: string; scheduledTournamentId?: string | null },
  params: {
    winnerUserId: string;
    player1Score: number;
    player2Score: number;
    seatScores?: ReadonlyArray<TournamentSeatScore>;
    /** Passed to applyMatchResult (the event backstop passes false). */
    dispatchAdvanced?: boolean;
  },
  persistence: EnginePersistence = defaultEnginePersistence,
  lookupMatchByRoom: (code: string) => Promise<MatchRow | null> = findTournamentMatchByRoom,
): Promise<boolean> {
  let matchId = room.scheduledTournamentMatchId ?? null;
  if (!matchId && room.code) {
    const byRoom = await lookupMatchByRoom(room.code);
    if (byRoom) {
      matchId = byRoom.id;
      log.info({
        roomCode: room.code,
        matchId,
        tournamentId: byRoom.tournament_id,
      }, 'resolved match by room code');
    }
  }
  if (!matchId) {
    log.warn({
      roomCode: room.code,
      scheduledTournamentMatchId: room.scheduledTournamentMatchId ?? null,
    }, 'no tournament match for room');
    return false;
  }
  let { player1Score, player2Score } = params;
  if (params.seatScores) {
    const match = await persistence.fetchMatchById(matchId);
    if (!match) throw new Error('Match not found');
    const oriented = orientSeatScoresToMatch(match, params.seatScores);
    if (!oriented) {
      log.warn({
        roomCode: room.code,
        matchId,
        seatPlayerIds: params.seatScores.map((seat) => seat.playerId),
        player1Id: match.player1_id,
        player2Id: match.player2_id,
      }, 'room seats do not match the tournament match players');
      throw new Error('tournament_seat_mismatch');
    }
    ({ player1Score, player2Score } = oriented);
  }
  log.info({
    roomCode: room.code,
    matchId,
    tournamentId: room.scheduledTournamentId ?? null,
    winnerId: params.winnerUserId,
    scores: { player1: player1Score, player2: player2Score },
  }, 'applying result');
  await applyMatchResult(
    io,
    {
      matchId,
      winnerId: params.winnerUserId,
      player1Score,
      player2Score,
      dispatchAdvanced: params.dispatchAdvanced,
    },
    persistence,
  );
  return true;
}

/** Look up the tournament-match record (if any) associated with a room code. */
export async function findTournamentMatchByRoom(roomCode: string): Promise<MatchRow | null> {
  const rows = await supabaseFetch<MatchRow[]>(
    `/rest/v1/scheduled_tournament_matches?select=*&room_code=eq.${encodeURIComponent(roomCode)}&limit=1`,
  );
  return rows[0] ?? null;
}
