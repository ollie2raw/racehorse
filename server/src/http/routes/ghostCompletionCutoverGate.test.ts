import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerifiedSinglePlayerMatch } from '../../shared/verifiedSinglePlayerMatch';

let gateClosed = true;
vi.mock('../../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string) => {
    if (String(path).includes('rating_cutover_gate')) {
      return [{ quiesced: gateClosed, quiesced_at: null, enabled_boot_id: null, reason: null, ghost_expand_applied_at: null }];
    }
    return [];
  }),
}));

import { registerGhostRoutes } from './ghost';
import {
  getRatingCutoverCountersForTests,
  resetRatingCutoverGateForTests,
  setLegacyRatingWritersEnforcedForTests,
} from '../../ranking/ratingCutoverGate';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OPPONENT_ID = '22222222-2222-4222-8222-222222222222';
const MATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function harness() {
  const routes = new Map<string, (req: any, res: any) => Promise<void>>();
  const record: VerifiedSinglePlayerMatch = {
    matchId: MATCH_ID, userId: USER_ID, localMatchId: null, mode: 'ghost', opponentUserId: OPPONENT_ID,
    fritzTier: null, status: 'started', startedAt: '2026-10-05T00:00:00.000Z', completedAt: null,
    completionHash: null, completionResult: null, dealSnapshot: null,
  };
  const completeGhostGame = vi.fn(async (params: { finalScore: number; opponentScore: number }) => ({
    newRating: 812, ratingDelta: 12, glickoRating: null, glickoDelta: null,
    playerScore: params.finalScore, ghostScore: params.opponentScore, playerWon: true,
    compositeLog: { generatedAt: 'x', sourceGameIds: [], states: [], recentGameStyles: [] }, styleProfile: null,
  }));
  const persist = vi.fn(async (row: VerifiedSinglePlayerMatch) => row);
  registerGhostRoutes({
    get: (p: string, h: any) => routes.set(`GET ${p}`, h),
    post: (p: string, h: any) => routes.set(`POST ${p}`, h),
  } as any, {
    getAuthenticatedUserId: async () => USER_ID,
    isFritzId: () => false,
    getVerifiedSinglePlayerMatch: async () => record,
    persistVerifiedSinglePlayerMatch: persist,
    startVerifiedSinglePlayerMatch: async () => record,
    isSafeGhostMoveLog: (raw): raw is Array<Record<string, unknown>> => Array.isArray(raw) && raw.length > 0,
    buildGhostCompletionHash: () => 'hash',
    writeMatchActivity: async () => null,
    formatFritzActivityOpponentLabel: () => 'Fritz',
    supabaseFetch: async () => [] as never,
    completeGhostGame: completeGhostGame as never,
    getGhostProfileSummary: (async () => ({ compositeLog: null })) as never,
  });
  async function complete() {
    let status = 200;
    let body: any;
    const headers: Record<string, string> = {};
    const res = {
      status: (c: number) => { status = c; return res; },
      json: (p: unknown) => { body = p; return res; },
      setHeader: (k: string, v: string) => { headers[k] = v; },
    };
    await routes.get('POST /api/ghost/complete')!({
      headers: {},
      body: { userId: USER_ID, matchId: MATCH_ID, opponentUserId: OPPONENT_ID, finalScore: 30, opponentScore: 12,
        moveLog: [{ turn: 1, actor: 'you', board_state: 'b', tile_played: '1|1', branch: 'left', hand_before: ['1|1'], score_delta: 0 }] },
    }, res);
    return { status, body, headers };
  }
  return { complete, completeGhostGame, persist };
}

beforeEach(() => {
  gateClosed = true;
  resetRatingCutoverGateForTests();
  setLegacyRatingWritersEnforcedForTests(true);
});
afterEach(() => resetRatingCutoverGateForTests());

describe('POST /api/ghost/complete under the rating cutover gate (legacy build)', () => {
  it('answers a retryable 503 before any rating or verified-match write while the gate is closed', async () => {
    const h = harness();
    const r = await h.complete();
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'rating_cutover_quiesced', retryable: true });
    expect(r.headers['Retry-After']).toBe('5');
    expect(h.completeGhostGame).not.toHaveBeenCalled();
    expect(h.persist).not.toHaveBeenCalled();
    expect(getRatingCutoverCountersForTests().completions).toBe(0);
  });

  it('an identical retry after the gate reopens completes exactly once', async () => {
    const h = harness();
    expect((await h.complete()).status).toBe(503);
    gateClosed = false;
    const retry = await h.complete();
    expect(retry.status).toBe(200);
    expect(h.completeGhostGame).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(getRatingCutoverCountersForTests().completions).toBe(0);
  });
});
