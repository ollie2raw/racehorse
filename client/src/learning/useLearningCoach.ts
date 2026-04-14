/**
 * learning/useLearningCoach.ts
 *
 * Phase 4 — React hook that drives the coaching system for a live game.
 *
 * Responsibilities:
 *   - Compute pre-move recommendation on each render (memoised)
 *   - Record each player move and build a post-move feedback packet
 *   - Accumulate HandMoveRecord[] for the end-of-hand recap
 *   - Build HandLearningSummary when the hand ends
 *   - Update and persist the LearningProfile to localStorage
 *
 * Design rules:
 *   - All learning-engine calls are wrapped in try/catch — never crash the game.
 *   - State is reset at the start of each new hand.
 *   - Side effects (storage) are always fire-and-forget; no blocking awaits.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { Move } from '../types.ts';
import type { BotMatchState } from '../bot/botEngine.ts';
import type { PlayerLevel, LearnGameMode } from './types.ts';
import { DEFAULT_THRESHOLD_CONFIG } from './types.ts';
import {
  buildMoveEvaluationResult,
  type MoveEvaluationResult,
} from './moveAnalysis.ts';
import {
  buildCoachingFeedback,
  buildPreMoveRecommendation,
  type CoachingFeedbackPacket,
  type PreMoveRecommendation,
} from './coachMessaging.ts';
import type { HandMoveRecord } from './handSummary.ts';
import { buildHandSummary } from './buildHandSummary.ts';
import type { HandLearningSummary } from './handSummary.ts';
import { loadProfile, saveProfile, updateProfile } from './learningStore.ts';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface LearningCoachApi {
  /** Pre-move recommendation — non-null when it's the player's turn */
  preMoveRec:       PreMoveRecommendation | null;

  /**
   * Full pre-move evaluation result.
   * Exposed for the dev debug panel; UI should use preMoveRec instead.
   */
  preMoveEval:      MoveEvaluationResult | null;

  /**
   * Full evaluation result for the most recent player move.
   * Populated by recordPlayerMove; null before first move or after resetHand.
   * Exposed for the dev debug panel — shows the exact eval used for post-move feedback.
   */
  postMoveEval:     MoveEvaluationResult | null;

  /** Post-move coaching packet — set immediately after player commits a move */
  postMoveFeedback: CoachingFeedbackPacket | null;

  /**
   * Accumulated move records for this hand.
   * Exposed so the handReveal overlay can show per-move grades if desired.
   */
  handMoveRecords:  HandMoveRecord[];

  /**
   * End-of-hand summary.
   * Non-null from the moment the hand ends until resetHand() is called.
   */
  handSummary:      HandLearningSummary | null;

  /**
   * Record the player's move BEFORE calling applyPlayMove.
   * Pass the pre-move match state and the committed move.
   */
  recordPlayerMove: (stateBefore: BotMatchState, move: Move) => void;

  /**
   * Build the hand summary from accumulated records.
   * Call when handReveal becomes non-null.
   */
  buildSummary: (
    handScore:      number,
    cumulativeScore: number,
    playerWonHand:  boolean,
  ) => void;

  /** Reset all per-hand state. Call when a new hand begins. */
  resetHand: () => void;

  /** Dismiss post-move feedback (e.g. when bot's turn starts). */
  dismissFeedback: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLearningCoach(opts: {
  isGuidedMode: boolean;
  match:        BotMatchState;
  playerLevel:  PlayerLevel;
  gameMode:     LearnGameMode;
}): LearningCoachApi {
  const { isGuidedMode, match, playerLevel, gameMode } = opts;

  // ── Per-hand state ────────────────────────────────────────────────────────
  const [postMoveFeedback, setPostMoveFeedback] = useState<CoachingFeedbackPacket | null>(null);
  const [postMoveEval,     setPostMoveEval]     = useState<MoveEvaluationResult | null>(null);
  const [handMoveRecords,  setHandMoveRecords]  = useState<HandMoveRecord[]>([]);
  const [handSummary,      setHandSummary]      = useState<HandLearningSummary | null>(null);

  // Ref to avoid stale closure captures in callbacks
  const recordsRef = useRef<HandMoveRecord[]>([]);

  // ── Pre-move evaluation (recomputed on every state change) ────────────────
  const preMoveEval = useMemo((): MoveEvaluationResult | null => {
    if (!isGuidedMode) return null;
    if (match.currentPlayer !== 'you') return null;
    if (match.handOver || match.gameOver) return null;

    try {
      return buildMoveEvaluationResult({
        state:        match,
        playerMove:   undefined,
        thresholds:   DEFAULT_THRESHOLD_CONFIG,
        playerLevel,
      });
    } catch (e) {
      console.warn('[coach] pre-move eval failed:', e);
      return null;
    }
  }, [isGuidedMode, match, playerLevel]);

  const preMoveRec = useMemo((): PreMoveRecommendation | null => {
    if (!preMoveEval) return null;
    try {
      return buildPreMoveRecommendation(preMoveEval, playerLevel, gameMode);
    } catch (e) {
      console.warn('[coach] buildPreMoveRecommendation failed:', e);
      return null;
    }
  }, [preMoveEval, playerLevel, gameMode]);

  // ── recordPlayerMove ──────────────────────────────────────────────────────
  const recordPlayerMove = useCallback(
    (stateBefore: BotMatchState, move: Move) => {
      if (!isGuidedMode) return;
      try {
        const evalResult = buildMoveEvaluationResult({
          state:      stateBefore,
          playerMove: move,
          thresholds: DEFAULT_THRESHOLD_CONFIG,
          playerLevel,
        });

        const packet = buildCoachingFeedback({
          result:      evalResult,
          playerLevel,
          gameMode,
        });

        setPostMoveFeedback(packet);
        setPostMoveEval(evalResult);

        if (evalResult.chosenMove) {
          const record: HandMoveRecord = {
            turnIndex:             stateBefore.turnIndex ?? 0,
            chosenMove:            evalResult.chosenMove,
            recommendedMove:       evalResult.bestMove,
            category:              evalResult.chosenMove.category,
            immediatePointsMissed: Math.max(
              0,
              evalResult.bestMove.immediatePoints - evalResult.chosenMove.immediatePoints,
            ),
            conceptTags: packet.teachableMoments,
          };
          recordsRef.current = [...recordsRef.current, record];
          setHandMoveRecords(recordsRef.current);
        }
      } catch (e) {
        console.warn('[coach] recordPlayerMove failed:', e);
      }
    },
    [isGuidedMode, playerLevel, gameMode],
  );

  // ── buildSummary ──────────────────────────────────────────────────────────
  const buildSummary = useCallback(
    (handScore: number, cumulativeScore: number, playerWonHand: boolean) => {
      if (!isGuidedMode) return;
      const records = recordsRef.current;
      if (records.length === 0) return;

      try {
        const summary = buildHandSummary({
          moveRecords:    records,
          handScore,
          cumulativeScore,
          playerWonHand,
        });
        setHandSummary(summary);

        // Persist profile update (fire-and-forget)
        try {
          const profile    = loadProfile();
          const newProfile = updateProfile(
            profile,
            summary,
            gameMode,
            new Date().toISOString(),
          );
          saveProfile(newProfile);
        } catch (e) {
          console.warn('[coach] profile update failed:', e);
        }
      } catch (e) {
        console.warn('[coach] buildSummary failed:', e);
      }
    },
    [isGuidedMode, gameMode],
  );

  // ── resetHand ─────────────────────────────────────────────────────────────
  const resetHand = useCallback(() => {
    recordsRef.current = [];
    setHandMoveRecords([]);
    setHandSummary(null);
    setPostMoveFeedback(null);
    setPostMoveEval(null);
  }, []);

  // ── dismissFeedback ───────────────────────────────────────────────────────
  const dismissFeedback = useCallback(() => {
    setPostMoveFeedback(null);
  }, []);

  return {
    preMoveRec,
    preMoveEval,
    postMoveFeedback,
    postMoveEval,
    handMoveRecords,
    handSummary,
    recordPlayerMove,
    buildSummary,
    resetHand,
    dismissFeedback,
  };
}
