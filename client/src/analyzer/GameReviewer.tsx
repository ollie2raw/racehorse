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
import { buildReviewSidebarCopy } from './reviewSidebarCopy';
import './GameReviewer.css';

interface GameReviewerProps {
  open: boolean;
  onClose: () => void;
  analysis: GameAnalysis | null;
  title?: string;
  scopeHandNumber?: number | null;
  /** 1-based move index within the starting hand (default 1). */
  initialMoveIndex?: number;
  opponentLabel?: string;
}

const COACHING_RATINGS: MoveRating[] = ['Blunder', 'Mistake', 'Inaccuracy'];

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

function positiveNote(move: AnalyzedMove): string | null {
  if (move.rating === 'Brilliant') {
    return 'Brilliant find — you spotted the scoring line Fritz would have played.';
  }
  if (move.rating === 'Great') {
    return 'Strong choice — this matched the engine\'s top line.';
  }
  if (move.rating === 'Good') {
    return 'Solid play — you stayed close to the engine on this turn.';
  }
  return null;
}

export default function GameReviewer({
  open,
  onClose,
  analysis,
  title = 'Game Review',
  scopeHandNumber = null,
  initialMoveIndex = 1,
  opponentLabel = 'Fritz',
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

  const currentConsequence = current
    ? analysis?.consequenceByMoveNumber?.[current.moveNumber] ?? null
    : null;

  const sidebarCopy = useMemo(() => {
    if (!current || !COACHING_RATINGS.includes(current.rating)) return null;
    return buildReviewSidebarCopy({
      move: current,
      consequence: currentConsequence,
      opponentLabel,
    });
  }, [current, currentConsequence, opponentLabel]);

  const praiseCopy = current ? positiveNote(current) : null;
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
        <div className="gr-shell" onClick={(event) => event.stopPropagation()}>
          <div className="gr-main">
            <div className="gr-header">
              <div className="gr-heading">
                <h3 className="gr-title">{title}</h3>
                <span className="gr-evidence-label">
                  {evidence.displayLabel} · {evidence.confidence} confidence
                </span>
              </div>
              <button type="button" className="mode-inline-btn" onClick={onClose}>
                Close
              </button>
            </div>

            <div className="gr-board-cell">
            <div className="gr-board-frame">
              <div className="gr-board-layer">
                <Board
                  board={current?.boardRenderStateAfterMove ?? null}
                  legalMoves={[]}
                  selectedTile={null}
                  onPositionClick={() => {}}
                  fitMode="guided"
                  containFullBoard
                  tileSize={46}
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
                className="mode-inline-btn"
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
                className="mode-inline-btn"
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
              {moves.map((move, idx) => (
                <button
                  key={`${move.moveNumber}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={idx === cursor}
                  className={`gr-move-row is-${ratingClass(move.rating)}${idx === cursor ? ' is-active' : ''}`}
                  onClick={() => setCursor(idx)}
                >
                  <span className="gr-move-row-num">#{move.moveNumber}</span>
                  <span className="gr-move-row-played">{formatPlayedLabel(move)}</span>
                  <span className={`gr-move-row-rating is-${ratingClass(move.rating)}`}>{move.rating}</span>
                </button>
              ))}
            </div>

            <div className={`gr-coaching${sidebarCopy ? ' is-prominent' : ''}`}>
              <div className="gr-coaching-body">
              {sidebarCopy ? (
                <>
                  <div className="gr-advice-section">
                    <span className="gr-advice-kicker">What you should have played</span>
                    <p className="gr-advice-copy">{sidebarCopy.shouldHavePlayed}</p>
                  </div>
                  {sidebarCopy.whyBetter ? (
                    <div className="gr-advice-section">
                      <span className="gr-advice-kicker">Why it was better</span>
                      <p className="gr-advice-copy">{sidebarCopy.whyBetter}</p>
                    </div>
                  ) : null}
                  {sidebarCopy.whatHappenedInstead ? (
                    <div className="gr-advice-section">
                      <span className="gr-advice-kicker">What {opponentLabel} did instead</span>
                      <p className="gr-advice-copy gr-advice-consequence">{sidebarCopy.whatHappenedInstead}</p>
                    </div>
                  ) : null}
                  <div className="gr-advice-section">
                    <span className="gr-advice-kicker">What to remember</span>
                    <p className="gr-advice-copy gr-advice-takeaway">{sidebarCopy.takeaway}</p>
                  </div>
                </>
              ) : praiseCopy ? (
                <p className="gr-coaching-praise">{praiseCopy}</p>
              ) : current ? (
                <p className="gr-coaching-muted">Select a blunder or mistake to see coaching.</p>
              ) : (
                <p className="gr-coaching-muted">Select a move to review.</p>
              )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
