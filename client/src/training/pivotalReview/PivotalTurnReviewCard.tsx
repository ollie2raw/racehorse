import { useCallback, useState } from 'react';
import { Board, DominoTile } from '../../components';
import type { ReviewAction } from '@racehorse/game-core/review';
import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import type { PostGameReviewAccent } from './PostGameReviewPrompt';
import type { PivotalTurnReflection } from './pivotalReviewStorage';
import type { PivotalTurnCandidate, PivotalTurnSelection } from './pivotalTurnSelector';
import '../../styles/dossierRecord.css';
import './pivotalTurnReviewCard.css';

export type PivotalTurnReviewCardProps = {
  open: boolean;
  accent?: PostGameReviewAccent;
  selection: PivotalTurnSelection;
  onComplete: (reflections: PivotalTurnReflection[]) => void;
};

function scoreStateCopy(you: number, opp: number): string {
  const diff = you - opp;
  if (diff > 0) return `You were ahead ${you}–${opp}`;
  if (diff < 0) return `You were behind ${you}–${opp}`;
  return `You were tied ${you}–${opp}`;
}

function formatAction(action: ReviewAction): string {
  if (action.kind === 'pass') return 'Pass';
  if (action.kind === 'draw') return 'Draw';
  return `[${action.tile.low}|${action.tile.high}] ${action.position}`;
}

function buildInitialReflections(candidates: PivotalTurnCandidate[]): PivotalTurnReflection[] {
  return candidates.map((candidate) => ({
    moveNumber: candidate.moveNumber,
    rank: candidate.rank,
    note: '',
  }));
}

export function PivotalTurnReviewCard({
  open,
  accent = 'gold',
  selection,
  onComplete,
}: PivotalTurnReviewCardProps) {
  const candidates = selection.candidates;
  const [stepIndex, setStepIndex] = useState(0);
  const [reflections, setReflections] = useState<PivotalTurnReflection[]>(() =>
    buildInitialReflections(candidates),
  );

  const reviewSessionKey = open ? `${selection.analysis.analyzedAt}:${candidates.length}` : '';
  const [trackedReviewSessionKey, setTrackedReviewSessionKey] = useState(reviewSessionKey);
  if (open && reviewSessionKey !== trackedReviewSessionKey) {
    setTrackedReviewSessionKey(reviewSessionKey);
    setStepIndex(0);
    setReflections(buildInitialReflections(candidates));
  }

  const candidate = candidates[stepIndex] ?? null;
  const analyzedMove = candidate?.move ?? null;
  const reflection = reflections[stepIndex] ?? null;
  const isLastStep = stepIndex >= candidates.length - 1;
  const cardAccentClass = accent === 'blue' ? ' dfd--blue' : '';

  const evaluation = candidate?.evaluation;
  const pointsDelta = evaluation ? evaluation.best.immediatePoints - evaluation.played.immediatePoints : 0;
  const rating = candidate?.rating;
  const consequence = candidate?.consequence;
  const handVerdict = selection.analysis.hands.find(
    (hand) => hand.analyzedMoves.some((move) => move.moveNumber === candidate?.moveNumber),
  )?.verdict;

  const updateNote = useCallback(
    (note: string) => {
      setReflections((prev) => {
        const next = prev.map((entry) => ({ ...entry }));
        if (next[stepIndex]) next[stepIndex].note = note;
        return next;
      });
    },
    [stepIndex],
  );

  const finishReview = useCallback(() => {
    onComplete(reflections);
  }, [onComplete, reflections]);

  const goNext = useCallback(() => {
    if (isLastStep) {
      finishReview();
      return;
    }
    setStepIndex((index) => Math.min(index + 1, candidates.length - 1));
  }, [candidates.length, finishReview, isLastStep]);

  const goPrev = useCallback(() => {
    setStepIndex((index) => Math.max(index - 1, 0));
  }, []);

  if (!open || !candidate || !analyzedMove || !reflection || !evaluation) return null;

  return (
    <GameOverlayPortal>
      <div
        className="game-over-overlay df-result-overlay ptr-card-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={`Pivotal turn review ${stepIndex + 1} of ${candidates.length}`}
      >
        <div
          className={`dfd ptr-dossier${cardAccentClass}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="dfd__body ptr-dossier__body">
            <header>
              <span className="dfd__eyebrow">Pivotal turn review</span>
              <h2 className="dfd__headline">Turn {candidate.moveNumber}</h2>
              <p className="dfd__sub">
                {scoreStateCopy(candidate.scoreYou, candidate.scoreOpp)} · {candidate.phase}
              </p>
            </header>

            <div className="ptr-card-scroll">
              <div className="ptr-board-frame" aria-hidden="true">
                <Board
                  board={analyzedMove.boardRenderState ?? null}
                  legalMoves={[]}
                  selectedTile={null}
                  onPositionClick={() => {}}
                  staticView
                  staticFitMainline
                  tileSize={36}
                />
              </div>

              <div className="dfd__standings" aria-label="Move comparison">
                <div className="dfd__standing">
                  <span>You played</span>
                  <span className="dfd__standing-score" style={{ fontSize: 14 }}>
                    {formatAction(evaluation.played.action)}
                  </span>
                </div>
                <div className="dfd__standing">
                  <span>
                    Best move
                    <span className="dfd__tag">{pointsDelta > 0 ? '+' : ''}{pointsDelta} immediate pts</span>
                  </span>
                  <span className="dfd__standing-score is-win" style={{ fontSize: 14 }}>
                    {formatAction(evaluation.best.action)}
                  </span>
                </div>
                <div className="dfd__standing">
                  <span>Rating</span>
                  <span className={`ptr-rating-chip is-${rating?.toLowerCase() ?? 'unrated'}`}>
                    {rating ?? 'Unrated'}
                  </span>
                </div>
                <div className="dfd__standing">
                  <span>Expected point loss</span>
                  <span className="dfd__standing-score">{Number(evaluation.loss.expectedPointDifferential.toFixed(2))} pts</span>
                </div>
              </div>
              <p className="dfd__note">{evaluation.evidence.displayLabel}</p>

              {consequence ? (
                <div className="dfd__meta" aria-label="What happened next">
                  <span className="dfd__meta-label">What happened next</span>
                  <p className="dfd__note" style={{ marginTop: 4 }}>
                    {consequence.rippleSummary}
                  </p>
                  {handVerdict ? (
                    <p className="dfd__note">
                      This hand:{' '}
                      {handVerdict.winner === 'you'
                        ? 'you won'
                        : handVerdict.winner === 'opponent'
                          ? 'Fritz won'
                          : 'tied'}{' '}
                      ({handVerdict.pointsYou}–{handVerdict.pointsOpponent} hand points)
                    </p>
                  ) : null}
                </div>
              ) : null}

              {analyzedMove.handSnapshot.length > 0 ? (
                <div className="dfd__tiles">
                  {analyzedMove.handSnapshot.map((tile, index) => (
                    <DominoTile
                      key={`ptr-hand-${index}-${tile[0]}-${tile[1]}`}
                      tile={{ low: tile[0], high: tile[1] }}
                      size={32}
                      disabled
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <div className="ptr-card-footer">
              <label className="ptr-miss-section">
                <span className="dfd__meta-label">Optional note</span>
                <input
                  type="text"
                  className="ptr-note-input"
                  value={reflection.note}
                  maxLength={120}
                  placeholder="One sentence — what will you remember?"
                  onChange={(event) => updateNote(event.target.value)}
                />
              </label>

              <div className="dfd__actions ptr-nav">
                <div className="dfd__row">
                  <button
                    type="button"
                    className="dfd__btn"
                    disabled={stepIndex === 0}
                    onClick={goPrev}
                  >
                    ← Prev
                  </button>
                  <button type="button" className="dfd__btn dfd__btn--primary" onClick={goNext}>
                    {isLastStep ? 'Finish Review' : 'Next →'}
                  </button>
                </div>
                <p className="dfd__note" style={{ textAlign: 'center', marginTop: 4 }}>
                  Turn {stepIndex + 1}/{candidates.length}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
