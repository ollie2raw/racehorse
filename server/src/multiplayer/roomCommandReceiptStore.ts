import { supabaseFetch } from '../supabaseUtils';
import type { GameActionAck, PersistedGameActionReceipt } from './gameActionIdempotency';

type RoomCommandReceiptRow = {
  room_code: string;
  player_seat_id: string;
  request_id: string;
  match_id: string | null;
  ack: Omit<GameActionAck, 'duplicate'>;
  expires_at: string;
};

let persistentRoomCommandReceiptsAvailable: boolean | null = null;

function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

function hasSupabaseCredentials(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_KEY?.trim());
}

function isMissingRoomCommandReceiptsTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('room_command_receipts') &&
    (message.includes('does not exist') ||
      message.includes('could not find') ||
      message.includes('pgrst205'))
  );
}

export function getRoomCommandReceiptsPersistenceAvailability(): boolean | null {
  return persistentRoomCommandReceiptsAvailable;
}

export function isRoomCommandReceiptsPersistenceAvailable(): boolean {
  return persistentRoomCommandReceiptsAvailable !== false;
}

/** Lightweight probe so startup does not inherit a stale "table missing" flag. */
export async function probeRoomCommandReceiptsTable(): Promise<boolean> {
  if (!hasSupabaseCredentials()) {
    persistentRoomCommandReceiptsAvailable = false;
    return false;
  }
  try {
    await supabaseFetch<Array<{ room_code: string }>>(
      '/rest/v1/room_command_receipts?select=room_code&limit=1',
      { method: 'GET', headers: { Prefer: 'return=minimal' }, timeoutMs: 5_000 },
    );
    persistentRoomCommandReceiptsAvailable = true;
    return true;
  } catch (error) {
    if (isMissingRoomCommandReceiptsTable(error)) {
      persistentRoomCommandReceiptsAvailable = false;
      return false;
    }
    console.warn('[room-command-receipts] startup probe failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return persistentRoomCommandReceiptsAvailable === true;
  }
}

export type PersistRoomCommandReceiptInput = {
  roomCode: string;
  playerSeatId: string;
  requestId: string;
  ack: Omit<GameActionAck, 'duplicate'>;
  expiresAtMs: number;
  matchId?: string | null;
};

export async function persistRoomCommandReceipt(
  input: PersistRoomCommandReceiptInput,
): Promise<void> {
  if (!hasSupabaseCredentials()) {
    persistentRoomCommandReceiptsAvailable = false;
    return;
  }
  if (persistentRoomCommandReceiptsAvailable === false) return;
  if (!input.ack.ok && !input.ack.uncertain) return;

  const row: RoomCommandReceiptRow = {
    room_code: normalizeRoomCode(input.roomCode),
    player_seat_id: input.playerSeatId,
    request_id: input.requestId,
    match_id: input.matchId ?? null,
    ack: {
      ok: input.ack.ok,
      sequence: input.ack.sequence ?? null,
      ...(input.ack.forcedDraw ? { forcedDraw: input.ack.forcedDraw } : {}),
      ...(input.ack.error ? { error: input.ack.error } : {}),
      ...(input.ack.uncertain ? { uncertain: input.ack.uncertain } : {}),
    },
    expires_at: new Date(input.expiresAtMs).toISOString(),
  };

  try {
    await supabaseFetch<RoomCommandReceiptRow[]>(
      '/rest/v1/room_command_receipts?on_conflict=room_code,player_seat_id,request_id',
      {
        method: 'POST',
        headers: {
          Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify([row]),
      },
    );
    persistentRoomCommandReceiptsAvailable = true;
  } catch (error) {
    if (isMissingRoomCommandReceiptsTable(error)) {
      persistentRoomCommandReceiptsAvailable = false;
      console.warn('[room-command-receipts] table missing, skipping persist');
      return;
    }
    console.warn('[room-command-receipts] persist failed', {
      roomCode: row.room_code,
      requestId: row.request_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function loadRoomCommandReceiptsForRoom(
  roomCode: string,
  now = Date.now(),
): Promise<PersistedGameActionReceipt[]> {
  if (!hasSupabaseCredentials()) {
    persistentRoomCommandReceiptsAvailable = false;
    return [];
  }
  if (persistentRoomCommandReceiptsAvailable === false) return [];

  const code = normalizeRoomCode(roomCode);
  try {
    const rows = await supabaseFetch<RoomCommandReceiptRow[]>(
      `/rest/v1/room_command_receipts?room_code=eq.${encodeURIComponent(code)}&expires_at=gt.${encodeURIComponent(new Date(now).toISOString())}&select=room_code,player_seat_id,request_id,match_id,ack,expires_at`,
      { method: 'GET' },
    );
    persistentRoomCommandReceiptsAvailable = true;
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const receipts: PersistedGameActionReceipt[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (typeof row.player_seat_id !== 'string' || !row.player_seat_id.trim()) continue;
      if (typeof row.request_id !== 'string' || !row.request_id.trim()) continue;
      if (!row.ack || typeof row.ack !== 'object') continue;
      const expiresAt = Date.parse(row.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
      receipts.push({
        playerSeatId: row.player_seat_id,
        requestId: row.request_id,
        ack: {
          ok: Boolean(row.ack.ok),
          sequence: typeof row.ack.sequence === 'number' ? row.ack.sequence : null,
          ...(row.ack.forcedDraw ? { forcedDraw: row.ack.forcedDraw } : {}),
          ...(typeof row.ack.error === 'string' ? { error: row.ack.error } : {}),
          ...(row.ack.uncertain ? { uncertain: true } : {}),
        },
        expiresAt,
      });
    }
    return receipts;
  } catch (error) {
    if (isMissingRoomCommandReceiptsTable(error)) {
      persistentRoomCommandReceiptsAvailable = false;
      return [];
    }
    console.warn('[room-command-receipts] load failed', {
      roomCode: code,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function deleteRoomCommandReceiptsForRoom(roomCode: string): Promise<void> {
  if (!hasSupabaseCredentials()) {
    persistentRoomCommandReceiptsAvailable = false;
    return;
  }
  if (persistentRoomCommandReceiptsAvailable === false) return;
  const code = normalizeRoomCode(roomCode);
  try {
    await supabaseFetch(
      `/rest/v1/room_command_receipts?room_code=eq.${encodeURIComponent(code)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
    );
    persistentRoomCommandReceiptsAvailable = true;
  } catch (error) {
    if (isMissingRoomCommandReceiptsTable(error)) {
      persistentRoomCommandReceiptsAvailable = false;
      return;
    }
    console.warn('[room-command-receipts] delete failed', {
      roomCode: code,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Test-only reset for table-availability cache. */
export function resetRoomCommandReceiptStoreForTests(): void {
  persistentRoomCommandReceiptsAvailable = null;
}
