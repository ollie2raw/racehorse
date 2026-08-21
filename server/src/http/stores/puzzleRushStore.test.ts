import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseFetch: vi.fn() }));

vi.mock('../../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => mocks.supabaseFetch(...args),
}));

import {
  createRushRun,
  finalizeRushRun,
  listPuzzlePoolCandidates,
  recordReportedRushPuzzle,
} from './puzzleRushStore';
import { PUZZLE_RUSH_CONFIG } from '../../puzzleRush/config';

const runRow = {
  id: 'run-1',
  user_id: 'user-1',
  username: 'Player',
  status: 'in_progress',
  started_at: '2026-08-20T20:00:00.000Z',
  ended_at: null,
  total_score: 0,
  puzzles_solved: 0,
  client_reported_score: 0,
  invalidated_reason: null,
  config_version: 1,
};

describe('createRushRun', () => {
  beforeEach(() => mocks.supabaseFetch.mockReset());

  it('inserts plainly — ON CONFLICT cannot infer a partial unique index', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([runRow]);

    const result = await createRushRun({
      userId: 'user-1', username: 'Player', runDate: '2026-08-20', isOfficial: true,
    });

    expect(result.created).toBe(true);
    expect(result.run.id).toBe('run-1');
    expect(result.run.status).toBe('in_progress');
    // Both unique indexes on rush_runs are partial, and PostgREST's
    // `on_conflict=` carries columns only — it cannot express the index
    // predicate, so Postgres rejected the statement with 42P10 (a 400) before
    // touching a row. Idempotency comes from catching 23505 instead.
    const path = mocks.supabaseFetch.mock.calls[0][0] as string;
    expect(path).toBe('/rest/v1/rush_runs');
    expect(path).not.toContain('on_conflict');
    const init = mocks.supabaseFetch.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Prefer).not.toContain('resolution=');
  });

  it('replays the open run when the insert hits the one-open-run index', async () => {
    // A user who already has a run in flight: the unique violation is the
    // signal to replay, not to fail.
    mocks.supabaseFetch
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "rush_runs_one_open_per_user_idx"'),
      )
      .mockResolvedValueOnce([{ ...runRow, id: 'run-winner' }]);

    const result = await createRushRun({
      userId: 'user-1', username: 'Player', runDate: '2026-08-20', isOfficial: true,
    });

    expect(result.created).toBe(false);
    expect(result.run.id).toBe('run-winner');
    expect(mocks.supabaseFetch.mock.calls[1][0]).toContain('status=eq.in_progress');
  });

  it('two concurrent starts converge on one run rather than creating two', async () => {
    // Racer A wins the insert; racer B hits the open-run index and replays A.
    mocks.supabaseFetch
      .mockResolvedValueOnce([runRow])
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "rush_runs_one_open_per_user_idx"'),
      )
      .mockResolvedValueOnce([runRow]);

    const [a, b] = await Promise.all([
      createRushRun({ userId: 'user-1', username: 'Player', runDate: '2026-08-20', isOfficial: true }),
      createRushRun({ userId: 'user-1', username: 'Player', runDate: '2026-08-20', isOfficial: false }),
    ]);

    expect(a.run.id).toBe(b.run.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
  });

  it('throws rather than inventing a run when recovery finds nothing', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(
      createRushRun({ userId: 'user-1', username: 'Player', runDate: '2026-08-20', isOfficial: true }),
    ).rejects.toThrow('Failed to create or recover puzzle rush run.');
  });

  it('stamps the config version the run was played under', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([runRow]);
    await createRushRun({ userId: 'user-1', username: 'Player', runDate: '2026-08-20', isOfficial: true });
    const body = JSON.parse((mocks.supabaseFetch.mock.calls[0][1] as { body: string }).body);
    expect(body[0].config_version).toBe(PUZZLE_RUSH_CONFIG.version);
  });
});

describe('pool candidate query', () => {
  beforeEach(() => mocks.supabaseFetch.mockReset());

  it('reads puzzle_pool, never daily_puzzles, least-played first', async () => {
    mocks.supabaseFetch.mockResolvedValue([]);
    await listPuzzlePoolCandidates();

    const paths = mocks.supabaseFetch.mock.calls.map((call) => call[0] as string);
    for (const path of paths) {
      expect(path).toContain('/rest/v1/puzzle_pool');
      // Rush selection must never contend with the ladder's readiness path.
      expect(path).not.toContain('daily_puzzles');
      expect(path).toContain('enabled=eq.true');
      expect(path).toContain('order=play_count.asc');
      expect(path).toContain('limit=');
    }
  });

  it('samples every tier separately so the thin tiers are never starved', async () => {
    // The real pool is ~91% master_chain; one global slice ordered by
    // difficulty would return almost nothing for the early ordinals' tiers.
    mocks.supabaseFetch.mockResolvedValue([]);
    await listPuzzlePoolCandidates();

    const paths = mocks.supabaseFetch.mock.calls.map((call) => call[0] as string);
    expect(paths).toHaveLength(3);
    expect(paths.some((path) => path.includes('tier=eq.quick_line'))).toBe(true);
    expect(paths.some((path) => path.includes('tier=eq.tactical_setup'))).toBe(true);
    expect(paths.some((path) => path.includes('tier=eq.master_chain'))).toBe(true);
  });

  it('keeps a failing tier query from taking down the whole run start', async () => {
    mocks.supabaseFetch
      .mockResolvedValueOnce([{ id: 'q1', tier: 'quick_line', best_possible_score: 10, difficulty_score: 40, starting_board: {}, starting_hand: [{ low: 1, high: 1 }], enabled: true }])
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce([]);

    const entries = await listPuzzlePoolCandidates();
    expect(entries.map((entry) => entry.id)).toEqual(['q1']);
  });
});

describe('reporting and finalizing', () => {
  beforeEach(() => mocks.supabaseFetch.mockReset());

  it('records a reported puzzle without any engine work', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([{
      id: 'rp-1',
      run_id: 'run-1',
      puzzle_id: 'pool-1',
      ordinal: 3,
      raw_score: 0,
      awarded_points: 0,
      client_raw_score: 42,
      solved: false,
      perfect: false,
      moves_used: 0,
      bonus_seconds: 0,
      submitted_line: [],
      client_reported_at: '2026-08-20T20:00:10.000Z',
      graded_at: null,
      grading_error: null,
    }]);

    const recorded = await recordReportedRushPuzzle({
      runId: 'run-1',
      puzzleId: 'pool-1',
      ordinal: 3,
      clientRawScore: 42,
      submittedLine: [{ tile: { low: 1, high: 2 }, position: 'left' }],
    });

    expect(recorded.ordinal).toBe(3);
    expect(mocks.supabaseFetch.mock.calls[0][0]).toBe('/rest/v1/rush_run_puzzles?on_conflict=run_id,ordinal');
    const body = JSON.parse((mocks.supabaseFetch.mock.calls[0][1] as { body: string }).body);
    // No graded fields written at report time — grading happens once, at run end.
    expect(body[0]).not.toHaveProperty('raw_score');
    expect(body[0]).not.toHaveProperty('awarded_points');
    expect(body[0].client_raw_score).toBe(42);
  });

  it('records stageReachedKey as observational telemetry on report', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([{
      id: 'rp-2',
      run_id: 'run-1',
      puzzle_id: 'pool-7',
      ordinal: 7,
      raw_score: 0,
      awarded_points: 0,
      client_raw_score: 30,
      solved: false,
      perfect: false,
      moves_used: 0,
      bonus_seconds: 0,
      submitted_line: [],
      client_reported_at: '2026-08-20T20:00:30.000Z',
      graded_at: null,
      grading_error: null,
      stage_reached_key: 'building',
    }]);

    const recorded = await recordReportedRushPuzzle({
      runId: 'run-1',
      puzzleId: 'pool-7',
      ordinal: 7,
      clientRawScore: 30,
      submittedLine: [],
      stageReachedKey: 'building',
    });

    const body = JSON.parse((mocks.supabaseFetch.mock.calls[0][1] as { body: string }).body);
    expect(body[0].stage_reached_key).toBe('building');
    expect(recorded.stageReachedKey).toBe('building');
    // Still no graded fields — telemetry did not turn this into a scoring write.
    expect(body[0]).not.toHaveProperty('raw_score');
    expect(body[0]).not.toHaveProperty('awarded_points');
  });

  it('writes a null stage key when the client omits the telemetry', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([{
      id: 'rp-3',
      run_id: 'run-1',
      puzzle_id: 'pool-1',
      ordinal: 1,
      raw_score: 0,
      awarded_points: 0,
      client_raw_score: 0,
      solved: false,
      perfect: false,
      moves_used: 0,
      bonus_seconds: 0,
      submitted_line: [],
      client_reported_at: '2026-08-20T20:00:00.000Z',
      graded_at: null,
      grading_error: null,
      stage_reached_key: null,
    }]);

    const recorded = await recordReportedRushPuzzle({
      runId: 'run-1',
      puzzleId: 'pool-1',
      ordinal: 1,
      clientRawScore: 0,
      submittedLine: [],
    });

    const body = JSON.parse((mocks.supabaseFetch.mock.calls[0][1] as { body: string }).body);
    expect(body[0].stage_reached_key).toBeNull();
    expect(recorded.stageReachedKey).toBeNull();
  });

  it('normalizes an unrecognised stored stage key to null', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([{
      id: 'rp-4',
      run_id: 'run-1',
      puzzle_id: 'pool-1',
      ordinal: 1,
      client_raw_score: 0,
      submitted_line: [],
      client_reported_at: '2026-08-20T20:00:00.000Z',
      stage_reached_key: 'not_a_stage',
    }]);

    const recorded = await recordReportedRushPuzzle({
      runId: 'run-1',
      puzzleId: 'pool-1',
      ordinal: 1,
      clientRawScore: 0,
      submittedLine: [],
    });
    expect(recorded.stageReachedKey).toBeNull();
  });

  it('writes the authoritative score and status on finalize', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([{
      ...runRow,
      status: 'invalidated',
      ended_at: '2026-08-20T20:02:00.000Z',
      total_score: 120,
      puzzles_solved: 4,
      client_reported_score: 9_999,
      invalidated_reason: 'client_score_mismatch',
    }]);

    const finalized = await finalizeRushRun({
      runId: 'run-1',
      status: 'invalidated',
      totalScore: 120,
      puzzlesSolved: 4,
      clientReportedScore: 9_999,
      invalidatedReason: 'client_score_mismatch',
    });

    expect(finalized.status).toBe('invalidated');
    // The server total is recorded, not the inflated client number.
    expect(finalized.totalScore).toBe(120);
    expect(finalized.clientReportedScore).toBe(9_999);
    expect(finalized.invalidatedReason).toBe('client_score_mismatch');
  });
});
