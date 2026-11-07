import type { GameAnalysis } from '../analyzer/moveAnalyzer';
import type { PlayerDecisionLedgerSummary } from '../modules/review/reviewDecisionAccounting';
import type { ReviewUnavailableReason, ReviewWaitState } from '../modules/review/reviewCompletionClient';
import {
  RETRY_NOTE,
  SETUP_CODES,
  SETUP_NOTE,
  STALLED_NOTE,
  SWITCHED_OFF_NOTE,
  resolveAccuracyStatValues,
  type ReviewRetryUiState,
} from '../training/pivotalReview/PostGameReviewPrompt';

/**
 * What the Play vs Fritz result card shows about the review.
 *
 * - `preparing`: the game is over but the position record is not built yet; the review cannot open.
 * - `queued`: the job exists but no pass holds it yet; the review opens, nothing is being analyzed.
 * - `quick`: the device's provisional quick review is ready and readable; the server's full analysis is upgrading it. Accuracy is not final.
 * - `running`: a pass holds the job; the board fills in as decisions finish; accuracy is not final.
 * - `stalled`: nothing has moved for a while (taking longer than expected, or the service has a setup problem); a retry is offered.
 * - `ready`: accuracy and grade are final.
 * - `unavailable`: the server will not finish it; the board still opens on what is known.
 */
export type PostGameReviewView = {
  status: 'preparing' | 'queued' | 'quick' | 'running' | 'stalled' | 'ready' | 'unavailable';
  canOpen: boolean;
  /** One short line under the review heading. */
  statusText: string;
  accuracyText: string | null;
  gradeText: string | null;
  progress: { done: number; total: number } | null;
  /** Explains a stalled or unavailable review. */
  note: string | null;
  canRetry: boolean;
  /** 'Analyze again' once the server gave up, 'Try again' while it merely stalled. */
  retryLabel: 'Analyze again' | 'Try again';
  retrying: boolean;
};

const NO_RETRY = { canRetry: false, retryLabel: 'Try again' as const, retrying: false };

export function buildPostGameReviewView(input: {
  eligible: boolean;
  analysis: GameAnalysis | null;
  analysisPending: boolean;
  accuracyModelPending: boolean;
  reviewUnavailable: boolean;
  reviewUnavailableReason: ReviewUnavailableReason | null;
  reviewWait?: ReviewWaitState | null;
  decisionLedger: PlayerDecisionLedgerSummary | null;
  retryAvailable: boolean;
  retryState: ReviewRetryUiState;
}): PostGameReviewView | null {
  if (!input.eligible) return null;

  if (!input.analysis) {
    return {
      status: 'preparing',
      canOpen: false,
      statusText: input.analysisPending ? 'Preparing your review…' : 'Review not ready yet',
      accuracyText: null,
      gradeText: null,
      progress: null,
      note: null,
      ...NO_RETRY,
    };
  }

  const resolved = resolveAccuracyStatValues({
    analysis: input.analysis,
    accuracyModelPending: input.accuracyModelPending,
    reviewUnavailable: input.reviewUnavailable,
    decisionLedger: input.decisionLedger,
    reviewWait: input.reviewWait,
  });

  if (input.reviewUnavailable) {
    const switchedOff = input.reviewUnavailableReason === 'sweep_disabled';
    return {
      status: 'unavailable',
      canOpen: true,
      statusText: switchedOff ? 'Move-by-move analysis is off right now' : 'Analysis could not finish',
      accuracyText: null,
      gradeText: null,
      progress: null,
      note: switchedOff ? SWITCHED_OFF_NOTE : RETRY_NOTE[input.retryState],
      // Retrying a review the server has switched off would only land back here.
      canRetry: input.retryAvailable && !switchedOff,
      retryLabel: 'Analyze again',
      retrying: input.retryState === 'retrying',
    };
  }

  if (resolved.complete) {
    return {
      status: 'ready',
      canOpen: true,
      statusText: resolved.coverageText ?? 'Analysis complete',
      accuracyText: resolved.accuracyText,
      gradeText: resolved.gradeText,
      progress: null,
      note: null,
      ...NO_RETRY,
    };
  }

  const wait = input.reviewWait ?? null;
  const quickReady = (input.decisionLedger?.quickReadyCount ?? 0) > 0;
  if (wait?.stalled === true) {
    const setupProblem = wait.sweepErrorCode != null && SETUP_CODES.has(wait.sweepErrorCode);
    return {
      status: 'stalled',
      canOpen: true,
      statusText: quickReady
        ? 'Quick review ready · full analysis is taking longer than expected'
        : setupProblem ? 'Analysis cannot start right now' : 'Analysis is taking longer than expected',
      accuracyText: null,
      gradeText: null,
      progress: resolved.progress,
      note: setupProblem ? SETUP_NOTE : input.retryState === 'idle' ? STALLED_NOTE : RETRY_NOTE[input.retryState],
      canRetry: input.retryAvailable,
      retryLabel: 'Try again',
      retrying: input.retryState === 'retrying',
    };
  }

  const done = resolved.progress?.done ?? 0;
  if (quickReady) {
    return {
      status: 'quick',
      canOpen: true,
      statusText: resolved.progress
        ? `Quick review ready · upgrading to full analysis (${resolved.progress.done} of ${resolved.progress.total})`
        : 'Quick review ready · upgrading to full analysis',
      accuracyText: null,
      gradeText: null,
      progress: resolved.progress,
      note: null,
      ...NO_RETRY,
    };
  }
  if (wait?.stage === 'queued' && done === 0) {
    return {
      status: 'queued',
      canOpen: true,
      statusText: 'Queued: waiting for the analysis to start',
      accuracyText: null,
      gradeText: null,
      progress: null,
      note: null,
      ...NO_RETRY,
    };
  }

  return {
    status: 'running',
    canOpen: true,
    statusText: resolved.progress
      ? `Analyzing ${resolved.progress.done} of ${resolved.progress.total} moves`
      : 'Analyzing your moves…',
    accuracyText: null,
    gradeText: null,
    progress: resolved.progress,
    note: null,
    ...NO_RETRY,
  };
}
