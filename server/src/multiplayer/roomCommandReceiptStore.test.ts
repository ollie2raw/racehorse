import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async () => []),
}));

import { supabaseFetch } from '../supabaseUtils';
import {
  deleteRoomCommandReceiptsForRoom,
  getRoomCommandReceiptsPersistenceAvailability,
  loadRoomCommandReceiptsForRoom,
  persistRoomCommandReceipt,
  probeRoomCommandReceiptsTable,
  resetRoomCommandReceiptStoreForTests,
} from './roomCommandReceiptStore';

describe('roomCommandReceiptStore', () => {
  beforeEach(() => {
    resetRoomCommandReceiptStoreForTests();
    vi.mocked(supabaseFetch).mockReset();
    vi.mocked(supabaseFetch).mockResolvedValue([]);
  });

  afterEach(() => {
    resetRoomCommandReceiptStoreForTests();
  });

  it('persists receipts via upsert on conflict', async () => {
    vi.mocked(supabaseFetch).mockResolvedValueOnce(undefined as never);
    await persistRoomCommandReceipt({
      roomCode: 'abcd',
      playerSeatId: 'seat-a',
      requestId: 'req-1',
      ack: { ok: true, sequence: 7 },
      expiresAtMs: Date.now() + 60_000,
    });

    expect(supabaseFetch).toHaveBeenCalledTimes(1);
    const [path, init] = vi.mocked(supabaseFetch).mock.calls[0]!;
    expect(path).toContain('room_command_receipts');
    expect(path).toContain('on_conflict=room_code,player_seat_id,request_id');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body[0].room_code).toBe('ABCD');
    expect(body[0].request_id).toBe('req-1');
    expect(body[0].ack.sequence).toBe(7);
  });

  it('marks table unavailable on PGRST205 and skips later writes', async () => {
    vi.mocked(supabaseFetch).mockRejectedValueOnce(
      new Error(
        'Supabase request failed: 404 {"code":"PGRST205","message":"Could not find the table \'public.room_command_receipts\'"}',
      ),
    );
    await persistRoomCommandReceipt({
      roomCode: 'ROOM1',
      playerSeatId: 'seat-a',
      requestId: 'req-missing',
      ack: { ok: true, sequence: 1 },
      expiresAtMs: Date.now() + 60_000,
    });
    expect(getRoomCommandReceiptsPersistenceAvailability()).toBe(false);

    vi.mocked(supabaseFetch).mockClear();
    await persistRoomCommandReceipt({
      roomCode: 'ROOM1',
      playerSeatId: 'seat-a',
      requestId: 'req-2',
      ack: { ok: true, sequence: 2 },
      expiresAtMs: Date.now() + 60_000,
    });
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it('loads non-expired receipts into PersistedGameActionReceipt shape', async () => {
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    vi.mocked(supabaseFetch).mockResolvedValueOnce([
      {
        room_code: 'ROOM9',
        player_seat_id: 'seat-b',
        request_id: 'req-load',
        match_id: null,
        ack: { ok: true, sequence: 3, uncertain: false },
        expires_at: expiresAt,
      },
    ]);

    const receipts = await loadRoomCommandReceiptsForRoom('room9');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.playerSeatId).toBe('seat-b');
    expect(receipts[0]?.requestId).toBe('req-load');
    expect(receipts[0]?.ack.sequence).toBe(3);
  });

  it('deletes all receipts for a room code', async () => {
    vi.mocked(supabaseFetch).mockResolvedValueOnce(undefined as never);
    await deleteRoomCommandReceiptsForRoom('zz99');
    const [path, init] = vi.mocked(supabaseFetch).mock.calls[0]!;
    expect(path).toContain('room_code=eq.ZZ99');
    expect(init?.method).toBe('DELETE');
  });

  it('probeRoomCommandReceiptsTable sets availability true when table exists', async () => {
    vi.mocked(supabaseFetch).mockResolvedValueOnce([]);
    await expect(probeRoomCommandReceiptsTable()).resolves.toBe(true);
  });
});
