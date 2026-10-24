import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';

const authMock = vi.fn();
const leaderboardMock = vi.fn();
vi.mock('../../platform/auth/supabaseAuth', () => ({ getAuthenticatedUserId: (...a: unknown[]) => authMock(...a) }));
vi.mock('../stores/dailyFritzStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildDailyFritzLeaderboard: (...a: unknown[]) => leaderboardMock(...a),
}));

import { registerDailyFritzAdminRoutes } from './dailyFritzAdminRoutes';

type Handler = (req: any, res: any) => Promise<void>;
const routes = new Map<string, Handler>();
registerDailyFritzAdminRoutes({ get: (p: string, h: Handler) => routes.set(`GET ${p}`, h), post: (p: string, h: Handler) => routes.set(`POST ${p}`, h) } as unknown as Application);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const board = [
  { rank: 1, userId: A, username: 'ada', final_score: 90 },
  { rank: 2, userId: B, username: 'bob', final_score: 80 },
];

async function get(date: string) {
  let status = 200;
  let body: any;
  const headers: Record<string, string> = {};
  const vary: string[] = [];
  const res = {
    status(c: number) { status = c; return res; },
    json(v: unknown) { body = v; return res; },
    set(k: string, v: string) { headers[k] = v; return res; },
    vary(v: string) { vary.push(v); return res; },
  };
  await routes.get('GET /api/daily-fritz/leaderboard/:date')!({ headers: {}, params: { date }, query: {}, body: {} }, res);
  return { status, body, headers, vary };
}

beforeEach(() => {
  authMock.mockReset();
  leaderboardMock.mockReset().mockResolvedValue(board);
});

describe('GET /api/daily-fritz/leaderboard/:date — what "private" means', () => {
  it('anonymous callers are refused before any data is read', async () => {
    authMock.mockResolvedValue(null);
    const r = await get('2026-10-16');
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'Unauthorized' });
    expect(leaderboardMock).not.toHaveBeenCalled();
  });

  it('each signed-in viewer sees the same board with only their own row flagged, and no user ids', async () => {
    authMock.mockResolvedValue(A);
    const asA = await get('2026-10-16');
    authMock.mockResolvedValue(B);
    const asB = await get('2026-10-16');

    expect(asA.body.leaderboard.map((e: any) => e.is_current_user)).toEqual([true, false]);
    expect(asB.body.leaderboard.map((e: any) => e.is_current_user)).toEqual([false, true]);
    for (const r of [asA, asB]) {
      expect(JSON.stringify(r.body)).not.toContain(A);
      expect(JSON.stringify(r.body)).not.toContain(B);
      expect(r.body.leaderboard.map((e: any) => e.username)).toEqual(['ada', 'bob']);
    }
  });

  it('is never shared-cacheable and varies on the credential', async () => {
    authMock.mockResolvedValue(A);
    const r = await get('2026-10-16');
    expect(r.headers['Cache-Control']).toMatch(/^private,/);
    expect(r.headers['Cache-Control']).not.toMatch(/public/);
    expect(r.vary).toContain('Authorization');
  });

  it('rejects malformed dates without reading the board', async () => {
    authMock.mockResolvedValue(A);
    expect((await get('2026-10-16&x=1')).status).toBe(400);
    expect(leaderboardMock).not.toHaveBeenCalled();
  });
});
