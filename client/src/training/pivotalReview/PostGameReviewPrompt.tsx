import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
import {
  formatDecisionAccountingSummary,
  type PlayerDecisionLedgerSummary,
} from '../../modules/review/reviewDecisionAccounting';
import '../../styles/dossierRecord.css';
import './postGameReviewPrompt.css';

export type PostGameReviewAccent = 'gold' | 'blue';

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
  decisionLedger?: PlayerDecisionLedgerSummary | null;
  onReviewGame: () => void;
  onSkip: () => void;
};

/**
 * Accuracy / grade presentation under partial coverage:
 * - complete with exact decision coverage: accuracy % + letter grade
 * - any incomplete / unavailable decision: analyzing progress, no final grade
 */
function resolveAccuracyStatValues({
  analysis,
  accuracyModelPending,
  decisionLedger,
}: {
  analysis: GameAnalysis;
  accuracyModelPending: boolean;
  decisionLedger?: PlayerDecisionLedgerSummary | null;
}): { accuracyText: string; gradeText: string; coverageText: string | null } {
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
    return {
      accuracyText: 'Analyzing game…',
      gradeText: '—',
      coverageText: totalNonForced !== null && done !== undefined
        ? `Analyzing ${done} / ${totalNonForced} decisions`
        : 'Analyzing…',
    };
  }

  return {
    accuracyText: `${analysis.accuracyModel.accuracy.toFixed(1)}%`,
    gradeText: analysis.accuracyModel.grade ?? '—',
    coverageText: formatDecisionAccountingSummary(ledger!),
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
  decisionLedger = null,
  onReviewGame,
  onSkip,
}: PostGameReviewPromptProps) {
  if (!open) return null;

  const margin = Math.abs(youScore - opponentScore);
  const marginTone = won === true ? 'is-win' : won === false ? 'is-loss' : '';
  const accentClass = accent === 'blue' ? ' dfd--blue' : '';
  const { accuracyText, gradeText, coverageText } = resolveAccuracyStatValues({
    analysis,
    accuracyModelPending,
    decisionLedger,
  });

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

            <div className="dfd__actions">
              <button type="button" className="dfd__btn dfd__btn--primary" onClick={onReviewGame}>
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
