import { useEffect, useMemo, useState } from 'react';
import { Board, DominoTile } from '../components';
import type { GameAnalysis, MoveRating } from './moveAnalyzer';
import { sameTileTuple } from './moveLogger';

interface GameReviewerProps {
  open: boolean;
  onClose: () => void;
  analysis: GameAnalysis | null;
  title?: string;
}

function colorForRating(rating: MoveRating): string {
  if (rating === 'Brilliant') return '#00ff88';
  if (rating === 'Great') return '#67e8f9';
  if (rating === 'Good') return '#7dd3fc';
  if (rating === 'Inaccuracy') return '#ffcc00';
  if (rating === 'Mistake') return '#ffcc00';
  return '#ff3333';
}

function accuracyTier(accuracy: number): MoveRating {
  if (accuracy >= 96) return 'Brilliant';
  if (accuracy >= 88) return 'Great';
  if (accuracy >= 76) return 'Good';
  if (accuracy >= 64) return 'Inaccuracy';
  if (accuracy >= 46) return 'Mistake';
  return 'Blunder';
}

function tileText(tile?: [number, number]): string {
  if (!tile) return '—';
  return `${tile[0]}-${tile[1]}`;
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

export default function GameReviewer({
  open,
  onClose,
  analysis,
  title = 'Game Review',
}: GameReviewerProps) {
  const [cursor, setCursor] = useState(0);

  const moves = analysis?.analyzedMoves ?? [];
  const current = moves[cursor] ?? null;
  const reviewSessionKey = open ? String(analysis?.analyzedAt ?? '') : 'closed';
  const [trackedReviewSessionKey, setTrackedReviewSessionKey] = useState(reviewSessionKey);
  if (reviewSessionKey !== trackedReviewSessionKey) {
    setTrackedReviewSessionKey(reviewSessionKey);
    setCursor(0);
  }

  const summaryTier = useMemo(() => accuracyTier(analysis?.accuracy ?? 0), [analysis?.accuracy]);
  const brilliantGlow = (analysis?.accuracy ?? 0) > 95;

  const blunderPipDiff = useMemo(() => {
    if (!current || current.rating !== 'Blunder') return 0;
    const played = bestImmediatePoints(current.playedTile, current.boardEnds);
    const best = bestImmediatePoints(current.bestTile, current.boardEnds);
    return Math.max(0, best - played);
  }, [current]);

  const showGhostTile = Boolean(
    current &&
      current.action === 'place' &&
      current.engineBestMove?.tile &&
      (!sameTileTuple(current.playedTile, current.engineBestMove.tile) ||
        current.bestPosition !== current.engineBestMove.position),
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Game reviewer"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2100,
        background: 'rgba(6,10,18,0.8)',
        backdropFilter: 'blur(5px)',
        display: 'grid',
        padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1400px, calc(100vw - 24px))',
          height: 'calc(100dvh - 24px)',
          margin: '0 auto',
          borderRadius: 18,
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(10,16,27,0.97), rgba(8,12,22,0.99))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 380px',
        }}
      >
        <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', gap: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <button className="mode-inline-btn" onClick={onClose}>
              Close
            </button>
          </div>

          <div
            style={{
              position: 'relative',
              minHeight: 0,
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(9,16,29,0.8)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: 0.72,
                filter: 'saturate(0.9) brightness(0.9)',
                pointerEvents: 'none',
              }}
            >
              <Board
                board={current?.boardRenderState ?? null}
                legalMoves={[]}
                selectedTile={null}
                onPositionClick={() => {}}
              />
            </div>
            {showGhostTile && current?.engineBestMove?.tile && (
              <div
                style={{
                  position: 'absolute',
                  right: 16,
                  bottom: 16,
                  display: 'grid',
                  justifyItems: 'center',
                  gap: 6,
                  opacity: 0.55,
                }}
              >
                <DominoTile
                  tile={{ low: current.engineBestMove.tile[0], high: current.engineBestMove.tile[1] }}
                  size={48}
                  disabled
                />
                <span style={{ fontSize: '0.75rem', color: 'rgba(236,248,245,0.9)' }}>Ghost (Engine)</span>
              </div>
            )}
            {current && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 74,
                  display: 'grid',
                  justifyItems: 'center',
                  gap: 6,
                  pointerEvents: 'none',
                }}
              >
                <span style={{ fontSize: '0.7rem', opacity: 0.6, letterSpacing: '0.08em' }}>
                  YOUR HAND AT THIS TURN
                </span>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                  {current.handSnapshot.map((tile, idx) => (
                    <div
                      key={`review-hand-${idx}-${tile[0]}-${tile[1]}`}
                      style={{ margin: 4, flex: '0 0 auto' }}
                    >
                      <DominoTile
                        tile={{ low: tile[0], high: tile[1] }}
                        size={36}
                        disabled
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <button
              className="mode-inline-btn"
              onClick={() => setCursor((prev) => Math.max(0, prev - 1))}
              disabled={cursor <= 0}
            >
              {'<'}
            </button>
            <span style={{ color: 'rgba(223,236,244,0.9)' }}>
              {moves.length ? `Move ${cursor + 1} / ${moves.length}` : 'No moves'}
            </span>
            <button
              className="mode-inline-btn"
              onClick={() => setCursor((prev) => Math.min(moves.length - 1, prev + 1))}
              disabled={!moves.length || cursor >= moves.length - 1}
            >
              {'>'}
            </button>
          </div>
        </div>

        <aside
          style={{
            borderLeft: '1px solid rgba(255,255,255,0.12)',
            display: 'grid',
            gridTemplateRows: 'auto minmax(0, 1fr) auto',
            minHeight: 0,
            background: 'rgba(6, 12, 22, 0.8)',
          }}
        >
          <div style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.12)', display: 'grid', gap: 8 }}>
            <strong>Accuracy Meter</strong>
            <div
              style={{
                height: 8,
                borderRadius: 999,
                background: 'rgba(255,255,255,0.12)',
                overflow: 'hidden',
                boxShadow: brilliantGlow ? '0 0 0 1px rgba(0,255,136,0.35), 0 0 16px rgba(0,255,136,0.45)' : 'none',
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, analysis?.accuracy ?? 0))}%`,
                  height: '100%',
                  background: colorForRating(summaryTier),
                  transition: 'width 180ms ease',
                }}
              />
            </div>
            <div style={{ color: colorForRating(summaryTier), fontWeight: 700 }}>
              {(analysis?.accuracy ?? 0).toFixed(1)}% · {summaryTier}
            </div>
          </div>

          <div style={{ overflow: 'auto', padding: 10, display: 'grid', gap: 8 }}>
            {moves.length === 0 && (
              <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>No moves available to review.</p>
            )}
            {moves.map((move, idx) => (
              <button
                key={`${move.moveNumber}-${idx}`}
                onClick={() => setCursor(idx)}
                style={{
                  borderRadius: 10,
                  border: idx === cursor ? `1px solid ${colorForRating(move.rating)}88` : '1px solid rgba(255,255,255,0.12)',
                  background: idx === cursor ? 'rgba(18,34,52,0.78)' : 'rgba(10,20,34,0.62)',
                  color: 'inherit',
                  textAlign: 'left',
                  padding: '9px 10px',
                  cursor: 'pointer',
                  display: 'grid',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <strong>#{move.moveNumber}</strong>
                  <span style={{ color: colorForRating(move.rating), fontSize: '0.82rem', fontWeight: 700 }}>
                    {move.rating}
                  </span>
                </div>
                <span style={{ color: 'rgba(222,236,244,0.9)', fontSize: '0.9rem' }}>
                  {move.action === 'place' ? `Played ${tileText(move.playedTile)}` : move.action}
                </span>
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', padding: 12, display: 'grid', gap: 6 }}>
            <strong>Engine Advice</strong>
            <p style={{ margin: 0, color: 'rgba(223,236,244,0.9)', minHeight: 54 }}>
              {current
                ? current.explanation
                : 'Select a move to see engine guidance.'}
            </p>
            {current?.rating === 'Blunder' && blunderPipDiff > 0 && (
              <p style={{ margin: 0, color: '#ff9f9f', fontSize: '0.88rem' }}>
                You missed a +{blunderPipDiff} point play.
              </p>
            )}
            {current?.bestTile && (
              <p style={{ margin: 0, color: 'rgba(199,219,231,0.86)', fontSize: '0.88rem' }}>
                Best move: {tileText(current.bestTile)}
                {current.bestPosition ? ` at ${current.bestPosition}` : ''}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
