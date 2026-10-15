import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../supabaseUtils', () => ({ supabaseFetch: fetchMock }));
vi.mock('../ranking/ratingCutoverGate', async () => {
  class Quiesced extends Error {}
  return {
    RatingCutoverQuiescedError: Quiesced,
    isRatingCutoverQuiescedError: (e: unknown) => e instanceof Quiesced,
    withRatingCompletion: async (_op: string, run: () => Promise<unknown>) => run(),
    trackDeferredRatingWork: (p: Promise<unknown>) => p,
  };
});

import { completeGhostGame, GHOST_DEFERRED_LEGACY_MATCH_UNIQUENESS } from './service';
import {
  drainDeferredGhostCompletions,
  GHOST_DEFERRED_MAX_ATTEMPTS,
  isDeterministicDeferredGhostFailure,
  resetDeferredGhostDrainForTests,
  scheduleDeferredGhostDrain,
} from './deferredGhostCompletion';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const M = '33333333-3333-4333-8333-333333333333';
const row = (over: Record<string, unknown> = {}) => ({
  user_id: B, match_id: M, final_score: 42, opponent_score: 60, move_log: [], mode: 'ghost',
  opponent_rating: 800, apply_rating: true, attempts: 0, ...over,
});
const calls = () => fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? 'GET'} ${String(path).split('?')[0]}`);

describe('completeGhostGame typed legacy-constraint deferral', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('returns ghostDeferred and performs NO profile/style/game reads after the RPC defers', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.includes('ghost_profiles')) return [{ user_id: A, ghost_rating: 900 }];
      if (path.includes('rpc/complete_ghost_rating_v2')) return { status: GHOST_DEFERRED_LEGACY_MATCH_UNIQUENESS };
      throw new Error(`unexpected ${path}`);
    });
    const result = await completeGhostGame({ userId: B, opponentUserId: A, finalScore: 42, opponentScore: 60, moveLog: [], matchId: M });
    expect(result.ghostDeferred).toBe(true);
    expect(calls().filter((c) => !c.includes('ghost_profiles'))).toEqual(['POST /rest/v1/rpc/complete_ghost_rating_v2']);
  });

  it('does NOT swallow a generic 23505 / RPC failure: it propagates', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.includes('ghost_profiles')) return [{ user_id: A, ghost_rating: 900 }];
      throw new Error('Supabase request failed: 409 {"code":"23505","message":"duplicate key value violates unique constraint \\"something_else\\""}');
    });
    await expect(
      completeGhostGame({ userId: B, opponentUserId: A, finalScore: 42, opponentScore: 60, moveLog: [], matchId: M }),
    ).rejects.toThrow(/23505/);
  });
});

describe('deferred Ghost drain', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    resetDeferredGhostDrainForTests();
  });
  afterEach(() => {
    delete process.env.GHOST_DEFERRED_DRAIN_ENABLED;
    resetDeferredGhostDrainForTests();
  });

  it('classifies only RPC rejections as deterministic', () => {
    for (const msg of ['400 {', '409 {', '422 {']) expect(isDeterministicDeferredGhostFailure(new Error(`Supabase request failed: ${msg}`))).toBe(true);
    for (const msg of ['Supabase request failed: 503 {}', 'Supabase request failed: 401', 'fetch failed', 'Supabase request timed out', 'ECONNRESET']) {
      expect(isDeterministicDeferredGhostFailure(new Error(msg))).toBe(false);
    }
  });

  it('nothing deferred: one request', async () => {
    fetchMock.mockResolvedValueOnce([]);
    expect(await drainDeferredGhostCompletions()).toMatchObject({ scanned: 0, completed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waiting for the contract: stops after the first probe and writes nothing', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.includes('ghost_deferred_completions?select')) return [row(), row({ match_id: 'x' })];
      if (path.includes('rpc/complete')) return { status: GHOST_DEFERRED_LEGACY_MATCH_UNIQUENESS };
      throw new Error(`unexpected ${path}`);
    });
    const r = await drainDeferredGhostCompletions();
    expect(r).toMatchObject({ scanned: 2, waitingForContract: true, completed: 0 });
    expect(calls()).toEqual(['GET /rest/v1/ghost_deferred_completions', 'POST /rest/v1/rpc/complete_ghost_rating_v2']);
  });

  it('infrastructure failure stops the sweep and does not consume an attempt', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.includes('ghost_deferred_completions?select')) return [row()];
      throw new Error('Supabase request failed: 503 busy');
    });
    const r = await drainDeferredGhostCompletions();
    expect(r.stoppedEarly).toBe('infrastructure');
    expect(calls().some((c) => c.startsWith('PATCH'))).toBe(false);
  });

  it('deterministic rejection counts an attempt; the last attempt quarantines (row retained)', async () => {
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('ghost_deferred_completions?select')) return [row({ attempts: GHOST_DEFERRED_MAX_ATTEMPTS - 1 })];
      if (path.includes('rpc/complete')) throw new Error('Supabase request failed: 409 {"message":"ghost_match_conflict"}');
      if (init?.method === 'PATCH') return null;
      throw new Error(`unexpected ${path}`);
    });
    const r = await drainDeferredGhostCompletions();
    expect(r).toMatchObject({ failed: 1, quarantined: 1 });
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    const body = JSON.parse(String(patch[1].body));
    expect(body.attempts).toBe(GHOST_DEFERRED_MAX_ATTEMPTS);
    expect(body.quarantined_at).toBeTruthy();
    expect(calls().some((c) => c.startsWith('DELETE'))).toBe(false); // quarantine never deletes
  });

  it('success deletes exactly the replayed (user, match) row', async () => {
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('ghost_deferred_completions?select')) return [row()];
      if (path.includes('rpc/complete')) return { isNewGame: true, newRating: 810, ratingDelta: 10 };
      if (path.includes('ghost_profiles')) return [{ user_id: B, ghost_rating: 810, composite_log: null, style_profile: null, games_played: 1 }];
      if (path.includes('ghost_games')) return [];
      if (init?.method === 'DELETE' || init?.method === 'PATCH') return null;
      throw new Error(`unexpected ${path}`);
    });
    const r = await drainDeferredGhostCompletions();
    expect(r).toMatchObject({ completed: 1, failed: 0 });
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')!;
    expect(del[0]).toContain(`user_id=eq.${B}&match_id=eq.${M}`);
  });

  it('is single-flight', async () => {
    let release!: (v: unknown[]) => void;
    fetchMock.mockReturnValueOnce(new Promise((res) => { release = res; }));
    const p1 = drainDeferredGhostCompletions();
    const p2 = drainDeferredGhostCompletions();
    release([]);
    expect(await p1).toBe(await p2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('scheduler: unref timers, once, disable flag', () => {
    vi.useFakeTimers();
    try {
      process.env.GHOST_DEFERRED_DRAIN_ENABLED = 'false';
      scheduleDeferredGhostDrain();
      expect(vi.getTimerCount()).toBe(0);
      delete process.env.GHOST_DEFERRED_DRAIN_ENABLED;
      scheduleDeferredGhostDrain();
      scheduleDeferredGhostDrain();
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      resetDeferredGhostDrainForTests();
      vi.useRealTimers();
    }
  });
});
