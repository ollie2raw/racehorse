/**
 * learning/types.ts
 *
 * All shared primitive types, enums, and configuration objects for the
 * Racehorse Learn Academy coaching engine.
 *
 * Nothing in this file imports from other learning/* modules —
 * every other module imports FROM here.
 */

// ---------------------------------------------------------------------------
// Player skill level — controls coaching verbosity and concept depth
// ---------------------------------------------------------------------------

export type PlayerLevel = 'beginner' | 'intermediate' | 'advanced';

// ---------------------------------------------------------------------------
// Game mode — controls how strict / forgiving the coach is
// ---------------------------------------------------------------------------

export type LearnGameMode =
  | 'guided'      // Default: suggestions allowed, never forced; low punishment
  | 'training'    // Every move graded; more detailed recap; no forced retry
  | 'challenge';  // Only best/excellent accepted; score based on accuracy

// ---------------------------------------------------------------------------
// Move quality tiers
// ---------------------------------------------------------------------------

export type MoveCategory = 'best' | 'excellent' | 'good' | 'dubious' | 'blunder';

// ---------------------------------------------------------------------------
// Coaching intensity — determines how much the coach interrupts
// ---------------------------------------------------------------------------

export type InterventionLevel = 'none' | 'light' | 'medium' | 'strong';

// ---------------------------------------------------------------------------
// Coaching reasons — the *why* behind a recommended or evaluated move
// ---------------------------------------------------------------------------

export type CoachingReason =
  | 'score_now'               // Scores points immediately
  | 'deny_return_score'       // Prevents opponent from scoring back
  | 'safest_play'             // Lowest risk option available
  | 'keep_board_flexible'     // Preserves multiple future options
  | 'preserve_scoring_numbers'// Keeps high-value pip numbers live on the board
  | 'avoid_opening_danger'    // Does not open an end the opponent profits from
  | 'protect_lead'            // Reduces volatility while ahead
  | 'create_comeback_pressure'// Increases scoring chances while behind
  | 'avoid_self_block'        // Does not strand tiles in your own hand
  | 'control_board_ends'      // Holds or shifts board-end pip values
  | 'simple_strong_move'      // Solid move without a single deeper reason
  | 'future_value';           // Sets up a stronger scoring turn next round

// ---------------------------------------------------------------------------
// Concept tags — broader strategic themes used in recaps and progress tracking
// ---------------------------------------------------------------------------

export type CoachingConceptTag =
  | 'scoring'
  | 'safety'
  | 'defense'
  | 'flexibility'
  | 'tempo'
  | 'board_control'
  | 'risk_management'
  | 'endgame';

// ---------------------------------------------------------------------------
// Risk flags — specific dangers attached to a move
// ---------------------------------------------------------------------------

export type RiskFlag =
  | 'gives_easy_score_back'   // Opponent can score immediately after this move
  | 'opens_dangerous_end'     // Creates an open end the opponent can exploit
  | 'reduces_future_options'  // Limits your own playable tiles next turn
  | 'self_blocks'             // Locks a pip value you need in your hand
  | 'high_variance'           // Outcome swing is large in either direction
  | 'misses_forcing_line';    // Skips a move that would have constrained opponent

// ---------------------------------------------------------------------------
// Configurable thresholds — tune with real playtesting; never hardcode
// ---------------------------------------------------------------------------

/**
 * All numeric deltas are expressed as engine-score units (the same scale
 * Master Fritz uses internally). Start conservative; tighten over time.
 */
export type LearningThresholdConfig = {
  /** Max score delta still considered "excellent" (near-best) */
  excellentDelta: number;

  /** Max score delta still considered "good" */
  goodDelta: number;

  /** Max score delta before a move becomes "dubious" */
  dubiousDelta: number;

  /** Score delta that triggers a "strong" intervention (blunder territory) */
  strongInterventionDelta: number;

  /**
   * When the gap between top-2 moves is this small, coaching tone softens —
   * the coach should not act like one move is obviously correct.
   */
  lowConfidenceBand: number;

  /**
   * How many immediate points must be missed for the coach to flag it
   * as a "missed score" (used for hand recap and profile tracking).
   */
  missedScoreSeverity: number;
};

/**
 * Calibrated defaults for the learning score scale used in Phase 2.
 *
 * Scale reference (from botHeuristics evaluateStrategicMove):
 *   immediateScore × 34   — dominates; 1 scoring unit (5 pts) = 34 scale pts
 *   strategic factors      — typically contribute ±5 to ±40 per move
 *
 * Threshold guidance:
 *   excellentDelta:            moves this close are effectively tied
 *   goodDelta:                 meaningful strategic miss but no score lost
 *   dubiousDelta:              approaching a missed half-scoring-unit
 *   strongInterventionDelta:   clear missed score (> 1 scoring unit gap)
 *   lowConfidenceBand:         top-2 gap this small → coach hedges tone
 *   missedScoreSeverity:       minimum immediate points to flag as "missed score"
 *
 * All values need live playtesting tuning — DO NOT treat as permanent.
 */
export const DEFAULT_THRESHOLD_CONFIG: LearningThresholdConfig = {
  excellentDelta: 6,
  goodDelta: 18,
  dubiousDelta: 34,
  strongInterventionDelta: 42,
  lowConfidenceBand: 6,
  missedScoreSeverity: 5,
};

// ---------------------------------------------------------------------------
// Concept score map — one entry per CoachingConceptTag
// Used by LearningProfile (defined in profileProgress.ts)
// ---------------------------------------------------------------------------

export type ConceptScoreMap = {
  [K in CoachingConceptTag]: number;
};

// ---------------------------------------------------------------------------
// Utility: a slim move identifier used across modules without importing
// the full engine types (keeps the learning layer loosely coupled)
// ---------------------------------------------------------------------------

export type LearningMoveId = string; // e.g. "3|4-left", "pass"
