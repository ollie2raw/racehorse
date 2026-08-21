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
