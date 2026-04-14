/**
 * learning/LearningHandRecap.tsx
 *
 * End-of-hand learning recap card.
 * Injected into the handReveal overlay when isGuidedMode is true.
 *
 * Shows: 1 stat (accuracy bar), 1 key lesson, 1 encouragement line.
 * Optionally shows move breakdown pills when there were any non-best moves.
 */

import React from 'react';
import type { HandLearningSummary } from './handSummary.ts';
import './coach.css';

interface LearningHandRecapProps {
  summary: HandLearningSummary;
}

export default function LearningHandRecap({ summary }: LearningHandRecapProps) {
  const {
    moveAccuracy,
    bestMovesPlayed,
    excellentMovesPlayed,
    goodMovesPlayed,
    dubiousMovesPlayed,
    blundersPlayed,
    totalMoves,
    keyLesson,
    encouragement,
  } = summary;

  const pct = Math.round(moveAccuracy * 100);

  // Only show move pill breakdown when there are < 100% best/excellent
  const showPills = totalMoves > 0 && (goodMovesPlayed + dubiousMovesPlayed + blundersPlayed) > 0;

  return (
    <div className="learning-recap-card">
      <div className="recap-header">
        <span style={{ fontSize: '0.85rem' }}>📊</span>
        <span className="recap-label">This Hand</span>
      </div>

      {/* Accuracy stat */}
      {totalMoves > 0 && (
        <div className="recap-accuracy-row">
          <span className="recap-accuracy-value">{pct}%</span>
          <div style={{ flex: 1 }}>
            <div className="recap-accuracy-label">move accuracy</div>
            <div className="recap-accuracy-bar">
              <div
                className="recap-accuracy-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Move breakdown pills */}
      {showPills && (
        <div className="recap-move-pills">
          {bestMovesPlayed > 0 && (
            <span className="recap-move-pill recap-pill-best">
              {bestMovesPlayed} best
            </span>
          )}
          {excellentMovesPlayed > 0 && (
            <span className="recap-move-pill recap-pill-excellent">
              {excellentMovesPlayed} excellent
            </span>
          )}
          {goodMovesPlayed > 0 && (
            <span className="recap-move-pill recap-pill-good">
              {goodMovesPlayed} good
            </span>
          )}
          {dubiousMovesPlayed > 0 && (
            <span className="recap-move-pill recap-pill-dubious">
              {dubiousMovesPlayed} watch out
            </span>
          )}
          {blundersPlayed > 0 && (
            <span className="recap-move-pill recap-pill-blunder">
              {blundersPlayed} missed
            </span>
          )}
        </div>
      )}

      {/* Key lesson */}
      <p className="recap-lesson">{keyLesson}</p>

      {/* Encouragement */}
      <p className="recap-encouragement">{encouragement}</p>
    </div>
  );
}
