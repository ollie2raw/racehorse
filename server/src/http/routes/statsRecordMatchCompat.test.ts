/**
 * Mixed-version compatibility of POST /api/stats/record-match after the legacy `avgMoveQuality` field was removed from the contract.
 * The route and recordUserMatch are real; only the database call is mocked.
 *
 *   - an OLD client that still sends avgMoveQuality (valid, or the garbage that used to be rejected with 400) is recorded normally and
 *     the value never reaches the row;
 *   - a NEW client that omits it is recorded identically;
 *   - the response shape is unchanged ({ ok, replayed }) and replay de-duplication still works.
 */
import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseFetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../supabaseUtils', () => ({ supabaseFetch: supabaseFetchMock }));

import { recordUserMatch } from '../../stats/recordUserMatch';
import { registerStatsRoutes, type StatsRouteDeps } from './stats';

const AUTH = '11111111-1111-4111-8111-111111111111';
const BODY = {
  mode: 'online', opponentType: 'online', winnerUserId: AUTH, loserUserId: null, winnerScore: 66, loserScore: 19, moveCount: null,
  roomCode: 'ABC123', metadata: { roomCode: 'ABC123', winnerSocketId: 'p1', loserSocketId: 'p2' },
};

describe('POST /api/stats/record-match, mixed client versions', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const deps = {
      io: {}, getRoomRuntimeStats: () => ({ roomCount: 0, gamesInProgress: 0 }), ROOM_CLEANUP_GRACE_MS: 0, getPacificDateKey: () => '2026-01-01',
      getAuthenticatedUserId: async () => AUTH, recordUserMatch,
    } as unknown as StatsRouteDeps;
    const app = express();
    app.use(express.json());
    registerStatsRoutes(app, deps);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  beforeEach(() => supabaseFetchMock.mockReset());

  const post = (body: unknown) => fetch(`${base}/api/stats/record-match`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' }, body: JSON.stringify(body) });
  const insertedRow = () => {
    const call = supabaseFetchMock.mock.calls.find(([path]) => String(path) === '/rest/v1/matches');
    return call ? JSON.parse(String((call[1] as { body: string }).body)) as Record<string, unknown> : null;
  };

  it.each([
    ['a valid legacy value', 87.3],
    ['an out-of-range value (the old server answered 400)', 1000],
    ['a negative value (the old server answered 400)', -3],
    ['a non-numeric value (the old server answered 400)', 'abc'],
    ['a perfect score', 100],
  ])('an old client sending %s is recorded and the value is dropped', async (_label, avgMoveQuality) => {
    supabaseFetchMock.mockResolvedValueOnce([]).mockResolvedValueOnce(undefined);
    const res = await post({ ...BODY, avgMoveQuality });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, replayed: false });
    const row = insertedRow();
    expect(row).toBeTruthy();
    expect(Object.keys(row!)).not.toContain('avg_move_quality');
    expect(row).toMatchObject({ mode: 'online', winner_user_id: AUTH, winner_score: 66, loser_score: 19, room_code: 'ABC123' });
  });

  it('a new client that omits the field records the identical row', async () => {
    supabaseFetchMock.mockResolvedValueOnce([]).mockResolvedValueOnce(undefined);
    const res = await post(BODY);
    expect(res.status).toBe(200);
    const withoutField = insertedRow();
    supabaseFetchMock.mockReset();
    supabaseFetchMock.mockResolvedValueOnce([]).mockResolvedValueOnce(undefined);
    await post({ ...BODY, avgMoveQuality: 42 });
    expect(insertedRow()).toEqual(withoutField);
  });

  it('replays are still de-duplicated, with or without the legacy field', async () => {
    supabaseFetchMock.mockResolvedValueOnce([{ id: 'existing-row' }]);
    const res = await post({ ...BODY, avgMoveQuality: 55 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, replayed: true });
    expect(insertedRow()).toBeNull();
  });
});
