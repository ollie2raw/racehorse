import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
import {
  formatDecisionAccountingSummary,
  type PlayerDecisionLedgerSummary,
} from '../../modules/review/reviewDecisionAccounting';
import type { ReviewUnavailableReason, ReviewWaitState } from '../../modules/review/reviewCompletionClient';
import '../../styles/dossierRecord.css';
import './postGameReviewPrompt.css';

export const STALLED_NOTE = 'This is taking longer than expected. You can keep waiting or try again.';
export const SETUP_NOTE = "Game review has a setup problem on our side, so it can't start yet. Nothing is wrong with your game.";
/** Sweep error codes that mean the review service itself is not set up, as opposed to one job having trouble. */
export const SETUP_CODES = new Set(['rpc_missing', 'schema_missing', 'permission_denied', 'worker_failed']);

export const SWITCHED_OFF_NOTE = "Game review is switched off right now, so this game couldn't be analyzed. Nothing is wrong with your game.";

export type PostGameReviewAccent = 'gold' | 'blue';

/** Where the "Analyze again" request stands. */
export type ReviewRetryUiState = 'idle' | 'retrying' | 'cooldown' | 'error';

export const RETRY_NOTE: Record<ReviewRetryUiState, string> = {
  idle: "We couldn't finish analyzing this game. You can run the analysis again.",
  retrying: 'Restarting the analysis…',
  cooldown: 'The analysis was just restarted. Please wait a minute, then try again.',
  error: "Couldn't reach the server. Check your connection and try again.",
};

export type PostGameReviewPromptProps = {
  open: boolean;
  accent?: PostGameReviewAccent;
  modeLabel: string;
  resultLabel: string;
  won: boolean | null;
  youScore: number;
  opponentScore: number;
  opponentLabel: string;
  analysis: GameAnalysis;
  accuracyModelPending: boolean;
  /** The server will not finish this review; show that instead of Analyzing. */
  reviewUnavailable?: boolean;
  /** `sweep_disabled`: the server's review is switched off, so retrying cannot help and is not offered. Anything else keeps Analyze again. */
  reviewUnavailableReason?: ReviewUnavailableReason | null;
  /** Where the server job is (queued or running) and whether it has stalled; null before a job exists. */
  reviewWait?: ReviewWaitState | null;
  decisionLedger?: PlayerDecisionLedgerSummary | null;
  /** Re-run an analysis the server gave up on. Only offered while `reviewUnavailable`. */
  onRetryReview?: () => void;
  reviewRetryState?: ReviewRetryUiState;
  onReviewGame: () => void;
  onSkip: () => void;
};

/**
 * Accuracy / grade presentation under partial coverage:
 * - complete with exact decision coverage: accuracy % + letter grade
 * - any incomplete / unavailable decision: analyzing progress, no final grade
 */
export function resolveAccuracyStatValues({
  analysis,
  accuracyModelPending,
  reviewUnavailable,
  decisionLedger,
  reviewWait,
}: {
  analysis: GameAnalysis;
  accuracyModelPending: boolean;
  reviewUnavailable: boolean;
  decisionLedger?: PlayerDecisionLedgerSummary | null;
  reviewWait?: ReviewWaitState | null;
}): {
  accuracyText: string;
  gradeText: string;
  coverageText: string | null;
  /** True once accuracy and grade are final (every decision resolved). */
  complete: boolean;
  /** Decisions scored so far out of those that can be scored; null before a ledger exists. */
  progress: { done: number; total: number } | null;
} {
  if (reviewUnavailable) {
    return {
      accuracyText: 'Unavailable',
      gradeText: '—',
      coverageText: 'Review unavailable for this game.',
      complete: false,
      progress: null,
    };
  }
  const ledger = decisionLedger;
  const totalNonForced = ledger ? ledger.totalDecisions - ledger.forcedCount : null;
  const fullyResolved = Boolean(ledger
    && ledger.pendingCount === 0
    && ledger.estimateCount === 0
    && ledger.unavailableCount === 0
    && ledger.scoredCount + ledger.forcedCount === ledger.totalDecisions);
  if (accuracyModelPending || !fullyResolved || !analysis.accuracyModel
    || analysis.accuracyModel.status !== 'complete'
    || analysis.accuracyModel.heuristicMoveCount !== 0
    || (analysis.accuracyModel.unavailableMoveCount ?? 0) !== 0
    || analysis.accuracyModel.coverageFraction !== 1
    || analysis.accuracyModel.accuracy === null) {
    const done = ledger?.scoredCount;
    // "Queued" until a pass actually holds the job: saying "Analyzing 0 / 50" about a job nothing is working on is what made a stuck review look busy.
    // A quick (device) review is ready: the player can already read the whole game, and the server's full analysis is upgrading it.
    const quickReady = (ledger?.quickReadyCount ?? 0) > 0;
    const queued = !quickReady && reviewWait?.stage === 'queued' && (done ?? 0) === 0;
    return {
      accuracyText: quickReady ? 'Quick review ready' : queued ? 'Queued…' : 'Analyzing game…',
      gradeText: '—',
      coverageText: quickReady
        ? `Upgrading to full analysis · ${done ?? 0} of ${totalNonForced ?? '?'}`
        : queued
        ? 'Waiting for the analysis to start'
        : totalNonForced !== null && done !== undefined
          ? `Analyzing ${done} / ${totalNonForced} decisions`
          : 'Analyzing…',
      complete: false,
      progress: totalNonForced !== null && done !== undefined ? { done, total: totalNonForced } : null,
    };
  }

  return {
    accuracyText: `${analysis.accuracyModel.accuracy.toFixed(1)}%`,
    gradeText: analysis.accuracyModel.grade ?? '—',
    coverageText: formatDecisionAccountingSummary(ledger!),
    complete: true,
    progress: null,
  };
}

export function PostGameReviewPrompt({
  open,
  accent = 'gold',
  modeLabel,
  resultLabel,
  won,
  youScore,
  opponentScore,
  opponentLabel,
  analysis,
  accuracyModelPending,
  reviewUnavailable = false,
  reviewUnavailableReason = null,
  reviewWait = null,
  decisionLedger = null,
  onRetryReview: retryHandler,
  reviewRetryState = 'idle',
  onReviewGame,
  onSkip,
}: PostGameReviewPromptProps) {
  if (!open) return null;

  const switchedOff = reviewUnavailable && reviewUnavailableReason === 'sweep_disabled';
  // Retrying a review the server has switched off would only land back here.
  const onRetryReview = switchedOff ? undefined : retryHandler;

  const margin = Math.abs(youScore - opponentScore);
  const marginTone = won === true ? 'is-win' : won === false ? 'is-loss' : '';
  const accentClass = accent === 'blue' ? ' dfd--blue' : '';
  const { accuracyText, gradeText, coverageText } = resolveAccuracyStatValues({
    analysis,
    accuracyModelPending,
    reviewUnavailable,
    decisionLedger,
    reviewWait,
  });
  const stalled = !reviewUnavailable && reviewWait?.stalled === true;
  const setupProblem = stalled && reviewWait?.sweepErrorCode != null && SETUP_CODES.has(reviewWait.sweepErrorCode);
  const canRetry = (reviewUnavailable || stalled) && Boolean(onRetryReview);

  return (
    <GameOverlayPortal>
      <div
        className="game-over-overlay df-result-overlay pgr-prompt-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Post-game review"
      >
        <div className={`dfd${accentClass}`} onClick={(event) => event.stopPropagation()}>
          <div className="dfd__body">
            <header>
              <span className="dfd__eyebrow">{modeLabel}</span>
              <h2 className="dfd__headline">{resultLabel}</h2>
              <p className="dfd__sub">
                {won === true
                  ? `You beat ${opponentLabel}.`
                  : won === false
                    ? `${opponentLabel} won this one.`
                    : `Final score vs ${opponentLabel}.`}
              </p>
            </header>

            <dl className="dfd__stats" aria-label="Match summary">
              <div className="dfd__stat">
                <dt>Final score</dt>
                <dd className={marginTone}>
                  {youScore}-{opponentScore}
                </dd>
              </div>
              <div className="dfd__stat">
                <dt>Margin</dt>
                <dd className={marginTone}>
                  {won === true ? '+' : won === false ? '-' : ''}
                  {margin}
                </dd>
              </div>
              <div className="dfd__stat">
                <dt>Accuracy</dt>
                <dd className="is-accent">{accuracyText}</dd>
              </div>
              <div className="dfd__stat">
                <dt>Grade</dt>
                <dd className="is-accent">{gradeText}</dd>
              </div>
            </dl>

            {coverageText ? <p className="pgr-coverage-note">{coverageText}</p> : null}
            {switchedOff ? <p className="pgr-coverage-note" role="status">{SWITCHED_OFF_NOTE}</p> : null}
            {stalled ? (
              <p className="pgr-coverage-note" role="status">
                {setupProblem ? SETUP_NOTE : reviewRetryState === 'idle' ? STALLED_NOTE : RETRY_NOTE[reviewRetryState]}
              </p>
            ) : null}
            {reviewUnavailable && onRetryReview ? (
              <p className="pgr-coverage-note" role="status">{RETRY_NOTE[reviewRetryState]}</p>
            ) : null}

            <div className="dfd__actions">
              {canRetry ? (
                <button
                  type="button"
                  className="dfd__btn dfd__btn--primary"
                  onClick={onRetryReview}
                  disabled={reviewRetryState === 'retrying'}
                >
                  {reviewUnavailable ? 'Analyze again' : 'Try again'}
                </button>
              ) : null}
              <button
                type="button"
                className={`dfd__btn ${reviewUnavailable && onRetryReview ? 'dfd__btn--ghost' : 'dfd__btn--primary'}`}
                onClick={onReviewGame}
              >
                Review Game
              </button>
              <button type="button" className="dfd__btn dfd__btn--ghost" onClick={onSkip}>
                Skip
              </button>
            </div>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
