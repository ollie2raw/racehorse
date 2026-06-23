import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
import { filledBlockCount, formatHandOutcome, handAccuracyLabel } from './handReviewFormat';
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
  onReviewGame: () => void;
  onSkip: () => void;
};

function HandAccuracyBar({ accuracy }: { accuracy: number }) {
  const filled = filledBlockCount(accuracy);
  return (
    <div className="pgr-hand-bar" aria-hidden="true">
      {Array.from({ length: 10 }, (_, index) => (
        <span key={index} className={`pgr-hand-bar__seg${index < filled ? ' is-filled' : ''}`} />
      ))}
    </div>
  );
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
  onReviewGame,
  onSkip,
}: PostGameReviewPromptProps) {
  if (!open) return null;

  const margin = Math.abs(youScore - opponentScore);
  const outcomeClass = won === true ? ' is-victory' : won === false ? ' is-defeat' : '';
  const cardAccentClass = accent === 'blue' ? ' pgr-prompt-card--blue' : '';
  const worstHandNumber = analysis.worstHandNumber;
  const hands = analysis.hands;

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
          <div className="df-result-panel pgr-prompt-panel">
            <header className="df-result-hero pgr-prompt-hero">
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

            <div className="df-result-stats pgr-prompt-stats" aria-label="Match summary">
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

            <div className="pgr-prompt-accuracy" aria-label="Move accuracy by hand">
              <header className="pgr-prompt-match-header">
                <p className="pgr-prompt-match-eyebrow">{modeLabel}</p>
                <p
                  className={`pgr-prompt-match-result${won === true ? ' is-victory' : won === false ? ' is-defeat' : ''}`}
                >
                  {resultLabel}
                </p>
              </header>
              <p className="pgr-prompt-accuracy-summary">
                Match accuracy {analysis.accuracy.toFixed(1)}% · Grade {analysis.grade}
              </p>
              <ul className="pgr-hand-list">
                {hands.map((hand) => {
                  const isWorst = hand.handNumber === worstHandNumber;
                  return (
                    <li
                      key={hand.handNumber}
                      className={`pgr-hand-row${isWorst ? ' is-worst' : ''}`}
                    >
                      <div className="pgr-hand-row__main">
                        <span className="pgr-hand-row__label">H{hand.handNumber}</span>
                        <HandAccuracyBar accuracy={hand.handAccuracy} />
                        <span className="pgr-hand-row__accuracy">{handAccuracyLabel(hand)}</span>
                      </div>
                      <p className="pgr-hand-row__outcome">
                        <span>{formatHandOutcome(hand.verdict, opponentLabel)}</span>
                        {isWorst ? (
                          <span className="pgr-hand-row__worst-tag">← worst hand</span>
                        ) : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="df-result-actions pgr-prompt-actions">
              <button type="button" className="df-result-primary" onClick={onReviewGame}>
                Review Game
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
