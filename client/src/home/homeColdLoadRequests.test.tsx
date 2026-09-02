// @vitest-environment jsdom
/**
 * Guards the request budget for a cold home load.
 *
 * The home screen fans out to eight loaders. Historically its effect also
 * depended on tournament state owned by useTournament, so every tournament
 * refresh re-ran the whole fan-out — and useTournament's own `refresh` listed
 * state it set, so it fetched twice per mount. Together that turned a 9-request
 * load into 16.
 *
 * This renders the two real hooks wired the way App.tsx wires them
 * (`tournament: ReturnType<typeof useTournament>` is passed straight through)
 * and counts what reaches the network boundary. If either coupling comes back,
 * an endpoint count goes to 2 and this fails with the offending endpoint named.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const TEST_USER = { id: '11111111-2222-4333-8444-555555555555', email: 'a@example.com' };

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseConfigError: () => null,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
      refreshSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: TEST_USER,
    profile: { username: 'tester', glicko_rating: 900 },
    accessToken: 'test-token',
    loading: false,
  }),
  isTemporaryUsername: () => false,
}));

import { useTournament } from '../tournament/useTournament';
import { useHomeCommandCenter } from './useHomeCommandCenter';

const RUN_DATE = '2026-08-21';

/** Exactly the endpoints a cold home load may touch — one call each. */
const EXPECTED_ENDPOINTS = [
  '/api/daily-fritz/today',
  '/api/home/daily-summary',
  '/api/ranking/profile/:id',
  '/api/social/feed',
  '/api/social/friends/with-presence',
  '/api/social/rivals',
  '/api/tournaments/me',
  '/api/tournaments/upcoming',
] as const;

/** An hour out: far enough that no boundary refresh fires, near enough that
 *  the countdown timer stays inside setTimeout's 32-bit range. */
const CLOSE_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const TOURNAMENT = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  scheduled_start: CLOSE_AT,
  registration_open_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  registration_close_at: CLOSE_AT,
  status: 'registration_open',
  format: 'single_elimination',
  win_target: 3,
  max_players: 8,
  winner_id: null,
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  registered_count: 2,
};

function bodyFor(path: string): unknown {
  if (path.includes('/api/tournaments/upcoming')) return { ok: true, tournaments: [TOURNAMENT] };
  if (path.includes('/api/tournaments/me')) {
    return {
      ok: true, registrations: [], activeAssignedMatch: null, assignedMatch: null,
      currentTournamentPhase: null, activeTournamentId: null,
      countdown: { kind: 'registration_close', at: CLOSE_AT },
    };
  }
  if (path.includes('/api/home/daily-summary')) {
    return { ok: true, today: RUN_DATE, week: [], weeklyCompletedCount: 0, currentStreakCount: 0, todayComplete: false };
  }
  if (path.includes('/api/daily-fritz/today')) {
    return {
      ok: true, run_date: RUN_DATE, challenge_id: `df-${RUN_DATE}`, fritz_tier: 'standard',
      deal_size: 7, winning_score: 100, attempt_status: 'none', next_action: 'start',
      streak: 0, result: null, set_result: null, rank: null, leaderboard_preview: [],
    };
  }
  if (path.includes('/api/social/friends/with-presence')) return { ok: true, friends: [] };
  if (path.includes('/api/social/feed')) return { ok: true, feed: [] };
  if (path.includes('/api/social/rivals')) return { ok: true, rivals: [] };
  if (path.includes('/api/ranking/profile')) {
    return { ok: true, rating: 900, peak_rating: 900, global_rank: 1, ranked_games_played: 10, current_win_streak: 0, provisional: false };
  }
  return { ok: true };
}

/** Collapse host, query string and volatile segments so counts aggregate per endpoint. */
function normalize(url: string): string {
  const p = (url.split('://')[1] ?? url).replace(/^[^/]*/, '').split('?')[0] ?? url;
  return p
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d{4}-\d{2}-\d{2}/g, '/:date');
}

let calls: string[] = [];

function countByEndpoint(): Record<string, number> {
  return calls.reduce<Record<string, number>>((acc, c) => {
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});
}

/** Resolve once the request count has held steady for three samples. */
async function waitForRequestsToSettle(): Promise<void> {
  let previous = -1;
  let stable = 0;
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 25); });
    if (calls.length > 0 && calls.length === previous) {
      stable += 1;
      if (stable >= 3) return;
    } else {
      stable = 0;
    }
    previous = calls.length;
  }
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    const path = normalize(url);
    calls.push(path);
    return {
      ok: true,
      status: 200,
      json: async () => bodyFor(path),
      text: async () => JSON.stringify(bodyFor(path)),
    } as unknown as Response;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cold home load request budget', () => {
  it('issues exactly one request per endpoint and eight in total', async () => {
    const { unmount } = renderHook(() => {
      const tournament = useTournament({ userId: TEST_USER.id });
      // The hook takes exactly what useTournament returns, as App.tsx passes it.
      useHomeCommandCenter(tournament as unknown as Parameters<typeof useHomeCommandCenter>[0]);
      return null;
    });

    // Settle on quiescence rather than an exact count. Waiting for "=== 8" would
    // never observe a regression that overshoots to 16, and would burn the whole
    // timeout before reaching the assertion that actually names the endpoint.
    await waitForRequestsToSettle();

    // Named per-endpoint counts, so a regression reports which endpoint doubled.
    expect(countByEndpoint()).toEqual(
      Object.fromEntries(EXPECTED_ENDPOINTS.map((e) => [e, 1])),
    );
    expect(calls.length).toBe(8);

    unmount();
  });
});
