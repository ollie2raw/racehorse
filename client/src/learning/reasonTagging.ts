/**
 * learning/reasonTagging.ts
 *
 * Phase 2 implementation: move feature extraction, reason tagging, and
 * human-readable explanation generation.
 *
 * Public surface:
 *   extractBoardContext(state)               → BoardContext
 *   extractMoveFeatures(move, ctx, state, preview) → MoveFeatures
 *   tagMove(input)                           → ReasonTaggingOutput
 *   REASON_TO_CONCEPT                        → ReasonToConceptMap
 *
 * All functions are pure: (input) → output, no side effects.
 * Called by moveAnalysis.ts to populate LearningMoveAnalysis records.
 */

import type {
  CoachingReason,
  CoachingConceptTag,
  RiskFlag,
  PlayerLevel,
  MoveCategory,
} from './types.ts';
import type { Move, Tile } from '../types.ts';
import type { BotMatchState, BotMovePreview } from '../bot/botEngine.ts';
// The (reason, features, level) → prose layer moved to its own file
// (REFACTOR_OPPORTUNITIES R4); re-exported here so the public surface is unchanged.
import { generateLongExplanation, generateShortExplanation } from './reasonExplanations.ts';

export { generateLongExplanation, generateShortExplanation } from './reasonExplanations.ts';

// ─── Phase 3: Constraint gradient type ───────────────────────────────────────

/**
 * Gradient classification of a player's (or opponent's) constraint level
 * after a move is played.
 *
 *   free:        ≥3 playable tiles — flexible, multiple follow-up options
 *   limited:     1–2 playable tiles — can still play but options are narrow
 *   constrained: 0 playable tiles + boneyard available — must draw, may recover
 *   blocked:     0 playable tiles + boneyard empty/≤2 — genuinely stuck
 */
export type ConstraintLevel = 'free' | 'limited' | 'constrained' | 'blocked';

// ─── Phase 1 types (unchanged) ───────────────────────────────────────────────

/**
 * A lightweight, tagging-friendly summary of the board position.
 * Decouples the tagging logic from the full BotMatchState shape.
 */
export type BoardContext = {
  leftEnd: number;
  rightEnd: number;
  leftEndIsDouble: boolean;
  rightEndIsDouble: boolean;
  playerHandSize: number;
  opponentHandSize: number;
  opponentKnownMissing: number[];
  boneyardSize: number;
  playerScore: number;
  opponentScore: number;
  winningScore: number;
  handNumber: number;
};

/**
 * Features extracted for a single candidate move.
 * Computed from the move + board context; feeds reason tagging logic.
 *
 * Signals are grouped by the concept they measure:
 *   IMMEDIATE:   immediateScore
 *   CHAINING:    turnContinues, remainingPlayableCount, playerNextTurnScoringCount,
 *                likelyForcedDraw, branchingFactor
 *   RESTRICTION: opponentResponseCount, opponentScoringResponseCount,
 *                reducesScoringFlexibility, opensEndDangerLevel
 *   LEGACY:      opponentReturnScore (estimated; kept for risk-flag thresholds)
 *   STRUCTURE:   resultingOpenEnds, scorePosition, causesHandBlock
 */
export type MoveFeatures = {
  // ── Immediate outcome ────────────────────────────────────────────────────────
  immediateScore: number;

  // ── Chaining signals (can the player continue playing?) ─────────────────────
  /**
   * True when this move immediately continues the player's turn.
   * In Racehorse dominoes, scoring a point OR playing a double keeps your turn.
   * This is the most reliable single indicator of chaining potential.
   */
  turnContinues: boolean;

  /**
   * Number of tiles remaining in the player's hand that can legally play
   * on the resulting open ends. Higher = better chaining position.
   * Does NOT count tiles that would score — see playerNextTurnScoringCount.
   */
  remainingPlayableCount: number;

  /**
   * Number of remaining hand tiles that would score immediately if played
   * on the resulting open ends. A direct measure of future scoring potential.
   */
  playerNextTurnScoringCount: number;

  /**
   * Gradient constraint classification for the player after this move.
   * Replaces the binary likelyForcedDraw with a richer signal:
   *   free:        ≥3 playable tiles
   *   limited:     1–2 playable tiles
   *   constrained: 0 playable + boneyard available (can draw)
   *   blocked:     0 playable + boneyard depleted (genuinely stuck)
   */
  playerConstraintLevel: ConstraintLevel;

  /**
   * Number of distinct open ends on the board that at least one of the
   * player's remaining tiles can connect to. More precise than raw open-end
   * count or raw playable-tile count — measures actual coverage diversity.
   */
  playerEndCoverage: number;

  // ── Board restriction signals (opponent constraint) ──────────────────────────
  /**
   * Number of tiles in the opponent's actual hand that can legally play
   * on the resulting open ends. Low values mean the opponent is constrained.
   * Unlike opponentReturnScore, this is exact (based on known opponent hand).
   */
  opponentResponseCount: number;

  /**
   * Number of tiles in the opponent's hand that would score immediately
   * if played on the resulting open ends.
   * Zero = opponent cannot score next turn (strong restriction).
   */
  opponentScoringResponseCount: number;

  /**
   * Gradient constraint classification for the opponent after this move.
   * Mirrors playerConstraintLevel — low values signal strong board restriction.
   */
  opponentConstraintLevel: ConstraintLevel;

  /**
   * Number of opponent tiles that, if played, would set up the player to score
   * on their next turn. These are "forced defensive" plays — the opponent
   * must make a move that inadvertently helps the player.
   * High values mean the opponent has no safe responses.
   */
  opponentForcedDefensiveCount: number;

  // ── Legacy / derived restriction signals ─────────────────────────────────────
  /**
   * Estimated maximum opponent return score from pip-matching analysis.
   * Conservative over-estimate — kept for backward compat with risk flags.
   * Prefer opponentScoringResponseCount for logical decisions.
   */
  opponentReturnScore: number;

  /** Classified danger level from opponentReturnScore (safe / neutral / dangerous) */
  opensEndDangerLevel: 'safe' | 'neutral' | 'dangerous';

  /** True when this move costs the player at least one future scoring opportunity */
  reducesScoringFlexibility: boolean;

  // ── Structural / positional ──────────────────────────────────────────────────
  /** True when all remaining player tiles are unplayable (severe chaining failure) */
  causesHandBlock: boolean;

  /** Player's score position relative to the opponent */
  scorePosition: 'ahead' | 'even' | 'behind';

  /**
   * Pip values on the open ends after this move is played.
   * Used for equivalence detection: two moves with the same resulting open
   * ends and the same immediate points are strategically equivalent.
   */
  resultingOpenEnds: number[];
};

export type ReasonTaggingInput = {
  move: Move;
  category: MoveCategory;
  features: MoveFeatures;
  boardContext: BoardContext;
  playerLevel: PlayerLevel;
  /**
   * True when the rank-1 move in this position also scores 0 pts.
   * Used to soften explanation language — strategic differences in no-score
   * positions should not be framed as obvious mistakes.
   */
  neitherScores?: boolean;
  /**
   * True when this move results in the same open ends and immediate points
   * as the rank-1 move. Coaching must not invent strategic distinctions
   * between moves that produce the same effective board state.
   * When true, explanationShort is replaced with a neutral "solid play" line.
   */
  isEquivalentToBest?: boolean;
};

export type ReasonTaggingOutput = {
  primaryReason: CoachingReason;
  secondaryReason?: CoachingReason;
  conceptTags: CoachingConceptTag[];
  riskFlags: RiskFlag[];
  explanationShort: string;
  explanationLong?: string;
};

export type ReasonToConceptMap = {
  [K in CoachingReason]: CoachingConceptTag[];
};

/** Signature of the function that extracts a BoardContext from BotMatchState */
export type BoardContextExtractor = (state: BotMatchState) => BoardContext;

/** Signature of the function that extracts MoveFeatures for one candidate move */
export type MoveFeaturesExtractor = (
  move: Move,
  boardContext: BoardContext,
  state: BotMatchState,
  preview: BotMovePreview,
) => MoveFeatures;

// ─── Phase 2: Reason-to-concept mapping ──────────────────────────────────────

/**
 * Declares which CoachingConceptTag(s) best describe each CoachingReason.
 * Used by the hand recap and profile layers to bucket moves by concept
 * without re-running the full tagging pipeline.
 */
export const REASON_TO_CONCEPT: ReasonToConceptMap = {
  score_now:               ['scoring'],
  deny_return_score:       ['defense', 'scoring'],
  safest_play:             ['safety', 'risk_management'],
  keep_board_flexible:     ['flexibility', 'board_control'],
  preserve_scoring_numbers:['scoring', 'flexibility'],
  avoid_opening_danger:    ['safety', 'defense'],
  protect_lead:            ['risk_management', 'safety'],
  create_comeback_pressure:['scoring', 'tempo'],
  avoid_self_block:        ['flexibility', 'board_control'],
  control_board_ends:      ['board_control', 'tempo'],
  simple_strong_move:      ['scoring'],
  future_value:            ['flexibility', 'tempo'],
};

// ─── Phase 2: Board context extraction ───────────────────────────────────────

/**
 * Extracts a lightweight BoardContext from a full BotMatchState.
 * The context is all the tagging layer needs — no raw BotMatchState leaks further.
 */
export function extractBoardContext(state: BotMatchState): BoardContext {
  return {
    leftEnd:               state.board?.leftEnd ?? -1,
    rightEnd:              state.board?.rightEnd ?? -1,
    leftEndIsDouble:       state.board?.leftEndIsDouble ?? false,
    rightEndIsDouble:      state.board?.rightEndIsDouble ?? false,
    playerHandSize:        state.players.you.hand.length,
    opponentHandSize:      state.players.bot.hand.length,
    opponentKnownMissing:  state.opponentKnownMissing ?? [],
    boneyardSize:          state.boneyard.length,
    playerScore:           state.players.you.score,
    opponentScore:         state.players.bot.score,
    winningScore:          state.winningScore,
    handNumber:            state.handNumber,
  };
}

// ─── Phase 2: Opponent return score estimation ────────────────────────────────

/**
 * Estimates the maximum immediate score the opponent could capture on
 * their very next turn, given the resulting open ends after our move.
 *
 * Returns the score in scoring-unit terms (0 = 0pts, 1 = 5pts, 2 = 10pts, …).
 * We cannot know the opponent's exact hand, so we use two approaches:
 *   1. Known missing pips (from game inference) are excluded.
 *   2. For each remaining open end, we check whether ANY pip value (0–6)
 *      that the opponent might hold would create a scoring sum there.
 *
 * This is intentionally conservative — it flags threats, not guarantees.
 */
function estimateOpponentReturnScore(
  openEnds: number[],
  openSum: number,
  knownMissing: number[],
): number {
  if (openEnds.length === 0 || openSum === 0) return 0;

  const missingSet = new Set(knownMissing);
  let maxReturnScore = 0;

  for (const end of openEnds) {
    // Skip ends where we KNOW the opponent cannot match
    if (missingSet.has(end)) continue;

    // Playing a double on this end: sum stays the same
    if (openSum % 5 === 0) {
      maxReturnScore = Math.max(maxReturnScore, openSum / 5);
    }

    // Playing a non-double tile matching this end: the new exposed pip
    // replaces `end` in the total open-ends sum
    for (let pip = 0; pip <= 6; pip++) {
      if (pip === end) continue; // Already handled as double above
      const newSum = openSum - end + pip;
      if (newSum > 0 && newSum % 5 === 0) {
        maxReturnScore = Math.max(maxReturnScore, newSum / 5);
        break; // Best case for this end found; move to next end
      }
    }
  }

  return maxReturnScore;
}

// ─── Phase 2: End danger classification ──────────────────────────────────────

/**
 * Classifies how dangerous the resulting board state is for the opponent
 * to score on immediately.
 *
 *   dangerous: opponent can realistically score 15+ pts back (≥3 units)
 *   neutral:   opponent might get some points back (1–2 units)
 *   safe:      no plausible immediate return score
 */
function computeEndDangerLevel(opponentReturnScore: number): 'safe' | 'neutral' | 'dangerous' {
  if (opponentReturnScore >= 3) return 'dangerous';
  if (opponentReturnScore >= 1) return 'neutral';
  return 'safe';
}

// ─── Phase 3: Constraint level helper ────────────────────────────────────────

/**
 * Classifies a player or opponent's constraint level after a move.
 *
 *   free:        ≥3 playable tiles — multiple follow-up paths
 *   limited:     1–2 playable tiles — options exist but are narrow
 *   constrained: 0 playable + boneyard available — forced draw, may recover
 *   blocked:     0 playable + boneyard depleted — genuinely stuck
 */
function computeConstraintLevel(playableCount: number, boneyardSize: number): ConstraintLevel {
  if (playableCount >= 3) return 'free';
  if (playableCount >= 1) return 'limited';
  if (boneyardSize > 2)  return 'constrained';
  return 'blocked';
}

// ─── Phase 3: Forced-defensive play detection ─────────────────────────────────

/**
 * Counts the number of opponent tiles that, if played on the resulting board,
 * would set the player up to score immediately on their following turn.
 * These are "forced defensive" plays — the opponent's best legal move still
 * inadvertently opens a scoring line for the player.
 *
 * Simulation: for each opponent tile playable on any open end, compute the
 * resulting open ends after that play, then check if the player's remaining
 * hand contains any scoring response.
 */
function countForcedDefensivePlays(
  opponentHand: Tile[],
  playerNextHand: Tile[],
  openEnds: number[],
  openSum: number,
): number {
  let count = 0;
  for (const tile of opponentHand) {
    let setsUpPlayer = false;
    for (const end of openEnds) {
      if (tile.high !== end && tile.low !== end) continue;

      let newOpenEnds: number[];
      let newOpenSum: number;

      if (tile.high === tile.low) {
        // Double: the end pip value is unchanged (double sits perpendicular)
        newOpenEnds = [...openEnds];
        newOpenSum = openSum;
      } else {
        const newPip = tile.high === end ? tile.low : tile.high;
        const idx = openEnds.indexOf(end);
        newOpenEnds = [...openEnds];
        if (idx >= 0) newOpenEnds[idx] = newPip;
        newOpenSum = openSum - end + newPip;
      }

      if (countScoringOpportunities(playerNextHand, newOpenEnds, newOpenSum) > 0) {
        setsUpPlayer = true;
        break; // One end is enough — count this tile once
      }
    }
    if (setsUpPlayer) count++;
  }
  return count;
}

// ─── Phase 2: Score position ──────────────────────────────────────────────────

/**
 * Determines whether the player is ahead, even, or behind on the scoreboard.
 * "Ahead" means 10+ points ahead in absolute terms, roughly one hand advantage.
 * Used to calibrate risk-averse vs. aggressive coaching language.
 */
function computeScorePosition(
  playerScore: number,
  opponentScore: number,
  _winningScore: number,
): 'ahead' | 'even' | 'behind' {
  const delta = playerScore - opponentScore;
  if (delta >= 10) return 'ahead';
  if (delta <= -10) return 'behind';
  return 'even';
}

// ─── Phase 2: Per-tile helpers ────────────────────────────────────────────────

/** Count tiles in hand that can play on at least one open end. */
function countPlayableTiles(hand: Tile[], openEnds: number[]): number {
  return hand.filter((tile) =>
    openEnds.some((end) => tile.high === end || tile.low === end),
  ).length;
}

/**
 * Count tiles in hand that COULD score if played (i.e. playing them on some
 * open end would produce a new open-ends sum divisible by 5).
 * Uses a conservative single-replacement estimate per tile.
 */
function countScoringOpportunities(hand: Tile[], openEnds: number[], openSum: number): number {
  let count = 0;
  for (const tile of hand) {
    let canScore = false;
    for (const end of openEnds) {
      if (tile.high !== end && tile.low !== end) continue;
      // The new exposed pip after playing this tile on `end`
      const newPip = tile.high === end ? tile.low : tile.high;
      const newSum = openSum - end + newPip;
      if (newSum > 0 && newSum % 5 === 0) {
        canScore = true;
        break;
      }
      // Also consider playing the double (same pip both sides)
      if (tile.high === tile.low && openSum % 5 === 0) {
        canScore = true;
        break;
      }
    }
    if (canScore) count++;
  }
  return count;
}

// ─── Phase 2: Move feature extraction ────────────────────────────────────────

/**
 * Extracts all MoveFeatures for one candidate move given the pre-move board
 * context and the BotMovePreview returned by the engine.
 *
 * The BotMovePreview (from previewPlayMove) contains:
 *   - immediateScore  — points scored by this move
 *   - turnContinues   — true when the player gets another turn (score or double)
 *   - nextHand        — player's remaining hand after the move
 *   - openEnds        — resulting board open-end pip values
 *   - openSum         — total open-ends pip sum after the move
 *   - nextBoard       — full board state after the move (not used here)
 *
 * The full BotMatchState provides access to the opponent hand (state.players.bot.hand)
 * which the coaching layer uses for exact opponent restriction analysis. This is
 * intentional — the coach has full information for teaching purposes, unlike the
 * game engine which must operate under information hiding.
 */
export function extractMoveFeatures(
  _move: Move,
  boardContext: BoardContext,
  state: BotMatchState,
  preview: BotMovePreview,
): MoveFeatures {
  const { openEnds, openSum, immediateScore, nextHand, turnContinues } = preview;
  const currentOpenEnds = boardContext.leftEnd >= 0
    ? [boardContext.leftEnd, boardContext.rightEnd]
    : [];

  // ── Legacy: estimated opponent return score ───────────────────────────────
  // Kept for risk-flag thresholds (gives_easy_score_back, opensEndDangerLevel).
  // This is a conservative over-estimate — it checks all possible pips, not just
  // what the opponent actually holds.
  const opponentReturnScore = estimateOpponentReturnScore(
    openEnds,
    openSum,
    boardContext.opponentKnownMissing,
  );
  const opensEndDangerLevel = computeEndDangerLevel(opponentReturnScore);

  // ── Score position ────────────────────────────────────────────────────────
  const scorePosition = computeScorePosition(
    boardContext.playerScore,
    boardContext.opponentScore,
    boardContext.winningScore,
  );

  // ── Chaining signals ──────────────────────────────────────────────────────
  // How many of the player's remaining tiles can be legally played
  const remainingPlayableCount = countPlayableTiles(nextHand, openEnds);

  // Player's tiles that would score immediately on the resulting ends
  const playerNextTurnScoringCount = countScoringOpportunities(nextHand, openEnds, openSum);

  // Hand block: tiles remain but none can be played — worst-case chaining failure
  const causesHandBlock = nextHand.length > 0 && remainingPlayableCount === 0;

  // Gradient constraint: how constrained is the player after this move?
  // Replaces binary likelyForcedDraw with a richer classification.
  const playerConstraintLevel = nextHand.length === 0
    ? 'free'  // no tiles left = hand empty, game constraint doesn't apply
    : computeConstraintLevel(remainingPlayableCount, state.boneyard.length);

  // Player end coverage: how many distinct open ends does the player's remaining
  // hand actually connect to? Truer diversity measure than raw playable-tile count.
  const playerEndCoverage = openEnds.filter(
    (end) => nextHand.some((t) => t.high === end || t.low === end),
  ).length;

  // ── Board restriction signals (exact, based on opponent's actual hand) ────
  // The coaching layer has full game state and can use the opponent's actual hand
  // for precise teaching — unlike the game engine which hides hands for fairness.
  const opponentHand = state.players.bot.hand;

  // Count of opponent tiles that can legally connect to any resulting open end
  const opponentResponseCount = countPlayableTiles(opponentHand, openEnds);

  // Count of opponent tiles that would score immediately if played now
  const opponentScoringResponseCount = countScoringOpportunities(
    opponentHand, openEnds, openSum,
  );

  // Gradient constraint level for the opponent — mirrors player signal
  const opponentConstraintLevel = computeConstraintLevel(
    opponentResponseCount, state.boneyard.length,
  );

  // Count of opponent tiles that, if played, would set the player up to score
  // next turn. These are "forced defensive" — no safe response exists.
  const opponentForcedDefensiveCount = countForcedDefensivePlays(
    opponentHand, nextHand, openEnds, openSum,
  );

  // ── Scoring flexibility (does the move cost future scoring chances?) ──────
  const scoringOpsBefore = currentOpenEnds.length > 0
    ? countScoringOpportunities(
        state.players.you.hand,
        currentOpenEnds,
        boardContext.leftEnd + boardContext.rightEnd,
      )
    : 0;
  const scoringOpsAfter = playerNextTurnScoringCount;
  // Reduced when the move costs at least one scoring opportunity net of the
  // hand shrinking by one tile (playing a tile naturally removes one option)
  const reducesScoringFlexibility =
    nextHand.length > 0 && scoringOpsAfter < scoringOpsBefore - 1;

  return {
    // Immediate
    immediateScore,
    // Chaining
    turnContinues,
    remainingPlayableCount,
    playerNextTurnScoringCount,
    playerConstraintLevel,
    playerEndCoverage,
    // Restriction
    opponentResponseCount,
    opponentScoringResponseCount,
    opponentConstraintLevel,
    opponentForcedDefensiveCount,
    // Legacy restriction
    opponentReturnScore,
    opensEndDangerLevel,
    reducesScoringFlexibility,
    // Structural
    causesHandBlock,
    scorePosition,
    resultingOpenEnds: [...openEnds],
  };
}

// ─── Phase 2: Primary reason determination ───────────────────────────────────

/**
 * Determines the single most important reason behind a move's quality.
 * Evaluated from a positive framing: "why would a strong player choose this?"
 *
 * Priority order (per Coach Truth Spec):
 *   1. Immediate score → score_now (Racehorse core rule; chaining added as secondary)
 *   2. Chaining — can the player continue playing?
 *      a. avoid_self_block: all tiles stranded (total chaining failure)
 *      b. control_board_ends: turn continues from a non-scoring double
 *      c. control_board_ends: high remaining playability (≥3 tiles stay live)
 *   3. Board restriction — does this constrain the opponent?
 *      a. deny_return_score: opponent has zero scoring responses (exact)
 *      b. keep_board_flexible: move reduces the player's future scoring options
 *      c. deny_return_score: estimated return score is zero and board is safe
 *   4. Safety fallback
 *   5. Score-position-specific reasoning
 *   6. Generic fallback
 *
 * Chaining signals used:
 *   turnContinues              — player immediately keeps their turn (double or score)
 *   remainingPlayableCount     — tiles still reachable after the move
 *   opponentScoringResponseCount — exact count of opponent tiles that would score
 *   opponentResponseCount      — exact count of opponent legal plays
 */
export function determinePrimaryReason(
  features: MoveFeatures,
  _category: MoveCategory,
): CoachingReason {
  const {
    immediateScore, opponentReturnScore, opensEndDangerLevel,
    scorePosition, remainingPlayableCount: _remainingPlayableCount, causesHandBlock,
    reducesScoringFlexibility, turnContinues,
    opponentScoringResponseCount, opponentConstraintLevel,
    playerConstraintLevel,
  } = features;

  // 1. Immediate scoring (Racehorse first rule: take points when available)
  //    The SECONDARY reason will add chaining/control context when relevant.
  if (immediateScore > 0) return 'score_now';

  // 2a. Chaining failure: all remaining tiles are stranded after this move
  //     This is the most critical warning — the player cannot continue playing.
  if (causesHandBlock) return 'avoid_self_block';

  // 2b. Non-scoring double that chains: the player keeps their turn without scoring.
  //     Turn continuation from a double is a significant positional advantage —
  //     the opponent never gets a response to this move.
  if (turnContinues && immediateScore === 0) {
    return 'control_board_ends';
  }

  // 2c. Strong chaining position: multiple tiles remain playable.
  //     Only lead with this when the move doesn't cost future scoring options.
  if (playerConstraintLevel === 'free' && !reducesScoringFlexibility) {
    return 'control_board_ends';
  }

  // 3a. Precise board restriction: opponent is completely blocked.
  //     'blocked' means zero playable tiles AND boneyard is depleted —
  //     the strongest possible restriction signal.
  if (opponentConstraintLevel === 'blocked') {
    return 'deny_return_score';
  }

  // 3b. Precise board restriction: opponent has zero tiles that would score.
  //     Uses the opponent's actual hand — not pip speculation.
  if (opponentScoringResponseCount === 0) {
    return 'deny_return_score';
  }

  // 3c. Flexibility concern: this move costs the player future scoring options.
  if (reducesScoringFlexibility) return 'keep_board_flexible';

  // 3d. Estimated restriction (legacy): board is genuinely quiet after this move.
  if (opponentReturnScore === 0 && opensEndDangerLevel === 'safe') {
    return 'deny_return_score';
  }

  // 4. Safety: the board is quiet and this is the lowest-risk path.
  if (opensEndDangerLevel === 'safe') return 'safest_play';

  // 5. Score-position framing.
  if (scorePosition === 'ahead' && opensEndDangerLevel !== 'dangerous') {
    return 'protect_lead';
  }
  if (scorePosition === 'behind' && !reducesScoringFlexibility) {
    return 'create_comeback_pressure';
  }

  // 6. Limited but nonzero playability: name the chaining context.
  if (playerConstraintLevel === 'limited') return 'control_board_ends';

  // 7. Generic fallback — solid move, no single dominant concept.
  return 'simple_strong_move';
}

// ─── Phase 2: Secondary reason determination ──────────────────────────────────

/**
 * Determines an optional secondary reason that adds depth without repeating
 * the primary. Only meaningful at intermediate/advanced player level.
 * Returns undefined if there is no distinct secondary insight.
 */
export function determineSecondaryReason(
  features: MoveFeatures,
  primaryReason: CoachingReason,
): CoachingReason | undefined {
  const {
    immediateScore, opponentReturnScore, remainingPlayableCount,
    reducesScoringFlexibility, opensEndDangerLevel,
    opponentScoringResponseCount, playerNextTurnScoringCount,
    turnContinues,
  } = features;

  switch (primaryReason) {
    case 'score_now':
      // Per spec: teach chaining first, then restriction, then risk.
      // Scoring move that also keeps you in a strong chain position — doubly good.
      if (remainingPlayableCount >= 3 && !reducesScoringFlexibility) return 'keep_board_flexible';
      // Scores and shuts out any opponent scoring reply (exact knowledge)
      if (opponentScoringResponseCount === 0) return 'deny_return_score';
      // Legacy: estimated return score also zero
      if (opponentReturnScore === 0) return 'deny_return_score';
      // Risk: the score is right but the resulting board is genuinely dangerous
      if (opensEndDangerLevel !== 'safe') return 'avoid_opening_danger';
      return undefined;

    case 'control_board_ends':
      // Good chaining position — does it also restrict the opponent?
      if (opponentScoringResponseCount === 0) return 'deny_return_score';
      // Does it also set up future scoring?
      if (playerNextTurnScoringCount >= 2) return 'preserve_scoring_numbers';
      // Does it also avoid giving the opponent a dangerous return?
      if (opensEndDangerLevel !== 'safe') return 'avoid_opening_danger';
      return undefined;

    case 'deny_return_score':
      // Board restriction + chaining: the best combination
      if (remainingPlayableCount >= 3 && !reducesScoringFlexibility)
        return 'keep_board_flexible';
      // Does it also set up future scoring for the player?
      if (playerNextTurnScoringCount >= 2) return 'preserve_scoring_numbers';
      return undefined;

    case 'safest_play':
      if (remainingPlayableCount >= 3) return 'keep_board_flexible';
      if (opponentScoringResponseCount === 0) return 'deny_return_score';
      return undefined;

    case 'protect_lead':
      if (opponentScoringResponseCount === 0) return 'deny_return_score';
      if (opponentReturnScore === 0) return 'deny_return_score';
      return undefined;

    case 'create_comeback_pressure':
      if (immediateScore > 0) return 'score_now';
      if (playerNextTurnScoringCount >= 2) return 'preserve_scoring_numbers';
      return undefined;

    case 'keep_board_flexible':
      if (opponentScoringResponseCount === 0) return 'deny_return_score';
      if (opponentReturnScore === 0) return 'safest_play';
      return undefined;

    case 'avoid_self_block':
      // Always flag the chaining problem; secondary shows what was better
      if (turnContinues) return 'control_board_ends';
      return undefined;

    default:
      return undefined;
  }
}

// ─── Phase 2: Concept tag builder ────────────────────────────────────────────

/**
 * Builds the list of CoachingConceptTag values most relevant to this move.
 * Deduplicates across primary and secondary reason mappings.
 */
export function buildConceptTags(
  features: MoveFeatures,
  primaryReason: CoachingReason,
  secondaryReason?: CoachingReason,
): CoachingConceptTag[] {
  const seen = new Set<CoachingConceptTag>();
  const tags: CoachingConceptTag[] = [];

  const addAll = (concepts: CoachingConceptTag[]) => {
    for (const c of concepts) {
      if (!seen.has(c)) { seen.add(c); tags.push(c); }
    }
  };

  addAll(REASON_TO_CONCEPT[primaryReason]);
  if (secondaryReason) addAll(REASON_TO_CONCEPT[secondaryReason]);

  // Always tag 'risk_management' when the end danger level is non-trivial
  if (features.opensEndDangerLevel !== 'safe' && !seen.has('risk_management')) {
    seen.add('risk_management');
    tags.push('risk_management');
  }

  // Tag 'endgame' in late-hand situations (boneyard ~empty, small hands)
  // The caller can inject this via boardContext if needed in future; skip for now

  return tags;
}

// ─── Phase 2: Risk flag builder ───────────────────────────────────────────────

/**
 * Identifies specific risks associated with this move.
 * These appear in the debug panel and drive "Why?" long explanations.
 * A move CAN have risk flags even if it is the top-ranked move (acknowledging
 * that all options have trade-offs in some positions).
 *
 * Scoring-aware threshold for gives_easy_score_back:
 *   - If this move scores immediately (immediateScore > 0), flag whenever the
 *     opponent can score back ANY amount (>= 1 unit). Even giving back 5 pts
 *     on a 5-pt gain is a meaningful trade-off the learner should see.
 *   - If this move does not score, flag only when the opponent can score big
 *     (>= 3 units), since small return threats are normal in non-scoring play.
 */
export function buildRiskFlags(features: MoveFeatures): RiskFlag[] {
  const flags: RiskFlag[] = [];

  // Raise the threshold for scoring moves: 1 unit of theoretical return is normal
  // in dominoes (the opponent can *always* theoretically find a matching pip). Flag
  // only when the return threat is genuinely material (≥2 units for scoring moves,
  // ≥3 units for non-scoring moves). This prevents the flag — and all downstream
  // copy that references it — from firing on virtually every scoring move.
  const givesBackThreshold = features.immediateScore > 0 ? 2 : 3;
  if (features.opponentReturnScore >= givesBackThreshold) {
    flags.push('gives_easy_score_back');
  }
  if (features.opensEndDangerLevel === 'dangerous') flags.push('opens_dangerous_end');
  if (features.causesHandBlock)                     flags.push('self_blocks');
  if (features.reducesScoringFlexibility)           flags.push('reduces_future_options');

  return flags;
}

// ─── Phase 2: Main tagging function (public) ─────────────────────────────────

/**
 * Produces the complete annotation for one move.
 * Called by moveAnalysis.ts for each candidate in the ranked list.
 *
 * Input comes from moveAnalysis.ts which has already:
 *   - Extracted MoveFeatures via extractMoveFeatures()
 *   - Assigned a MoveCategory via classifyMoveByDelta()
 */
export function tagMove(input: ReasonTaggingInput): ReasonTaggingOutput {
  const {
    features, category, playerLevel,
    neitherScores = false,
    isEquivalentToBest = false,
  } = input;

  const primaryReason   = determinePrimaryReason(features, category);
  const secondaryReason = determineSecondaryReason(features, primaryReason);
  const conceptTags     = buildConceptTags(features, primaryReason, secondaryReason);
  const riskFlags       = buildRiskFlags(features);

  // When this move is structurally equivalent to the best move (same open ends,
  // same immediate points), the explanation must be neutral — do not generate
  // copy that invents a strategic distinction the engine cannot actually see.
  const explanationShort = generateShortExplanation(
    primaryReason, features, playerLevel, neitherScores, isEquivalentToBest,
  );
  // Long explanations are never generated for equivalent moves — there is no
  // genuine depth to expand on when the board state is effectively the same.
  const explanationLong = isEquivalentToBest
    ? undefined
    : generateLongExplanation(primaryReason, secondaryReason, features, playerLevel, neitherScores);

  return {
    primaryReason,
    secondaryReason,
    conceptTags,
    riskFlags,
    explanationShort,
    explanationLong,
  };
}
