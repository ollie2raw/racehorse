/**
 * learning/CoachPanel.tsx
 *
 * Phase 4 — The in-game coaching overlay.
 *
 * Renders two states:
 *   PRE-MOVE  — recommendation card with "Play it" button
 *   POST-MOVE — feedback card with grade badge, headline, body, and "Why?" expander
 *
 * Design rules:
 *   - Same visual footprint as the old coach-tip-card (top-left of board area)
 *   - No new game logic — purely presentational
 *   - Dev debug info behind `debugMode` prop (hidden in production)
 *   - Never crashes the game; all rendering is defensive
 */

import { useState } from 'react';
import type { PreMoveRecommendation, CoachingFeedbackPacket } from './coachMessaging.ts';
import type { MoveEvaluationResult } from './moveAnalysis.ts';
import type { MoveCategory, InterventionLevel } from './types.ts';
import './coach.css';

// ---------------------------------------------------------------------------
// Grade badge helpers
// ---------------------------------------------------------------------------

const GRADE_LABEL: Record<MoveCategory, string> = {
  best:      'Best Play',
  excellent: 'Excellent',
  good:      'Good',
  dubious:   'Watch Out',
  blunder:   'Missed It',
};

const GRADE_CLASS: Record<MoveCategory, string> = {
  best:      'grade-best',
  excellent: 'grade-excellent',
  good:      'grade-good',
  dubious:   'grade-dubious',
  blunder:   'grade-blunder',
};

const INTERVENTION_CLASS: Record<InterventionLevel, string> = {
  none:   'panel-none',
  light:  'panel-light',
  medium: 'panel-medium',
  strong: 'panel-strong',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GradeBadge({ grade }: { grade: MoveCategory }) {
  return (
    <span className={`coach-grade-badge ${GRADE_CLASS[grade]}`}>
      {GRADE_LABEL[grade]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pre-move panel
// ---------------------------------------------------------------------------

interface PreMovePanelProps {
  rec:         PreMoveRecommendation;
  onPlayBest:  () => void;
  isOnlyPlay:  boolean;
}

function PreMovePanel({ rec, onPlayBest, isOnlyPlay }: PreMovePanelProps) {
  const tileLabel = (() => {
    const m = rec.suggestedMove.move;
    if (m.type !== 'play' || !m.tile) return null;
    return `[${m.tile.low}|${m.tile.high}]`;
  })();

  return (
    <div className="coach-panel coach-panel--pre-move">
      <div className="coach-panel-header">
        <span className="coach-icon" aria-hidden="true">🎓</span>
        <span className="coach-label">Coach</span>
        {rec.confidence >= 0.7 && (
          <span className="coach-confidence-pip high" title="High confidence" />
        )}
      </div>

      <p className="coach-prompt-text">{rec.promptText}</p>

      {tileLabel && (
        <div className="coach-tile-hint">
          <span className="coach-tile-badge">{tileLabel}</span>
          {rec.suggestedMove.move.position && (
            <span className="coach-tile-arrow">
              → {rec.suggestedMove.move.position}
            </span>
          )}
        </div>
      )}

      {!isOnlyPlay && (
        <button className="coach-play-btn" onClick={onPlayBest}>
          Play Best Move
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-move panel
// ---------------------------------------------------------------------------

interface PostMovePanelProps {
  packet:    CoachingFeedbackPacket;
  onDismiss: () => void;
}

function PostMovePanel({ packet, onDismiss }: PostMovePanelProps) {
  const [expanded, setExpanded] = useState(false);

  const {
    moveGrade,
    interventionLevel,
    coachHeadline,
    coachBodyShort,
    coachBodyLong,
    bestMoveLabel,
    teachableMoments,
  } = packet;

  // Silent moves (best play with no coaching needed) show only a brief flash
  const isSilent = !coachHeadline && !coachBodyShort;
  if (isSilent) return null;

  const panelClass = interventionLevel ? INTERVENTION_CLASS[interventionLevel] : 'panel-none';

  return (
    <div className={`coach-panel coach-panel--post-move ${panelClass}`}>
      <div className="coach-panel-header">
        <span className="coach-icon" aria-hidden="true">🎓</span>
        <span className="coach-label">Coach</span>
        {moveGrade && <GradeBadge grade={moveGrade} />}
        <button
          className="coach-dismiss-btn"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>

      {coachHeadline && (
        <p className="coach-headline">{coachHeadline}</p>
      )}

      {coachBodyShort && (
        <p className="coach-body-short">{coachBodyShort}</p>
      )}

      {bestMoveLabel && interventionLevel !== 'none' && (
        <div className="coach-best-label">
          Best: <span className="coach-best-move">{bestMoveLabel}</span>
        </div>
      )}

      {coachBodyLong && (
        <div className="coach-why-section">
          <button
            className="coach-why-btn"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Less ↑' : 'Why? ↓'}
          </button>
          {expanded && (
            <p className="coach-body-long">{coachBodyLong}</p>
          )}
        </div>
      )}

      {teachableMoments.length > 0 && (
        <div className="coach-concepts">
          {teachableMoments.map((tag) => (
            <span key={tag} className="coach-concept-chip">{tag.replace('_', ' ')}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dev debug panel
// ---------------------------------------------------------------------------

interface DebugPanelProps {
  eval:       MoveEvaluationResult | null;
  packet:     CoachingFeedbackPacket | null;
  phase:      'pre' | 'post' | 'idle';
  turnIndex?: number;
}

function DebugPanel({ eval: evalResult, packet, phase, turnIndex }: DebugPanelProps) {
  const [open, setOpen] = useState(false);
  if (!evalResult && !packet) return null;

  return (
    <div className="coach-debug-panel">
      <button className="coach-debug-toggle" onClick={() => setOpen((v) => !v)}>
        🔬 Coach Debug {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="coach-debug-body">
          {/* Header row */}
          <div>
            <b>turn:</b> {turnIndex ?? '?'}
            {' '}<b>phase:</b> {phase}
          </div>

          {evalResult && (
            <>
              {/* Position flags */}
              <div>
                <b>conf:</b> {evalResult.engineConfidence.toFixed(3)}
                {' '}<b>ambig:</b> {String(evalResult.isAmbiguousPosition)}
                {' '}<b>neitherScores:</b> {String(evalResult.neitherScores)}
              </div>

              {/* Best move — notation, pts, ends, reason */}
              <div>
                <b>best:</b> {evalResult.bestMove.moveNotation}
                {' '}<b>pts:</b> {evalResult.bestMove.immediatePoints}
                {' '}<b>ends:</b> [{evalResult.bestMove.resultingOpenEnds.join(',')}]
                {' '}<b>reason:</b> {evalResult.bestMove.primaryReason}
                {evalResult.bestMove.secondaryReason && (
                  <span> / {evalResult.bestMove.secondaryReason}</span>
                )}
              </div>

              {/* Chosen move — full analysis */}
              {evalResult.chosenMove ? (() => {
                const cm = evalResult.chosenMove!;
                // Read chaining/restriction features from the explanationShort
                // to avoid re-running analysis; use what's stored on the move object.
                // Note: features are not stored directly — debug signals come from the
                // MoveEvaluationResult. Additional per-move signals are shown below.
                return (
                  <div>
                    <b>chosen:</b> {cm.moveNotation}
                    {' '}<b>pts:</b> {cm.immediatePoints}
                    {' '}<b>ends:</b> [{cm.resultingOpenEnds.join(',')}]
                    {' '}[{cm.category}]
                    {' '}<b>Δ:</b> {cm.scoreDeltaFromBest.toFixed(1)}
                    {cm.isEquivalentToBest && (
                      <span style={{ color: 'var(--accent-teal)' }}> ≡EQUIV</span>
                    )}
                    {' '}<b>reason:</b> {cm.primaryReason}
                    {cm.secondaryReason && (
                      <span> / {cm.secondaryReason}</span>
                    )}
                    {cm.riskFlags.length > 0 && (
                      <div><b>risks:</b> {cm.riskFlags.join(', ')}</div>
                    )}
                    <div style={{ fontStyle: 'italic', fontSize: '0.85em', marginTop: 2 }}>
                      &ldquo;{cm.explanationShort}&rdquo;
                    </div>
                  </div>
                );
              })() : (
                <div><i>pre-move (no chosen move yet)</i></div>
              )}
            </>
          )}

          {/* Chaining + restriction signals for best and chosen moves */}
          {evalResult && (() => {
            const renderSignals = (label: string, mv: typeof evalResult.bestMove) => {
              const s = mv.debugSignals;
              return (
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 4, marginTop: 4 }}>
                  <b>{label} signals:</b>
                  <div>
                    <b>chain:</b>
                    {' '}continues={String(s.turnContinues)}
                    {' '}playable={s.remainingPlayableCount}
                    {' '}scoring={s.playerNextTurnScoringCount}
                    {' '}constraint={s.playerConstraintLevel}
                    {' '}coverage={s.playerEndCoverage}
                  </div>
                  <div>
                    <b>restrict:</b>
                    {' '}opp_plays={s.opponentResponseCount}
                    {' '}opp_scores={s.opponentScoringResponseCount}
                    {' '}opp_constraint={s.opponentConstraintLevel}
                    {' '}forced_def={s.opponentForcedDefensiveCount}
                  </div>
                  <div style={{ fontStyle: 'italic', fontSize: '0.85em' }}>
                    &ldquo;{mv.explanationShort}&rdquo;
                  </div>
                </div>
              );
            };

            return (
              <>
                {renderSignals('best', evalResult.bestMove)}
                {evalResult.chosenMove && evalResult.chosenMove.moveId !== evalResult.bestMove.moveId
                  ? renderSignals('chosen', evalResult.chosenMove)
                  : null
                }
              </>
            );
          })()}

          {/* Packet row */}
          {packet && (
            <div>
              <b>intervention:</b> {packet.interventionLevel}
              {' '}<b>confidence:</b> {packet.confidence.toFixed(2)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface CoachPanelProps {
  preMoveRec:       PreMoveRecommendation | null;
  preMoveEval:      MoveEvaluationResult | null;
  postMoveFeedback: CoachingFeedbackPacket | null;
  postMoveEval:     MoveEvaluationResult | null;
  onPlayBest:       () => void;
  onDismissFeedback: () => void;
  isOnlyPlay:       boolean;
  currentPlayer:    'you' | 'bot';
  turnIndex?:       number;
  debugMode?:       boolean;
}

export default function CoachPanel({
  preMoveRec,
  preMoveEval,
  postMoveFeedback,
  postMoveEval,
  onPlayBest,
  onDismissFeedback,
  isOnlyPlay,
  currentPlayer,
  turnIndex,
  debugMode = false,
}: CoachPanelProps) {
  // Post-move feedback takes priority
  if (postMoveFeedback) {
    return (
      <>
        <PostMovePanel
          packet={postMoveFeedback}
          onDismiss={onDismissFeedback}
        />
        {debugMode && (
          <div className="coach-debug-anchor">
            <DebugPanel
              eval={postMoveEval}
              packet={postMoveFeedback}
              phase="post"
              turnIndex={turnIndex}
            />
          </div>
        )}
      </>
    );
  }

  // Pre-move recommendation
  if (preMoveRec && currentPlayer === 'you') {
    return (
      <>
        <PreMovePanel
          rec={preMoveRec}
          onPlayBest={onPlayBest}
          isOnlyPlay={isOnlyPlay}
        />
        {debugMode && (
          <div className="coach-debug-anchor">
            <DebugPanel
              eval={preMoveEval}
              packet={null}
              phase="pre"
              turnIndex={turnIndex}
            />
          </div>
        )}
      </>
    );
  }

  // Bot's turn or idle — show nothing (or debug panel only)
  if (debugMode && (preMoveEval || postMoveEval)) {
    return (
      <div className="coach-debug-anchor">
        <DebugPanel
          eval={postMoveEval ?? preMoveEval}
          packet={null}
          phase="idle"
          turnIndex={turnIndex}
        />
      </div>
    );
  }

  return null;
}
