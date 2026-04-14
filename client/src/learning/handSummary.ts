/**
 * learning/handSummary.ts
 *
 * Types for the end-of-hand recap system.
 *
 * PHASE 1: Types and interfaces only. No implementation logic.
 *
 * Design rules (from spec):
 *  - Show 1 main lesson, 1 supporting stat, 1 encouraging line
 *  - No walls of text
 *  - Only surface 1–2 themes per recap
 *  - Improvement should feel tangible, not overwhelming
 *
 * How it fits in:
 *   Array<CoachingFeedbackPacket>  (one per player move this hand)
 *       ↓
 *   HandSummaryInput               ← defined here
 *       ↓  (Phase 5 implementation)
 *   HandLearningSummary            ← defined here
 *       ↓
 *   Recap card UI + profile update
 */

import type { CoachingConceptTag, MoveCategory } from './types';
import type { LearningMoveAnalysis } from './moveAnalysis';

// ---------------------------------------------------------------------------
// Move-level record collected during the hand
// ---------------------------------------------------------------------------

/**
 * Lightweight record of what happened on one player turn.
 * Accumulated throughout the hand; fed into the summary builder.
 */
export type HandMoveRecord = {
  /** Turn index within the hand (0-based) */
  turnIndex: number;

  /** What the player played */
  chosenMove: LearningMoveAnalysis;

  /** What the coach would have played (may be same as chosen) */
  recommendedMove: LearningMoveAnalysis;

  /** Grade assigned to the player's move */
  category: MoveCategory;

  /** Points the player could have scored but didn't (0 if none missed) */
  immediatePointsMissed: number;

  /** Concept tags surfaced during this turn */
  conceptTags: CoachingConceptTag[];
};

// ---------------------------------------------------------------------------
// Input to the hand summary builder
// ---------------------------------------------------------------------------

/**
 * Everything the Phase 5 summary builder needs to generate a
 * HandLearningSummary after a hand ends.
 */
export type HandSummaryInput = {
  /** All move records from this hand (player turns only) */
  moveRecords: HandMoveRecord[];

  /** Final hand score for the player (points awarded this hand) */
  handScore: number;

  /** Total cumulative game score after this hand */
  cumulativeScore: number;

  /** Whether the player won this hand */
  playerWonHand: boolean;
};

// ---------------------------------------------------------------------------
// End-of-hand summary output
// ---------------------------------------------------------------------------

/**
 * The structured recap generated after each hand.
 * Drives the recap card UI and is used to update the LearningProfile.
 *
 * Accuracy formula: (best + excellent moves) / total player moves
 */
export type HandLearningSummary = {
  /** Points scored by the player this hand */
  handScore: number;

  /**
   * Move accuracy as a 0–1 value.
   * 1.0 = every move was best or excellent.
   */
  moveAccuracy: number;

  // --- Move count breakdown ---
  bestMovesPlayed: number;
  excellentMovesPlayed: number;
  goodMovesPlayed: number;
  dubiousMovesPlayed: number;
  blundersPlayed: number;

  /** Total moves the player made this hand */
  totalMoves: number;

  /** Count of turns where the player missed an immediate score */
  missedScores: number;

  /**
   * Count of turns where the player made a defensive error
   * (opened a dangerous end, gave opponent a free score, etc.)
   */
  defensiveMistakes: number;

  /**
   * Count of turns where the player reduced their own future flexibility
   * without good reason.
   */
  flexibilityMistakes: number;

  /**
   * The concept the player performed best at this hand.
   * Used for positive reinforcement copy.
   */
  strongestConcept: CoachingConceptTag;

  /**
   * The concept the player struggled with most.
   * Drives the key lesson for this recap.
   */
  weakestConcept: CoachingConceptTag;

  /**
   * The single main teaching point for this hand.
   * E.g.: "Your biggest lesson today: avoid opening easy return scores."
   * One sentence max.
   */
  keyLesson: string;

  /**
   * Encouraging closing line.
   * E.g.: "Nice hand. Your safest moves were strong."
   * Always positive; never preachy.
   */
  encouragement: string;
};

// ---------------------------------------------------------------------------
// Concept performance snapshot (per-hand, feeds into profile)
// ---------------------------------------------------------------------------

/**
 * How well the player handled each concept THIS hand.
 * Values are 0–1 (proportion of relevant moves handled correctly).
 * Only concepts that were exercised this hand are included.
 */
export type HandConceptPerformance = Partial<{
  [K in CoachingConceptTag]: number;
}>;

// ---------------------------------------------------------------------------
// Recap display config — controls what the recap card shows
// ---------------------------------------------------------------------------

/**
 * Tells the recap card UI what to render and how.
 * Keeps display decisions out of the summary generator itself.
 */
export type RecapDisplayConfig = {
  /** Show the move accuracy percentage prominently */
  showAccuracy: boolean;

  /** Show per-concept breakdown (e.g. a small bar chart) */
  showConceptBreakdown: boolean;

  /**
   * Show a "Replay hand" button.
   * Intended for Training and Challenge modes; not Guided.
   */
  showReplayButton: boolean;

  /**
   * Show detailed move-by-move list with grades.
   * Only available in Training and Challenge modes.
   */
  showMoveList: boolean;
};
