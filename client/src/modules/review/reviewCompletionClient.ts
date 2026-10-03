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

/**
 * Review-job poll cadence. Each poll makes the server read the job row from
 * Supabase (~13-40 KB gzip with the move snapshots), so the old 1 s cadence
 * was the largest per-player egress source. Start at 3 s, back off to 5 s
 * while nothing changes, drop back to 3 s when progress moves; stop entirely
 * once the job is complete or unavailable (both terminal for this screen).
 */
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
      progress: EnqueueReviewCompletionResponse['progress'];
      evaluations?: ReviewEvaluationV1[];
      decisions: { decisionId: string; lifecycle: string; positionHash: string }[];
      accuracyModelResult?: import('@racehorse/review-engine').GameAccuracyModelResult | null;
    };
  } catch {
    return null;
  }
}
