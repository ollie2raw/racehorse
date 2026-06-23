import { useCallback, useMemo, useState } from 'react';
import { Board, DominoTile } from '../../components';
import type { AnalyzedMove, MoveRating } from '../../analyzer/moveAnalyzer';
import { sameTileTuple } from '../../analyzer/moveLogger';
import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import type { PostGameReviewAccent } from './PostGameReviewPrompt';
import {
  MAX_MISS_REASONS_PER_TURN,
  PIVOTAL_REVIEW_MISS_REASONS,
  type PivotalReviewMissReasonId,
} from './pivotalReviewMissReasons';
import type { PivotalTurnReflection } from './pivotalReviewStorage';
import type { PivotalTurnCandidate, PivotalTurnSelection } from './pivotalTurnSelector';
import { buildMissReasonCoachingCopy } from './missReasonCoaching';
import './pivotalTurnReviewCard.css';

export type PivotalTurnReviewCardProps = {
  open: boolean;
  accent?: PostGameReviewAccent;
  selection: PivotalTurnSelection;
  onComplete: (reflections: PivotalTurnReflection[]) => void;
};

function colorForRating(rating: MoveRating): string {
  if (rating === 'Brilliant') return '#00ff88';
  if (rating === 'Great') return '#67e8f9';
  if (rating === 'Good') return '#7dd3fc';
  if (rating === 'Inaccuracy') return '#ffcc00';
  if (rating === 'Mistake') return '#ffcc00';
  return '#ff3333';
}

function tileLabel(tile?: [number, number]): string {
  if (!tile) return '—';
  return `[${tile[0]}|${tile[1]}]`;
}

function scoreStateCopy(you: number, opp: number): string {
  const diff = you - opp;
  if (diff > 0) return `You were ahead ${you}–${opp}`;
  if (diff < 0) return `You were behind ${you}–${opp}`;
  return `You were tied ${you}–${opp}`;
}

function formatPlayedMove(move: AnalyzedMove): string {
  if (move.action === 'pass') return 'Pass';
  const tile = tileLabel(move.playedTile);
  const position = move.engineBestMove?.position ?? move.bestPosition;
  return position ? `${tile} ${position}` : tile;
}

function formatBestMove(move: AnalyzedMove): string {
  if (move.action === 'pass') {
    const bestTile = move.bestTile ?? move.engineBestMove?.tile;
    if (!bestTile) return 'Play a tile';
    const position = move.engineBestMove?.position ?? move.bestPosition;
    return position ? `${tileLabel(bestTile)} ${position}` : tileLabel(bestTile);
  }
  const bestTile = move.bestTile ?? move.engineBestMove?.tile;
  if (!bestTile) return '—';
  const position = move.engineBestMove?.position ?? move.bestPosition;
  const sameTile = sameTileTuple(move.playedTile, bestTile);
  if (sameTile && position) return `${tileLabel(bestTile)} ${position}`;
  return position ? `${tileLabel(bestTile)} ${position}` : tileLabel(bestTile);
}

function nextEndsForTile(tile: [number, number], boardEnds: [number, number]): Array<[number, number]> {
  const [left, right] = boardEnds;
  if (left < 0 || right < 0) return [[tile[0], tile[1]]];
  const out: Array<[number, number]> = [];
  if (tile[0] === left) out.push([tile[1], right]);
  if (tile[1] === left) out.push([tile[0], right]);
  if (tile[0] === right) out.push([left, tile[1]]);
  if (tile[1] === right) out.push([left, tile[0]]);
  return out;
}

function bestImmediatePoints(tile: [number, number] | undefined, boardEnds: [number, number]): number {
  if (!tile) return 0;
  const possibilities = nextEndsForTile(tile, boardEnds);
  if (!possibilities.length) return 0;
  return Math.max(...possibilities.map((ends) => ends[0] + ends[1]));
}

function buildInitialReflections(candidates: PivotalTurnCandidate[]): PivotalTurnReflection[] {
  return candidates.map((candidate) => ({
    moveNumber: candidate.moveNumber,
    rank: candidate.rank,
    missReasons: [],
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
  const [expandedReasonId, setExpandedReasonId] = useState<PivotalReviewMissReasonId | null>(null);
  const [reflections, setReflections] = useState<PivotalTurnReflection[]>(() =>
    buildInitialReflections(candidates),
  );

  const reviewSessionKey = open ? `${selection.analysis.analyzedAt}:${candidates.length}` : '';
  const [trackedReviewSessionKey, setTrackedReviewSessionKey] = useState(reviewSessionKey);
  if (open && reviewSessionKey !== trackedReviewSessionKey) {
    setTrackedReviewSessionKey(reviewSessionKey);
    setStepIndex(0);
    setExpandedReasonId(null);
    setReflections(buildInitialReflections(candidates));
  }

  const candidate = candidates[stepIndex] ?? null;
  const analyzedMove = candidate?.move ?? null;
  const reflection = reflections[stepIndex] ?? null;
  const isLastStep = stepIndex >= candidates.length - 1;
  const cardAccentClass = accent === 'blue' ? ' ptr-card--blue' : '';

  const pointsDelta = useMemo(() => {
    if (!analyzedMove) return 0;
    const played = bestImmediatePoints(analyzedMove.playedTile, analyzedMove.boardEnds);
    const best = bestImmediatePoints(
      analyzedMove.bestTile ?? analyzedMove.engineBestMove?.tile,
      analyzedMove.boardEnds,
    );
    return Math.max(0, best - played);
  }, [analyzedMove]);

  const consequence = candidate.consequence;
  const handVerdict = selection.analysis.hands.find(
    (hand) => hand.analyzedMoves.some((move) => move.moveNumber === candidate.moveNumber),
  )?.verdict;

  const toggleMissReason = useCallback(
    (reasonId: PivotalReviewMissReasonId) => {
      setReflections((prev) => {
        const next = prev.map((entry) => ({ ...entry, missReasons: [...entry.missReasons] }));
        const current = next[stepIndex];
        if (!current) return prev;
        const selected = current.missReasons.includes(reasonId);
        if (selected) {
          current.missReasons = current.missReasons.filter((id) => id !== reasonId);
          setExpandedReasonId((prevId) => (prevId === reasonId ? null : prevId));
        } else if (current.missReasons.length < MAX_MISS_REASONS_PER_TURN) {
          current.missReasons.push(reasonId);
          setExpandedReasonId(reasonId);
        }
        return next;
      });
    },
    [stepIndex],
  );

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

  if (!open || !candidate || !analyzedMove || !reflection) return null;

  return (
    <GameOverlayPortal>
      <div
        className="game-over-overlay df-result-overlay ptr-card-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={`Pivotal turn review ${stepIndex + 1} of ${candidates.length}`}
      >
        <div
          className={`game-over-card df-result-card ptr-card${cardAccentClass}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="ptr-card-panel">
            <header className="ptr-card-header">
              <p className="ptr-card-kicker">Pivotal Turn Review</p>
              <h2 className="ptr-card-title">Turn {candidate.moveNumber}</h2>
              <p className="ptr-card-context">
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

              <div className="ptr-move-compare" aria-label="Move comparison">
                <div className="ptr-move-row">
                  <span className="ptr-move-row-label">You played</span>
                  <span className="ptr-move-row-value">{formatPlayedMove(analyzedMove)}</span>
                </div>
                <div className="ptr-move-row is-best">
                  <span className="ptr-move-row-label">Best move</span>
                  <span className="ptr-move-row-value">
                    {formatBestMove(analyzedMove)}
                    {pointsDelta > 0 ? ` (+${pointsDelta} pts)` : ''}
                  </span>
                </div>
                <div className="ptr-move-row">
                  <span className="ptr-move-row-label">Rating</span>
                  <span className="ptr-move-row-value">
                    <span
                      className="ptr-rating-pill"
                      style={{
                        color: colorForRating(analyzedMove.rating),
                        border: `1px solid ${colorForRating(analyzedMove.rating)}44`,
                        background: `${colorForRating(analyzedMove.rating)}18`,
                      }}
                    >
                      {analyzedMove.rating}
                    </span>
                  </span>
                </div>
              </div>

              {consequence ? (
                <div className="ptr-consequence-block" aria-label="What happened next">
                  <span className="ptr-miss-label">What happened next</span>
                  <p className="ptr-consequence-copy">{consequence.rippleSummary}</p>
                  {handVerdict ? (
                    <p className="ptr-consequence-hand">
                      This hand: {handVerdict.winner === 'you' ? 'you won' : handVerdict.winner === 'opponent' ? 'Fritz won' : 'tied'}{' '}
                      ({handVerdict.pointsYou}–{handVerdict.pointsOpponent} hand points)
                    </p>
                  ) : null}
                </div>
              ) : null}

              {analyzedMove.handSnapshot.length > 0 ? (
                <div className="ptr-hand-snapshot">
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
              <div className="ptr-miss-section">
              <span className="ptr-miss-label">Why did you miss this?</span>
              <p className="ptr-miss-hint">Pick up to {MAX_MISS_REASONS_PER_TURN} reasons</p>
              <div className="ptr-miss-chips" role="group" aria-label="Miss reasons">
                {PIVOTAL_REVIEW_MISS_REASONS.map((reason) => {
                  const selected = reflection.missReasons.includes(reason.id);
                  const atCap =
                    !selected && reflection.missReasons.length >= MAX_MISS_REASONS_PER_TURN;
                  return (
                    <button
                      key={reason.id}
                      type="button"
                      className={`ptr-miss-chip${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      disabled={atCap}
                      onClick={() => toggleMissReason(reason.id)}
                    >
                      {reason.label}
                    </button>
                  );
                })}
              </div>
              {expandedReasonId ? (
                <p className="ptr-miss-coaching">
                  {buildMissReasonCoachingCopy(expandedReasonId, analyzedMove)}
                </p>
              ) : null}
            </div>

            <label className="ptr-miss-section">
              <span className="ptr-miss-label">Optional note</span>
              <input
                type="text"
                className="ptr-note-input"
                value={reflection.note}
                maxLength={120}
                placeholder="One sentence — what will you remember?"
                onChange={(event) => updateNote(event.target.value)}
              />
            </label>

            <div className="ptr-nav">
              <button
                type="button"
                className="df-result-secondary ptr-nav-btn"
                disabled={stepIndex === 0}
                onClick={goPrev}
              >
                ← Prev
              </button>
              <span className="ptr-nav-step">
                Turn {stepIndex + 1}/{candidates.length}
              </span>
              <button type="button" className="df-result-primary ptr-nav-btn is-next" onClick={goNext}>
                {isLastStep ? 'Finish Review' : 'Next →'}
              </button>
            </div>
            </div>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
