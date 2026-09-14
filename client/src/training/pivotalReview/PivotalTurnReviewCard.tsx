import { useCallback, useMemo, useState } from 'react';
import { Board, DominoTile } from '../../components';
import type { AnalyzedMove } from '../../analyzer/moveAnalyzer';
import { sameTileTuple } from '../../game/moveLogger';
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
import '../../styles/dossierRecord.css';
import './pivotalTurnReviewCard.css';

export type PivotalTurnReviewCardProps = {
  open: boolean;
  accent?: PostGameReviewAccent;
  selection: PivotalTurnSelection;
  onComplete: (reflections: PivotalTurnReflection[]) => void;
};

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
  const cardAccentClass = accent === 'blue' ? ' dfd--blue' : '';

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
                    {formatPlayedMove(analyzedMove)}
                  </span>
                </div>
                <div className="dfd__standing">
                  <span>
                    Best move
                    {pointsDelta > 0 ? <span className="dfd__tag">+{pointsDelta} pts</span> : null}
                  </span>
                  <span className="dfd__standing-score is-win" style={{ fontSize: 14 }}>
                    {formatBestMove(analyzedMove)}
                  </span>
                </div>
                <div className="dfd__standing">
                  <span>Rating</span>
                  <span className={`ptr-rating-chip is-${analyzedMove.rating.toLowerCase()}`}>
                    {analyzedMove.rating}
                  </span>
                </div>
              </div>

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
              <div className="ptr-miss-section">
                <span className="dfd__meta-label">Why did you miss this?</span>
                <p className="dfd__note" style={{ marginTop: 4 }}>
                  Pick up to {MAX_MISS_REASONS_PER_TURN} reasons
                </p>
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
