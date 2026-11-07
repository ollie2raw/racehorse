/**
 * What the review sweep is doing, in a form /health and the job route can show.
 *
 * A review that sat at "Analyzing 0 / 50" with the sweep switched on had no visible cause: the database functions the claim needs live in a migration the owner
 * applies by hand, a missing one failed inside the sweep and was logged at warn as "will retry", and nothing a player or the owner could read said so. This keeps
 * the last tick, the last claimed job and the last error as a short code (never raw error text, which can carry ids), and can ask the database which of the
 * functions the sweep needs it does not have.
 */
import { supabaseFetch } from '../supabaseUtils';
import { getReviewDecisionCost, readCpuThrottle, type CpuThrottle, type ReviewDecisionCostSnapshot } from './reviewDecisionCost';

export type ReviewErrorCode =
  | 'rpc_missing'
  | 'schema_missing'
  | 'permission_denied'
  | 'worker_failed'
  | 'db_timeout'
  | 'db_error'
  | 'unknown';

export type ClassifiedReviewError = { readonly code: ReviewErrorCode; readonly detail: string | null };

/** The database functions the sweep calls; each is created by a migration in supabase/migrations. */
export const REVIEW_DATABASE_FUNCTIONS = [
  'list_claimable_review_completion_jobs',
  'claim_review_completion_job_v2',
  'renew_review_completion_lease',
  'checkpoint_review_completion_job',
] as const;
export type ReviewDatabaseFunction = (typeof REVIEW_DATABASE_FUNCTIONS)[number];

export function classifyReviewError(error: unknown): ClassifiedReviewError {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return { code: 'unknown', detail: null };
  if (/PGRST202|42883|Could not find the function|function [\w.]+\(.*\) does not exist/i.test(message)) {
    const named = REVIEW_DATABASE_FUNCTIONS.find((name) => message.includes(name))
      ?? message.match(/public\.([a-z][a-z0-9_]*)/i)?.[1]
      ?? null;
    return { code: 'rpc_missing', detail: named };
  }
  if (/42P01|42703|relation .* does not exist|column .* does not exist/i.test(message)) {
    return { code: 'schema_missing', detail: null };
  }
  if (/permission denied|42501|Supabase request failed: (?:401|403)/i.test(message)) {
    return { code: 'permission_denied', detail: null };
  }
  if (/review search worker|Cannot find module|ERR_WORKER/i.test(message)) {
    return { code: 'worker_failed', detail: null };
  }
  if (/timed out|AbortError/i.test(message)) return { code: 'db_timeout', detail: null };
  if (/Supabase/i.test(message)) return { code: 'db_error', detail: null };
  return { code: 'unknown', detail: null };
}

export type ReviewDatabaseProbe = {
  readonly ok: boolean;
  /** Functions the database answered "not found" for. */
  readonly missing: readonly ReviewDatabaseFunction[];
  readonly checkedAt: number;
};

export type ReviewSweepStatus = {
  readonly ticks: number;
  readonly lastTickAt: number | null;
  readonly lastRan: number;
  readonly lastJobId: string | null;
  readonly lastErrorCode: ReviewErrorCode | null;
  readonly lastErrorDetail: string | null;
  readonly lastErrorAt: number | null;
  readonly database: ReviewDatabaseProbe | null;
};

/** What /health reports: the sweep's own state plus what a decision costs here and whether the container is CPU-throttled. */
export type ReviewSweepStatusView = ReviewSweepStatus & {
  readonly decisionCost: ReviewDecisionCostSnapshot;
  readonly cpuThrottle: CpuThrottle | null;
};

const empty = (): ReviewSweepStatus => ({
  ticks: 0, lastTickAt: null, lastRan: 0, lastJobId: null, lastErrorCode: null, lastErrorDetail: null, lastErrorAt: null, database: null,
});

let status: ReviewSweepStatus = empty();

export function getReviewSweepStatus(): ReviewSweepStatusView {
  return { ...status, decisionCost: getReviewDecisionCost(), cpuThrottle: readCpuThrottle() };
}

export function resetReviewSweepStatusForTests(): void {
  status = empty();
}

export function noteReviewSweepTick(now: number, result: { ran: number; completed: number; jobId?: string }): void {
  status = {
    ...status,
    ticks: status.ticks + 1,
    lastTickAt: now,
    lastRan: result.ran,
    lastJobId: result.jobId ?? status.lastJobId,
  };
}

export function noteReviewSweepError(error: unknown, now: number): ClassifiedReviewError {
  const classified = classifyReviewError(error);
  status = { ...status, lastErrorCode: classified.code, lastErrorDetail: classified.detail, lastErrorAt: now };
  return classified;
}

type ProbeFetch = <T>(path: string, init?: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number }) => Promise<T>;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Harmless arguments for each function: a job id that does not exist, so none of them can change a row. */
const PROBE_BODIES: Record<ReviewDatabaseFunction, Record<string, unknown>> = {
  list_claimable_review_completion_jobs: { p_limit: 0 },
  claim_review_completion_job_v2: {
    p_job_id: NIL_UUID, p_claim_token: 'health-probe', p_lease_ms: 1_000, p_max_attempts: 1, p_backoff_base_ms: 1_000, p_backoff_max_ms: 1_000,
  },
  renew_review_completion_lease: { p_job_id: NIL_UUID, p_claim_token: 'health-probe', p_claim_generation: 0, p_lease_ms: 1_000 },
  checkpoint_review_completion_job: {
    p_job_id: NIL_UUID, p_claim_token: 'health-probe', p_claim_generation: 0, p_job_payload: {}, p_status: 'pending', p_lease_ms: 1_000,
    p_next_attempt_at: new Date(0).toISOString(),
  },
};

/**
 * Ask the database which review functions it has, by calling each with arguments that match no job. Only "function not found" counts as missing; a timeout
 * or any other failure is recorded as an error but does not blame a migration.
 */
export async function probeReviewDatabase(fetchImpl: ProbeFetch = supabaseFetch as ProbeFetch, now = Date.now()): Promise<ReviewDatabaseProbe> {
  const missing: ReviewDatabaseFunction[] = [];
  let failed = false;
  for (const name of REVIEW_DATABASE_FUNCTIONS) {
    try {
      await fetchImpl(`/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(PROBE_BODIES[name]),
        timeoutMs: 8_000,
      });
    } catch (error) {
      failed = true;
      const classified = noteReviewSweepError(error, now);
      if (classified.code === 'rpc_missing') missing.push(name);
    }
  }
  const result: ReviewDatabaseProbe = { ok: !failed, missing, checkedAt: now };
  status = { ...status, database: result };
  return result;
}

export type ReviewJobStage = 'queued' | 'running' | 'complete' | 'failed';

/** Where a job is in its life, from what the poll already reads: never "running" unless a pass holds a live lease. */
export function jobStage(
  job: { readonly status: string; readonly claimToken?: string | null; readonly leaseExpiresAt?: number | null; readonly attemptCount?: number },
  now: number,
): ReviewJobStage {
  if (job.status === 'complete') return 'complete';
  if (job.status === 'failed_fatal') return 'failed';
  if (job.claimToken && job.leaseExpiresAt != null && job.leaseExpiresAt > now) return 'running';
  return 'queued';
}
