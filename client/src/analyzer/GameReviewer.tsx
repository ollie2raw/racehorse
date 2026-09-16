import { useEffect, useMemo, useState } from 'react';
import { Board, DominoTile } from '../components';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import {
  LEGACY_ANALYSIS_DISCLOSURE,
  type AnalyzedMove,
  type GameAnalysis,
  type MoveRating,
} from './moveAnalyzer';
import { sameTileTuple } from '../game/moveLogger';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import { selectMoveHeuristicClassification } from './useMoveHeuristicClassification';
import { heuristicClassificationToDisplay } from './heuristicClassificationToDisplay';
import { selectMoveSearchTier } from './useMoveSearchTier';
import { moveRatingCoachingCopy } from './moveRatingCoachingCopy';
import { buildReviewCoachingFacts } from './reviewCoachingFacts';
import { buildReviewCoachingProse } from './reviewCoachingProse';
import '../styles/dossierRecord.css';
import './GameReviewer.css';

interface GameReviewerProps {
  open: boolean;
  onClose: () => void;
  analysis: GameAnalysis | null;
  reviewWorkerBatch?: ReviewBatchState;
  decisionIdByMoveNumber?: ReadonlyMap<number, string>;
  title?: string;
  scopeHandNumber?: number | null;
  /** 1-based move index within the starting hand (default 1). */
  initialMoveIndex?: number;
  opponentLabel?: string;
}

const COACHING_RATINGS: MoveRating[] = ['Blunder', 'Mistake', 'Inaccuracy'];

const BADGE_TEXT: Record<'heuristic' | 'unclear' | 'search', string> = {
  heuristic: 'Est.',
  unclear: 'Unclear',
  search: 'Search',
};

function ratingClass(rating: MoveRating): string {
  return rating.toLowerCase();
}

function tileText(tile?: [number, number]): string {
  if (!tile) return '—';
  return `${tile[0]}-${tile[1]}`;
}

function formatPlayedLabel(move: AnalyzedMove): string {
  if (move.action === 'pass') return 'Pass';
  if (move.action === 'draw') return 'Draw';
  return tileText(move.playedTile);
}

export default function GameReviewer({
  open,
  onClose,
  analysis,
  reviewWorkerBatch,
  decisionIdByMoveNumber,
  title = 'Game Review',
  scopeHandNumber = null,
  initialMoveIndex = 1,
}: GameReviewerProps) {
  const hands = useMemo(() => analysis?.hands ?? [], [analysis?.hands]);
  const [selectedHandNumber, setSelectedHandNumber] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);

  const reviewSessionKey = open
    ? `${analysis?.analyzedAt ?? ''}:${scopeHandNumber ?? 'all'}:${initialMoveIndex}`
    : 'closed';

  const [trackedReviewSessionKey, setTrackedReviewSessionKey] = useState(reviewSessionKey);
  if (reviewSessionKey !== trackedReviewSessionKey) {
    setTrackedReviewSessionKey(reviewSessionKey);
  }

  useEffect(() => {
    if (!open || !analysis) return;
    const defaultHand = scopeHandNumber ?? hands[0]?.handNumber ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derives the initial hand + move cursor from props when the reviewer opens
    setSelectedHandNumber(defaultHand);
    const hand = hands.find((entry) => entry.handNumber === defaultHand);
    const moveCount = hand?.analyzedMoves.length ?? analysis.analyzedMoves.length;
    const startIdx =
      moveCount > 0
        ? Math.max(0, Math.min(moveCount - 1, initialMoveIndex - 1))
        : 0;
    setCursor(startIdx);
  }, [analysis, hands, initialMoveIndex, open, reviewSessionKey, scopeHandNumber]);

  const selectedHand = useMemo(
    () => hands.find((hand) => hand.handNumber === selectedHandNumber) ?? null,
    [hands, selectedHandNumber],
  );

  const moves = selectedHand?.analyzedMoves ?? analysis?.analyzedMoves ?? [];
  const current = moves[cursor] ?? null;

  // D2 (game-review-oracle-upgrade-2026-09-13.md): the one structured
  // coaching path, replacing sidebarCopy/praiseCopy below. Sourced from
  // the same reviewWorkerBatch/decisionIdByMoveNumber props
  // ratingCoachingCopy already reads just below -- the only place in this
  // component a resolved ReviewEvaluationV1 is available.
  const currentDecisionId = current ? decisionIdByMoveNumber?.get(current.moveNumber) : undefined;

  const coaching = useMemo(() => {
    if (!currentDecisionId || !reviewWorkerBatch) return null;
    const resolvedEvaluation = reviewWorkerBatch.resultsByDecisionId.get(currentDecisionId);
    if (!resolvedEvaluation) return null;
    const facts = buildReviewCoachingFacts(resolvedEvaluation);
    return { facts, prose: buildReviewCoachingProse(facts) };
  }, [currentDecisionId, reviewWorkerBatch]);

  // Explicit, honest states for every case that isn't a resolved result --
  // never a fabricated placeholder claiming an answer exists.
  const coachingStatus: 'resolved' | 'pending' | 'error' | 'unavailable' = coaching
    ? 'resolved'
    : !currentDecisionId || !reviewWorkerBatch
      ? 'unavailable'
      : reviewWorkerBatch.errorsByDecisionId.has(currentDecisionId)
        ? 'error'
        : reviewWorkerBatch.pendingDecisionIds.has(currentDecisionId)
          ? 'pending'
          : 'unavailable';

  const ratingCoachingCopy = useMemo(() => {
    if (!current) return null;
    const decisionId = decisionIdByMoveNumber?.get(current.moveNumber);
    const classification = reviewWorkerBatch
      ? selectMoveHeuristicClassification(decisionId, reviewWorkerBatch)
      : null;
    // forced (nothing to explain) and unclear (explaining it confidently
    // defeats the point of flagging it unclear) deliberately get no copy.
    if (classification?.kind === 'forced' || classification?.kind === 'unclear') return null;
    if (classification?.kind === 'bucket') {
      return moveRatingCoachingCopy(classification.bucket, 'heuristic');
    }
    const resolvedEvaluation = decisionId ? reviewWorkerBatch?.resultsByDecisionId.get(decisionId) : undefined;
    const isPreciseSource =
      resolvedEvaluation?.evidence.source === 'exact' || resolvedEvaluation?.evidence.source === 'search';
    const scoreGap = isPreciseSource ? Math.abs(resolvedEvaluation!.loss.expectedPointDifferential) : undefined;
    return moveRatingCoachingCopy(current.rating, 'precise', scoreGap);
  }, [current, decisionIdByMoveNumber, reviewWorkerBatch]);

  const evidence = analysis?.evidence ?? LEGACY_ANALYSIS_DISCLOSURE;

  const showGhostTile = Boolean(
    current &&
      current.action === 'place' &&
      current.engineBestMove?.tile &&
      COACHING_RATINGS.includes(current.rating) &&
      (!sameTileTuple(current.playedTile, current.engineBestMove.tile) ||
        current.bestPosition !== current.engineBestMove.position),
  );

  if (!open) return null;

  return (
    <GameOverlayPortal>
      <div
        className="game-over-overlay df-result-overlay gr-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Game reviewer"
        onClick={onClose}
      >
        <div className="gr-shell dfd dfd--wide" onClick={(event) => event.stopPropagation()}>
          <div className="gr-main">
            <div className="gr-header">
              <div className="gr-heading">
                <span className="dfd__eyebrow">Analysis record</span>
                <h3 className="dfd__headline gr-title">{title}</h3>
                <span className="gr-evidence-label">
                  {evidence.displayLabel} · {evidence.confidence} confidence
                </span>
              </div>
              <button type="button" className="dfd__btn gr-close-btn" onClick={onClose}>
                Close
              </button>
            </div>

            <div className="gr-board-cell">
            <div className="gr-board-frame">
              <div className="gr-board-layer">
                <Board
                  key={`gr-board-${selectedHandNumber ?? 'all'}-${cursor}`}
                  board={current?.boardRenderStateAfterMove ?? null}
                  legalMoves={[]}
                  selectedTile={null}
                  onPositionClick={() => {}}
                  fitMode="guided"
                  containFullBoard
                  tileSize={42}
                  showZoomTray
                />
              </div>
              {showGhostTile && current?.engineBestMove?.tile ? (
                <div className="gr-ghost-tile">
                  <DominoTile
                    tile={{ low: current.engineBestMove.tile[0], high: current.engineBestMove.tile[1] }}
                    size={48}
                    disabled
                  />
                  <span className="gr-ghost-label">Best move</span>
                </div>
              ) : null}
            </div>
            </div>

            <div className="gr-move-nav">
              <button
                type="button"
                className="dfd__btn gr-nav-btn"
                onClick={() => setCursor((prev) => Math.max(0, prev - 1))}
                disabled={cursor <= 0}
                aria-label="Previous move"
              >
                {'<'}
              </button>
              <span className="gr-move-nav-label">
                {moves.length
                  ? `Move ${cursor + 1} / ${moves.length}${selectedHand ? ` · Hand ${selectedHand.handNumber}` : ''}`
                  : 'No moves'}
              </span>
              <button
                type="button"
                className="dfd__btn gr-nav-btn"
                onClick={() => setCursor((prev) => Math.min(moves.length - 1, prev + 1))}
                disabled={!moves.length || cursor >= moves.length - 1}
                aria-label="Next move"
              >
                {'>'}
              </button>
            </div>
          </div>

          <aside className="gr-sidebar">
            {hands.length > 0 ? (
              <div className="gr-hand-strip" role="tablist" aria-label="Hands">
                {hands.map((hand) => {
                  const isActive = hand.handNumber === selectedHandNumber;
                  return (
                    <button
                      key={hand.handNumber}
                      type="button"
                      className={`gr-hand-pill${isActive ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedHandNumber(hand.handNumber);
                        setCursor(0);
                      }}
                    >
                      Hand {hand.handNumber} · {hand.handAccuracy.toFixed(0)}%
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="gr-move-list" role="listbox" aria-label="Moves in selected hand">
              {moves.length === 0 ? (
                <p className="gr-empty">No moves available to review in this hand.</p>
              ) : null}
              {moves.map((move, idx) => {
                const decisionId = decisionIdByMoveNumber?.get(move.moveNumber);
                const classification = reviewWorkerBatch
                  ? selectMoveHeuristicClassification(decisionId, reviewWorkerBatch)
                  : null;
                const display = classification ? heuristicClassificationToDisplay(classification) : null;
                const searchTier = reviewWorkerBatch ? selectMoveSearchTier(decisionId, reviewWorkerBatch) : null;
                const label = display?.label ?? move.rating;
                const rowRatingClass = display?.ratingClass ?? ratingClass(move.rating);
                const badge = display?.badge ?? searchTier;
                return (
                  <button
                    key={`${move.moveNumber}-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={idx === cursor}
                    className={`gr-move-row is-${rowRatingClass}${idx === cursor ? ' is-active' : ''}`}
                    onClick={() => setCursor(idx)}
                  >
                    <span className="gr-move-row-num">#{move.moveNumber}</span>
                    <span className="gr-move-row-played">{formatPlayedLabel(move)}</span>
                    <span className="gr-move-row-rating-cell">
                      <span className={`gr-move-row-rating is-${rowRatingClass}`}>{label}</span>
                      {badge ? (
                        <span className={`gr-move-row-badge is-${badge}`}>{BADGE_TEXT[badge]}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className={`gr-coaching${coaching ? ' is-prominent' : ''}`}>
              <div className="gr-coaching-body">
              {ratingCoachingCopy ? (
                <div className="gr-advice-section">
                  <span className="gr-advice-kicker">Why this rating</span>
                  <p className="gr-advice-copy">{ratingCoachingCopy}</p>
                </div>
              ) : null}
              {!current ? (
                <p className="gr-coaching-muted">Select a move to review.</p>
              ) : coaching ? (
                <>
                  <div className="gr-advice-section">
                    <span className="gr-advice-kicker">What happened</span>
                    <p className="gr-advice-copy gr-advice-headline">{coaching.prose.headline}</p>
                    <p className="gr-advice-copy">{coaching.prose.detail}</p>
                  </div>
                  <div className="gr-advice-section">
                    <span className="gr-advice-kicker">What to remember</span>
                    <p className="gr-advice-copy gr-advice-takeaway">{coaching.prose.takeaway}</p>
                  </div>
                </>
              ) : coachingStatus === 'pending' ? (
                <p className="gr-coaching-muted">Analyzing this move…</p>
              ) : coachingStatus === 'error' ? (
                <p className="gr-coaching-muted">{"This move couldn't be analyzed."}</p>
              ) : (
                <p className="gr-coaching-muted">Review data not available for this move.</p>
              )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
