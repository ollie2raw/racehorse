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
    scorePosition, remainingPlayableCount, causesHandBlock,
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

// ─── Phase 2: Short explanation templates ────────────────────────────────────

/**
 * One-sentence coaching line for each (reason, level) combination.
 * Used directly on the coach panel — always beginner-safe at beginner level.
 *
 * Style rules from spec:
 *   ✓ "safer", "cleaner", "stronger", "keeps your options open"
 *   ✗ "engine eval", "optimal", "heuristic frontier", "expected value delta"
 */
const SHORT_EXPLANATION_TEMPLATES: Record<CoachingReason, Record<PlayerLevel, string>> = {
  score_now: {
    beginner:     'This scores points right now.',
    intermediate: 'This scores immediately — always the priority.',
    advanced:     'Immediate score. Take it.',
  },
  deny_return_score: {
    beginner:     'This avoids giving back easy points.',
    intermediate: 'This closes a scoring line before the opponent can use it.',
    advanced:     'Denies an immediate reply score.',
  },
  safest_play: {
    beginner:     'This is the safest option here.',
    intermediate: 'This keeps the board quieter and limits risk.',
    advanced:     'Lowest variance play — minimises reply threat.',
  },
  keep_board_flexible: {
    beginner:     'This keeps your options open.',
    intermediate: 'This preserves more scoring chances for future turns.',
    advanced:     'Maintains board flexibility — avoids narrowing your options.',
  },
  preserve_scoring_numbers: {
    beginner:     'This keeps a useful number on the board.',
    intermediate: 'This protects a pip value you can score on later.',
    advanced:     'Preserves a high-value end for future scoring.',
  },
  avoid_opening_danger: {
    beginner:     'This avoids opening a risky end.',
    intermediate: "This doesn't create an end the opponent can easily exploit.",
    advanced:     'Avoids exposing a high-threat pip to the opponent.',
  },
  protect_lead: {
    beginner:     "While you're ahead, this keeps the board calmer.",
    intermediate: "This reduces risk while you're in the lead.",
    advanced:     'Lead protection — reduces volatility when ahead.',
  },
  create_comeback_pressure: {
    beginner:     "While you're behind, this opens up more chances.",
    intermediate: 'This increases scoring opportunities when trailing.',
    advanced:     'Comeback pressure — raises variance in your favour.',
  },
  avoid_self_block: {
    beginner:     "This avoids getting stuck later.",
    intermediate: "This doesn't strand tiles in your own hand.",
    advanced:     'Avoids creating a self-block on key pip values.',
  },
  control_board_ends: {
    beginner:     'This puts useful numbers on the board.',
    intermediate: 'This shifts the board ends in your favour.',
    advanced:     'Board-end control — shapes the pip landscape for future turns.',
  },
  simple_strong_move: {
    beginner:     'This is a solid, clean play.',
    intermediate: 'This is a clean move with good fundamentals.',
    advanced:     'Solid all-around choice.',
  },
  future_value: {
    beginner:     'This sets up a better opportunity next turn.',
    intermediate: 'This positions you for a stronger scoring turn ahead.',
    advanced:     'Tempo move — builds future scoring structure.',
  },
};

/**
 * Generates the short one-sentence explanation for a given reason and level.
 *
 * Design principle: tie every explanation to real gameplay data, not vague
 * adjectives. Use actual counts — tiles, responses, ends — where they add
 * precision without becoming technical jargon.
 *
 * Special-case paths (in priority order):
 *
 *  0. Equivalent move (isEquivalentToBest): same open ends + same pts → neutral copy,
 *     never invent distinctions.
 *
 *  1. Forced draw with positive framing: player has no playable tiles but boneyard
 *     is available — drawing can genuinely help.
 *
 *  2. Non-scoring double chain (turnContinues, no score): playing a double keeps
 *     the player's turn — explain the continuation mechanic explicitly.
 *
 *  3. control_board_ends: use actual remaining-tile count and open-end count
 *     instead of vague "keeps your options open."
 *
 *  4. deny_return_score with exact opponent data: use opponentScoringResponseCount
 *     when it gives more precise language than the template.
 *
 *  5. score_now + dangerous reply: acknowledge the trade-off.
 *
 *  6. score_now + strong chaining: mention both the score and the continuation.
 *
 *  7. Non-scoring strategic miss (neitherScores): softer language, not "blunder."
 *
 *  8. Standard template fallback.
 */
export function generateShortExplanation(
  reason: CoachingReason,
  features: MoveFeatures,
  level: PlayerLevel,
  neitherScores = false,
  isEquivalentToBest = false,
): string {
  const {
    remainingPlayableCount, playerNextTurnScoringCount, playerEndCoverage,
    playerConstraintLevel, opponentConstraintLevel, opponentForcedDefensiveCount,
    opponentResponseCount, opponentScoringResponseCount,
    turnContinues, immediateScore, opensEndDangerLevel, resultingOpenEnds,
  } = features;
  const openEndCount = resultingOpenEnds.length;

  // ── Path 0: Equivalent board state — never invent distinctions ───────────
  if (isEquivalentToBest) {
    return SHORT_EXPLANATION_TEMPLATES['simple_strong_move'][level];
  }

  // ── Path 1: Constrained draw — gradient framing ───────────────────────────
  // Player has tiles but none can play; boneyard is available. Use the gradient
  // to distinguish between a recoverable draw (constrained) vs truly blocked.
  if (playerConstraintLevel === 'constrained' && reason !== 'score_now') {
    switch (level) {
      case 'beginner':
        return 'You may need to draw, but pulling a tile can give you a useful play next turn.';
      case 'intermediate':
        return 'This forces a draw — drawing adds to your hand and often opens new scoring chances.';
      case 'advanced':
        return 'Draw forced: boneyard access can improve hand composition and extend chaining options.';
    }
  }

  // ── Path 1b: Limited options framing ─────────────────────────────────────
  // Player has only 1–2 tiles that can connect. Surface this honestly so the
  // player understands their position is narrow without being catastrophic.
  if (playerConstraintLevel === 'limited' && reason === 'control_board_ends') {
    switch (level) {
      case 'beginner':
        return `This leaves you with only ${remainingPlayableCount} option${remainingPlayableCount !== 1 ? 's' : ''} next turn — manageable, but tight.`;
      case 'intermediate':
        return `Only ${remainingPlayableCount} of your tiles can connect — limited but not stuck. Watch for draw opportunities.`;
      case 'advanced':
        return `Limited: ${remainingPlayableCount} live tile${remainingPlayableCount !== 1 ? 's' : ''}, ${playerEndCoverage} end${playerEndCoverage !== 1 ? 's' : ''} covered. Draw may improve position.`;
    }
  }

  // ── Path 2: Non-scoring double that chains ───────────────────────────────
  // Playing a non-scoring double keeps the player's turn — a real mechanical
  // advantage the coach should name explicitly, not hide behind vague language.
  if (turnContinues && immediateScore === 0 && reason === 'control_board_ends') {
    switch (level) {
      case 'beginner':
        return 'Playing the double keeps your turn — you get another move right away.';
      case 'intermediate':
        return `The double chains your turn — you play again immediately with ${openEndCount} open end${openEndCount !== 1 ? 's' : ''} to work with.`;
      case 'advanced':
        return `Double chains: immediate continuation, no opponent reply. ${openEndCount} open end${openEndCount !== 1 ? 's' : ''} live.`;
    }
  }

  // ── Path 3: control_board_ends — anchor to coverage, not just count ──────
  // Use playerEndCoverage (distinct ends covered) over raw playable count;
  // name both tiles and ends so the player understands the diversity.
  if (reason === 'control_board_ends') {
    const scoringNote = playerNextTurnScoringCount >= 2
      ? ` including ${playerNextTurnScoringCount} that could score`
      : '';
    switch (level) {
      case 'beginner':
        return `This keeps ${playerEndCoverage} of your tiles with a playable end${scoringNote}.`;
      case 'intermediate':
        return `${playerEndCoverage} tiles connect across ${openEndCount} open end${openEndCount !== 1 ? 's' : ''}${scoringNote} — good chaining position.`;
      case 'advanced':
        return `${playerEndCoverage} tiles covered, ${openEndCount} end${openEndCount !== 1 ? 's' : ''}${scoringNote}. Strong continuation.`;
    }
  }

  // ── Path 4: deny_return_score — layered opponent constraint copy ──────────
  // Use the constraint gradient and forced-defensive count for precise language.
  if (reason === 'deny_return_score') {
    // Strongest: opponent is completely blocked (no plays, boneyard gone)
    if (opponentConstraintLevel === 'blocked') {
      switch (level) {
        case 'beginner':
          return "This leaves the opponent with no good plays — they're completely stuck.";
        case 'intermediate':
          return 'Opponent has no playable tiles and no boneyard to draw from — total restriction.';
        case 'advanced':
          return 'Opponent blocked: zero responses, boneyard depleted. Positional dominance.';
      }
    }
    // Forced defensive: opponent can play but every reply sets the player up to score
    if (opponentForcedDefensiveCount > 0 && opponentForcedDefensiveCount >= opponentResponseCount) {
      switch (level) {
        case 'beginner':
          return "The opponent can play, but their moves would open ends you can score on.";
        case 'intermediate':
          return `All ${opponentForcedDefensiveCount} of the opponent's responses open a line for you to score — they have no safe play.`;
        case 'advanced':
          return `${opponentForcedDefensiveCount}/${opponentResponseCount} opponent responses are forced-defensive — every reply helps you.`;
      }
    }
    // Some forced-defensive: opponent has limited truly safe plays
    if (opponentForcedDefensiveCount > 0) {
      switch (level) {
        case 'beginner':
          return "Several of the opponent's replies would open ends you can score on.";
        case 'intermediate':
          return `${opponentForcedDefensiveCount} of the opponent's ${opponentResponseCount} possible plays would set you up to score.`;
        case 'advanced':
          return `${opponentForcedDefensiveCount}/${opponentResponseCount} opponent responses are forced-defensive. Pressure maintained.`;
      }
    }
    // Zero scoring: opponent can't score, even if they can play
    if (opponentScoringResponseCount === 0 && opponentResponseCount <= 2) {
      switch (level) {
        case 'beginner':
          return `The opponent has no scoring reply — they're left with ${opponentResponseCount} possible play${opponentResponseCount !== 1 ? 's' : ''}.`;
        case 'intermediate':
          return `Zero opponent scoring responses, only ${opponentResponseCount} legal play${opponentResponseCount !== 1 ? 's' : ''} — strong restriction.`;
        case 'advanced':
          return `Zero opponent scoring vectors; ${opponentResponseCount} total response${opponentResponseCount !== 1 ? 's' : ''} — near-blocking position.`;
      }
    }
    if (opponentScoringResponseCount === 0) {
      switch (level) {
        case 'beginner':
          return 'The opponent has no scoring reply next turn.';
        case 'intermediate':
          return 'No opponent scoring response available — you keep the pressure on.';
        case 'advanced':
          return 'Zero opponent scoring vectors from this position.';
      }
    }
  }

  // ── Path 5: score_now + dangerous reply threat ────────────────────────────
  // Acknowledge the trade-off honestly when the board left behind is genuinely risky.
  if (reason === 'score_now' && opensEndDangerLevel === 'dangerous') {
    switch (level) {
      case 'beginner':
        return 'This scores, but be careful — the board you leave behind gives the opponent easy replies.';
      case 'intermediate':
        return `Scores now and opens a dangerous reply threat — the opponent has ${opponentScoringResponseCount} tile${opponentScoringResponseCount !== 1 ? 's' : ''} that could score back.`;
      case 'advanced':
        return `Immediate score; ${opponentScoringResponseCount} opponent scoring vector${opponentScoringResponseCount !== 1 ? 's' : ''} in reply — track the open end carefully.`;
    }
  }

  // ── Path 6: score_now + strong chaining ──────────────────────────────────
  // A scoring move that also keeps good continuation is doubly strong.
  // Surface the chaining quality alongside the score when both are notable.
  if (reason === 'score_now' && remainingPlayableCount >= 3 && !neitherScores) {
    switch (level) {
      case 'beginner':
        return `This scores and leaves you with ${remainingPlayableCount} tiles you can still play.`;
      case 'intermediate':
        return `Scores immediately and keeps ${remainingPlayableCount} of your tiles live — good scoring and chaining.`;
      case 'advanced':
        return `Score + ${remainingPlayableCount} live tiles remaining. Strong immediate and positional value.`;
    }
  }

  // ── Path 7: Non-scoring strategic miss in a no-score position ────────────
  if (neitherScores && immediateScore === 0 && reason === 'simple_strong_move') {
    switch (level) {
      case 'beginner':
        return 'There may be a stronger option here — nothing scores either way.';
      case 'intermediate':
        return 'This works, but a different placement gives better board structure.';
      case 'advanced':
        return 'Strategically weaker — better end structure was available.';
    }
  }

  // ── Path 8: Standard template fallback ───────────────────────────────────
  return SHORT_EXPLANATION_TEMPLATES[reason][level];
}

// ─── Phase 2: Long explanation generation ────────────────────────────────────

/**
 * Generates an optional 2–4 sentence "Why?" expansion for moves where
 * there is genuine teaching depth beyond the short copy.
 *
 * Returns undefined when the short explanation is sufficient (most moves).
 * Used behind a "Why?" button — never surfaced automatically.
 */
export function generateLongExplanation(
  primaryReason: CoachingReason,
  secondaryReason: CoachingReason | undefined,
  features: MoveFeatures,
  level: PlayerLevel,
  neitherScores = false,
): string | undefined {
  const {
    remainingPlayableCount, playerNextTurnScoringCount, playerEndCoverage,
    playerConstraintLevel, opponentConstraintLevel, opponentForcedDefensiveCount,
    opponentResponseCount, opponentScoringResponseCount,
    turnContinues, opensEndDangerLevel, resultingOpenEnds,
  } = features;
  const openEndCount = resultingOpenEnds.length;

  // Only generate long explanations for moves with clear strategic depth
  const needsDepth =
    primaryReason === 'deny_return_score'        ||
    primaryReason === 'protect_lead'             ||
    primaryReason === 'create_comeback_pressure' ||
    primaryReason === 'avoid_opening_danger'     ||
    primaryReason === 'keep_board_flexible'      ||
    primaryReason === 'avoid_self_block'         ||
    primaryReason === 'control_board_ends'       ||
    playerConstraintLevel === 'constrained'      ||
    opponentConstraintLevel === 'blocked'        ||
    opponentForcedDefensiveCount > 0             ||
    // Scoring move that opens ANY reply threat
    (features.immediateScore > 0 && opensEndDangerLevel !== 'safe') ||
    // Strategic-only positions with a second-order insight
    (neitherScores && secondaryReason !== undefined);

  if (!needsDepth) return undefined;

  // At beginner level, long explanations may confuse more than help
  if (level === 'beginner') return undefined;

  const parts: string[] = [];

  // Lead sentence: expand on the primary reason with precise data where available
  switch (primaryReason) {
    case 'control_board_ends': {
      const scoringPotential = playerNextTurnScoringCount >= 2
        ? ` — ${playerNextTurnScoringCount} of those could score immediately`
        : '';
      const doubleNote = turnContinues && features.immediateScore === 0
        ? 'Playing a double keeps your turn, which means the opponent never gets a chance to respond to this move. '
        : '';
      parts.push(
        level === 'advanced'
          ? `${doubleNote}${playerEndCoverage} tiles connect across ${openEndCount} open end${openEndCount !== 1 ? 's' : ''}${scoringPotential}. Chaining depth is measured by how many distinct ends your hand can reach.`
          : `${doubleNote}You have ${playerEndCoverage} tiles that can connect to the board${scoringPotential}. Keeping those options alive is how you stay in control of the hand.`,
      );
      break;
    }

    case 'deny_return_score': {
      let opponentNote: string;
      if (opponentConstraintLevel === 'blocked') {
        opponentNote = level === 'advanced'
          ? `The opponent has zero plays and no boneyard access — this position is fully locked down. Total board restriction.`
          : `The opponent has no tiles that fit the board and can't draw either — you've completely shut them out.`;
      } else if (opponentForcedDefensiveCount > 0 && opponentForcedDefensiveCount >= opponentResponseCount) {
        opponentNote = level === 'advanced'
          ? `Every one of the opponent's ${opponentResponseCount} possible response${opponentResponseCount !== 1 ? 's' : ''} opens a scoring line for you — they have no safe play.`
          : `The opponent can play, but every option they have would set you up to score next turn. They're forced into helping you.`;
      } else if (opponentForcedDefensiveCount > 0) {
        opponentNote = level === 'advanced'
          ? `${opponentForcedDefensiveCount} of the opponent's ${opponentResponseCount} response${opponentResponseCount !== 1 ? 's' : ''} are forced-defensive — most plays help you more than them.`
          : `Several of the opponent's replies would open an end you can score on. Their options are limited and mostly unsafe.`;
      } else if (opponentScoringResponseCount === 0) {
        opponentNote = level === 'advanced'
          ? `The opponent has ${opponentResponseCount} legal play${opponentResponseCount !== 1 ? 's' : ''} available but zero that would score — you've shut out their immediate scoring.`
          : `The opponent can play ${opponentResponseCount > 0 ? `${opponentResponseCount} tile${opponentResponseCount !== 1 ? 's' : ''}` : 'nothing'} but none of them score right now — that's what good board control looks like.`;
      } else {
        opponentNote = level === 'advanced'
          ? 'Keeping the open ends away from values the opponent can score on is as important as scoring yourself.'
          : 'Strong players think about what the opponent can do on the very next turn, not just what they scored right now.';
      }
      parts.push(opponentNote);
      break;
    }

    case 'protect_lead':
      parts.push(
        level === 'advanced'
          ? "When ahead, lower-variance plays compound the advantage — the opponent needs chaos to catch up, so don't provide it."
          : 'When you have a lead, the goal shifts slightly: keep the game under control rather than chasing big scores.',
      );
      break;

    case 'create_comeback_pressure':
      parts.push(
        level === 'advanced'
          ? 'When trailing, you need variance — accept some risk in exchange for the chance at a bigger swing.'
          : 'When behind, you generally need to be a bit more aggressive to create enough scoring chances to close the gap.',
      );
      break;

    case 'avoid_opening_danger': {
      const exactNote = opponentScoringResponseCount > 0
        ? (level === 'advanced'
            ? `The opponent has ${opponentScoringResponseCount} tile${opponentScoringResponseCount !== 1 ? 's' : ''} that would score on the resulting open ends.`
            : `Opening that end gives the opponent ${opponentScoringResponseCount} possible scoring tile${opponentScoringResponseCount !== 1 ? 's' : ''} to use.`)
        : (level === 'advanced'
            ? 'The new open end has a pip value the opponent may hold, creating a reply threat.'
            : "Opening certain ends can hand the opponent an easy score — even if your move scores now, it matters what it leaves behind.");
      parts.push(exactNote);
      break;
    }

    case 'keep_board_flexible':
      parts.push(
        level === 'advanced'
          ? `Each distinct end your hand can reach is a live option — losing coverage accelerates hand-blocking risk. Currently ${playerEndCoverage} of your tiles cover at least one open end.`
          : `Keeping your tiles playable matters — if the board closes up around pip values you don't have, you may be forced to draw. Right now ${playerEndCoverage} of your tiles can still connect.`,
      );
      break;

    case 'avoid_self_block':
      parts.push(
        level === 'advanced'
          ? `This play closes off an end value that several of your remaining tiles need — a positional cost that compounds over time. After this move, only ${playerEndCoverage} tile${playerEndCoverage !== 1 ? 's' : ''} cover an open end.`
          : `Be careful when a move leaves your remaining tiles with no matching open end — you could be forced to draw or pass. After this move, only ${playerEndCoverage} of your tiles can connect to the board.`,
      );
      break;

    default:
      break;
  }

  // Constrained-draw explanation — worth expanding on at intermediate+
  if (playerConstraintLevel === 'constrained' && parts.length === 0) {
    parts.push(
      level === 'advanced'
        ? 'Drawing from the boneyard forces a pause but adds a tile — that tile may connect to an end that unlocks your hand.'
        : 'When none of your tiles fit the board, drawing can actually help — the new tile might be exactly what you need to score.',
    );
  }

  // Secondary sentence: note the second insight if present.
  // Skip for score_now: the risk note below already covers the trade-off.
  if (secondaryReason && primaryReason !== 'score_now') {
    const secondaryNote = SHORT_EXPLANATION_TEMPLATES[secondaryReason][level];
    parts.push(secondaryNote);
  }

  // Risk note: flag a meaningful trade-off on scoring moves with reply threats.
  // Use exact opponent scoring response count when available for precision.
  if (features.immediateScore > 0 && opensEndDangerLevel !== 'safe') {
    const exactThreat = opponentScoringResponseCount > 0
      ? ` (${opponentScoringResponseCount} opponent tile${opponentScoringResponseCount !== 1 ? 's' : ''} can score back)`
      : '';
    const riskSentence =
      opensEndDangerLevel === 'dangerous'
        ? (level === 'advanced'
            ? `The opening here creates a high-probability reply threat${exactThreat} — the score is worth taking, but track the resulting open end.`
            : `One clear trade-off: the opponent can score back on the next turn${exactThreat}. Take the points, but watch the board.`)
        : (level === 'advanced'
            ? `This opening does give the opponent a reply option${exactThreat} — the immediate score is worth it, but stay aware of the board state.`
            : `One trade-off: the opponent may be able to score back next turn${exactThreat}.`);
    parts.push(riskSentence);
  }

  // Strategic-position note: explain why differences matter even when nobody scores
  if (neitherScores && parts.length === 0) {
    parts.push(
      level === 'advanced'
        ? 'In positions where no move scores immediately, end-pip placement determines who scores first next — board structure becomes the game.'
        : "When nothing scores right now, the difference between moves is about which pip values end up on the board. Those ends shape who gets points next turn.",
    );
    if (secondaryReason) {
      parts.push(SHORT_EXPLANATION_TEMPLATES[secondaryReason][level]);
    }
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
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
