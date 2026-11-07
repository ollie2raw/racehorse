/**
 * Client enqueue / poll for server-owned review completion.
 * Browser is not the authority — it observes job state.
 */
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { saveReviewCompletionJob, type ReviewCompletionJob } from './durableReviewCompletionJob.ts';

export type EnqueueReviewCompletionResponse = {
  readonly jobId: string;
  readonly status: string;
  readonly progress: {
    readonly total: number;
    readonly forced: number;
    readonly scored: number;
    readonly remaining: number;
  };
};

export async function enqueueServerReviewCompletion(input: {
  readonly apiBase: string;
  readonly authHeader: string | null;
  readonly gameDigest: string;
  readonly sourceMatchId: string;
  readonly gameId: string;
  readonly snapshots: readonly ReviewPositionSnapshotV2[];
  readonly expectedDecisionIds: readonly string[];
  readonly captureFailures?: readonly { decisionId: string; handId: string; sequence: number; reason: string }[];
  readonly evaluations?: readonly ReviewEvaluationV1[];
}): Promise<EnqueueReviewCompletionResponse | null> {
  try {
    const res = await fetch(`${input.apiBase}/api/review-completion-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.authHeader ? { Authorization: input.authHeader } : {}),
      },
      body: JSON.stringify({
        gameDigest: input.gameDigest,
        sourceMatchId: input.sourceMatchId,
        snapshots: input.snapshots,
        expectedDecisionIds: input.expectedDecisionIds,
        captureFailures: input.captureFailures ?? [],
        evaluations: input.evaluations,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as EnqueueReviewCompletionResponse;
    const mirror: ReviewCompletionJob = {
      jobVersion: 2,
      jobId: body.jobId,
      gameId: input.gameId,
      sourceMatchId: input.sourceMatchId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      decisions: [],
      progress: body.progress,
    };
    saveReviewCompletionJob(mirror);
    return body;
  } catch {
    return null;
  }
}

export type RetryServerReviewResult =
  /** The server accepted the re-run: poll again. */
  | { readonly kind: 'restarted' }
  /** Nothing to re-run (already running or finished): poll again anyway. */
  | { readonly kind: 'not_failed' }
  /** Re-run too soon after the last failure. */
  | { readonly kind: 'cooldown'; readonly retryAfterMs: number }
  | { readonly kind: 'error' };

/**
 * Ask the server to re-run a review it gave up on (the "Analyze again" button). The server re-runs from the positions it
 * already stored, so nothing about the game is re-sent.
 */
export async function retryServerReviewCompletion(input: {
  readonly apiBase: string;
  readonly authHeader: string | null;
  readonly jobId: string;
}): Promise<RetryServerReviewResult> {
  try {
    const res = await fetch(`${input.apiBase}/api/review-completion-jobs/${encodeURIComponent(input.jobId)}/retry`, {
      method: 'POST',
      headers: { ...(input.authHeader ? { Authorization: input.authHeader } : {}) },
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { retryAfterMs?: unknown };
      return { kind: 'cooldown', retryAfterMs: typeof body.retryAfterMs === 'number' ? body.retryAfterMs : 60_000 };
    }
    if (!res.ok) return { kind: 'error' };
    const body = (await res.json().catch(() => ({}))) as { restarted?: unknown };
    return body.restarted === true ? { kind: 'restarted' } : { kind: 'not_failed' };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * Review-job poll cadence. Each poll makes the server read the job row from
 * Supabase (~13-40 KB gzip with the move snapshots), so the old 1 s cadence
 * was the largest per-player egress source. Start at 3 s, back off to 5 s
 * while nothing changes, drop back to 3 s when progress moves; stop entirely
 * once the job is complete or unavailable (both terminal for this screen).
 */
export type ReviewUnavailableReason = 'sweep_disabled' | 'failed';

/** Where the server says the job is: `queued` = no pass holds it yet, `running` = a pass holds a live lease. Absent on an older server. */
export type ReviewJobStage = 'queued' | 'running';

/** What the card needs to say "Queued" or "Analyzing" truthfully and to offer a retry when nothing moves. */
export type ReviewWaitState = {
  readonly stage: ReviewJobStage | null;
  /** No progress for REVIEW_STALL_MS: the review is taking longer than expected. */
  readonly stalled: boolean;
  /** The server's last sweep error as a short code (for example `rpc_missing`), when it has one for this job. */
  readonly sweepErrorCode: string | null;
};

/** After this long without a decision completing, the card says the review is taking longer than expected and offers a retry. */
export const REVIEW_STALL_MS = 90_000;

export function isReviewStalled(now: number, lastProgressAt: number): boolean {
  return now - lastProgressAt >= REVIEW_STALL_MS;
}

/** A stalled job is polled slowly: it is waiting on the server, not about to change, and every poll reads the job row. */
export const REVIEW_POLL_STALLED_MS = 15_000;

export const REVIEW_POLL_INITIAL_MS = 3_000;
export const REVIEW_POLL_MAX_MS = 5_000;

export function nextReviewPollDelayMs(previousDelayMs: number, progressed: boolean): number {
  if (progressed) return REVIEW_POLL_INITIAL_MS;
  return Math.min(REVIEW_POLL_MAX_MS, Math.round(previousDelayMs * 1.5));
}

export async function pollServerReviewCompletion(input: {
  readonly apiBase: string;
  readonly authHeader: string | null;
  readonly jobId: string;
}): Promise<{
  readonly complete: boolean;
  readonly status: string;
  /** Server will not finish this job (failed, or review sweep switched off). */
  readonly unavailable?: boolean;
  /** Why: `sweep_disabled` = the server's review is switched off (retrying cannot help), `failed` = this job failed (retrying can). Absent on an older server. */
  readonly unavailableReason?: ReviewUnavailableReason | null;
  /** queued / running, from the server (absent on an older one). */
  readonly stage?: ReviewJobStage | 'complete' | 'failed' | null;
  readonly sweepError?: { readonly code: string | null; readonly detail?: string | null } | null;
  readonly progress: EnqueueReviewCompletionResponse['progress'];
  readonly evaluations?: ReviewEvaluationV1[];
  readonly decisions: readonly { decisionId: string; lifecycle: string; positionHash: string }[];
  readonly accuracyModelResult?: import('@racehorse/review-engine').GameAccuracyModelResult | null;
} | null> {
  try {
    const res = await fetch(`${input.apiBase}/api/review-completion-jobs/${encodeURIComponent(input.jobId)}`, {
      headers: {
        ...(input.authHeader ? { Authorization: input.authHeader } : {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      complete: boolean;
      status: string;
      unavailable?: boolean;
      unavailableReason?: ReviewUnavailableReason | null;
      stage?: ReviewJobStage | 'complete' | 'failed' | null;
      sweepError?: { code: string | null; detail?: string | null } | null;
      progress: EnqueueReviewCompletionResponse['progress'];
      evaluations?: ReviewEvaluationV1[];
      decisions: { decisionId: string; lifecycle: string; positionHash: string }[];
      accuracyModelResult?: import('@racehorse/review-engine').GameAccuracyModelResult | null;
    };
  } catch {
    return null;
  }
}
