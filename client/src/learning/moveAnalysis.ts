/**
 * learning/moveAnalysis.ts
 *
 * Phase 2 implementation: core move grading engine.
 *
 * Public surface:
 *   buildMoveEvaluationResult(input)  → MoveEvaluationResult   ← main entry point
 *   computeInterventionLevel(...)     → InterventionLevel
 *   classifyMoveByDelta(...)          → MoveCategory
 *   computeEngineConfidence(...)      → number
 *   normalizeMoveId(move)             → LearningMoveId
 *   formatMoveNotation(move)          → string
 *   createMockEvaluationResult(...)   → MoveEvaluationResult   ← for Phase 3 testing
 *
 * Architecture note — Fritz state mirroring
 * ──────────────────────────────────────────
 * Fritz's evaluateMove() is designed to evaluate from the 'bot' player's
 * perspective.  To rank moves from the human ('you') perspective we swap
 * the player slots before calling it:
 *
 *   mirroredState.players.bot  = original state.players.you  (our hand)
 *   mirroredState.players.you  = original state.players.bot  (opponent)
 *   mirroredState.currentPlayer = 'bot'
 *
 * asVisibleState() inside evaluateMove() then correctly hides the opponent
 * ('you' slot) and runs Fritz's full strategic evaluation from our hand.
 * This gives Master-Fritz-quality move rankings without duplicating engine
 * logic.  The only information lost is opponent-hand inference
 * (opponentKnownMissing), which we zero out in the mirrored state since
 * the original inference was built for the opposite perspective.
 *
 * All functions are pure: (input) → output, no side effects, no React.
 */

import type {
  MoveCategory,
  CoachingReason,
  CoachingConceptTag,
  RiskFlag,
  LearningMoveId,
  LearningThresholdConfig,
  InterventionLevel,
  PlayerLevel,
  LearnGameMode,
} from './types.ts';
import { DEFAULT_THRESHOLD_CONFIG } from './types.ts';
import {
  extractBoardContext,
  extractMoveFeatures,
  tagMove,
  type BoardContext,
  type ConstraintLevel,
  type MoveFeatures,
  type ReasonTaggingOutput,
} from './reasonTagging.ts';
import type { Move, Tile } from '../types.ts';
import type { BotMatchState, BotMovePreview } from '../bot/botEngine.ts';
import {
  getLegalMoves,
  previewPlayMove,
} from '../bot/botEngine.ts';
import { evaluateMove } from '../bot/botHeuristics.ts';

// ─── Phase 1 types (preserved + updated) ─────────────────────────────────────

/**
 * Fully annotated analysis of one legal move.
 * Every legal move in the position gets one of these; the array is ranked
 * by engineScore descending (best → worst).
 */
export type LearningMoveAnalysis = {
  /** Stable string key, e.g. "3|4-left", "pass" */
  moveId: LearningMoveId;

  /** Human-readable label, e.g. "[3|4] → left" */
  moveNotation: string;

  /** The raw Move object from the game engine */
  move: Move;

  /** 1 = top-ranked move; higher numbers = weaker */
  rank: number;

  /**
   * Composite learning score (higher = better for the current player).
   * Scale mirrors Fritz's strategic evaluator:
   *   immediateScore × 34 dominates; strategic factors contribute ±5–±40.
   * NEVER expose this raw number in player-facing UI — it has no meaning
   * to a learner and the units are intentionally internal.
   */
  engineScore: number;

  /**
   * How many score-scale units this move loses vs the top-ranked move.
   * 0 for rank-1. This drives category classification.
   */
  scoreDeltaFromBest: number;

  /** Immediate points scored (in scoring units: 0 = 0pts, 1 = 5pts, …) */
  immediatePoints: number;

  /** Quality tier assigned by the threshold config */
  category: MoveCategory;

  /** The single most important reason this move is strong */
  primaryReason: CoachingReason;

  /** Optional secondary insight (shown at intermediate/advanced level) */
  secondaryReason?: CoachingReason;

  /** Broader strategic themes this move relates to */
  conceptTags: CoachingConceptTag[];

  /** Specific risks attached to this move */
  riskFlags: RiskFlag[];

  /** 1-sentence coaching explanation, always beginner-safe */
  explanationShort: string;

  /** Longer "Why?" expansion — only populated when there is genuine depth */
  explanationLong?: string;

  /**
   * Pip values on the open ends after this move is played.
   * Exposed for: equivalence detection, debug panel, future analysis layers.
   */
  resultingOpenEnds: number[];

  /**
   * True when this move produces the same open ends and immediate points as
   * the rank-1 move. The coach must not invent strategic distinctions between
   * moves that result in the same effective board state.
   * When true: explanation is neutral; coaching tone is treated as 'best'.
   */
  isEquivalentToBest: boolean;

  /**
   * Key chaining and restriction signals, stored for the debug panel.
   * These are the exact values that drove reason selection and explanation copy.
   * Not shown in player-facing UI — dev-only.
   */
  debugSignals: {
    turnContinues:                boolean;         // player keeps their turn (double or score)
    remainingPlayableCount:       number;          // player tiles that can still play
    playerNextTurnScoringCount:   number;          // player tiles that could score now
    playerConstraintLevel:        ConstraintLevel; // gradient: free/limited/constrained/blocked
    playerEndCoverage:            number;          // distinct ends the player's tiles cover
    opponentResponseCount:        number;          // opponent tiles that can play
    opponentScoringResponseCount: number;          // opponent tiles that would score
    opponentConstraintLevel:      ConstraintLevel; // gradient: free/limited/constrained/blocked
    opponentForcedDefensiveCount: number;          // opponent plays that set up the player
  };
};

/**
 * Everything the coaching layer needs to evaluate the player's chosen move
 * and produce a CoachingFeedbackPacket.
 */
export type MoveEvaluationResult = {
  /** All legal moves, sorted best → worst */
  rankedMoves: LearningMoveAnalysis[];

  /** Convenience reference to rank-1 move */
  bestMove: LearningMoveAnalysis;

  /** The move the player actually chose (undefined = pre-move phase) */
  chosenMove?: LearningMoveAnalysis;

  /**
   * Engine confidence that the best move is clearly correct (0–1).
   * Derived from the score gap between rank-1 and rank-2 moves.
   * Low → coaching tone softens; high → coach can be more direct.
   */
  engineConfidence: number;

  /**
   * True when the top-2 moves are within lowConfidenceBand of each other.
   * Coach must not frame either as "obviously correct" in this state.
   */
  isAmbiguousPosition: boolean;

  /**
   * True when the rank-1 (best) move scores zero immediate points.
   * Indicates a position where ALL quality differences are purely strategic.
   * Coaching layer uses this to soften intervention tone — differences that
   * are invisible to a learner should not be framed as obvious mistakes.
   * Pass this to computeInterventionLevel as the neitherScores argument.
   */
  neitherScores: boolean;

  /** The threshold config used to produce this evaluation */
  thresholds: LearningThresholdConfig;

  /** Timestamp (ms since epoch) — for debug / replay */
  evaluatedAt: number;
};

/**
 * A pre-ranked move from an external source (e.g., future server-side Fritz).
 * Currently unused in the live path but kept for forward compatibility.
 */
export type EngineRankedMove = {
  move: Move;
  score: number;
  immediatePoints: number;
};

/**
 * Parameters passed into buildMoveEvaluationResult.
 *
 * engineMoves is optional: when provided (future server Fritz integration),
 * those rankings are used directly instead of the built-in evaluator.
 * When absent the built-in evaluator runs automatically.
 */
export type MoveAnalysisInput = {
  /** Full game state — used to enumerate and evaluate legal moves */
  state: BotMatchState;

  /**
   * Move the player chose.
   * undefined = pre-move recommendation phase (coach is suggesting, not reacting).
   */
  playerMove?: Move;

  /** Active threshold config. Defaults to DEFAULT_THRESHOLD_CONFIG if omitted. */
  thresholds?: LearningThresholdConfig;

  /**
   * Player skill level — controls coaching vocabulary depth.
   * Defaults to 'beginner'.
   */
  playerLevel?: PlayerLevel;

  /**
   * Pre-ranked moves from an external evaluator (future server Fritz path).
   * When present, skips the built-in learning evaluator entirely.
   */
  engineMoves?: EngineRankedMove[];
};

// ─── Phase 2: Move ID and notation ───────────────────────────────────────────

/**
 * Produces a stable string key for a move, used as LearningMoveAnalysis.moveId.
 * Format: "[low|high]-[position]" for play moves, "pass" for pass.
 */
export function normalizeMoveId(move: Move): LearningMoveId {
  if (move.type === 'pass') return 'pass';
  if (!move.tile || !move.position) return 'unknown';
  const { low, high } = move.tile;
  return `${low}|${high}-${move.position}`;
}

/**
 * Produces a human-readable move label for the coach panel and debug view.
 * Examples: "[3|4] → left", "[6|6] → branch-0-1", "Pass"
 */
export function formatMoveNotation(move: Move): string {
  if (move.type === 'pass') return 'Pass';
  if (!move.tile || !move.position) return 'Unknown move';
  const { low, high } = move.tile;
  return `[${low}|${high}] → ${move.position}`;
}

// ─── Phase 2: Classification ──────────────────────────────────────────────────

/**
 * Assigns a MoveCategory based on how many score-scale units this move
 * loses compared to the top-ranked move.
 *
 * Multiple moves can be 'best' if they share the exact top score.
 * The thresholds are configured externally and must be easy to tune.
 *
 *   delta === 0          → best     (tied for top)
 *   delta ≤ excellentDelta → excellent  (effectively tied, same core idea)
 *   delta ≤ goodDelta    → good       (reasonable, small strategic loss)
 *   delta ≤ dubiousDelta → dubious    (noticeable quality drop)
 *   delta >  dubiousDelta → blunder    (major miss or tactical error)
 */
export function classifyMoveByDelta(
  delta: number,
  thresholds: LearningThresholdConfig,
): MoveCategory {
  if (delta === 0)                           return 'best';
  if (delta <= thresholds.excellentDelta)    return 'excellent';
  if (delta <= thresholds.goodDelta)         return 'good';
  if (delta <= thresholds.dubiousDelta)      return 'dubious';
  return 'blunder';
}

// ─── Phase 2: Confidence calculation ─────────────────────────────────────────

/**
 * Computes how confident the engine is that the rank-1 move is clearly
 * superior to the rank-2 move.
 *
 *   gap ≤ lowConfidenceBand      → 0.0 (ambiguous; don't claim one is "obviously" better)
 *   gap ≥ strongInterventionDelta → 1.0 (clear best move)
 *   otherwise → linear interpolation
 *
 * @param sortedScores  Scores array already sorted descending (best first)
 */
export function computeEngineConfidence(
  sortedScores: number[],
  thresholds: LearningThresholdConfig,
): number {
  if (sortedScores.length < 2) return 1.0; // Only one legal move — forced

  const gap = sortedScores[0] - sortedScores[1];

  if (gap <= thresholds.lowConfidenceBand)      return 0.0;
  if (gap >= thresholds.strongInterventionDelta) return 1.0;

  const range = thresholds.strongInterventionDelta - thresholds.lowConfidenceBand;
  return (gap - thresholds.lowConfidenceBand) / range;
}

/**
 * True when the top-two moves are so close that neither can be called
 * "obviously correct". The coach must hedge its language in this state.
 */
export function isAmbiguousGap(
  sortedScores: number[],
  thresholds: LearningThresholdConfig,
): boolean {
  if (sortedScores.length < 2) return false;
  return sortedScores[0] - sortedScores[1] <= thresholds.lowConfidenceBand;
}

// ─── Phase 2: Fritz state mirroring ──────────────────────────────────────────

/**
 * Evaluates a player ('you') move using Fritz's strategic evaluator.
 *
 * Fritz is designed to evaluate from 'bot' perspective.  We swap the player
 * slots so the human hand occupies the 'bot' slot, then call evaluateMove
 * normally.  asVisibleState() inside evaluateMove correctly hides the
 * opponent ('you' slot) — just as it would in a real bot turn.
 *
 * Returns the composite Fritz score (strategic + MC), or null if the move
 * is illegal or Fritz cannot evaluate it (e.g. pass move).
 *
 * Inference state (opponentKnownMissing etc.) is zeroed out in the mirrored
 * state because it was built for the original perspective and would be
 * semantically misleading after the swap.
 */
function evalMoveFromPlayerPerspective(
  state: BotMatchState,
  move: Move,
): number | null {
  if (move.type !== 'play') return null;

  // Swap player slots so Fritz runs from the human's hand
  const mirroredState: BotMatchState = {
    ...state,
    currentPlayer: 'bot',
    players: {
      bot: { hand: [...state.players.you.hand], score: state.players.you.score },
      you: { hand: [...state.players.bot.hand], score: state.players.bot.score },
    },
    // Zero out opponent inference — it was built for the un-mirrored perspective
    opponentKnownMissing:   [],
    opponentPassedOnEnds:   [],
    opponentMissingEvidence: [],
    opponentDrawCount:      0,
  };

  const choice = evaluateMove(mirroredState, move, 'hard');
  return choice?.score ?? null;
}

// ─── Phase 2: Pass move handler ───────────────────────────────────────────────

/**
 * Builds a LearningMoveAnalysis for a pass move.
 * In Racehorse dominoes, pass is only available when there are NO legal play
 * moves AND the boneyard is exhausted — so it is always the 'best' (only) option.
 * We tag it with a neutral reason and no risk flags.
 */
function buildPassMoveAnalysis(level: PlayerLevel): LearningMoveAnalysis {
  const passMove: Move = { type: 'pass' };
  const passExplanation =
    level === 'beginner'
      ? 'No tiles available to play — forced to pass.'
      : 'No legal play moves and boneyard is exhausted. Pass is required.';

  return {
    moveId:           'pass',
    moveNotation:     'Pass',
    move:             passMove,
    rank:             1,
    engineScore:      0,
    scoreDeltaFromBest: 0,
    immediatePoints:  0,
    category:         'best',
    primaryReason:    'safest_play',
    secondaryReason:  undefined,
    conceptTags:      ['safety'],
    riskFlags:        [],
    explanationShort: passExplanation,
    explanationLong:  undefined,
    resultingOpenEnds: [],
    isEquivalentToBest: true,
    debugSignals: {
      turnContinues:                false,
      remainingPlayableCount:       0,
      playerNextTurnScoringCount:   0,
      playerConstraintLevel:        'blocked',
      playerEndCoverage:            0,
      opponentResponseCount:        0,
      opponentScoringResponseCount: 0,
      opponentConstraintLevel:      'free',
      opponentForcedDefensiveCount: 0,
    },
  };
}

// ─── Phase 2: Intervention level ─────────────────────────────────────────────

/**
 * Determines how much the coach should interrupt after a move.
 *
 * Rules (from spec Part 5):
 *   none   — best/excellent, or good with trivial difference, or ambiguous position
 *   light  — good move but slightly weaker; teachable but not serious
 *   medium — dubious: missed clean score, meaningfully weaker, opened risk
 *   strong — blunder: huge missed score, obvious tactical danger, severe self-block
 *
 * Challenge mode escalates the threshold: things that are 'light' become 'medium'.
 * Guided mode is most forgiving — this is the default.
 *
 * neitherScores: when true, both the best move and the chosen move score 0 pts.
 * In this situation the differences are purely strategic and often invisible to
 * learners. We reduce the intervention by one tier to avoid scolding a player
 * for a move they had no obvious reason to avoid. The underlying category is
 * unchanged — this is a presentation-layer adjustment only.
 */
export function computeInterventionLevel(
  chosenCategory: MoveCategory,
  confidence: number,
  isAmbiguous: boolean,
  gameMode: LearnGameMode = 'guided',
  neitherScores = false,
): InterventionLevel {
  // Ambiguous positions must never generate strong interventions.
  if (isAmbiguous && chosenCategory !== 'blunder') return 'none';

  // In purely-strategic (no-score) positions, soften one tier.
  // Blunders become dubious-equivalent; dubious becomes good-equivalent.
  // We never go below 'none'.
  const effectiveCategory: MoveCategory =
    neitherScores && chosenCategory === 'blunder'  ? 'dubious' :
    neitherScores && chosenCategory === 'dubious'  ? 'good'    :
    chosenCategory;

  switch (effectiveCategory) {
    case 'best':
    case 'excellent':
      return 'none';

    case 'good':
      if (confidence < 0.3) return 'none';
      return gameMode === 'challenge' ? 'medium' : 'light';

    case 'dubious':
      return gameMode === 'challenge' ? 'strong' : 'medium';

    case 'blunder':
      return 'strong';

    default:
      return 'none';
  }
}

// ─── Phase 2: Move matching ───────────────────────────────────────────────────

/** True if two Move objects represent the same action (tile + position). */
function movesAreEqual(a: Move, b: Move): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'pass') return true;
  if (!a.tile || !b.tile) return false;
  const samePosition = a.position === b.position;
  const sameTile =
    (a.tile.high === b.tile.high && a.tile.low === b.tile.low) ||
    (a.tile.high === b.tile.low && a.tile.low === b.tile.high);
  return samePosition && sameTile;
}

// ─── Phase 2: Core scored move record (internal) ─────────────────────────────

/** Internal intermediate record before assembling LearningMoveAnalysis */
type ScoredMove = {
  move: Move;
  score: number;
  preview: BotMovePreview | null;
  immediatePoints: number;
};

/**
 * Evaluates all legal moves and returns them sorted best → worst.
 *
 * Evaluation path:
 *   1. Call getLegalMoves(state, 'you') for all candidates
 *   2. For each play move: evalMoveFromPlayerPerspective() (Fritz via state mirror)
 *   3. For pass: score = -Infinity (always last, only appears when forced)
 *   4. Sort descending by score
 *
 * If engineMoves are externally provided (future server Fritz path), those
 * scores are used instead of step 2.
 */
function scoreAllMoves(
  state: BotMatchState,
  externalMoves?: EngineRankedMove[],
): ScoredMove[] {
  const legalMoves = getLegalMoves(state, 'you');

  // Fast path: external engine provided pre-ranked moves
  if (externalMoves && externalMoves.length > 0) {
    return externalMoves
      .map((em) => ({
        move:           em.move,
        score:          em.score,
        preview:        em.move.type === 'play'
                          ? previewPlayMove(state, 'you', em.move)
                          : null,
        immediatePoints: em.immediatePoints,
      }))
      .sort((a, b) => b.score - a.score);
  }

  // Built-in path: evaluate via Fritz state mirror
  const scored: ScoredMove[] = legalMoves.map((move) => {
    if (move.type === 'pass') {
      return { move, score: -Infinity, preview: null, immediatePoints: 0 };
    }

    const preview = previewPlayMove(state, 'you', move);
    const fritzScore = evalMoveFromPlayerPerspective(state, move);

    // fritzScore is null only if the move is illegal in the mirrored state —
    // treat as a very weak move (shouldn't happen in practice)
    const score = fritzScore ?? (preview ? preview.immediateScore * 34 : -Infinity);
    const immediatePoints = preview?.immediateScore ?? 0;

    return { move, score, preview, immediatePoints };
  });

  // Sort best first; use move notation as a stable tiebreaker
  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (diff !== 0) return diff;
    // Stable tiebreaker: prefer higher-immediate-score move, then notation
    if (b.immediatePoints !== a.immediatePoints) return b.immediatePoints - a.immediatePoints;
    return normalizeMoveId(a.move).localeCompare(normalizeMoveId(b.move));
  });

  return scored;
}

// ─── Phase 2: Full analysis assembly ─────────────────────────────────────────

/**
 * Assembles a LearningMoveAnalysis record for one scored move.
 * Combines engine score, classification, and reason tagging into the
 * shape that all downstream layers consume.
 *
 * neitherScores: true when the best move in this position also scores 0 pts.
 * Passed into the tagging layer so explanations use strategic (not blunder)
 * framing. Does not alter the raw category classification.
 *
 * isEquivalentToBest: true when this move produces the same open ends and
 * immediate points as the rank-1 move. The tagging layer will use a neutral
 * explanation instead of inventing strategic distinctions.
 */
function assembleMoveAnalysis(
  scored: ScoredMove,
  rank: number,
  bestScore: number,
  thresholds: LearningThresholdConfig,
  boardContext: BoardContext,
  state: BotMatchState,
  playerLevel: PlayerLevel,
  neitherScores: boolean,
  isEquivalentToBest: boolean,
): LearningMoveAnalysis {
  const { move, score, preview, immediatePoints } = scored;
  const delta = bestScore - score;
  const category = classifyMoveByDelta(delta, thresholds);
  const resultingOpenEnds = preview?.openEnds ?? [];

  // --- Reason tagging ---
  let tagging: ReasonTaggingOutput;

  let features: MoveFeatures | null = null;

  if (move.type === 'pass' || !preview) {
    // Pass moves: minimal tagging
    tagging = {
      primaryReason:    'safest_play',
      secondaryReason:  undefined,
      conceptTags:      ['safety'],
      riskFlags:        [],
      explanationShort: 'No tiles available to play — forced to pass.',
      explanationLong:  undefined,
    };
  } else {
    features = extractMoveFeatures(move, boardContext, state, preview);
    tagging = tagMove({
      move, category, features, boardContext, playerLevel,
      neitherScores, isEquivalentToBest,
    });
  }

  // Populate debug signals from extracted features (pass moves get safe defaults)
  const debugSignals: LearningMoveAnalysis['debugSignals'] = {
    turnContinues:                features?.turnContinues                ?? false,
    remainingPlayableCount:       features?.remainingPlayableCount        ?? 0,
    playerNextTurnScoringCount:   features?.playerNextTurnScoringCount    ?? 0,
    playerConstraintLevel:        features?.playerConstraintLevel         ?? 'free',
    playerEndCoverage:            features?.playerEndCoverage             ?? 0,
    opponentResponseCount:        features?.opponentResponseCount         ?? 0,
    opponentScoringResponseCount: features?.opponentScoringResponseCount  ?? 0,
    opponentConstraintLevel:      features?.opponentConstraintLevel        ?? 'free',
    opponentForcedDefensiveCount: features?.opponentForcedDefensiveCount  ?? 0,
  };

  return {
    moveId:            normalizeMoveId(move),
    moveNotation:      formatMoveNotation(move),
    move,
    rank,
    engineScore:       score,
    scoreDeltaFromBest: delta,
    immediatePoints,
    category,
    primaryReason:     tagging.primaryReason,
    secondaryReason:   tagging.secondaryReason,
    conceptTags:       tagging.conceptTags,
    riskFlags:         tagging.riskFlags,
    explanationShort:  tagging.explanationShort,
    explanationLong:   tagging.explanationLong,
    resultingOpenEnds,
    isEquivalentToBest,
    debugSignals,
  };
}

// ─── Phase 2: Main entry point (public) ──────────────────────────────────────

/**
 * Builds a complete MoveEvaluationResult for the current position.
 *
 * This is the ONLY function the coaching layer (Phase 3) and game
 * integration (Phase 4) should call. Everything else in this file is
 * internal implementation detail.
 *
 * Pipeline:
 *   1. Resolve defaults (thresholds, playerLevel)
 *   2. Handle pure-pass positions immediately
 *   3. Score and rank all legal play moves via Fritz state mirroring
 *   4. Classify each move by delta from best
 *   5. Compute confidence and ambiguity flags
 *   6. Extract board context (once, shared by all tagging calls)
 *   7. Assemble full LearningMoveAnalysis for each move
 *   8. Find the player's chosen move in the ranked list (if provided)
 *   9. Return the complete MoveEvaluationResult
 */
export function buildMoveEvaluationResult(
  input: MoveAnalysisInput,
): MoveEvaluationResult {
  const {
    state,
    playerMove,
    engineMoves,
  } = input;

  const thresholds  = input.thresholds  ?? DEFAULT_THRESHOLD_CONFIG;
  const playerLevel = input.playerLevel ?? 'beginner';

  // --- Handle pass-only positions ---
  const legalMoves = getLegalMoves(state, 'you');
  const isForcePass = legalMoves.length === 1 && legalMoves[0].type === 'pass';

  if (isForcePass) {
    const passAnalysis = buildPassMoveAnalysis(playerLevel);
    return {
      rankedMoves:         [passAnalysis],
      bestMove:            passAnalysis,
      chosenMove:          playerMove?.type === 'pass' ? passAnalysis : undefined,
      engineConfidence:    1.0,
      isAmbiguousPosition: false,
      neitherScores:       false,
      thresholds,
      evaluatedAt:         Date.now(),
    };
  }

  // --- Score and rank all play moves ---
  const scoredMoves = scoreAllMoves(state, engineMoves);
  const bestScore   = scoredMoves[0].score;
  const sortedScores = scoredMoves.map((m) => m.score);

  const engineConfidence  = computeEngineConfidence(sortedScores, thresholds);
  const isAmbiguousPosition = isAmbiguousGap(sortedScores, thresholds);

  // neitherScores: TRUE only when no legal move in this position scores any
  // immediate points. When true, ALL differences are purely strategic and the
  // coaching layer softens its intervention tone.
  //
  // NOTE: We do NOT use scoredMoves[0].immediatePoints === 0 here because
  // Fritz occasionally places a strategic non-scoring move above a scoring
  // move (when the scoring move opens a severe reply threat). In those cases
  // the scoring move still exists — the learner can see the highlighted tile —
  // and telling them "nothing scores either way" is both incorrect and
  // confusing. Using .some() gives the semantically accurate answer.
  const anyMoveScores = scoredMoves.some(m => m.immediatePoints > 0);
  const neitherScores = !anyMoveScores;

  // --- Extract board context once (shared across all tagging calls) ---
  const boardContext = extractBoardContext(state);

  // --- Equivalence detection ---
  // Two moves are strategically equivalent when they produce the same open
  // ends (same pip values, sorted) AND the same immediate points. In this
  // case the coach must not invent distinctions — both moves result in the
  // same board structure and the same scoring outcome, so there is nothing
  // material to prefer between them.
  const bestEndsKey = [...(scoredMoves[0].preview?.openEnds ?? [])]
    .sort((a, b) => a - b).join(',');
  const bestImmediatePoints = scoredMoves[0].immediatePoints;

  function computeIsEquivalent(sm: ScoredMove, idx: number): boolean {
    if (idx === 0) return false; // rank-1 is never "equivalent to itself"
    if (sm.immediatePoints !== bestImmediatePoints) return false;
    const endsKey = [...(sm.preview?.openEnds ?? [])].sort((a, b) => a - b).join(',');
    return endsKey === bestEndsKey;
  }

  // --- Assemble full analysis records ---
  const rankedMoves: LearningMoveAnalysis[] = scoredMoves.map((sm, idx) =>
    assembleMoveAnalysis(
      sm,
      idx + 1,          // 1-based rank
      bestScore,
      thresholds,
      boardContext,
      state,
      playerLevel,
      neitherScores,
      computeIsEquivalent(sm, idx),
    ),
  );

  // --- Find chosen move ---
  let chosenMove: LearningMoveAnalysis | undefined;
  if (playerMove) {
    chosenMove = rankedMoves.find((m) => movesAreEqual(m.move, playerMove));
    // Fallback: if player's move isn't in legal moves (shouldn't happen),
    // treat it as the worst move for coaching purposes
    if (!chosenMove && rankedMoves.length > 0) {
      chosenMove = rankedMoves[rankedMoves.length - 1];
    }
  }

  // --- Override bestMove to scoring when one exists ---
  // In Racehorse dominoes "score when you can" is the core rule. Fritz
  // sometimes prefers a strategic non-scoring play, but surfacing that as
  // "best" for a learner who can see a scoring tile highlighted on the board
  // breaks trust in the coach. Override: if Fritz's rank-1 doesn't score but
  // a scoring move exists, use the highest-ranked scoring move as bestMove.
  // rankedMoves ordering is preserved for delta/category calculations.
  const fritzBestMove = rankedMoves[0];
  const bestScoringMove = rankedMoves.find(m => m.immediatePoints > 0);
  const effectiveBestMove =
    (!neitherScores && fritzBestMove.immediatePoints === 0 && bestScoringMove)
      ? bestScoringMove
      : fritzBestMove;

  return {
    rankedMoves,
    bestMove:           effectiveBestMove,
    chosenMove,
    engineConfidence,
    isAmbiguousPosition,
    neitherScores,
    thresholds,
    evaluatedAt:        Date.now(),
  };
}

// ─── Phase 2: Mock/example usage (for Phase 3 testing) ───────────────────────

/**
 * Builds a realistic mock MoveEvaluationResult for use in Phase 3
 * coaching message tests WITHOUT needing a live game state.
 *
 * Scenarios:
 *   'missed_score'  — player plays a non-scoring move when a score was available
 *   'safe_choice'   — player plays a safe non-scoring move; top move also non-scoring
 *   'blunder'       — player opens a highly dangerous end, losing a large score gap
 *   'best_move'     — player plays the best move; coach stays silent
 */
export function createMockEvaluationResult(
  scenario: 'missed_score' | 'safe_choice' | 'blunder' | 'best_move',
  _playerLevel: PlayerLevel = 'beginner',
): MoveEvaluationResult {
  const thresholds = DEFAULT_THRESHOLD_CONFIG;

  // ── Helper to build a minimal LearningMoveAnalysis ─────────────────
  const makeMove = (
    low: number,
    high: number,
    position: string,
    score: number,
    immediatePoints: number,
    rank: number,
    category: MoveCategory,
    primary: CoachingReason,
    conceptTags: CoachingConceptTag[],
    riskFlags: RiskFlag[],
    shortExpl: string,
    delta: number,
  ): LearningMoveAnalysis => ({
    moveId:            `${low}|${high}-${position}`,
    moveNotation:      `[${low}|${high}] → ${position}`,
    move:              { type: 'play', tile: { low, high }, position: position as any },
    rank,
    engineScore:       score,
    scoreDeltaFromBest: delta,
    immediatePoints,
    category,
    primaryReason:     primary,
    secondaryReason:   undefined,
    conceptTags,
    riskFlags,
    explanationShort:  shortExpl,
    explanationLong:   undefined,
    resultingOpenEnds: [],      // mock — no real board state available
    isEquivalentToBest: false,  // mock scenarios always have distinct moves
    debugSignals: {             // mock — zeroed for test scenarios
      turnContinues:                immediatePoints > 0,
      remainingPlayableCount:       0,
      playerNextTurnScoringCount:   0,
      playerConstraintLevel:        'free'  as ConstraintLevel,
      playerEndCoverage:            0,
      opponentResponseCount:        0,
      opponentScoringResponseCount: 0,
      opponentConstraintLevel:      'free'  as ConstraintLevel,
      opponentForcedDefensiveCount: 0,
    },
  });

  switch (scenario) {
    case 'missed_score': {
      const best = makeMove(5, 5, 'left',  102, 3, 1, 'best',     'score_now',         ['scoring'],           [],                   'This scores 15 points right now.',    0);
      const chosen = makeMove(3, 4, 'right',  38, 0, 3, 'dubious', 'keep_board_flexible',['flexibility'],       ['reduces_future_options'], 'This keeps your options open.',   64);
      return {
        rankedMoves:         [best, makeMove(4, 6, 'right', 55, 0, 2, 'good', 'safest_play', ['safety'], [], 'This is the safest option here.', 47), chosen],
        bestMove:            best,
        chosenMove:          chosen,
        engineConfidence:    1.0,
        isAmbiguousPosition: false,
        neitherScores:       false,
        thresholds,
        evaluatedAt:         Date.now(),
      };
    }

    case 'safe_choice': {
      const best = makeMove(3, 4, 'left',   45, 0, 1, 'best',      'deny_return_score', ['defense', 'scoring'], [],                    'This avoids giving back easy points.', 0);
      const chosen = makeMove(2, 5, 'right',  40, 0, 2, 'excellent', 'safest_play',      ['safety'],            [],                    'This is the safest option here.',      5);
      return {
        rankedMoves:         [best, chosen],
        bestMove:            best,
        chosenMove:          chosen,
        engineConfidence:    0.15,
        isAmbiguousPosition: true,
        neitherScores:       true,
        thresholds,
        evaluatedAt:         Date.now(),
      };
    }

    case 'blunder': {
      const best = makeMove(3, 4, 'left',  68, 1, 1, 'best',    'score_now',           ['scoring', 'safety'],  [],                        'This scores now and keeps the board safe.', 0);
      const chosen = makeMove(5, 6, 'right', 12, 0, 3, 'blunder', 'avoid_opening_danger',['risk_management'],  ['opens_dangerous_end', 'gives_easy_score_back'], 'This opens a risky end for the opponent.', 56);
      return {
        rankedMoves:         [best, makeMove(4, 5, 'left', 50, 0, 2, 'good', 'safest_play', ['safety'], [], 'This is the safest option here.', 18), chosen],
        bestMove:            best,
        chosenMove:          chosen,
        engineConfidence:    0.95,
        isAmbiguousPosition: false,
        neitherScores:       false,
        thresholds,
        evaluatedAt:         Date.now(),
      };
    }

    case 'best_move': {
      const best = makeMove(5, 5, 'left', 110, 3, 1, 'best', 'score_now', ['scoring'], [], 'This scores points right now.', 0);
      return {
        rankedMoves:         [best, makeMove(3, 4, 'right', 42, 0, 2, 'dubious', 'safest_play', ['safety'], [], 'This is the safest option here.', 68)],
        bestMove:            best,
        chosenMove:          best,
        engineConfidence:    1.0,
        isAmbiguousPosition: false,
        neitherScores:       false,
        thresholds,
        evaluatedAt:         Date.now(),
      };
    }
  }
}
