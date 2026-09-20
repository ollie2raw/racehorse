import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
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
  /**
   * C4 UI follow-up: true while reviewWorkerBatch is still computing this
   * game's per-decision ReviewEvaluationV1 data. While true, the accuracy
   * stat block shows a loading state -- never a legacy-then-swap flash, and
   * never a premature "Partial" before the real coverage is known.
   */
  accuracyModelPending: boolean;
  onReviewGame: () => void;
  onSkip: () => void;
};

/**
 * Three distinct states for `analysis.accuracyModel`, per the C4 follow-up
 * spec revision (phase-c-accuracy-model-spec.md section 6) -- deliberately
 * not collapsed into one fallback:
 *  - `undefined` -- this GameAnalysis predates C4, or no caller computed
 *    one (e.g. review capture produced nothing for this game). Render the
 *    legacy accuracy/grade exactly as before.
 *  - `accuracy === null` -- computed, but coverage never cleared
 *    MINIMUM_COVERAGE_FLOOR. Render "Partial / Fritz's read" plus the real
 *    "N of M moves analyzed" count. NEVER fall back to the legacy number
 *    here -- it would misrepresent what the new model actually found.
 *  - `accuracy !== null` -- coverage cleared the floor. Render the new
 *    accuracy/grade in the same slot the legacy ones used, plus the same
 *    coverage line (coverage may still be under 100%).
 * `accuracyModelPending` is a fourth, temporal state layered on top of all
 * three: while true, none of the above render -- a loading placeholder
 * does, so the stat block never flashes legacy numbers before swapping to
 * the real ones.
 */
function resolveAccuracyStatValues({
  analysis,
  accuracyModelPending,
}: {
  analysis: GameAnalysis;
  accuracyModelPending: boolean;
}): { accuracyText: string; gradeText: string; coverageText: string | null } {
  if (accuracyModelPending) {
    return { accuracyText: '…', gradeText: '…', coverageText: null };
  }

  const { accuracyModel } = analysis;

  if (accuracyModel === undefined) {
    return { accuracyText: `${analysis.accuracy.toFixed(1)}%`, gradeText: analysis.grade, coverageText: null };
  }

  const scorableCount = accuracyModel.totalNonForcedMoveCount - accuracyModel.heuristicMoveCount;
  const coverageText = `${scorableCount} of ${accuracyModel.totalNonForcedMoveCount} moves analyzed`;

  if (accuracyModel.accuracy === null) {
    return { accuracyText: 'Partial', gradeText: "Fritz's read", coverageText };
  }

  return { accuracyText: `${accuracyModel.accuracy.toFixed(1)}%`, gradeText: accuracyModel.grade ?? '—', coverageText };
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
  onReviewGame,
  onSkip,
}: PostGameReviewPromptProps) {
  if (!open) return null;

  const margin = Math.abs(youScore - opponentScore);
  const marginTone = won === true ? 'is-win' : won === false ? 'is-loss' : '';
  const accentClass = accent === 'blue' ? ' dfd--blue' : '';
  const { accuracyText, gradeText, coverageText } = resolveAccuracyStatValues({ analysis, accuracyModelPending });

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
