/**
 * Puzzle Rush as the Daily Puzzle: official-run marking, the streak's move to
 * rush_runs, and the two leaderboards.
 *
 * The load-bearing test here is streak continuity across the transition — a
 * player mid-streak when Rush shipped must not lose a day or reset.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseFetch: vi.fn() }));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => mocks.supabaseFetch(...args),
}));

import {
  buildHomeDailySummary,
  createHomeDailyCompletionMap,
} from '../homeDailySummary';
import {
  buildDailyPuzzleRushLeaderboard,
  buildPuzzleRushLeaderboard,
  findPersonalBestRun,
} from './leaderboard';
import type { PuzzleRushRun } from './types';

function run(overrides: Partial<PuzzleRushRun> & { id: string; userId: string }): PuzzleRushRun {
  return {
    username: 'Player',
    status: 'completed',
    startedAt: '2026-08-20T10:00:00.000Z',
    endedAt: '2026-08-20T10:02:00.000Z',
    totalScore: 0,
    puzzlesSolved: 0,
    clientReportedScore: 0,
    invalidatedReason: null,
    configVersion: 1,
    runDate: '2026-08-20',
    isOfficial: false,
    ...overrides,
  };
}

beforeEach(() => mocks.supabaseFetch.mockReset());

// ─── 1 + 4: official marking and the race ────────────────────────────────

describe('official run marking', () => {
  it('marks the first run of the day official and the second not', async () => {
    const { createRushRun, hasOfficialRushRunForDate } = await import(
      '../http/stores/puzzleRushStore'
    );

    // First run of the day: no official run exists yet.
    mocks.supabaseFetch.mockResolvedValueOnce([]);
    expect(await hasOfficialRushRunForDate('user-1', '2026-08-20')).toBe(false);

    mocks.supabaseFetch.mockResolvedValueOnce([
      { id: 'run-1', user_id: 'user-1', status: 'in_progress', started_at: 'x', run_date: '2026-08-20', is_official: true },
    ]);
    const first = await createRushRun({
      userId: 'user-1', username: 'P', runDate: '2026-08-20', isOfficial: true,
    });
    expect(first.run.isOfficial).toBe(true);
    expect(first.run.runDate).toBe('2026-08-20');
    const firstBody = JSON.parse((mocks.supabaseFetch.mock.calls[1][1] as { body: string }).body);
    expect(firstBody[0]).toMatchObject({ run_date: '2026-08-20', is_official: true });

    // Second run the same day: an official run now exists.
    mocks.supabaseFetch.mockResolvedValueOnce([{ id: 'run-1' }]);
    expect(await hasOfficialRushRunForDate('user-1', '2026-08-20')).toBe(true);

    mocks.supabaseFetch.mockResolvedValueOnce([
      { id: 'run-2', user_id: 'user-1', status: 'in_progress', started_at: 'x', run_date: '2026-08-20', is_official: false },
    ]);
    const second = await createRushRun({
      userId: 'user-1', username: 'P', runDate: '2026-08-20', isOfficial: false,
    });
    expect(second.run.isOfficial).toBe(false);
    const secondBody = JSON.parse((mocks.supabaseFetch.mock.calls[3][1] as { body: string }).body);
    expect(secondBody[0].is_official).toBe(false);
  });

  it('queries the official check against the indexed user+date+flag', async () => {
    const { hasOfficialRushRunForDate } = await import('../http/stores/puzzleRushStore');
    mocks.supabaseFetch.mockResolvedValueOnce([]);
    await hasOfficialRushRunForDate('user-1', '2026-08-20');
    const path = mocks.supabaseFetch.mock.calls[0][0] as string;
    expect(path).toContain('user_id=eq.user-1');
    expect(path).toContain('run_date=eq.2026-08-20');
    expect(path).toContain('is_official=is.true');
    expect(path).toContain('limit=1');
  });

  it('loses the race gracefully: a unique-index conflict retries as unofficial', async () => {
    const { createRushRun } = await import('../http/stores/puzzleRushStore');

    // Both starts read "no official run yet"; the DB index rejects the loser.
    mocks.supabaseFetch
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "rush_runs_one_official_per_user_day_idx"'),
      )
      .mockResolvedValueOnce([
        { id: 'run-b', user_id: 'user-1', status: 'in_progress', started_at: 'x', run_date: '2026-08-20', is_official: false },
      ]);

    const loser = await createRushRun({
      userId: 'user-1', username: 'P', runDate: '2026-08-20', isOfficial: true,
    });

    // Exactly one run ends up official — this one fell back rather than failing.
    expect(loser.run.isOfficial).toBe(false);
    const retryBody = JSON.parse((mocks.supabaseFetch.mock.calls[1][1] as { body: string }).body);
    expect(retryBody[0].is_official).toBe(false);
  });

  it('recovers the winning open run if the unofficial retry also collides', async () => {
    const { createRushRun } = await import('../http/stores/puzzleRushStore');
    mocks.supabaseFetch
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "rush_runs_one_official_per_user_day_idx"'))
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "rush_runs_one_open_per_user_idx"'))
      .mockResolvedValueOnce([{ id: 'run-winner', user_id: 'user-1', status: 'in_progress', started_at: 'x', run_date: '2026-08-20', is_official: true, assigned_puzzle_ids: ['puzzle-1'] }]);

    const result = await createRushRun({
      userId: 'user-1', username: 'P', runDate: '2026-08-20', isOfficial: true,
      assignedPuzzleIds: ['puzzle-2'],
    });
    expect(result.created).toBe(false);
    expect(result.run.id).toBe('run-winner');
    expect(result.run.assignedPuzzleIds).toEqual(['puzzle-1']);
  });

  it('does not swallow an unrelated insert failure', async () => {
    const { createRushRun } = await import('../http/stores/puzzleRushStore');
    mocks.supabaseFetch.mockRejectedValueOnce(new Error('connection reset'));
    await expect(
      createRushRun({ userId: 'user-1', username: 'P', runDate: '2026-08-20', isOfficial: true }),
    ).rejects.toThrow('connection reset');
  });
});

// ─── 2 + 3: the streak ───────────────────────────────────────────────────

describe('streak source', () => {
  it('counts any completed run that day, not only the official one', async () => {
    const { listCompletedPuzzleRushDatesForUser } = await import(
      '../http/stores/homeCompletionDates'
    );
    mocks.supabaseFetch.mockResolvedValueOnce([{ run_date: '2026-08-20' }]);

    const dates = await listCompletedPuzzleRushDatesForUser('user-1');

    expect(dates).toEqual(['2026-08-20']);
    const path = mocks.supabaseFetch.mock.calls[0][0] as string;
    expect(path).toContain('status=eq.completed');
    // The whole point: an abandoned official run must not cost the day, so the
    // streak query is deliberately blind to is_official.
    expect(path).not.toContain('is_official');
  });

  it('an abandoned official run plus a completed later run still makes the day count', () => {
    // Only completed runs reach the completion map; the abandoned official run
    // simply is not in the list. The day still counts.
    const completedRushDates = ['2026-08-20'];
    const map = createHomeDailyCompletionMap([], completedRushDates);
    const summary = buildHomeDailySummary('2026-08-20', map, new Date('2026-08-20T18:00:00Z'));

    expect(summary.todayComplete).toBe(true);
    expect(summary.currentStreakCount).toBe(1);
  });

  it('CRITICAL: a streak spanning ladder history and new rush days has no gap', () => {
    // A player mid-streak when Rush shipped: five ladder days, then their
    // first-ever Rush completion the next day.
    const ladderDays = ['2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19'];
    const rushDays = ['2026-08-20'];

    // Exactly what the stats route does: union the sources, no writes.
    const puzzleDates = Array.from(new Set([...ladderDays, ...rushDays]));
    const map = createHomeDailyCompletionMap([], puzzleDates);
    const summary = buildHomeDailySummary('2026-08-20', map, new Date('2026-08-20T18:00:00Z'));

    // Six days: five from daily_puzzle_attempts, one from rush_runs.
    expect(summary.currentStreakCount).toBe(6);
    expect(summary.todayComplete).toBe(true);
  });

  it('a streak does not reset on the day Rush ships before the first run', () => {
    // Same player, but they have not played Rush yet today. The ladder history
    // still anchors the streak on yesterday — nothing was reset.
    const ladderDays = ['2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19'];
    const map = createHomeDailyCompletionMap([], ladderDays);
    const summary = buildHomeDailySummary('2026-08-20', map, new Date('2026-08-20T18:00:00Z'));

    expect(summary.todayComplete).toBe(false);
    // Anchored to yesterday, so the five-day run is intact and continuable.
    expect(summary.currentStreakCount).toBe(5);
  });

  it('a gap day still breaks the streak', () => {
    const map = createHomeDailyCompletionMap([], ['2026-08-20', '2026-08-19', '2026-08-17']);
    const summary = buildHomeDailySummary('2026-08-20', map, new Date('2026-08-20T18:00:00Z'));
    expect(summary.currentStreakCount).toBe(2);
  });

  it('degrades to no rush days when the table is missing, rather than failing', async () => {
    const { listCompletedPuzzleRushDatesForUser } = await import(
      '../http/stores/homeCompletionDates'
    );
    mocks.supabaseFetch.mockRejectedValueOnce(
      new Error('relation "public.rush_runs" does not exist'),
    );
    await expect(listCompletedPuzzleRushDatesForUser('user-1')).resolves.toEqual([]);
  });
});

// ─── 5: the two leaderboards ─────────────────────────────────────────────

describe('leaderboards', () => {
  const runs: PuzzleRushRun[] = [
    run({ id: 'a-official', userId: 'user-a', totalScore: 500, puzzlesSolved: 8, isOfficial: true }),
    run({ id: 'a-funrun', userId: 'user-a', totalScore: 900, puzzlesSolved: 12, isOfficial: false }),
    run({ id: 'b-official', userId: 'user-b', totalScore: 700, puzzlesSolved: 10, isOfficial: true }),
  ];

  it('the daily board shows only official runs', () => {
    const daily = buildDailyPuzzleRushLeaderboard(runs);
    expect(daily.map((entry) => entry.runId)).toEqual(['b-official', 'a-official']);
    // The 900-point for-fun run is the highest score of the day and still does
    // not appear — it was not the official attempt.
    expect(daily.some((entry) => entry.runId === 'a-funrun')).toBe(false);
    expect(daily[0]).toMatchObject({ rank: 1, totalScore: 700 });
  });

  it('the all-time board counts every completed run, official or not', () => {
    const allTime = buildPuzzleRushLeaderboard(runs);
    // user-a's personal best is their unofficial 900.
    expect(allTime[0]).toMatchObject({ userId: 'user-a', totalScore: 900, runId: 'a-funrun' });
    expect(allTime[1]).toMatchObject({ userId: 'user-b', totalScore: 700 });
    expect(findPersonalBestRun(runs, 'user-a')?.id).toBe('a-funrun');
  });

  it('the daily board excludes invalidated official runs', () => {
    const daily = buildDailyPuzzleRushLeaderboard([
      run({ id: 'cheat', userId: 'user-c', totalScore: 9999, isOfficial: true, status: 'invalidated' }),
      run({ id: 'real', userId: 'user-d', totalScore: 300, isOfficial: true }),
    ]);
    expect(daily.map((entry) => entry.runId)).toEqual(['real']);
  });

  it('the daily store query filters by date, completion, and official', async () => {
    const { listOfficialRushRunsForDate } = await import('../http/stores/puzzleRushStore');
    mocks.supabaseFetch.mockResolvedValueOnce([]);
    await listOfficialRushRunsForDate('2026-08-20');
    const path = mocks.supabaseFetch.mock.calls[0][0] as string;
    expect(path).toContain('run_date=eq.2026-08-20');
    expect(path).toContain('status=eq.completed');
    expect(path).toContain('is_official=is.true');
  });

  describe('the all-time scan pages until enough different players are covered', () => {
    // A row as supabase returns it, with just the columns the normalizer needs.
    const row = (id: string, userId: string, score: number) => ({
      id,
      user_id: userId,
      username: userId,
      status: 'completed',
      started_at: '2026-10-01T00:00:00.000Z',
      ended_at: '2026-10-01T00:02:00.000Z',
      total_score: score,
      puzzles_solved: 5,
      client_reported_score: score,
      invalidated_reason: null,
      config_version: 4,
      run_date: '2026-10-01',
      is_official: false,
      assigned_puzzle_ids: [],
      completion_claimed_at: null,
      completion_client_score: null,
    });

    it('does not let one player with many top runs push everyone else off the board', async () => {
      const { listCompletedRushRuns } = await import('../http/stores/puzzleRushStore');
      // page size 3: the first page is three runs by the same player, the second page brings the others
      mocks.supabaseFetch
        .mockResolvedValueOnce([row('a1', 'user-a', 900), row('a2', 'user-a', 890), row('a3', 'user-a', 880)])
        .mockResolvedValueOnce([row('b1', 'user-b', 870), row('c1', 'user-c', 860), row('a4', 'user-a', 850)]);
      const runs = await listCompletedRushRuns(3, 3);
      expect(mocks.supabaseFetch).toHaveBeenCalledTimes(2);
      expect(mocks.supabaseFetch.mock.calls[0][0]).toContain('limit=3&offset=0');
      expect(mocks.supabaseFetch.mock.calls[1][0]).toContain('limit=3&offset=3');
      expect(buildPuzzleRushLeaderboard(runs).map((entry) => entry.userId)).toEqual(['user-a', 'user-b', 'user-c']);
    });

    it('orders by a total order (id last) so pages never overlap or skip', async () => {
      const { listCompletedRushRuns } = await import('../http/stores/puzzleRushStore');
      mocks.supabaseFetch.mockResolvedValueOnce([]);
      await listCompletedRushRuns();
      expect(mocks.supabaseFetch.mock.calls[0][0]).toContain('order=total_score.desc,puzzles_solved.desc,ended_at.asc,id.asc');
    });

    it('stops as soon as the first page already covers enough players', async () => {
      const { listCompletedRushRuns } = await import('../http/stores/puzzleRushStore');
      mocks.supabaseFetch.mockResolvedValueOnce([row('a1', 'user-a', 9), row('b1', 'user-b', 8), row('c1', 'user-c', 7)]);
      await listCompletedRushRuns(2, 3);
      expect(mocks.supabaseFetch).toHaveBeenCalledTimes(1);
    });

    it('stops when the table runs out, and never reads more than the page cap', async () => {
      const { listCompletedRushRuns, RUSH_LEADERBOARD_MAX_PAGES } = await import('../http/stores/puzzleRushStore');
      // a short page means the table is exhausted
      mocks.supabaseFetch.mockResolvedValueOnce([row('a1', 'user-a', 9)]);
      await listCompletedRushRuns(50, 3);
      expect(mocks.supabaseFetch).toHaveBeenCalledTimes(1);

      // a board that can never fill (one player, always full pages) still ends
      mocks.supabaseFetch.mockClear();
      mocks.supabaseFetch.mockResolvedValue([row('a1', 'user-a', 9), row('a2', 'user-a', 8), row('a3', 'user-a', 7)]);
      await listCompletedRushRuns(50, 3);
      expect(mocks.supabaseFetch).toHaveBeenCalledTimes(RUSH_LEADERBOARD_MAX_PAGES);
    });
  });

  describe('the ranked leaderboard function', () => {
    const entry = (rank: number, userId: string, score: number) => ({
      rank,
      userId,
      username: userId,
      totalScore: score,
      puzzlesSolved: 7,
      runId: `run-${userId}`,
      achievedAt: '2026-11-01T10:00:00.000Z',
    });

    beforeEach(async () => {
      const { resetRankedRushLeaderboardCooldown } = await import('../http/stores/puzzleRushStore');
      resetRankedRushLeaderboardCooldown();
    });

    it('asks the database for one page and the caller\'s own row, and maps what comes back', async () => {
      const { fetchRankedRushLeaderboard } = await import('../http/stores/puzzleRushStore');
      mocks.supabaseFetch.mockResolvedValueOnce({
        rows: [entry(1, 'a', 900), { ...entry(2, 'b', 800), username: '  ' }],
        totalPlayers: 120,
        self: entry(87, 'me', 300),
      });
      const result = await fetchRankedRushLeaderboard({ limit: 2, offset: 0, userId: 'me' });
      const [path, init] = mocks.supabaseFetch.mock.calls[0] as [string, { method: string; body: string }];
      expect(path).toBe('/rest/v1/rpc/rush_leaderboard_ranked_v1');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ p_limit: 2, p_offset: 0, p_user_id: 'me' });
      expect(result?.totalPlayers).toBe(120);
      expect(result?.rows.map((row) => row.rank)).toEqual([1, 2]);
      // a blank name never reaches the board as an empty string
      expect(result?.rows[1].username).toBe('Player');
      // the caller's own rank is reported even though it is far off this page
      expect(result?.self?.rank).toBe(87);
    });

    it('reports no own row when the caller has no completed run', async () => {
      const { fetchRankedRushLeaderboard } = await import('../http/stores/puzzleRushStore');
      mocks.supabaseFetch.mockResolvedValueOnce({ rows: [entry(1, 'a', 900)], totalPlayers: 1, self: null });
      const result = await fetchRankedRushLeaderboard({ limit: 50, offset: 0, userId: 'nobody' });
      expect(result?.self).toBeNull();
    });

    it('returns null when the function is missing, and does not ask again until the cooldown has passed', async () => {
      const { fetchRankedRushLeaderboard, resetRankedRushLeaderboardCooldown } = await import('../http/stores/puzzleRushStore');
      mocks.supabaseFetch.mockRejectedValueOnce(new Error('Supabase request failed: 404 {"code":"PGRST202"}'));
      expect(await fetchRankedRushLeaderboard({ limit: 50, offset: 0, userId: null })).toBeNull();
      expect(mocks.supabaseFetch).toHaveBeenCalledTimes(1);

      // inside the cooldown the database is not asked at all
      expect(await fetchRankedRushLeaderboard({ limit: 50, offset: 0, userId: null })).toBeNull();
      expect(mocks.supabaseFetch).toHaveBeenCalledTimes(1);

      // and once it has passed, the next request tries again and can succeed
      resetRankedRushLeaderboardCooldown();
      mocks.supabaseFetch.mockResolvedValueOnce({ rows: [], totalPlayers: 0, self: null });
      expect(await fetchRankedRushLeaderboard({ limit: 50, offset: 0, userId: null })).toEqual({ rows: [], totalPlayers: 0, self: null });
      expect(mocks.supabaseFetch).toHaveBeenCalledTimes(2);
    });

    it('treats a malformed response as unavailable rather than showing a broken board', async () => {
      const { fetchRankedRushLeaderboard } = await import('../http/stores/puzzleRushStore');
      mocks.supabaseFetch.mockResolvedValueOnce({ totalPlayers: 3 });
      expect(await fetchRankedRushLeaderboard({ limit: 50, offset: 0, userId: null })).toBeNull();
    });
  });

  it('the all-time store query does NOT filter on official', async () => {
    const { listCompletedRushRuns } = await import('../http/stores/puzzleRushStore');
    mocks.supabaseFetch.mockResolvedValueOnce([]);
    await listCompletedRushRuns();
    const path = mocks.supabaseFetch.mock.calls[0][0] as string;
    expect(path).toContain('status=eq.completed');
    // The column is selected (we read the flag) but never used as a filter —
    // every completed run is eligible for an all-time personal best.
    const filters = path.slice(path.indexOf('&'));
    expect(filters).not.toContain('is_official=');
  });
});
