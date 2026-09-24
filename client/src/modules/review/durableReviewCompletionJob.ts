/**
 * Browser mirror of the durable completion job checkpoint.
 * Server owns authoritative completion via /api/review-completion-jobs;
 * localStorage lets reopen observe progress before the poll catches up.
 */
import type { ReviewDecisionLifecycle } from '@racehorse/game-core/review';

export type ReviewCompletionJobDecision = {
  readonly decisionId: string;
  readonly positionHash: string;
  readonly lifecycle: ReviewDecisionLifecycle;
  readonly tierReached: 1 | 2 | 3 | 4 | null;
  readonly updatedAt: number;
};

export type ReviewCompletionJob = {
  readonly jobVersion: 2;
  readonly jobId?: string;
  readonly gameId: string;
  readonly sourceMatchId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly decisions: readonly ReviewCompletionJobDecision[];
  readonly progress?: {
    readonly total: number;
    readonly scored: number;
    readonly forced: number;
    readonly remaining: number;
  };
};

const STORAGE_PREFIX = 'racehorse.reviewCompletionJob.v2:';

export function reviewCompletionJobKey(sourceMatchId: string): string {
  return `${STORAGE_PREFIX}${sourceMatchId}`;
}

export function loadReviewCompletionJob(sourceMatchId: string): ReviewCompletionJob | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(reviewCompletionJobKey(sourceMatchId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.jobVersion !== 1 && parsed.jobVersion !== 2) return null;
    return parsed as unknown as ReviewCompletionJob;
  } catch {
    return null;
  }
}

export function saveReviewCompletionJob(job: ReviewCompletionJob): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      reviewCompletionJobKey(job.sourceMatchId),
      JSON.stringify({ ...job, updatedAt: Date.now() }),
    );
  } catch {
    // Quota / private mode — server job remains authoritative.
  }
}

export function clearReviewCompletionJob(sourceMatchId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(reviewCompletionJobKey(sourceMatchId));
  } catch {
    /* ignore */
  }
}

export function jobIsAuthoritativeComplete(job: ReviewCompletionJob): boolean {
  if (job.decisions.length === 0) return false;
  return job.decisions.every((d) => d.lifecycle === 'SCORED' || d.lifecycle === 'FORCED');
}

export function formatReviewProgress(job: ReviewCompletionJob): string {
  const total = job.progress?.total ?? job.decisions.length;
  const done =
    (job.progress?.scored ?? job.decisions.filter((d) => d.lifecycle === 'SCORED').length)
    + (job.progress?.forced ?? job.decisions.filter((d) => d.lifecycle === 'FORCED').length);
  return `Analyzing ${done} / ${total} decisions`;
}
