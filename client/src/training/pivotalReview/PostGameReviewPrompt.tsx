import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
import { formatHandOutcome, handAccuracyLabel } from './handReviewFormat';
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
  onReviewGame: () => void;
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
  analysis,
  onReviewGame,
  onSkip,
}: PostGameReviewPromptProps) {
  if (!open) return null;

  const margin = Math.abs(youScore - opponentScore);
  const marginTone = won === true ? 'is-win' : won === false ? 'is-loss' : '';
  const accentClass = accent === 'blue' ? ' dfd--blue' : '';
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
                <dd className="is-accent">{analysis.accuracy.toFixed(1)}%</dd>
              </div>
              <div className="dfd__stat">
                <dt>Grade</dt>
                <dd className="is-accent">{analysis.grade}</dd>
              </div>
            </dl>

            <div className="dfd__games pgr-dossier-hands" aria-label="Move accuracy by hand">
              {hands.map((hand) => {
                const isWorst = hand.handNumber === worstHandNumber;
                const accuracyPct = Math.max(0, Math.min(100, hand.handAccuracy));
                return (
                  <div key={hand.handNumber} className={`pgr-dossier-hand${isWorst ? ' is-worst' : ''}`}>
                    <div className="dfd__game">
                      <span className="dfd__game-no">H{hand.handNumber}</span>
                      <span className="dfd__track pgr-dossier-track" aria-hidden="true">
                        <span className="pgr-dossier-track__fill" style={{ width: `${accuracyPct}%` }} />
                      </span>
                      <span className="dfd__game-score dfd__game-score--win">{handAccuracyLabel(hand)}</span>
                      {isWorst ? <span className="dfd__game-tag">Worst</span> : null}
                    </div>
                    <p className="pgr-dossier-hand__outcome">{formatHandOutcome(hand.verdict, opponentLabel)}</p>
                  </div>
                );
              })}
            </div>

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
