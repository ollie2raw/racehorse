import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
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
  accuracy: number;
  accuracyGrade?: GameAnalysis['grade'];
  onReviewPivotalTurns: () => void;
  onFullGameReview: () => void;
  onSkip: () => void;
};

export function PostGameReviewPrompt({
  open,
  accent = 'gold',
  modeLabel,
  resultLabel,
  won,
  youScore,
  opponentScore,
  opponentLabel,
  accuracy,
  accuracyGrade,
  onReviewPivotalTurns,
  onFullGameReview,
  onSkip,
}: PostGameReviewPromptProps) {
  if (!open) return null;

  const margin = Math.abs(youScore - opponentScore);
  const outcomeClass = won === true ? ' is-victory' : won === false ? ' is-defeat' : '';
  const cardAccentClass = accent === 'blue' ? ' pgr-prompt-card--blue' : '';

  return (
    <GameOverlayPortal>
      <div
        className="game-over-overlay df-result-overlay pgr-prompt-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Post-game review"
      >
        <div
          className={`game-over-card df-result-card pgr-prompt-card${cardAccentClass}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="df-result-panel">
            <header className="df-result-hero">
              <p className="df-result-eyebrow">{modeLabel}</p>
              <h2 className="df-result-title">{resultLabel}</h2>
              <p className="df-result-subtitle">
                {won === true
                  ? `You beat ${opponentLabel}.`
                  : won === false
                    ? `${opponentLabel} won this one.`
                    : `Final score vs ${opponentLabel}.`}
              </p>
            </header>

            <div className="df-result-stats" aria-label="Match summary">
              <div className={`df-result-stat${outcomeClass}`}>
                <span className="df-result-stat-label">Final Score</span>
                <strong
                  className={`df-result-stat-value${won === true ? ' is-win' : won === false ? ' is-loss' : ''}`}
                >
                  {youScore}-{opponentScore}
                </strong>
              </div>
              <div className="df-result-stat">
                <span className="df-result-stat-label">Margin</span>
                <strong
                  className={`df-result-stat-value${won === true ? ' is-win' : won === false ? ' is-loss' : ''}`}
                >
                  {won === true ? '+' : won === false ? '-' : ''}
                  {margin}
                </strong>
              </div>
            </div>

            <div className="pgr-prompt-accuracy" aria-label="Move accuracy">
              <span className="pgr-prompt-accuracy-label">Move accuracy</span>
              <strong className="pgr-prompt-accuracy-value">{accuracy.toFixed(1)}%</strong>
              {accuracyGrade ? (
                <span className="pgr-prompt-accuracy-grade">Grade {accuracyGrade}</span>
              ) : null}
            </div>

            <div className="df-result-actions">
              <button type="button" className="df-result-primary" onClick={onReviewPivotalTurns}>
                Review 3 Pivotal Turns
              </button>
              <button type="button" className="df-result-secondary" onClick={onFullGameReview}>
                Full Game Review
              </button>
              <button type="button" className="pgr-prompt-skip" onClick={onSkip}>
                Skip
              </button>
            </div>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
