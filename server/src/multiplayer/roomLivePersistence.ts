/**
 * Durable live room snapshots (Supabase `room_live_sessions`).
 *
 * `game_state` is the authoritative in-memory `GameState` as held on the server
 * (`room.state`) — NOT the masked payload sent to clients. That includes:
 * - `boneyard`: full ordered draw pile (top-of-pile = index 0 for drawOne)
 * - `deadTiles`: protected boneyard tail
 * - `players[seatId].hand`: every seat's full hand
 *
 * Hand masking for clients remains in `maskStateForRecipient` at broadcast time.
 */
import type { Config, GameState, Tile } from '../game/types';
import type { GhostMoveLogEntry } from '../ghost/service';
import type { Room, LeadTracker } from '../rooms';
import { deleteRoom, peekRoom } from '../rooms';
import type { RoomMatchEvent } from '../roomEvents';
import { supabaseFetch } from '../supabaseUtils';
import { childLogger } from '../logger';
import { applyLiveSessionRow } from './applyLiveSessionRoom';

const log = childLogger('room-live-persistence');
import {
  captureRoomDurabilityFence,
  getRoomDurabilityState,
  isRoomDurablyRecoverable,
  markRoomDurabilityPending,
  markRoomDurabilityPersistFailure,
  markRoomDurabilityPersistSuccess,
  type RoomDurabilityFence,
} from './roomDurability';
import {
  hydrateGameActionReceiptsForRoom,
  snapshotGameActionReceiptsForRoom,
  type PersistedGameActionReceipt,
} from './gameActionIdempotency';
import { emitMpAuthorityFunnel, emitMpAuthorityHydrationResult } from './mpAuthorityTelemetry';
import { loadRoomCommandReceiptsForRoom } from './roomCommandReceiptStore';

const LIVE_PERSIST_DEBOUNCE_MS = 75;
export const DEFAULT_SHUTDOWN_FLUSH_TIMEOUT_MS = 10_000;

let persistenceShuttingDown = false;
const inFlightPersistByRoomCode = new Map<string, Promise<boolean>>();
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RoomLiveSessionStatus = 'lobby' | 'playing' | 'hand_over' | 'game_over' | 'abandoned';
export type RoomLiveSessionSourceType = 'private' | 'matchmaking' | 'tournament';

export type LiveRosterEntry = {
  seatId: string;
  userId: string | null;
  username: string;
};

export type PersistedRoomShell = {
  config: Partial<Config>;
  asyncStateVersion: number;
  durabilityCommit: RoomDurabilityFence | null;
  nextHandReady: string[];
  rematchReady: string[];
  matchStartReady: string[];
  lastHandEndedNotifiedHand: number | null;
  lastHandEndedAtMs: number | null;
  lastBroadcastScores: Record<string, number>;
  ghostMoveLogs: Record<string, GhostMoveLogEntry[]>;
  ghostTurnIndex: number;
  matchLogged: boolean;
  leadTracker: LeadTracker | null;
  abandonedAt?: string;
  abandonedByUserId?: string | null;
  abandonedWinnerUserId?: string | null;
  abandonedReason?: 'forfeit' | 'abandon';
  scheduledTournamentBotTier?: 'standard' | 'elite' | 'master';
  /** Durable game:action receipts for restart-safe idempotency replay. */
  actionReceipts?: PersistedGameActionReceipt[];
};

export type RoomLiveSessionRow = {
  room_code: string;
  match_id: string;
  status: RoomLiveSessionStatus;
  source_type: RoomLiveSessionSourceType;
  game_state: GameState | null;
  game_state_sequence: number;
  room_shell: PersistedRoomShell;
  engine_seat_ids: string[];
  roster: LiveRosterEntry[];
  event_log_version: number;
  last_event_sequence: number;
  events: RoomMatchEvent[];
  participant_user_ids: string[];
  matchmaking_match_id: string | null;
  scheduled_tournament_id: string | null;
  scheduled_tournament_match_id: string | null;
  started_at: string | null;
  updated_at: string;
  created_at: string;
};

export type RoomHydrateResult = {
  room: Room;
  restoredRoster: LiveRosterEntry[];
  source: 'memory' | 'database';
};

export type ActiveRoomHydrationResult =
  | { kind: 'already_in_memory'; room: Room; restoredRoster: []; durabilityRecoverable: boolean }
  | { kind: 'hydrated'; room: Room; restoredRoster: LiveRosterEntry[]; durabilityRecoverable: true }
  | { kind: 'not_found' }
  | { kind: 'shell_only' }
  | { kind: 'snapshot_freshness_unknown'; error: string }
  | { kind: 'snapshot_stale'; error: string }
  | { kind: 'snapshot_invalid'; error: string }
  | { kind: 'persistence_unavailable'; error: string };

const flushTimersByRoomCode = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPersistByRoomCode = new Map<
  string,
  { room: Room; roster: LiveRosterEntry[] }
>();
const inFlightHydrationByRoomCode = new Map<string, Promise<ActiveRoomHydrationResult>>();

let liveSessionsTableAvailable: boolean | null = null;

let rosterResolver: ((roomCode: string) => LiveRosterEntry[]) | null = null;

export function configureLiveRoomPersistence(options: {
  resolveRoster: (roomCode: string) => LiveRosterEntry[];
}): void {
  rosterResolver = options.resolveRoster;
}

function resolveRosterForPersist(room: Room): LiveRosterEntry[] {
  const fromSession = rosterResolver?.(room.code) ?? [];
  if (fromSession.length > 0) return fromSession;
  return room.players.map((seatId) => ({
    seatId,
    userId: null,
    username: 'Player',
  }));
}

/** Called from `registerLiveRoomPersistHook` after each committed room mutation. */
export function schedulePersistLiveRoomSessionForRoom(room: Room): void {
  schedulePersistLiveRoomSession(room, resolveRosterForPersist(room));
}

function isUuidLike(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isMissingRoomLiveSessionsTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('room_live_sessions') && message.includes('does not exist');
}

function isValidTile(value: unknown): value is Tile {
  if (!value || typeof value !== 'object') return false;
  const tile = value as { low?: unknown; high?: unknown };
  return (
    typeof tile.low === 'number' &&
    Number.isFinite(tile.low) &&
    typeof tile.high === 'number' &&
    Number.isFinite(tile.high)
  );
}

function isRoomDurabilityFence(value: unknown): value is RoomDurabilityFence {
  if (!value || typeof value !== 'object') return false;
  const fence = value as { commitId?: unknown; asyncStateVersion?: unknown; stateSequence?: unknown; eventSequence?: unknown };
  return (
    typeof fence.commitId === 'string' &&
    typeof fence.asyncStateVersion === 'number' &&
    Number.isFinite(fence.asyncStateVersion) &&
    (typeof fence.stateSequence === 'number' || fence.stateSequence === null) &&
    typeof fence.eventSequence === 'number' &&
    Number.isFinite(fence.eventSequence)
  );
}

/**
 * Guard before writing `game_state` — ensures we never persist a client-masked
 * snapshot missing boneyard tiles or opponent hands.
 */
export function assertUnmaskedGameStateForPersistence(state: GameState): void {
  if (!Array.isArray(state.boneyard)) {
    throw new Error('live_persist: game_state.boneyard must be an array');
  }
  for (const tile of state.boneyard) {
    if (!isValidTile(tile)) {
      throw new Error('live_persist: game_state.boneyard contains invalid tile');
    }
  }
  if (!Array.isArray(state.deadTiles)) {
    throw new Error('live_persist: game_state.deadTiles must be an array');
  }
  for (const tile of state.deadTiles) {
    if (!isValidTile(tile)) {
      throw new Error('live_persist: game_state.deadTiles contains invalid tile');
    }
  }
  if (!Array.isArray(state.playerIds) || state.playerIds.length === 0) {
    throw new Error('live_persist: game_state.playerIds must be a non-empty array');
  }
  for (const playerId of state.playerIds) {
    const hand = state.players[playerId]?.hand;
    if (!Array.isArray(hand)) {
      throw new Error(`live_persist: game_state.players[${playerId}].hand must be an array`);
    }
    for (const tile of hand) {
      if (!isValidTile(tile)) {
        throw new Error(`live_persist: game_state.players[${playerId}].hand contains invalid tile`);
      }
    }
  }
}

export function inferLiveSessionSourceType(room: Room): RoomLiveSessionSourceType {
  if (room.scheduledTournamentMatchId) return 'tournament';
  if (room.matchmakingMatchId) return 'matchmaking';
  return 'private';
}

export function inferLiveSessionStatus(room: Room): RoomLiveSessionStatus {
  if (room.abandonedAt) return 'abandoned';
  if (!room.state) return 'lobby';
  if (room.state.gameOver) return 'game_over';
  if (room.state.handOver) return 'hand_over';
  return 'playing';
}

export function isTerminalLiveSessionStatus(status: RoomLiveSessionStatus): boolean {
  return status === 'game_over' || status === 'abandoned';
}

export function serializeRoomShell(room: Room): PersistedRoomShell {
  const actionReceipts = snapshotGameActionReceiptsForRoom(room.code);
  return {
    config: room.config,
    asyncStateVersion: room.asyncStateVersion,
    durabilityCommit: room.durability.persistedFence ? { ...room.durability.persistedFence } : null,
    nextHandReady: [...room.nextHandReady],
    rematchReady: [...room.rematchReady],
    matchStartReady: [...room.matchStartReady],
    lastHandEndedNotifiedHand: room.lastHandEndedNotifiedHand,
    lastHandEndedAtMs: room.lastHandEndedAtMs,
    lastBroadcastScores: { ...room.lastBroadcastScores },
    ghostMoveLogs: structuredClone(room.ghostMoveLogs),
    ghostTurnIndex: room.ghostTurnIndex,
    matchLogged: room.matchLogged,
    leadTracker: room.leadTracker ? { ...room.leadTracker } : null,
    ...(room.abandonedAt ? { abandonedAt: room.abandonedAt } : {}),
    ...(room.abandonedByUserId !== undefined ? { abandonedByUserId: room.abandonedByUserId } : {}),
    ...(room.abandonedWinnerUserId !== undefined
      ? { abandonedWinnerUserId: room.abandonedWinnerUserId }
      : {}),
    ...(room.abandonedReason ? { abandonedReason: room.abandonedReason } : {}),
    ...(room.scheduledTournamentBotTier
      ? { scheduledTournamentBotTier: room.scheduledTournamentBotTier }
      : {}),
    ...(actionReceipts.length > 0 ? { actionReceipts } : {}),
  };
}

export function parseRoomShell(raw: unknown): PersistedRoomShell {
  const shell = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    config: (shell.config && typeof shell.config === 'object' ? shell.config : {}) as Partial<Config>,
    asyncStateVersion: typeof shell.asyncStateVersion === 'number' ? shell.asyncStateVersion : 0,
    durabilityCommit: isRoomDurabilityFence(shell.durabilityCommit)
      ? (shell.durabilityCommit as RoomDurabilityFence)
      : null,
    nextHandReady: Array.isArray(shell.nextHandReady)
      ? shell.nextHandReady.filter((id): id is string => typeof id === 'string')
      : [],
    rematchReady: Array.isArray(shell.rematchReady)
      ? shell.rematchReady.filter((id): id is string => typeof id === 'string')
      : [],
    matchStartReady: Array.isArray(shell.matchStartReady)
      ? shell.matchStartReady.filter((id): id is string => typeof id === 'string')
      : [],
    lastHandEndedNotifiedHand:
      typeof shell.lastHandEndedNotifiedHand === 'number' ? shell.lastHandEndedNotifiedHand : null,
    lastHandEndedAtMs: typeof shell.lastHandEndedAtMs === 'number' ? shell.lastHandEndedAtMs : null,
    lastBroadcastScores:
      shell.lastBroadcastScores && typeof shell.lastBroadcastScores === 'object'
        ? (shell.lastBroadcastScores as Record<string, number>)
        : {},
    ghostMoveLogs:
      shell.ghostMoveLogs && typeof shell.ghostMoveLogs === 'object'
        ? structuredClone(shell.ghostMoveLogs as Record<string, GhostMoveLogEntry[]>)
        : {},
    ghostTurnIndex: typeof shell.ghostTurnIndex === 'number' ? shell.ghostTurnIndex : 0,
    matchLogged: shell.matchLogged === true,
    leadTracker:
      shell.leadTracker && typeof shell.leadTracker === 'object'
        ? (shell.leadTracker as LeadTracker)
        : null,
    ...(typeof shell.abandonedAt === 'string' ? { abandonedAt: shell.abandonedAt } : {}),
    ...(shell.abandonedByUserId === null || typeof shell.abandonedByUserId === 'string'
      ? { abandonedByUserId: shell.abandonedByUserId as string | null }
      : {}),
    ...(shell.abandonedWinnerUserId === null || typeof shell.abandonedWinnerUserId === 'string'
      ? { abandonedWinnerUserId: shell.abandonedWinnerUserId as string | null }
      : {}),
    ...(shell.abandonedReason === 'forfeit' || shell.abandonedReason === 'abandon'
      ? { abandonedReason: shell.abandonedReason }
      : {}),
    ...(shell.scheduledTournamentBotTier === 'standard' ||
    shell.scheduledTournamentBotTier === 'elite' ||
    shell.scheduledTournamentBotTier === 'master'
      ? { scheduledTournamentBotTier: shell.scheduledTournamentBotTier }
      : {}),
    ...(Array.isArray(shell.actionReceipts)
      ? { actionReceipts: shell.actionReceipts as PersistedGameActionReceipt[] }
      : {}),
  };
}

function cloneGameState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

function normalizeRosterEntry(raw: unknown): LiveRosterEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as { seatId?: unknown; userId?: unknown; username?: unknown };
  if (typeof entry.seatId !== 'string' || !entry.seatId.trim()) return null;
  return {
    seatId: entry.seatId,
    userId: typeof entry.userId === 'string' ? entry.userId : null,
    username: typeof entry.username === 'string' ? entry.username : 'Player',
  };
}

export function buildLiveSessionRow(
  room: Room,
  roster: LiveRosterEntry[],
  commitFence: RoomDurabilityFence = captureRoomDurabilityFence(room),
): RoomLiveSessionRow {
  const status = inferLiveSessionStatus(room);
  const gameState = room.state ? cloneGameState(room.state) : null;
  if (gameState) {
    assertUnmaskedGameStateForPersistence(gameState);
  }

  const participantUserIds = roster
    .map((entry) => entry.userId)
    .filter((userId): userId is string => isUuidLike(userId));

  const firstEventTs = room.events[0]?.timestamp;
  const nowIso = new Date().toISOString();

  return {
    room_code: room.code,
    match_id: room.matchId,
    status,
    source_type: inferLiveSessionSourceType(room),
    game_state: gameState,
    game_state_sequence: gameState?.sequence ?? 0,
    room_shell: {
      ...serializeRoomShell(room),
      durabilityCommit: { ...commitFence },
    },
    engine_seat_ids: [...room.players],
    roster: roster.map((entry) => ({ ...entry })),
    event_log_version: room.eventLogVersion,
    last_event_sequence: room.eventSequence,
    events: structuredClone(room.events),
    participant_user_ids: participantUserIds,
    matchmaking_match_id: room.matchmakingMatchId ?? null,
    scheduled_tournament_id: room.scheduledTournamentId ?? null,
    scheduled_tournament_match_id: room.scheduledTournamentMatchId ?? null,
    started_at: typeof firstEventTs === 'string' ? firstEventTs : nowIso,
    updated_at: nowIso,
    created_at: nowIso,
  };
}

function toUpsertPayload(row: RoomLiveSessionRow): Record<string, unknown> {
  return {
    room_code: row.room_code,
    match_id: row.match_id,
    status: row.status,
    source_type: row.source_type,
    game_state: row.game_state,
    game_state_sequence: row.game_state_sequence,
    room_shell: row.room_shell,
    engine_seat_ids: row.engine_seat_ids,
    roster: row.roster,
    event_log_version: row.event_log_version,
    last_event_sequence: row.last_event_sequence,
    events: row.events,
    participant_user_ids: row.participant_user_ids,
    matchmaking_match_id: row.matchmaking_match_id,
    scheduled_tournament_id: row.scheduled_tournament_id,
    scheduled_tournament_match_id: row.scheduled_tournament_match_id,
    started_at: row.started_at,
    updated_at: row.updated_at,
  };
}

function parseLiveSessionRow(raw: Record<string, unknown>): RoomLiveSessionRow | null {
  if (typeof raw.room_code !== 'string' || typeof raw.match_id !== 'string') return null;
  const status = raw.status;
  const sourceType = raw.source_type;
  if (
    status !== 'lobby' &&
    status !== 'playing' &&
    status !== 'hand_over' &&
    status !== 'game_over' &&
    status !== 'abandoned'
  ) {
    return null;
  }
  if (sourceType !== 'private' && sourceType !== 'matchmaking' && sourceType !== 'tournament') {
    return null;
  }

  const gameStateRaw = raw.game_state;
  let gameState: GameState | null = null;
  if (gameStateRaw && typeof gameStateRaw === 'object') {
    gameState = structuredClone(gameStateRaw) as GameState;
    assertUnmaskedGameStateForPersistence(gameState);
  }

  const roster = Array.isArray(raw.roster)
    ? raw.roster.map(normalizeRosterEntry).filter((entry): entry is LiveRosterEntry => entry !== null)
    : [];

  return {
    room_code: raw.room_code.trim().toUpperCase(),
    match_id: raw.match_id,
    status,
    source_type: sourceType,
    game_state: gameState,
    game_state_sequence:
      typeof raw.game_state_sequence === 'number' ? raw.game_state_sequence : gameState?.sequence ?? 0,
    room_shell: parseRoomShell(raw.room_shell),
    engine_seat_ids: Array.isArray(raw.engine_seat_ids)
      ? raw.engine_seat_ids.filter((id): id is string => typeof id === 'string')
      : [],
    roster,
    event_log_version: typeof raw.event_log_version === 'number' ? raw.event_log_version : 1,
    last_event_sequence: typeof raw.last_event_sequence === 'number' ? raw.last_event_sequence : 0,
    events: Array.isArray(raw.events) ? structuredClone(raw.events as RoomMatchEvent[]) : [],
    participant_user_ids: Array.isArray(raw.participant_user_ids)
      ? raw.participant_user_ids.filter((id): id is string => typeof id === 'string' && isUuidLike(id))
      : [],
    matchmaking_match_id:
      typeof raw.matchmaking_match_id === 'string' ? raw.matchmaking_match_id : null,
    scheduled_tournament_id:
      typeof raw.scheduled_tournament_id === 'string' ? raw.scheduled_tournament_id : null,
    scheduled_tournament_match_id:
      typeof raw.scheduled_tournament_match_id === 'string'
        ? raw.scheduled_tournament_match_id
        : null,
    started_at: typeof raw.started_at === 'string' ? raw.started_at : null,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : new Date().toISOString(),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
  };
}

type LoadLiveRoomSessionResult =
  | { kind: 'found'; row: RoomLiveSessionRow }
  | { kind: 'not_found' }
  | { kind: 'snapshot_invalid'; error: string }
  | { kind: 'persistence_unavailable'; error: string };

type LiveRoomHydrationValidationResult =
  | { ok: true }
  | {
      ok: false;
      kind: 'shell_only' | 'snapshot_freshness_unknown' | 'snapshot_stale' | 'snapshot_invalid';
      error: string;
    };

function validateLiveRoomHydrationRow(
  requestedRoomCode: string,
  row: RoomLiveSessionRow,
): LiveRoomHydrationValidationResult {
  const normalizedRoomCode = requestedRoomCode.trim().toUpperCase();
  if (row.room_code !== normalizedRoomCode) {
    return { ok: false, kind: 'snapshot_invalid', error: 'snapshot_room_code_mismatch' };
  }
  if (row.status === 'game_over' || row.status === 'abandoned') {
    return { ok: false, kind: 'snapshot_stale', error: 'snapshot_terminal' };
  }
  if (row.status === 'lobby') {
    return { ok: false, kind: 'shell_only', error: 'snapshot_has_no_active_gameplay' };
  }
  if (!row.room_shell.durabilityCommit) {
    return {
      ok: false,
      kind: 'snapshot_freshness_unknown',
      error: 'snapshot_missing_commit_fence',
    };
  }
  if (!row.game_state) {
    return { ok: false, kind: 'snapshot_invalid', error: 'snapshot_missing_game_state' };
  }
  if (!Array.isArray(row.engine_seat_ids) || row.engine_seat_ids.length !== 2) {
    return { ok: false, kind: 'snapshot_invalid', error: 'snapshot_invalid_engine_seats' };
  }
  if (!Array.isArray(row.roster) || row.roster.length < 2) {
    return { ok: false, kind: 'snapshot_invalid', error: 'snapshot_missing_roster' };
  }
  const rosterSeatIds = new Set(row.roster.map((entry) => entry.seatId));
  if (!row.engine_seat_ids.every((seatId) => rosterSeatIds.has(seatId))) {
    return { ok: false, kind: 'snapshot_invalid', error: 'snapshot_roster_seat_mismatch' };
  }
  if (row.game_state.playerIds.length !== 2) {
    return { ok: false, kind: 'snapshot_invalid', error: 'snapshot_invalid_player_ids' };
  }
  const playerIdsMatch =
    row.game_state.playerIds.length === row.engine_seat_ids.length &&
    row.game_state.playerIds.every((seatId, index) => seatId === row.engine_seat_ids[index]);
  if (!playerIdsMatch) {
    return { ok: false, kind: 'snapshot_invalid', error: 'snapshot_player_seat_mismatch' };
  }
  if (
    typeof row.game_state.sequence !== 'number' ||
    !Number.isFinite(row.game_state.sequence) ||
    row.game_state.sequence < 0
  ) {
    return { ok: false, kind: 'snapshot_invalid', error: 'snapshot_invalid_state_sequence' };
  }
  if (row.game_state_sequence !== row.game_state.sequence) {
    return { ok: false, kind: 'snapshot_stale', error: 'snapshot_state_sequence_mismatch' };
  }
  if (
    typeof row.last_event_sequence !== 'number' ||
    !Number.isFinite(row.last_event_sequence) ||
    row.last_event_sequence < 0
  ) {
    return { ok: false, kind: 'snapshot_invalid', error: 'snapshot_invalid_event_sequence' };
  }
  const maxEventSequence = row.events.reduce(
    (max, event) => Math.max(max, typeof event.sequence === 'number' ? event.sequence : 0),
    0,
  );
  if (maxEventSequence > row.last_event_sequence) {
    return { ok: false, kind: 'snapshot_stale', error: 'snapshot_event_sequence_mismatch' };
  }
  if (typeof row.room_shell.asyncStateVersion !== 'number' || row.room_shell.asyncStateVersion < 0) {
    return { ok: false, kind: 'snapshot_invalid', error: 'snapshot_invalid_async_state_version' };
  }
  if (
    row.room_shell.durabilityCommit.asyncStateVersion !== row.room_shell.asyncStateVersion ||
    row.room_shell.durabilityCommit.stateSequence !== row.game_state.sequence ||
    row.room_shell.durabilityCommit.eventSequence !== row.last_event_sequence
  ) {
    return { ok: false, kind: 'snapshot_stale', error: 'snapshot_commit_fence_mismatch' };
  }
  const expectedStatus = row.game_state.gameOver
    ? 'game_over'
    : row.game_state.handOver
      ? 'hand_over'
      : 'playing';
  if (row.status !== expectedStatus) {
    return { ok: false, kind: 'snapshot_stale', error: 'snapshot_status_mismatch' };
  }
  if (row.game_state.gameOver) {
    return { ok: false, kind: 'snapshot_stale', error: 'snapshot_terminal_state' };
  }
  return { ok: true };
}

function assertJsonSerializable(value: unknown, label: string): void {
  try {
    JSON.stringify(value);
  } catch (error) {
    throw new Error(
      `live_persist: ${label} is not JSON-serializable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

type PersistLiveSessionAttemptResult =
  | { ok: true }
  | { ok: false; status: 'degraded' | 'failed'; error: string };

async function persistLiveSessionRowNow(
  row: RoomLiveSessionRow,
): Promise<PersistLiveSessionAttemptResult> {
  if (liveSessionsTableAvailable === false) {
    return {
      ok: false,
      status: 'failed',
      error: 'room_live_sessions table unavailable',
    };
  }

  const payload = toUpsertPayload(row);
  assertJsonSerializable(payload.game_state, 'game_state');
  assertJsonSerializable(payload.room_shell, 'room_shell');
  assertJsonSerializable(payload.events, 'events');
  assertJsonSerializable(payload.roster, 'roster');
  try {
    await supabaseFetch<RoomLiveSessionRow[]>(
      '/rest/v1/room_live_sessions?on_conflict=room_code',
      {
        method: 'POST',
        headers: {
          Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify([payload]),
      },
    );
    liveSessionsTableAvailable = true;
    return { ok: true };
  } catch (error) {
    if (isMissingRoomLiveSessionsTable(error)) {
      liveSessionsTableAvailable = false;
      log.warn('room_live_sessions table missing; skipping live persist');
      return {
        ok: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn({ roomCode: row.room_code, error: errorMessage }, 'room_live_sessions persist failed');
    return {
      ok: false,
      status: 'degraded',
      error: errorMessage,
    };
  }
}

export async function persistLiveRoomSessionNow(
  room: Room,
  roster: LiveRosterEntry[],
): Promise<boolean> {
  const roomCode = room.code.trim().toUpperCase();
  const inFlight = inFlightPersistByRoomCode.get(roomCode);
  if (inFlight) return inFlight;

  const persistPromise = (async () => {
    while (true) {
      const commitFence = captureRoomDurabilityFence(room, room.durability.targetFence.commitId);
      const result = await persistLiveSessionRowNow(buildLiveSessionRow(room, roster, commitFence));
      if (result.ok) {
        if (markRoomDurabilityPersistSuccess(room, commitFence)) return true;
        // The room changed while this write was in flight. Persist the newer
        // fence before reporting success to gameplay callers. Refresh the
        // target explicitly so an event appended after a scheduling hook can
        // never leave this loop retrying an obsolete fence forever.
        markRoomDurabilityPending(room);
        continue;
      }
      markRoomDurabilityPersistFailure(
        room,
        {
          status: result.status,
          error: result.error,
        },
        commitFence,
      );
      return false;
    }
  })().finally(() => {
    if (inFlightPersistByRoomCode.get(roomCode) === persistPromise) {
      inFlightPersistByRoomCode.delete(roomCode);
    }
  });
  inFlightPersistByRoomCode.set(roomCode, persistPromise);
  return persistPromise;
}

export function getLiveRoomDurabilityState(room: Room) {
  return getRoomDurabilityState(room);
}

export function isLiveRoomDurablyRecoverable(room: Room): boolean {
  return isRoomDurablyRecoverable(room);
}

export function isLiveRoomPersistenceShuttingDown(): boolean {
  return persistenceShuttingDown;
}

export function setLiveRoomPersistenceShuttingDown(value: boolean): void {
  persistenceShuttingDown = value;
}

export function getPendingLiveRoomPersistenceRoomCodes(): string[] {
  return [...pendingPersistByRoomCode.keys()];
}

export function getInFlightLiveRoomPersistenceRoomCodes(): string[] {
  return [...inFlightPersistByRoomCode.keys()];
}

export function cancelScheduledLiveRoomPersistence(roomCode: string): void {
  const code = roomCode.trim().toUpperCase();
  const timer = flushTimersByRoomCode.get(code);
  if (timer) {
    clearTimeout(timer);
    flushTimersByRoomCode.delete(code);
  }
  pendingPersistByRoomCode.delete(code);
}

/**
 * After a terminal archive: write game_over/abandoned to room_live_sessions, then delete.
 * Cancels any debounced playing-state persist first so it cannot race after delete.
 */
export async function finalizeAndDeleteLiveRoomSession(
  room: Room,
  archiveStatus: 'completed' | 'abandoned',
): Promise<void> {
  if (liveSessionsTableAvailable === false) return;

  cancelScheduledLiveRoomPersistence(room.code);

  const terminalStatus: RoomLiveSessionStatus =
    archiveStatus === 'completed' ? 'game_over' : 'abandoned';
  const row = buildLiveSessionRow(room, resolveRosterForPersist(room));
  row.status = terminalStatus;

  const result = await persistLiveSessionRowNow(row);
  if (!result.ok) return;

  await deleteLiveRoomSession(room.code);
}

/** Debounced upsert — coalesces rapid state commits per room. */
export function schedulePersistLiveRoomSession(room: Room, roster: LiveRosterEntry[]): void {
  const roomCode = room.code.trim().toUpperCase();
  markRoomDurabilityPending(room);
  pendingPersistByRoomCode.set(roomCode, { room, roster });
  if (persistenceShuttingDown) return;

  const existingTimer = flushTimersByRoomCode.get(roomCode);
  if (existingTimer) return;

  const timer = setTimeout(() => {
    flushTimersByRoomCode.delete(roomCode);
    const pending = pendingPersistByRoomCode.get(roomCode);
    pendingPersistByRoomCode.delete(roomCode);
    if (!pending) return;
    void persistLiveRoomSessionNow(pending.room, pending.roster);
  }, LIVE_PERSIST_DEBOUNCE_MS);

  flushTimersByRoomCode.set(roomCode, timer);
}

export type FlushScheduledLiveRoomPersistenceResult = {
  flushedRoomCodes: string[];
};

export async function flushScheduledLiveRoomPersistence(
  roomCode?: string,
): Promise<FlushScheduledLiveRoomPersistenceResult> {
  const codes = roomCode
    ? [roomCode.trim().toUpperCase()]
    : [...new Set([...pendingPersistByRoomCode.keys(), ...flushTimersByRoomCode.keys()])];

  const flushedRoomCodes: string[] = [];

  for (const code of codes) {
    const timer = flushTimersByRoomCode.get(code);
    if (timer) {
      clearTimeout(timer);
      flushTimersByRoomCode.delete(code);
    }
    const pending = pendingPersistByRoomCode.get(code);
    pendingPersistByRoomCode.delete(code);
    if (pending) {
      await persistLiveRoomSessionNow(pending.room, pending.roster);
      flushedRoomCodes.push(code);
    }
  }

  return { flushedRoomCodes };
}

export type FlushAllPendingLiveSessionsResult = {
  flushedRoomCodes: string[];
  awaitedInFlightRoomCodes: string[];
  timedOut: boolean;
};

/**
 * Production shutdown flush: drain debounced pending writes and await in-flight upserts.
 * Safe to call multiple times; concurrent callers share one in-flight flush promise.
 */
export async function flushAllPendingLiveSessions(options?: {
  timeoutMs?: number;
}): Promise<FlushAllPendingLiveSessionsResult> {
  if (flushAllPendingInFlight) return flushAllPendingInFlight;

  const timeoutMs = options?.timeoutMs ?? DEFAULT_SHUTDOWN_FLUSH_TIMEOUT_MS;
  const wasShuttingDown = persistenceShuttingDown;
  persistenceShuttingDown = true;

  flushAllPendingInFlight = (async () => {
    const flushedRoomCodes: string[] = [];
    let timedOut = false;

    const flushWork = async (): Promise<string[]> => {
      const scheduled = await flushScheduledLiveRoomPersistence();
      flushedRoomCodes.push(...scheduled.flushedRoomCodes);

      const inFlightCodes = [...inFlightPersistByRoomCode.keys()];
      await Promise.all([...inFlightPersistByRoomCode.values()]);
      return inFlightCodes;
    };

    let awaitedInFlightRoomCodes: string[] = [];
    try {
      awaitedInFlightRoomCodes = await Promise.race([
        flushWork(),
        new Promise<string[]>((_, reject) => {
          setTimeout(() => reject(new Error('live_persist_flush_timeout')), timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message === 'live_persist_flush_timeout') {
        timedOut = true;
        log.warn(
          {
            timeoutMs,
            pendingRoomCodes: getPendingLiveRoomPersistenceRoomCodes(),
            inFlightRoomCodes: getInFlightLiveRoomPersistenceRoomCodes(),
          },
          'room_live_sessions shutdown flush timed out',
        );
      } else {
        throw error;
      }
    }

    return {
      flushedRoomCodes: [...new Set(flushedRoomCodes)],
      awaitedInFlightRoomCodes,
      timedOut,
    };
  })().finally(() => {
    flushAllPendingInFlight = null;
    if (!wasShuttingDown) {
      persistenceShuttingDown = false;
    }
  });

  return flushAllPendingInFlight;
}

let flushAllPendingInFlight: Promise<FlushAllPendingLiveSessionsResult> | null = null;

export async function loadLiveRoomSession(roomCode: string): Promise<LoadLiveRoomSessionResult> {
  if (liveSessionsTableAvailable === false) {
    return {
      kind: 'persistence_unavailable',
      error: 'room_live_sessions table unavailable',
    };
  }

  const code = roomCode.trim().toUpperCase();
  try {
    const rows = await supabaseFetch<Array<Record<string, unknown>>>(
      `/rest/v1/room_live_sessions?select=*&room_code=eq.${encodeURIComponent(code)}&limit=1`,
      { method: 'GET', headers: { Prefer: 'return=representation' } },
    );
    liveSessionsTableAvailable = true;
    const raw = rows[0];
    if (!raw) return { kind: 'not_found' };
    const parsed = parseLiveSessionRow(raw);
    if (!parsed) {
      return { kind: 'snapshot_invalid', error: 'snapshot_parse_failed' };
    }
    return { kind: 'found', row: parsed };
  } catch (error) {
    if (isMissingRoomLiveSessionsTable(error)) {
      liveSessionsTableAvailable = false;
      return {
        kind: 'persistence_unavailable',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn({ roomCode: code, error: errorMessage }, 'room_live_sessions load failed');
    return {
      kind: 'persistence_unavailable',
      error: errorMessage,
    };
  }
}

export async function deleteLiveRoomSession(roomCode: string): Promise<void> {
  if (liveSessionsTableAvailable === false) return;

  const code = roomCode.trim().toUpperCase();
  try {
    await supabaseFetch(
      `/rest/v1/room_live_sessions?room_code=eq.${encodeURIComponent(code)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
    );
    liveSessionsTableAvailable = true;
  } catch (error) {
    if (isMissingRoomLiveSessionsTable(error)) {
      liveSessionsTableAvailable = false;
      return;
    }
    log.warn(
      { roomCode: code, error: error instanceof Error ? error.message : String(error) },
      'room_live_sessions delete failed',
    );
  }
}

/**
 * Restart hydration contract for active gameplay rooms.
 * Returns explicit outcomes so callers can distinguish durable gameplay restore,
 * shell-only state, absence, stale/invalid snapshot, and persistence outage.
 */
export async function ensureRoomHydrated(roomCode: string): Promise<ActiveRoomHydrationResult> {
  const code = roomCode.trim().toUpperCase();
  const existing = peekRoom(code);
  if (existing) {
    return {
      kind: 'already_in_memory',
      room: existing,
      restoredRoster: [],
      durabilityRecoverable: isRoomDurablyRecoverable(existing),
    };
  }

  const inFlight = inFlightHydrationByRoomCode.get(code);
  if (inFlight) return inFlight;

  const hydrationPromise = (async (): Promise<ActiveRoomHydrationResult> => {
    const result = await runLiveRoomHydration(code);
    emitMpAuthorityHydrationResult(code, result);
    return result;
  })().finally(() => {
    if (inFlightHydrationByRoomCode.get(code) === hydrationPromise) {
      inFlightHydrationByRoomCode.delete(code);
    }
  });

  inFlightHydrationByRoomCode.set(code, hydrationPromise);
  return hydrationPromise;
}

async function runLiveRoomHydration(code: string): Promise<ActiveRoomHydrationResult> {
    const loaded = await loadLiveRoomSession(code);
    if (loaded.kind === 'not_found') {
      return { kind: 'not_found' };
    }
    if (loaded.kind === 'persistence_unavailable') {
      return {
        kind: 'persistence_unavailable',
        error: loaded.error,
      };
    }
    if (loaded.kind === 'snapshot_invalid') {
      return {
        kind: 'snapshot_invalid',
        error: loaded.error,
      };
    }

    const validation = validateLiveRoomHydrationRow(code, loaded.row);
    if (!validation.ok) {
      if (validation.kind === 'shell_only') {
        return { kind: 'shell_only' };
      }
      if (validation.kind === 'snapshot_freshness_unknown') {
        return {
          kind: 'snapshot_freshness_unknown',
          error: validation.error,
        };
      }
      return {
        kind: validation.kind,
        error: validation.error,
      };
    }

    const applied = applyLiveSessionRow(loaded.row);
    if (!applied) {
      return { kind: 'snapshot_invalid', error: 'snapshot_apply_failed' };
    }

    try {
      // Supplement shell-embedded receipts with dedicated table rows (if migrated).
      const dbReceipts = await loadRoomCommandReceiptsForRoom(code);
      if (dbReceipts.length > 0) {
        const restored = hydrateGameActionReceiptsForRoom(code, dbReceipts);
        if (restored > 0) {
          emitMpAuthorityFunnel('private_receipts_hydrated', {
            roomCode: code,
            extra: { restored, source: 'room_command_receipts' },
          });
        }
      }
      return {
        kind: 'hydrated',
        room: applied.room,
        restoredRoster: applied.restoredRoster,
        durabilityRecoverable: true,
      };
    } catch (error) {
      deleteRoom(code);
      return {
        kind: 'snapshot_invalid',
        error: error instanceof Error ? error.message : String(error),
      };
    }
}

/** Test-only reset for debounce timers and table-availability cache. */
export function resetLiveRoomPersistenceForTests(): void {
  for (const timer of flushTimersByRoomCode.values()) {
    clearTimeout(timer);
  }
  flushTimersByRoomCode.clear();
  pendingPersistByRoomCode.clear();
  inFlightPersistByRoomCode.clear();
  inFlightHydrationByRoomCode.clear();
  flushAllPendingInFlight = null;
  persistenceShuttingDown = false;
  liveSessionsTableAvailable = null;
  rosterResolver = null;
}
