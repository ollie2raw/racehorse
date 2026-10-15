import { childLogger } from '../logger';
import { peekRoom } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { isProcessClosing, processInterval, processTimeout, trackProcessWork } from '../platform/processLifecycle';
import { replayGameOverCompletion } from '../realtime/gameOverPersistence';
import { isRatingCutoverQuiescedError } from '../ranking/ratingCutoverGate';
import { recordOperationalFailure } from '../operationalTelemetry';
import { markGameOverPersistSucceeded } from './gameOverPersistPolicy';
import { materializeDetachedRoomFromSession } from './applyLiveSessionRoom';
import {
  loadLiveRoomSession,
  type LiveRosterEntry,
  type RoomLiveSessionRow,
} from './roomLivePersistence';
import type { GameOverPersistInput, RoomPlayer } from './roomSession';
import { completeRatedForfeit } from './ratedForfeitCompletion';
import {
  accountIdOrNull,
  isTournamentLikeRoom,
  type ForfeitReason,
} from './terminalCompletion';
import {
  deleteResolvedTerminalSession,
  markTerminalCompletionLogged,
  recordTerminalReplayFailure,
  scanStrandedTerminalSessions,
  type StrandedScanCursor,
  type StrandedTerminalCandidate,
} from './terminalCompletionStore';

const log = childLogger('terminal-completion-recovery');

/**
 * Restart-time owner of terminal-completion replay (R1).
 *
 * A room whose terminal snapshot is durable but whose completion is not yet logged is found by
 * ONE bounded scan of `room_live_sessions` (lightweight projection, oldest first) and replayed
 * through the same idempotent pipeline the foreground used. It never reopens the room: the
 * terminal row is read as evidence, materialized as a detached room object, and discarded.
 */
export const TERMINAL_RECOVERY_BOOT_DELAY_MS = 15_000;
/** Operational/test knob: shorten the boot delay (never below 1s, never above the default). */
export function resolveTerminalRecoveryBootDelayMs(): number {
  const raw = Number(process.env.TERMINAL_COMPLETION_RECOVERY_BOOT_DELAY_MS);
  return Number.isFinite(raw) && raw >= 1_000 ? Math.min(raw, TERMINAL_RECOVERY_BOOT_DELAY_MS) : TERMINAL_RECOVERY_BOOT_DELAY_MS;
}
export const TERMINAL_RECOVERY_INTERVAL_MS = 15 * 60_000;
/**
 * A terminal row untouched for this long is eligible. Boot recovery needs this short: after a
 * hard crash nothing in this (fresh) process is completing it. Overlap with another instance's
 * foreground completion is harmless — every write is idempotent.
 */
export const TERMINAL_RECOVERY_MIN_AGE_MS = 30_000;
export const TERMINAL_RECOVERY_PAGE_SIZE = 25;
export const TERMINAL_RECOVERY_MAX_ROWS_PER_SWEEP = 25;
export const TERMINAL_RECOVERY_MAX_PAGES = 4;
/** Durable failed-replay ceiling before a row is quarantined (excluded, alerted, never deleted). */
export const TERMINAL_RECOVERY_MAX_ATTEMPTS = 5;

export function isTerminalCompletionRecoveryEnabled(): boolean {
  return process.env.TERMINAL_COMPLETION_RECOVERY_ENABLED !== 'false';
}

export type TerminalReplayOutcome =
  | 'recovered'
  | 'already_logged'
  | 'skipped_live'
  | 'skipped_gone'
  | 'deferred'
  | 'raced'
  | 'failed'
  | 'quarantined';

export type TerminalRecoverySweepResult = {
  scanned: number;
  pages: number;
  outcomes: Record<TerminalReplayOutcome, number>;
};

const emptyOutcomes = (): Record<TerminalReplayOutcome, number> => ({
  recovered: 0,
  already_logged: 0,
  skipped_live: 0,
  skipped_gone: 0,
  deferred: 0,
  raced: 0,
  failed: 0,
  quarantined: 0,
});

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

class NonRetryableTerminalRowError extends Error {
  readonly retryable = false;
}

/** Structural validation of a terminal row as replay evidence (NOT hydration validation). */
export function validateTerminalReplayRow(
  row: RoomLiveSessionRow,
): { ok: true } | { ok: false; reason: string } {
  if (row.status !== 'game_over' && row.status !== 'abandoned') return { ok: false, reason: 'row_not_terminal' };
  if (!Array.isArray(row.engine_seat_ids) || row.engine_seat_ids.length !== 2) {
    return { ok: false, reason: 'invalid_engine_seats' };
  }
  const rosterSeatIds = new Set((row.roster ?? []).map((entry) => entry.seatId));
  if (!row.engine_seat_ids.every((seatId) => rosterSeatIds.has(seatId))) {
    return { ok: false, reason: 'roster_seat_mismatch' };
  }
  if (row.status === 'game_over') {
    const state = row.game_state;
    if (!state || state.gameOver !== true) return { ok: false, reason: 'game_state_not_game_over' };
    if (!Array.isArray(state.playerIds) || state.playerIds.length !== 2) {
      return { ok: false, reason: 'invalid_player_ids' };
    }
    if (!state.playerIds.every((seatId, index) => seatId === row.engine_seat_ids[index])) {
      return { ok: false, reason: 'player_seat_mismatch' };
    }
    for (const seatId of state.playerIds) {
      if (typeof state.players?.[seatId]?.score !== 'number') return { ok: false, reason: 'missing_score' };
    }
    return { ok: true };
  }
  const shell = row.room_shell;
  if (shell.abandonedReason !== 'forfeit') return { ok: false, reason: 'abandon_not_forfeit' };
  if (typeof shell.abandonedAt !== 'string' || Number.isNaN(Date.parse(shell.abandonedAt))) {
    return { ok: false, reason: 'missing_abandoned_at' };
  }
  if (!shell.abandonedByUserId) return { ok: false, reason: 'missing_abandoner' };
  return { ok: true };
}

function rosterToPlayers(roster: LiveRosterEntry[]): RoomPlayer[] {
  return roster.map((entry) => ({
    id: entry.seatId,
    socketId: '',
    username: entry.username,
    userId: entry.userId,
  }));
}

/** Exported for tests: the pipeline input a replay builds from a terminal row. */
export function buildGameOverReplayInput(row: RoomLiveSessionRow): GameOverPersistInput {
  const state = row.game_state!;
  const room = materializeDetachedRoomFromSession(row);
  const players = rosterToPlayers(row.roster);
  const byId = new Map(players.map((p) => [p.id, p]));
  const [aId, bId] = state.playerIds as [string, string];
  const guest = (id: string): RoomPlayer => ({ id, socketId: '', username: 'Guest', userId: null });
  const a = byId.get(aId) ?? guest(aId);
  const b = byId.get(bId) ?? guest(bId);
  const scoreA = state.players[aId]!.score;
  const scoreB = state.players[bId]!.score;
  // Same winner rule as the foreground broadcast path.
  const winnerSeatId = state.winnerId ?? (scoreA >= scoreB ? aId : bId);
  return {
    room,
    sourceMatchId: row.match_id,
    cfg: room.config,
    aId,
    bId,
    a,
    b,
    scoreA,
    scoreB,
    winnerSeatId,
    replayRoster: players,
  };
}

async function replayForfeit(row: RoomLiveSessionRow): Promise<void> {
  const room = materializeDetachedRoomFromSession(row);
  if (isTournamentLikeRoom(room)) throw new NonRetryableTerminalRowError('tournament_replay_unsupported');
  const players = rosterToPlayers(row.roster);
  const byId = new Map(players.map((p) => [p.id, p]));
  const [aId, bId] = row.engine_seat_ids as [string, string];
  const a = byId.get(aId);
  const b = byId.get(bId);
  const aUser = accountIdOrNull(a?.userId);
  const bUser = accountIdOrNull(b?.userId);
  if (!a || !b || !aUser || !bUser) throw new NonRetryableTerminalRowError('forfeit_seats_not_rated');
  const abandonedBy = row.room_shell.abandonedByUserId ?? null;
  const abandonerSeat = a.userId === abandonedBy ? a : b.userId === abandonedBy ? b : null;
  if (!abandonerSeat) throw new NonRetryableTerminalRowError('forfeit_abandoner_not_in_roster');
  const opponentSeat = abandonerSeat === a ? b : a;
  const scoreOf = (seatId: string) => row.game_state?.players?.[seatId]?.score ?? 0;
  const forfeitReason: ForfeitReason = row.room_shell.abandonedForfeitReason ?? 'manual';
  await completeRatedForfeit({
    roomCode: row.room_code,
    sourceMatchId: row.match_id,
    a: { seatId: a.id, userId: aUser },
    b: { seatId: b.id, userId: bUser },
    scoreA: scoreOf(a.id),
    scoreB: scoreOf(b.id),
    abandonerSeatId: abandonerSeat.id,
    forfeitReason,
    playedAt: row.room_shell.abandonedAt!,
    matchmakingMatchId: row.matchmaking_match_id,
    winnerUserId: row.room_shell.abandonedWinnerUserId ?? opponentSeat.userId,
  });
}

/** Archive the recovered match like the foreground cleanup would (idempotent; keeps an existing archive). */
async function archiveRecoveredSession(row: RoomLiveSessionRow): Promise<void> {
  if (!row.events || row.events.length === 0) return;
  const state = row.game_state;
  const seatOrder = row.engine_seat_ids;
  const participants = seatOrder.map((seatId, seatIndex) => {
    const entry = row.roster.find((r) => r.seatId === seatId);
    return { id: seatId, username: entry?.username ?? 'Guest', userId: entry?.userId ?? null, seatIndex };
  });
  const status = row.status === 'game_over' ? 'completed' : 'abandoned';
  const body = {
    match_id: row.match_id,
    room_code: row.room_code,
    status,
    event_log_version: row.event_log_version,
    last_event_sequence: row.last_event_sequence,
    event_count: row.events.length,
    started_at: row.started_at,
    archived_at: new Date().toISOString(),
    participant_user_ids: row.participant_user_ids,
    participants,
    summary: state
      ? {
          status,
          gameStarted: true,
          gameOver: state.gameOver,
          handOver: state.handOver,
          handNumber: state.handNumber,
          winnerId: state.winnerId ?? null,
          winningScore: state.config?.winningScore ?? null,
          scores: Object.fromEntries(state.playerIds.map((id) => [id, state.players[id]?.score ?? 0])),
          recoveredFromTerminalSession: true,
        }
      : { status, gameStarted: false, recoveredFromTerminalSession: true },
    state_snapshot: state,
    events: row.events,
  };
  await supabaseFetch('/rest/v1/room_match_logs?on_conflict=match_id', {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify([body]),
  });
}

const inFlightByRoom = new Set<string>();

/** Replay one terminal candidate. Never throws: every failure is classified and recorded. */
export async function recoverTerminalCompletion(
  candidate: StrandedTerminalCandidate,
): Promise<TerminalReplayOutcome> {
  const code = candidate.room_code.trim().toUpperCase();
  const live = peekRoom(code);
  // A room this process still owns is completed (or retried) by its foreground scheduler;
  // only a room that already gave up is taken over here.
  if (live && live.gameOverPersistStatus !== 'failed') return 'skipped_live';
  if (inFlightByRoom.has(code)) return 'skipped_live';
  inFlightByRoom.add(code);
  try {
    const loaded = await loadLiveRoomSession(code);
    if (loaded.kind === 'not_found') return 'skipped_gone';
    if (loaded.kind === 'persistence_unavailable') throw new Error(loaded.error);
    if (loaded.kind === 'snapshot_invalid') {
      return await quarantine(candidate, `snapshot_invalid:${loaded.error}`);
    }
    const row = loaded.row;
    if (row.match_id !== candidate.match_id) return 'raced'; // a newer match took the room code
    if (row.room_shell.matchLogged === true) {
      await markTerminalCompletionLogged(code, row.match_id);
      return 'already_logged';
    }
    const validation = validateTerminalReplayRow(row);
    if (!validation.ok) return await quarantine(candidate, validation.reason);

    try {
      if (row.status === 'game_over') {
        await replayGameOverCompletion(buildGameOverReplayInput(row));
      } else {
        await replayForfeit(row);
      }
    } catch (error) {
      if (isRatingCutoverQuiescedError(error)) return 'deferred';
      if (error instanceof NonRetryableTerminalRowError) return await quarantine(candidate, error.message);
      return await failed(candidate, error);
    }

    // Completion is durably logged (or a duplicate of an earlier logging): flip the marker.
    const marked = await markTerminalCompletionLogged(code, row.match_id);
    if (!marked) return 'raced';
    if (live && live.matchId === row.match_id) markGameOverPersistSucceeded(live);
    try {
      await archiveRecoveredSession(row);
      await deleteResolvedTerminalSession(code, row.match_id);
    } catch (error) {
      // The marker is the truth; the row is simply eligible for ordinary cleanup/retention.
      log.warn({ roomCode: code, error: errorMessage(error) }, 'recovered terminal session archive/cleanup deferred');
    }
    log.info({ roomCode: code, matchId: row.match_id, status: row.status }, 'terminal completion recovered');
    return 'recovered';
  } catch (error) {
    return await failed(candidate, error);
  } finally {
    inFlightByRoom.delete(code);
  }
}

/**
 * Errors that say nothing about the row itself: network/DB/gateway outages, timeouts, throttling,
 * auth blips and a missing table/RPC (deploy order). They are retried forever (with backoff) and
 * never spend the quarantine budget. Everything else (RPC rejections 400/409/422, invariant
 * violations, unexpected code errors) is deterministic for that row.
 */
export function isTransientInfrastructureError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /Supabase request (?:failed: (?:401|403|404|408|425|429|5\d\d)\b|timed out)/i.test(message) ||
    /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|UND_ERR|network|timed out|aborted/i.test(message)
  );
}

async function failed(candidate: StrandedTerminalCandidate, error: unknown): Promise<TerminalReplayOutcome> {
  const message = errorMessage(error);
  const transient = isTransientInfrastructureError(error);
  log.warn({ roomCode: candidate.room_code, matchId: candidate.match_id, error: message }, 'terminal completion replay failed');
  // Count the attempt only if the database is reachable enough to record it: an outage must
  // not march every pending row toward quarantine.
  let recorded: Awaited<ReturnType<typeof recordTerminalReplayFailure>> = null;
  try {
    recorded = await recordTerminalReplayFailure(candidate.room_code, candidate.match_id, message, {
      maxAttempts: TERMINAL_RECOVERY_MAX_ATTEMPTS,
      transient,
    });
  } catch {
    recorded = null;
  }
  if (recorded?.quarantined) {
    alertQuarantine(candidate, message);
    return 'quarantined';
  }
  return 'failed';
}

async function quarantine(candidate: StrandedTerminalCandidate, reason: string): Promise<TerminalReplayOutcome> {
  try {
    await recordTerminalReplayFailure(candidate.room_code, candidate.match_id, reason, {
      maxAttempts: TERMINAL_RECOVERY_MAX_ATTEMPTS,
      quarantineNow: true,
    });
  } catch (error) {
    log.warn({ roomCode: candidate.room_code, error: errorMessage(error) }, 'could not record quarantine');
    return 'failed';
  }
  alertQuarantine(candidate, reason);
  return 'quarantined';
}

function alertQuarantine(candidate: StrandedTerminalCandidate, reason: string): void {
  recordOperationalFailure('terminal_completion_quarantined', reason, {
    roomCode: candidate.room_code,
    matchId: candidate.match_id,
    status: candidate.status,
  });
}

let sweepInFlight: Promise<TerminalRecoverySweepResult> | null = null;

/** One bounded sweep. Single-flight: concurrent triggers share the running sweep. */
export function recoverStrandedTerminalCompletions(options: {
  now?: number;
  minAgeMs?: number;
  maxRows?: number;
} = {}): Promise<TerminalRecoverySweepResult> {
  if (sweepInFlight) return sweepInFlight;
  const run = runSweep(options).finally(() => {
    if (sweepInFlight === run) sweepInFlight = null;
  });
  sweepInFlight = run;
  return run;
}

async function runSweep(options: { now?: number; minAgeMs?: number; maxRows?: number }): Promise<TerminalRecoverySweepResult> {
  const now = options.now ?? Date.now();
  const cutoffIso = new Date(now - (options.minAgeMs ?? TERMINAL_RECOVERY_MIN_AGE_MS)).toISOString();
  const maxRows = options.maxRows ?? TERMINAL_RECOVERY_MAX_ROWS_PER_SWEEP;
  const result: TerminalRecoverySweepResult = { scanned: 0, pages: 0, outcomes: emptyOutcomes() };
  let after: StrandedScanCursor | undefined;
  let handled = 0;

  while (result.pages < TERMINAL_RECOVERY_MAX_PAGES && handled < maxRows && !isProcessClosing()) {
    const page = await scanStrandedTerminalSessions({ cutoffIso, limit: TERMINAL_RECOVERY_PAGE_SIZE, after });
    result.pages += 1;
    result.scanned += page.length;
    for (const candidate of page) {
      if (isProcessClosing() || handled >= maxRows) break;
      const outcome = await recoverTerminalCompletion(candidate);
      result.outcomes[outcome] += 1;
      if (outcome !== 'skipped_live' && outcome !== 'skipped_gone') handled += 1;
    }
    if (page.length < TERMINAL_RECOVERY_PAGE_SIZE) break;
    const last = page[page.length - 1]!;
    after = { updatedAt: last.updated_at, roomCode: last.room_code };
  }
  if (result.scanned > 0) log.info(result, 'terminal completion recovery sweep');
  return result;
}

let scheduled = false;

/** Boot sweep + periodic sweep, owned by the process lifecycle (stopped at shutdown admission). */
export function scheduleTerminalCompletionRecovery(): void {
  if (scheduled) return;
  if (!isTerminalCompletionRecoveryEnabled()) {
    log.info('terminal completion recovery DISABLED (TERMINAL_COMPLETION_RECOVERY_ENABLED=false)');
    return;
  }
  scheduled = true;
  const sweep = () =>
    trackProcessWork('terminal-completion-recovery', () =>
      recoverStrandedTerminalCompletions().catch((error) =>
        log.warn({ error: errorMessage(error) }, 'terminal completion sweep failed'),
      ),
    );
  processTimeout('terminal-completion-recovery', sweep, resolveTerminalRecoveryBootDelayMs());
  processInterval('terminal-completion-recovery', sweep, TERMINAL_RECOVERY_INTERVAL_MS);
}

/** Test seam. */
export function resetTerminalCompletionRecoveryForTests(): void {
  sweepInFlight = null;
  inFlightByRoom.clear();
  scheduled = false;
}
