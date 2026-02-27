import { useMemo, useState } from 'react';
import type { GameAnalysis, MoveRating } from './moveAnalyzer';

interface AnalyzerModalProps {
  open: boolean;
  onClose: () => void;
  analysis: GameAnalysis | null;
  title?: string;
}

function colorForRating(rating: MoveRating): string {
  if (rating === 'Brilliant') return '#00ff88';
  if (rating === 'Great') return '#67e8f9';
  if (rating === 'Good') return '#73b7ff';
  if (rating === 'Inaccuracy') return '#ffcc00';
  if (rating === 'Mistake') return '#f0c46c';
  return '#ff7373';
}

function tileText(tile?: [number, number]): string {
  if (!tile) return '—';
  return `${tile[0]}|${tile[1]}`;
}

export default function AnalyzerModal({
  open,
  onClose,
  analysis,
  title = 'Move Analyzer',
}: AnalyzerModalProps) {
  const [expandedMove, setExpandedMove] = useState<number | null>(null);
  const header = useMemo(() => {
    if (!analysis) return { accuracy: 0, grade: 'D' as const };
    return { accuracy: analysis.accuracy, grade: analysis.grade };
  }, [analysis]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Move analyzer"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2100,
        background: 'rgba(6,10,18,0.72)',
        backdropFilter: 'blur(4px)',
        display: 'grid',
        placeItems: 'center',
        padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, calc(100vw - 24px))',
          maxHeight: 'calc(100dvh - 24px)',
          overflow: 'auto',
          borderRadius: 16,
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(18,26,39,0.94), rgba(9,15,26,0.98))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
          padding: 16,
          color: 'rgba(235,245,242,0.96)',
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <p style={{ margin: 0, color: 'rgba(223,236,244,0.82)' }}>
              Accuracy {header.accuracy}% · Grade {header.grade}
            </p>
          </div>
          <button className="mode-inline-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {!analysis || analysis.analyzedMoves.length === 0 ? (
          <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>
            No moves available to analyze yet.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {analysis.analyzedMoves.map((move) => {
              const expanded = expandedMove === move.moveNumber;
              return (
                <div
                  key={move.moveNumber}
                  style={{
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(12,20,34,0.66)',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => setExpandedMove((prev) => (prev === move.moveNumber ? null : move.moveNumber))}
                    style={{
                      width: '100%',
                      border: 0,
                      background: 'transparent',
                      color: 'inherit',
                      cursor: 'pointer',
                      textAlign: 'left',
                      padding: '10px 12px',
                      display: 'grid',
                      gridTemplateColumns: '80px minmax(0, 1fr) auto',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <strong>#{move.moveNumber}</strong>
                    <span>
                      {move.action === 'place' ? `Played ${tileText(move.playedTile)}` : move.action}
                    </span>
                    <span
                      style={{
                        color: colorForRating(move.rating),
                        border: `1px solid ${colorForRating(move.rating)}66`,
                        borderRadius: 999,
                        padding: '3px 9px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {move.rating}
                    </span>
                  </button>

                  <div style={{ padding: '0 12px 10px', color: 'rgba(223,236,244,0.84)' }}>
                    {move.explanation}
                  </div>

                  {expanded && (
                    <div
                      style={{
                        borderTop: '1px solid rgba(255,255,255,0.12)',
                        padding: '10px 12px 12px',
                        display: 'grid',
                        gap: 6,
                        color: 'rgba(223,236,244,0.88)',
                        fontSize: '0.9rem',
                      }}
                    >
                      <div>Board Ends: {move.boardEnds[0]} · {move.boardEnds[1]}</div>
                      <div>Played: {tileText(move.playedTile)}</div>
                      <div>Best: {tileText(move.bestTile)}</div>
                      {move.bestBreakdown && (
                        <>
                          <div
                            style={{
                              fontSize: '0.78rem',
                              color: 'rgba(180,200,220,0.6)',
                              marginBottom: 4,
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                            }}
                          >
                            Fritz&apos;s evaluation of best move:
                          </div>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(2, 1fr)',
                              gap: '4px 16px',
                              padding: '6px 8px',
                              background: 'rgba(255,255,255,0.04)',
                              borderRadius: 6,
                              fontSize: '0.82rem',
                              color: 'rgba(200,220,235,0.75)',
                            }}
                          >
                            <span>
                              🎯 Scored:{' '}
                              {move.bestBreakdown.immediate > 0
                                ? `${move.bestBreakdown.immediate} pt${
                                    move.bestBreakdown.immediate !== 1 ? 's' : ''
                                  }`
                                : 'No points'}
                            </span>
                            <span>🤚 Tiles kept playable: {move.bestBreakdown.mobility}</span>
                            <span>
                              🛡 Board control:{' '}
                              {move.bestBreakdown.denial > -10
                                ? 'Strong'
                                : move.bestBreakdown.denial > -20
                                  ? 'Moderate'
                                  : 'Weak'}
                            </span>
                            <span>⚖️ Pips shed: {move.bestBreakdown.unload}</span>
                            <span>
                              ⚠️ Reply risk:{' '}
                              {move.bestBreakdown.replyRisk < 3
                                ? 'Low'
                                : move.bestBreakdown.replyRisk < 7
                                  ? 'Medium'
                                  : 'High'}
                            </span>
                            {move.bestBreakdown.doubleBias > 0 && <span>🎲 Double play</span>}
                          </div>
                        </>
                      )}
                      <div>Hand: {move.handBefore.length ? move.handBefore.map(tileText).join('  ') : '—'}</div>
                      <div>Valid: {move.validMoves.length ? move.validMoves.map(tileText).join('  ') : '—'}</div>
                      <div>Score: {move.score}/100</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
