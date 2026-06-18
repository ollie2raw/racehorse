import type { Room } from '../rooms';
import { getRoomMatchEventSnapshot } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { finalizeAndDeleteLiveRoomSession } from './roomLivePersistence';
import { getRoomPlayersWithFallback, type PersistedRoomMatchLogStatus } from './roomSession';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PersistedRoomParticipant = {
  id: string;
  username: string;
  userId: string | null;
  seatIndex: number;
};

export type PersistedRoomMatchLogRow = {
  match_id: string;
  room_code: string;
  status: PersistedRoomMatchLogStatus;
  event_log_version: number;
  last_event_sequence: number;
  event_count: number;
  started_at: string | null;
  archived_at: string;
  participant_user_ids: string[];
  participants: PersistedRoomParticipant[];
  summary: Record<string, unknown> | null;
  state_snapshot: Record<string, unknown> | null;
  events: ReturnType<typeof getRoomMatchEventSnapshot>['events'];
};

let persistentRoomMatchLogsAvailable: boolean | null = null;

function isUuidLike(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isMissingRoomMatchLogsTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('room_match_logs') &&
    (message.includes('does not exist') ||
      message.includes('could not find') ||
      message.includes('pgrst205'))
  );
}

export function getRoomMatchLogsPersistenceAvailability(): boolean | null {
  return persistentRoomMatchLogsAvailable;
}

/** Lightweight HEAD-style probe so startup does not inherit a stale "table missing" flag. */
export async function probeRoomMatchLogsTable(): Promise<boolean> {
  try {
    await supabaseFetch<Array<{ match_id: string }>>(
      '/rest/v1/room_match_logs?select=match_id&limit=1',
      { method: 'GET', headers: { Prefer: 'return=minimal' }, timeoutMs: 5_000 },
    );
    persistentRoomMatchLogsAvailable = true;
    return true;
  } catch (error) {
    if (isMissingRoomMatchLogsTable(error)) {
      persistentRoomMatchLogsAvailable = false;
      return false;
    }
    console.warn('[room-match-logs] startup probe failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return persistentRoomMatchLogsAvailable === true;
  }
}

function buildPersistedRoomParticipants(roomCode: string, room: Room): PersistedRoomParticipant[] {
  const roster = getRoomPlayersWithFallback(roomCode, room.players);
  return roster.map((player, seatIndex) => ({
    id: player.id,
    username: player.username,
    userId: player.userId,
    seatIndex,
  }));
}

function buildPersistedRoomSummary(
  room: Room,
  status: PersistedRoomMatchLogStatus,
): Record<string, unknown> | null {
  if (!room.state) {
    return {
      status,
      gameStarted: false,
      playerCount: room.players.length,
      winningScore:
        typeof (room.config as Record<string, unknown>)?.winningScore === 'number'
          ? (room.config as Record<string, unknown>).winningScore
          : null,
    };
  }

  return {
    status,
    gameStarted: true,
    gameOver: room.state.gameOver,
    handOver: room.state.handOver,
    handNumber: room.state.handNumber,
    winnerId: room.state.winnerId ?? null,
    currentPlayerId: room.state.playerIds[room.state.currentPlayerIndex] ?? null,
    winningScore: room.state.config.winningScore,
    scores: Object.fromEntries(
      room.state.playerIds.map((playerId) => [playerId, room.state?.players[playerId]?.score ?? 0]),
    ),
    handCounts: Object.fromEntries(
      room.state.playerIds.map((playerId) => [playerId, room.state?.players[playerId]?.hand.length ?? 0]),
    ),
  };
}

function toPersistedRoomMatchLogRow(
  room: Room,
  status: PersistedRoomMatchLogStatus,
): PersistedRoomMatchLogRow {
  const snapshot = getRoomMatchEventSnapshot(room.code);
  const participants = buildPersistedRoomParticipants(room.code, room);
  const participantUserIds = participants
    .map((participant) => participant.userId)
    .filter((userId): userId is string => isUuidLike(userId));

  return {
    match_id: snapshot.matchId,
    room_code: snapshot.roomCode,
    status,
    event_log_version: snapshot.version,
    last_event_sequence: snapshot.lastEventSequence,
    event_count: snapshot.eventCount,
    started_at: snapshot.events[0]?.timestamp ?? null,
    archived_at: new Date().toISOString(),
    participant_user_ids: participantUserIds,
    participants,
    summary: buildPersistedRoomSummary(room, status),
    state_snapshot: room.state ? (room.state as unknown as Record<string, unknown>) : null,
    events: snapshot.events,
  };
}

export function isRoomMatchLogsPersistenceAvailable(): boolean {
  return persistentRoomMatchLogsAvailable !== false;
}

export async function persistRoomMatchLog(
  room: Room,
  status: PersistedRoomMatchLogStatus,
): Promise<void> {
  if (room.events.length === 0) return;
  if (persistentRoomMatchLogsAvailable === false) return;

  try {
    await supabaseFetch<PersistedRoomMatchLogRow[]>(
      '/rest/v1/room_match_logs?on_conflict=match_id',
      {
        method: 'POST',
        headers: {
          Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify([toPersistedRoomMatchLogRow(room, status)]),
      },
    );
    persistentRoomMatchLogsAvailable = true;
    await finalizeAndDeleteLiveRoomSession(room, status);
  } catch (error) {
    if (isMissingRoomMatchLogsTable(error)) {
      persistentRoomMatchLogsAvailable = false;
      console.warn('[room-match-logs] persistence table missing, skipping archive');
      return;
    }
    throw error;
  }
}

export async function queryPersistedRoomMatchLog(
  matchId: string,
): Promise<PersistedRoomMatchLogRow | null> {
  if (persistentRoomMatchLogsAvailable === false) return null;

  try {
    const rows = await supabaseFetch<PersistedRoomMatchLogRow[]>(
      `/rest/v1/room_match_logs?select=match_id,room_code,status,event_log_version,last_event_sequence,event_count,started_at,archived_at,participant_user_ids,participants,summary,state_snapshot,events&match_id=eq.${encodeURIComponent(matchId)}&limit=1`,
      { method: 'GET' },
    );
    persistentRoomMatchLogsAvailable = true;
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingRoomMatchLogsTable(error)) {
      persistentRoomMatchLogsAvailable = false;
      return null;
    }
    throw error;
  }
}

/** Test-only reset for table-availability cache. */
export function resetRoomMatchLogPersistenceForTests(): void {
  persistentRoomMatchLogsAvailable = null;
}
