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
 * - complete (all non-forced calibrated): accuracy % + letter grade
 * - partial with scored accuracy: "Scored accuracy: X%" and NO letter grade
 * - unavailable non-forced / below floor: Partial / Incomplete, no grade
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
  if (accuracyModelPending) {
    const total = decisionLedger?.totalDecisions;
    const done =
      total !== undefined && decisionLedger
        ? decisionLedger.scoredCount + decisionLedger.forcedCount
        : undefined;
    // Progressive Game Review: usable while Tier 3/4 finish in the background.
    // Final authoritative % stays gated until every non-forced decision is SCORED.
    const progressText =
      total !== undefined && done !== undefined
        ? `Analyzing ${done} / ${total} decisions`
        : 'Analyzing…';
    return {
      accuracyText: 'Analyzing…',
      gradeText: '—',
      coverageText: progressText,
    };
  }

  const { accuracyModel } = analysis;
  const coverageText = decisionLedger
    ? formatDecisionAccountingSummary(decisionLedger)
    : null;

  if (accuracyModel === undefined) {
    return { accuracyText: `${analysis.accuracy.toFixed(1)}%`, gradeText: analysis.grade, coverageText };
  }

  const unavailableNonForced =
    decisionLedger?.unavailableCount
    ?? accuracyModel.unavailableMoveCount
    ?? 0;
  const hasEstimates =
    (decisionLedger?.estimateCount ?? 0) > 0 || accuracyModel.heuristicMoveCount > 0;
  const isPartial = accuracyModel.status === 'partial' || hasEstimates || unavailableNonForced > 0;

  const scoredCount =
    accuracyModel.totalNonForcedMoveCount
    - accuracyModel.heuristicMoveCount
    - unavailableNonForced;
  const fallbackCoverage =
    coverageText
    ?? [
      `${Math.max(0, scoredCount)} scored`,
      ...(accuracyModel.heuristicMoveCount > 0
        ? [`${accuracyModel.heuristicMoveCount} estimate${accuracyModel.heuristicMoveCount === 1 ? '' : 's'}`]
        : []),
      ...(unavailableNonForced > 0
        ? [`${unavailableNonForced} unavailable`]
        : []),
      `${accuracyModel.totalNonForcedMoveCount} non-forced`,
    ].join(' · ');

  if (unavailableNonForced > 0 && hasEstimates === false && accuracyModel.accuracy !== null) {
    // Finalized with some UNAVAILABLE residuals: still show scored accuracy.
    return {
      accuracyText: `Scored accuracy: ${accuracyModel.accuracy.toFixed(1)}%`,
      gradeText: '—',
      coverageText: fallbackCoverage,
    };
  }

  if (unavailableNonForced > 0 && accuracyModel.accuracy === null) {
    return {
      accuracyText: 'Partial',
      gradeText: 'Incomplete review',
      coverageText: fallbackCoverage,
    };
  }

  if (accuracyModel.accuracy === null) {
    return {
      accuracyText: 'Partial',
      gradeText: "Fritz's read",
      coverageText: fallbackCoverage,
    };
  }

  if (isPartial) {
    return {
      accuracyText: `Scored accuracy: ${accuracyModel.accuracy.toFixed(1)}%`,
      gradeText: '—',
      coverageText: fallbackCoverage,
    };
  }

  return {
    accuracyText: `${accuracyModel.accuracy.toFixed(1)}%`,
    gradeText: accuracyModel.grade ?? '—',
    coverageText: fallbackCoverage,
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
