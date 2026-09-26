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

export async function pollServerReviewCompletion(input: {
  readonly apiBase: string;
  readonly authHeader: string | null;
  readonly jobId: string;
}): Promise<{
  readonly complete: boolean;
  readonly status: string;
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
      progress: EnqueueReviewCompletionResponse['progress'];
      evaluations?: ReviewEvaluationV1[];
      decisions: { decisionId: string; lifecycle: string; positionHash: string }[];
      accuracyModelResult?: import('@racehorse/review-engine').GameAccuracyModelResult | null;
    };
  } catch {
    return null;
  }
}
