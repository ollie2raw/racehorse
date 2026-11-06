import type { GameAnalysis } from '../analyzer/moveAnalyzer';
import type { PlayerDecisionLedgerSummary } from '../modules/review/reviewDecisionAccounting';
import type { ReviewUnavailableReason } from '../modules/review/reviewCompletionClient';
import {
  RETRY_NOTE,
  SWITCHED_OFF_NOTE,
  resolveAccuracyStatValues,
  type ReviewRetryUiState,
} from '../training/pivotalReview/PostGameReviewPrompt';

/**
 * What the Play vs Fritz result card shows about the review.
 *
 * - `preparing`: the game is over but the position record is not built yet; the review cannot open.
 * - `running`: the review opens now (the board fills in as decisions finish); accuracy is not final.
 * - `ready`: accuracy and grade are final.
 * - `unavailable`: the server will not finish it; the board still opens on what is known.
 */
export type PostGameReviewView = {
  status: 'preparing' | 'running' | 'ready' | 'unavailable';
  canOpen: boolean;
  /** One short line under the review heading. */
  statusText: string;
  accuracyText: string | null;
  gradeText: string | null;
  progress: { done: number; total: number } | null;
  /** Explains an unavailable review. */
  note: string | null;
  canRetry: boolean;
  retrying: boolean;
};

export function buildPostGameReviewView(input: {
  eligible: boolean;
  analysis: GameAnalysis | null;
  analysisPending: boolean;
  accuracyModelPending: boolean;
  reviewUnavailable: boolean;
  reviewUnavailableReason: ReviewUnavailableReason | null;
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
      canRetry: false,
      retrying: false,
    };
  }

  const resolved = resolveAccuracyStatValues({
    analysis: input.analysis,
    accuracyModelPending: input.accuracyModelPending,
    reviewUnavailable: input.reviewUnavailable,
    decisionLedger: input.decisionLedger,
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
      canRetry: false,
      retrying: false,
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
    canRetry: false,
    retrying: false,
  };
}
