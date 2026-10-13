import { supabaseFetch } from '../../supabaseUtils';
import {
  PUZZLE_RUSH_CONFIG,
  type PuzzleRushStageKey,
  type PuzzleRushTier,
} from '../../puzzleRush/config';
import {
  normalizePuzzlePoolEntry,
  normalizeRushRun,
  normalizeRushRunPuzzle,
  type PuzzlePoolEntry,
  type PuzzlePoolRow,
  type PuzzleRushRun,
  type PuzzleRushRunPuzzle,
  type RushRunPuzzleRow,
  type RushRunRow,
} from '../../puzzleRush/types';
import type { GradedPuzzle } from '../../puzzleRush/grading';

const POOL_SELECT =
  'id,source,source_puzzle_id,starting_board,starting_hand,max_moves,puzzle_type,tier,deal_size,target_score,best_possible_score,difficulty_score,play_count,enabled';
const RUN_SELECT =
  'id,user_id,username,status,started_at,ended_at,total_score,puzzles_solved,client_reported_score,invalidated_reason,config_version,run_date,is_official,assigned_puzzle_ids,completion_claimed_at,completion_client_score';
const RUN_PUZZLE_SELECT =
  'id,run_id,puzzle_id,ordinal,raw_score,awarded_points,client_raw_score,solved,perfect,moves_used,bonus_seconds,submitted_line,client_reported_at,graded_at,grading_error,stage_reached_key';

/** Bounded scan, not a full table read (cap style carried over from the retired daily-puzzle ladder leaderboard). */
export const RUSH_LEADERBOARD_RUN_LIMIT = PUZZLE_RUSH_CONFIG.leaderboard.scanLimit;

/**
 * Candidate pool slice for run selection.
 *
 * Sampled **per tier**, not as one global slice. The pool's real distribution
 * is ~91% master_chain (see docs/ops/puzzle-rush-deploy.md), so a single query
 * ordered by difficulty would return almost nothing from the tiers the early
 * ordinals need, and every early ordinal would report a fallback for reasons
 * that have nothing to do with pool size.
 *
 * Within a tier: least-played first, so the bank spreads out instead of serving
 * the same puzzles every run. Ordering is the only variety mechanism —
 * selection itself (difficulty.ts) is deterministic given this order.
 */
export async function listPuzzlePoolCandidates(perTierLimit?: number): Promise<PuzzlePoolEntry[]> {
  const take = Math.max(1, Math.round(perTierLimit ?? PUZZLE_RUSH_CONFIG.run.puzzlesPerRun * 3));
  const tiers: PuzzleRushTier[] = ['quick_line', 'tactical_setup', 'master_chain'];
  const perTier = await Promise.all(
    tiers.map((tier) =>
      supabaseFetch<PuzzlePoolRow[]>(
        `/rest/v1/puzzle_pool?select=${POOL_SELECT}&enabled=eq.true&tier=eq.${tier}` +
          `&order=play_count.asc,difficulty_score.asc,id.asc&limit=${take}`,
      ).catch(() => [] as PuzzlePoolRow[]),
    ),
  );
  // Shuffle *within* each tier's fetched slice.
  //
  // The query orders by play_count asc to bias toward under-played content,
  // but play_count starts at 0 for everything and difficulty_score barely
  // varies inside a tier, so the real tiebreak was `id asc` — which made every
  // run serve the same 30 puzzles in the same order, for every player, on
  // every replay. Selection itself (difficulty.ts) is deliberately
  // deterministic given this order, so this is the layer that owes variety.
  return perTier.flatMap((rows) => shuffle(rows)).map(normalizePuzzlePoolEntry);
}

/** Fisher-Yates. Not seeded: two runs by the same player should differ. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function listPuzzlePoolEntriesByIds(ids: string[]): Promise<PuzzlePoolEntry[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const filter = unique.map((id) => encodeURIComponent(id)).join(',');
  const rows = await supabaseFetch<PuzzlePoolRow[]>(
    `/rest/v1/puzzle_pool?select=${POOL_SELECT}&id=in.(${filter})`,
  );
  return (rows ?? []).map(normalizePuzzlePoolEntry);
}

export async function countPuzzlePool(): Promise<number> {
  const rows = await supabaseFetch<PuzzlePoolRow[]>(
    '/rest/v1/puzzle_pool?select=id&enabled=eq.true&limit=1000',
  );
  return (rows ?? []).length;
}

/**
 * Start a run, or recover the one already open for this user.
 *
 * Same shape as `createDailyPuzzleAttempt`: insert with
 * `resolution=ignore-duplicates` against a unique constraint, and on an empty
 * response (the duplicate was ignored) read back the authoritative winner
 * rather than surfacing a 23505. Here the constraint is the partial unique
 * index on `(user_id) where status = 'in_progress'` — which allows unlimited
 * *sequential* runs while making concurrent starts converge on one row.
 */
/** A 23505 against the one-open-run-per-user index. */
function isOpenRunConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /rush_runs_one_open_per_user_idx/i.test(message);
}

/** A 23505 against the one-official-run-per-day index, not some other conflict. */
function isOfficialConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /rush_runs_one_official_per_user_day_idx|23505/i.test(message);
}

/**
 * True when this user already has an official run for `runDate`.
 *
 * One indexed lookup against `rush_runs_one_official_per_user_day_idx`. The
 * caller runs it in parallel with the username fetch `/start` already awaits,
 * so it adds no round trip to run creation.
 */
export async function hasOfficialRushRunForDate(
  userId: string,
  runDate: string,
): Promise<boolean> {
  const rows = await supabaseFetch<Array<{ id: string }>>(
    `/rest/v1/rush_runs?select=id&user_id=eq.${encodeURIComponent(userId)}` +
      `&run_date=eq.${encodeURIComponent(runDate)}&is_official=is.true&limit=1`,
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function createRushRun(params: {
  userId: string;
  username: string | null;
  configVersion?: number;
  /** Pacific calendar date, resolved by the caller. */
  runDate: string;
  /** First run of the day for this user. Daily leaderboard only. */
  isOfficial: boolean;
  assignedPuzzleIds: string[];
}, legacyRetry = 0): Promise<{ run: PuzzleRushRun; created: boolean }> {
  const recoverOpenRun = async (): Promise<{ run: PuzzleRushRun; created: boolean }> => {
    const existing = await getOpenRushRunForUser(params.userId);
    if (!existing) throw new Error('Failed to create or recover puzzle rush run.');
    if (existing.assignedPuzzleIds.length > 0) return { run: existing, created: false };
    // An old server may have created this after the expand migration. Its
    // served puzzles were never recorded, so close it and retry a new start.
    await invalidateUnassignedRushRun(existing.id, params.userId);
    if (legacyRetry >= 2) throw new Error('Legacy Puzzle Rush run kept racing start; retry shortly.');
    return createRushRun(params, legacyRetry + 1);
  };
  /**
   * A plain INSERT — deliberately no `on_conflict`.
   *
   * Both unique indexes on rush_runs are *partial*:
   *   rush_runs_one_open_per_user_idx          (user_id) where status = 'in_progress'
   *   rush_runs_one_official_per_user_day_idx  (user_id, run_date) where is_official
   *
   * Postgres can only infer a partial index as an ON CONFLICT arbiter when the
   * statement repeats the index predicate (`ON CONFLICT (user_id) WHERE status
   * = 'in_progress'`), and PostgREST's `on_conflict=` parameter carries columns
   * only — it cannot express a WHERE. So `on_conflict=user_id` matched neither
   * index and Postgres rejected the statement outright with 42P10, surfacing as
   * a 400 before any row was touched.
   *
   * Idempotent start therefore comes from catching the unique violation and
   * replaying the winner, not from ON CONFLICT. `is_official` is just a column
   * value here; it is decided by the caller's existence check, never by a
   * conflict target.
   */
  const insert = async (isOfficial: boolean) =>
    supabaseFetch<RushRunRow[]>(
      '/rest/v1/rush_runs',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{
          user_id: params.userId,
          username: params.username,
          status: 'in_progress',
          total_score: 0,
          puzzles_solved: 0,
          client_reported_score: 0,
          config_version: params.configVersion ?? PUZZLE_RUSH_CONFIG.version,
          run_date: params.runDate,
          is_official: isOfficial,
          assigned_puzzle_ids: params.assignedPuzzleIds,
        }]),
      },
    );

  let rows: RushRunRow[] | null = null;
  try {
    rows = await insert(params.isOfficial);
  } catch (error) {
    if (isOpenRunConflict(error)) {
      return recoverOpenRun();
    }
    if (params.isOfficial && isOfficialConflict(error)) {
      // Lost the race for today's official slot; run as unofficial instead.
      try {
        rows = await insert(false);
      } catch (retryError) {
        if (!isOpenRunConflict(retryError)) throw retryError;
        return recoverOpenRun();
      }
    } else {
      throw error;
    }
  }

  const row = rows?.[0];
  if (row) return { run: normalizeRushRun(row), created: true };

  return recoverOpenRun();
}

export async function invalidateUnassignedRushRun(
  runId: string,
  userId: string,
): Promise<{ invalidated: boolean; run: PuzzleRushRun }> {
  const result = await supabaseFetch<{ invalidated: boolean; run: RushRunRow }>(
    '/rest/v1/rpc/invalidate_unassigned_rush_run_v2', {
      method: 'POST',
      body: JSON.stringify({ p_run_id: runId, p_user_id: userId }),
    },
  );
  return { invalidated: result.invalidated, run: normalizeRushRun(result.run) };
}

export async function getOpenRushRunForUser(userId: string): Promise<PuzzleRushRun | null> {
  const rows = await supabaseFetch<RushRunRow[]>(
    `/rest/v1/rush_runs?select=${RUN_SELECT}&user_id=eq.${encodeURIComponent(userId)}&status=eq.in_progress&order=started_at.desc&limit=1`,
  );
  const row = rows?.[0];
  return row ? normalizeRushRun(row) : null;
}

export async function getRushRunById(runId: string, userId: string): Promise<PuzzleRushRun | null> {
  const rows = await supabaseFetch<RushRunRow[]>(
    `/rest/v1/rush_runs?select=${RUN_SELECT}&id=eq.${encodeURIComponent(runId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  const row = rows?.[0];
  return row ? normalizeRushRun(row) : null;
}

/**
 * Record what the client reported for one puzzle. Deliberately does no engine
 * work: the run clock is live and must never wait on validation. Grading
 * happens once, at run end.
 */
export async function recordReportedRushPuzzle(input: {
  runId: string;
  userId: string;
  puzzleId: string;
  ordinal: number;
  clientRawScore: number;
  submittedLine: Array<Record<string, unknown>>;
  /** Observational telemetry; not read by grading. */
  stageReachedKey?: PuzzleRushStageKey | null;
}): Promise<PuzzleRushRunPuzzle> {
  const row = await supabaseFetch<RushRunPuzzleRow>('/rest/v1/rpc/record_rush_report_v2', {
    method: 'POST',
    body: JSON.stringify({
      p_run_id: input.runId,
      p_user_id: input.userId,
      p_puzzle_id: input.puzzleId,
      p_ordinal: input.ordinal,
      p_client_raw_score: Math.max(0, Math.round(input.clientRawScore || 0)),
      p_submitted_line: input.submittedLine,
      p_stage_reached_key: input.stageReachedKey ?? null,
    }),
  });
  if (!row) throw new Error('Failed to record puzzle rush report.');
  return normalizeRushRunPuzzle(row);
}

export async function listRushRunPuzzles(runId: string): Promise<PuzzleRushRunPuzzle[]> {
  const rows = await supabaseFetch<RushRunPuzzleRow[]>(
    `/rest/v1/rush_run_puzzles?select=${RUN_PUZZLE_SELECT}&run_id=eq.${encodeURIComponent(runId)}&order=ordinal.asc`,
  );
  return (rows ?? []).map(normalizeRushRunPuzzle);
}

export async function claimRushRunCompletion(input: {
  runId: string;
  userId: string;
  clientReportedScore: number;
}): Promise<{ outcome: 'claimed' | 'resuming' | 'already_completed'; run: PuzzleRushRun }> {
  const result = await supabaseFetch<{ outcome: 'claimed' | 'resuming' | 'already_completed'; run: RushRunRow }>(
    '/rest/v1/rpc/claim_rush_completion_v2', {
      method: 'POST',
      body: JSON.stringify({
        p_run_id: input.runId,
        p_user_id: input.userId,
        p_client_reported_score: Math.max(0, Math.round(input.clientReportedScore || 0)),
      }),
    },
  );
  return { outcome: result.outcome, run: normalizeRushRun(result.run) };
}

export async function finalizeRushRun(params: {
  runId: string;
  userId: string;
  status: 'completed' | 'invalidated';
  totalScore: number;
  puzzlesSolved: number;
  invalidatedReason: string | null;
  gradedPuzzles: GradedPuzzle[];
}): Promise<{ run: PuzzleRushRun; applied: boolean }> {
  const result = await supabaseFetch<{ outcome: 'applied' | 'already_completed'; run: RushRunRow }>(
    '/rest/v1/rpc/finalize_rush_run_v2', {
      method: 'POST',
      body: JSON.stringify({
        p_run_id: params.runId,
        p_user_id: params.userId,
        p_status: params.status,
        p_total_score: params.totalScore,
        p_puzzles_solved: params.puzzlesSolved,
        p_invalidated_reason: params.invalidatedReason,
        p_graded_puzzles: params.gradedPuzzles,
      }),
    },
  );
  return { run: normalizeRushRun(result.run), applied: result.outcome === 'applied' };
}

/** Best-effort usage counter; never blocks a run. */
export async function incrementPuzzlePoolPlayCounts(puzzleIds: string[]): Promise<void> {
  const unique = [...new Set(puzzleIds.filter(Boolean))];
  if (unique.length === 0) return;
  const entries = await listPuzzlePoolEntriesByIds(unique);
  await Promise.all(
    entries.map((entry) =>
      supabaseFetch(`/rest/v1/puzzle_pool?id=eq.${encodeURIComponent(entry.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ play_count: entry.playCount + 1, updated_at: new Date().toISOString() }),
      }).catch(() => undefined),
    ),
  );
}

/** Bounded scan of completed runs for the all-time board. */
export async function listCompletedRushRuns(limit = RUSH_LEADERBOARD_RUN_LIMIT): Promise<PuzzleRushRun[]> {
  const rows = await supabaseFetch<RushRunRow[]>(
    `/rest/v1/rush_runs?select=${RUN_SELECT}&status=eq.completed&order=total_score.desc,puzzles_solved.desc,ended_at.asc&limit=${Math.max(1, Math.round(limit))}`,
  );
  return (rows ?? []).map(normalizeRushRun);
}

/**
 * Today's official results: one run per user by construction (the partial
 * unique index guarantees at most one official run per user per day).
 *
 * This is the *daily* board. The all-time personal-best board deliberately does
 * not filter on is_official — every completed run can set a personal best.
 */
export async function listOfficialRushRunsForDate(
  runDate: string,
  limit = RUSH_LEADERBOARD_RUN_LIMIT,
): Promise<PuzzleRushRun[]> {
  const rows = await supabaseFetch<RushRunRow[]>(
    `/rest/v1/rush_runs?select=${RUN_SELECT}&run_date=eq.${encodeURIComponent(runDate)}` +
      '&status=eq.completed&is_official=is.true' +
      `&order=total_score.desc,puzzles_solved.desc,ended_at.asc&limit=${Math.max(1, Math.round(limit))}`,
  );
  return (rows ?? []).map(normalizeRushRun);
}

export async function listCompletedRushRunsForUser(userId: string, limit = 50): Promise<PuzzleRushRun[]> {
  const rows = await supabaseFetch<RushRunRow[]>(
    `/rest/v1/rush_runs?select=${RUN_SELECT}&user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=total_score.desc,puzzles_solved.desc&limit=${Math.max(1, Math.round(limit))}`,
  );
  return (rows ?? []).map(normalizeRushRun);
}
