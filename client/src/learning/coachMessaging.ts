/**
 * learning/coachMessaging.ts
 *
 * Phase 3 implementation: coaching feedback layer.
 *
 * Public surface:
 *   buildCoachingFeedback(input)      → CoachingFeedbackPacket   ← main entry point
 *   buildPreMoveRecommendation(input) → PreMoveRecommendation
 *   resolveInterventionDecision(...)  → InterventionDecision
 *
 * Architecture:
 *   MoveEvaluationResult (moveAnalysis.ts)
 *       ↓
 *   buildCoachingFeedback()           ← assembles the packet
 *       ├─ selectTone()               ← picks the right voice for this situation
 *       ├─ buildHeadline()            ← ≤8-word human line
 *       ├─ buildBodyShort()           ← 1–2 sentence explanation
 *       ├─ buildBodyLong()            ← optional deeper expansion
 *       └─ resolveInterventionDecision()
 *       ↓
 *   CoachingFeedbackPacket            ← consumed by UI layer
 *
 * Design rules:
 *   - Pure functions: (input) → output, no side effects, no React.
 *   - Never expose engine scores, Fritz internals, or delta numbers to players.
 *   - Never say "optimal", "engine", "heuristic", or "expected value".
 *   - Tone adapts to: move category, confidence, neitherScores, risk flags,
 *     game mode, and player level. Low confidence always softens everything.
 *   - Headlines are punchy; body sentences are complete; long copy is only
 *     generated when there is genuine teaching depth.
 */

import type {
  MoveCategory,
  InterventionLevel,
  CoachingConceptTag,
  PlayerLevel,
  LearnGameMode,
} from './types.ts';
import type {
  LearningMoveAnalysis,
  MoveEvaluationResult,
} from './moveAnalysis.ts';
import { computeInterventionLevel } from './moveAnalysis.ts';

// ─── Phase 1 types (preserved exactly from Phase 1 spec) ─────────────────────

/**
 * Everything the UI needs to render the coach panel for one move.
 *
 * Rules:
 *  - coachHeadline  → short, human, punchy (≤8 words)
 *  - coachBodyShort → 1–2 sentences max, always beginner-safe
 *  - coachBodyLong  → optional; only shown behind "Why?" expansion
 *  - bestMoveLabel  → what the coach would have played (shown only when relevant)
 *  - confidence     → drives tone; low = coach is gentler / more hedged
 */
export type CoachingFeedbackPacket = {
  /** Full analysis of the move the coach would recommend (pre-move phase) */
  recommendedMove?: LearningMoveAnalysis;

  /** Full analysis of the move the player actually chose (post-move phase) */
  chosenMove?: LearningMoveAnalysis;

  /** Quality grade for the player's chosen move (undefined pre-move) */
  moveGrade?: MoveCategory;

  /** How much the coach should interrupt (drives UI behavior) */
  interventionLevel: InterventionLevel;

  /** Short headline shown in the coach panel — never robotic or technical */
  coachHeadline: string;

  /** One or two sentence explanation — always visible after the move */
  coachBodyShort: string;

  /**
   * Deeper explanation for the "Why?" expansion.
   * Only populated when there's genuine teaching value beyond the short copy.
   */
  coachBodyLong?: string;

  /**
   * Human label for the stronger move, e.g. "[3|4] on the left".
   * Only shown when the player did not play the best move.
   */
  bestMoveLabel?: string;

  /**
   * True when the coach recommends the player try the move again.
   * Only set for strong interventions in training/challenge modes.
   */
  retryRecommended?: boolean;

  /**
   * The concept tags most relevant to this coaching moment.
   * Used to drive the hand recap and update the learning profile.
   */
  teachableMoments: CoachingConceptTag[];

  /**
   * 0–1. Reflects how clearly the engine prefers the recommended move.
   * Low confidence → coaching copy should be hedged and gentle.
   * Derived from the score gap between rank-1 and rank-2 moves.
   */
  confidence: number;
};

/**
 * Sent to the UI *before* the player moves.
 * Used to populate the coach panel with a suggestion and short reason.
 */
export type PreMoveRecommendation = {
  suggestedMove: LearningMoveAnalysis;
  promptText: string;
  showHighlight: boolean;
  confidence: number;
};

/**
 * Internal record used by the intervention-level logic to explain its decision.
 * Consumed by the debug panel; not shown to the player.
 */
export type InterventionDecision = {
  level: InterventionLevel;
  rationale:
    | 'move_is_best_or_excellent'
    | 'small_difference_trivial'
    | 'missed_better_move_teachable'
    | 'missed_clean_score'
    | 'opened_risk'
    | 'clear_blunder'
    | 'huge_missed_score'
    | 'severe_self_block';
  scoreDelta: number;
  modeOverride?: LearnGameMode;
};

/**
 * Everything the message builder needs to produce coaching copy.
 */
export type CoachingMessageContext = {
  recommendedMove: LearningMoveAnalysis;
  chosenMove?: LearningMoveAnalysis;
  moveGrade?: MoveCategory;
  interventionLevel: InterventionLevel;
  isAmbiguousPosition: boolean;
  confidence: number;
  playerLevel: PlayerLevel;
  gameMode: LearnGameMode;
};

// ─── Input contract ───────────────────────────────────────────────────────────

/**
 * Everything buildCoachingFeedback() needs.
 * Callers pass the MoveEvaluationResult they already have from Phase 2.
 */
export type CoachingFeedbackInput = {
  result: MoveEvaluationResult;
  playerLevel: PlayerLevel;
  gameMode: LearnGameMode;
};

// ─── Tone descriptor ─────────────────────────────────────────────────────────

/**
 * Internal: describes the voice/register the coach should adopt for this move.
 * Picked once and threaded through all copy-generation functions.
 *
 *   celebrate      — best or excellent; positive, brief
 *   praise_near    — near-best; acknowledge solid play, add tiny nudge
 *   gentle_guide   — good move or low-confidence; explain kindly
 *   clarify_risk   — scored but opened a reply threat; honest about trade-off
 *   strategic_note — non-scoring position miss; strategy framing, not blame
 *   coach_correct  — dubious; clear correction, not scolding
 *   alert          — clear blunder; direct, honest
 *   silent         — no intervention needed
 */
type CoachTone =
  | 'celebrate'
  | 'praise_near'
  | 'gentle_guide'
  | 'clarify_risk'
  | 'strategic_note'
  | 'coach_correct'
  | 'alert'
  | 'silent';

// ─── Tone selection ───────────────────────────────────────────────────────────

/**
 * Selects the appropriate coach tone for this situation.
 *
 * Priority order:
 *   1. No chosen move → silent (pre-move phase)
 *   2. Equivalent move (same open ends, same pts) → celebrate (no fake distinctions)
 *   3. No intervention needed → celebrate or praise or silent
 *   4. Ambiguous position → always gentle regardless of category
 *   5. Low confidence → gentle regardless of category
 *   6. Non-scoring position → strategic_note (never alert)
 *   7. Scoring+risky → clarify_risk
 *   8. Category-driven escalation
 */
function selectTone(
  chosenCategory: MoveCategory | undefined,
  interventionLevel: InterventionLevel,
  isAmbiguous: boolean,
  neitherScores: boolean,
  hasRiskFlags: boolean,
  immediateScore: number,
  confidence: number,
  isEquivalentToBest: boolean,
): CoachTone {
  if (chosenCategory === undefined) return 'silent';

  // Equivalent moves: same open ends, same immediate points — the engine's
  // internal score difference is not a real strategic distinction the coach
  // should teach. Treat as best and celebrate.
  if (isEquivalentToBest) return 'celebrate';

  if (interventionLevel === 'none') {
    if (chosenCategory === 'best')      return 'celebrate';
    if (chosenCategory === 'excellent') return 'praise_near';
    return 'silent';
  }

  if (isAmbiguous)        return 'gentle_guide';
  if (confidence < 0.35)  return 'gentle_guide';
  if (neitherScores)      return 'strategic_note';

  if (immediateScore > 0 && hasRiskFlags) return 'clarify_risk';

  switch (chosenCategory) {
    case 'best':      return 'celebrate';
    case 'excellent': return 'praise_near';
    case 'good':      return 'gentle_guide';
    case 'dubious':   return 'coach_correct';
    case 'blunder':   return 'alert';
    default:          return 'gentle_guide';
  }
}

// ─── Headline builder ─────────────────────────────────────────────────────────

/**
 * Generates the ≤8-word headline shown at the top of the coach panel.
 *
 * Rules:
 *   - Conversational, not clinical: "Nice one." not "Optimal move played."
 *   - Never reference scores, deltas, or the engine.
 *   - For celebrate/praise: a brief positive line.
 *   - For corrections: a soft hook — the body carries the explanation.
 *   - Player level: beginners get warmth, advanced get directness.
 */
function buildHeadline(
  tone: CoachTone,
  chosenCategory: MoveCategory | undefined,
  playerLevel: PlayerLevel,
  isAmbiguous: boolean,
  neitherScores: boolean,
  bestMoveScores: boolean,
  hasRiskFlags: boolean,
): string {
  if (chosenCategory === undefined) return 'Your turn.';

  switch (tone) {
    case 'celebrate':
      return playerLevel === 'advanced'
        ? 'Best move.'
        : playerLevel === 'intermediate'
          ? "That's the play."
          : 'Nice one!';

    case 'praise_near':
      return playerLevel === 'advanced'
        ? 'Solid choice.'
        : 'Good thinking.';

    case 'gentle_guide':
      if (isAmbiguous) {
        return neitherScores ? 'Tricky spot — no easy score.' : 'Close call here.';
      }
      return playerLevel === 'advanced'
        ? "There's a cleaner option."
        : 'Worth knowing.';

    case 'strategic_note':
      return playerLevel === 'advanced'
        ? 'Board structure matters here.'
        : 'No points either way — position is key.';

    case 'clarify_risk':
      return hasRiskFlags
        ? 'Good score, but watch the board.'
        : "Scored — keep an eye on what's open.";

    case 'coach_correct':
      return bestMoveScores
        ? playerLevel === 'advanced'
          ? 'Score was available.'
          : 'A score was on the table.'
        : playerLevel === 'advanced'
          ? 'Stronger option available.'
          : "There's a better play here.";

    case 'alert':
      return bestMoveScores
        ? playerLevel === 'advanced'
          ? 'Missed scoring opportunity.'
          : 'Points were right there.'
        : playerLevel === 'advanced'
          ? 'This creates a real problem.'
          : "Let's look at this one.";

    case 'silent':
    default:
      return '';
  }
}

// ─── Body-short builder ───────────────────────────────────────────────────────

/**
 * Generates the 1–2 sentence coaching body shown always after the move.
 *
 * Sources (priority order):
 *   1. Context-specific copy for tone + reason + flags
 *   2. The explanationShort from Phase 2 (already reason-tagged)
 *   3. Generic fallback
 *
 * The Phase 2 explanationShort is used as a base and surrounded with
 * situation-appropriate framing rather than regenerating everything.
 */
function buildBodyShort(
  ctx: CoachingMessageContext,
  tone: CoachTone,
  chosenMove: LearningMoveAnalysis | undefined,
  bestMove: LearningMoveAnalysis,
  neitherScores: boolean,
): string {
  const { playerLevel, confidence, isAmbiguousPosition } = ctx;

  if (tone === 'silent' || !chosenMove) return '';

  // ── Celebrate: use Phase 2 explanation directly ──────────────────────────
  // The explanationShort already surfaces reply-risk language when the threat
  // is genuinely dangerous (opensEndDangerLevel === 'dangerous'). Appending a
  // generic "watch the board" note here would duplicate that warning for
  // dangerous positions and add noise for all other scoring moves.
  if (tone === 'celebrate') {
    return chosenMove.explanationShort;
  }

  // ── Praise near-best: acknowledge solid play, note the edge ─────────────
  if (tone === 'praise_near') {
    const bestLabel = bestMove.moveNotation;
    if (playerLevel === 'beginner') {
      return `${chosenMove.explanationShort} For next time: ${bestLabel} was slightly stronger.`;
    }
    return `${chosenMove.explanationShort} There was a marginal edge to ${bestLabel}, but this is a sound play.`;
  }

  // ── Gentle guide ─────────────────────────────────────────────────────────
  if (tone === 'gentle_guide') {
    if (isAmbiguousPosition) {
      return playerLevel === 'beginner'
        ? `These moves are pretty close. ${chosenMove.explanationShort}`
        : `The top options are nearly equal here — both are defensible. ${chosenMove.explanationShort}`;
    }
    const bestLabel = bestMove.moveNotation;
    if (confidence < 0.35) {
      return playerLevel === 'beginner'
        ? `${chosenMove.explanationShort} ${bestLabel} might be slightly better, but it's a close call.`
        : `${chosenMove.explanationShort} ${bestLabel} had a small edge, though the difference is marginal.`;
    }
    return `${chosenMove.explanationShort} ${bestLabel} was the stronger option here.`;
  }

  // ── Strategic note: no-score position — explain the board-control logic ──
  if (tone === 'strategic_note') {
    const bestLabel = bestMove.moveNotation;
    switch (playerLevel) {
      case 'beginner':
        return `Nothing scores right now — it's all about position. ${bestLabel} puts a better number on the board for later.`;
      case 'intermediate':
        return `In no-score positions, think about which open end helps you most next turn. ${bestLabel} gives better board structure.`;
      case 'advanced':
        return `No immediate scoring available — this is a board-control decision. ${bestLabel} creates a more favourable pip distribution for future turns.`;
    }
  }

  // ── Clarify risk: scored but opened a reply threat ───────────────────────
  if (tone === 'clarify_risk') {
    const replyThreat = chosenMove.riskFlags.includes('gives_easy_score_back');
    if (replyThreat) {
      switch (playerLevel) {
        case 'beginner':
          return `You scored, but the end you just opened gives the opponent a chance to score back. Keep an eye on it next turn.`;
        case 'intermediate':
          return `Good score, and the right call. The reply risk here is real — your opponent may have a tile that fits the open end you just created.`;
        case 'advanced':
          return `Score is correct. The open end creates a reply vector — note the pip value and track whether your opponent has the matching tile.`;
      }
    }
    return `${chosenMove.explanationShort} Be aware of the board state after this play.`;
  }

  // ── Coach correct: dubious miss ───────────────────────────────────────────
  if (tone === 'coach_correct') {
    const bestLabel = bestMove.moveNotation;
    const missedScore = bestMove.immediatePoints > 0 && chosenMove.immediatePoints === 0;

    if (missedScore) {
      switch (playerLevel) {
        case 'beginner':
          return `${bestLabel} would have scored here. It's worth checking for scoring plays before picking a tile.`;
        case 'intermediate':
          return `${bestLabel} was scoring — take the points when they're available. ${chosenMove.explanationShort}`;
        case 'advanced':
          return `${bestLabel} scores. Scoring moves take clear priority unless there's a concrete reason to pass. ${chosenMove.explanationShort}`;
      }
    }

    switch (playerLevel) {
      case 'beginner':
        return `${bestLabel} was the stronger option here. ${bestMove.explanationShort}`;
      case 'intermediate':
        return `${bestLabel} was stronger — ${bestMove.explanationShort.toLowerCase()} ${chosenMove.explanationShort}`;
      case 'advanced':
        return `${bestLabel} was correct. ${bestMove.explanationShort} Your play: ${chosenMove.explanationShort.toLowerCase()}`;
    }
  }

  // ── Alert: clear blunder ──────────────────────────────────────────────────
  if (tone === 'alert') {
    const bestLabel = bestMove.moveNotation;
    const missedScore = bestMove.immediatePoints > 0 && chosenMove.immediatePoints === 0;
    const selfBlocked = chosenMove.riskFlags.includes('self_blocks');

    if (missedScore) {
      switch (playerLevel) {
        case 'beginner':
          return `${bestLabel} scores points — in Racehorse, you almost always want to take a score when it's there. Look for scoring plays first.`;
        case 'intermediate':
          return `${bestLabel} was scoring. Missing available points is one of the most costly habits to break — scan for scores before anything else.`;
        case 'advanced':
          return `${bestLabel} scores. There's very rarely a strategic justification for passing on available points.`;
      }
    }

    if (selfBlocked) {
      switch (playerLevel) {
        case 'beginner':
          return `This move can get you stuck — it closes off a number you still need later. ${bestLabel} avoids that problem.`;
        case 'intermediate':
          return `This strands a pip value in your hand. ${bestLabel} keeps your options open.`;
        case 'advanced':
          return `Self-block on a key pip value. ${bestLabel} maintains tile liquidity.`;
      }
    }

    switch (playerLevel) {
      case 'beginner':
        return `${bestLabel} was the right move — ${bestMove.explanationShort.toLowerCase()} Your play leaves the board in a harder spot.`;
      case 'intermediate':
        return `${bestLabel} was clearly stronger. ${bestMove.explanationShort} This play creates a significant disadvantage.`;
      case 'advanced':
        return `${bestLabel}. ${bestMove.explanationShort} This move results in a position that's difficult to recover from.`;
    }
  }

  return chosenMove.explanationShort;
}

// ─── Body-long builder ────────────────────────────────────────────────────────

/**
 * Generates the optional "Why?" expansion.
 * Only populated when there is genuine, non-obvious teaching depth.
 * Phase 2's explanationLong is used as the primary source; this layer
 * adds coaching-context framing around it.
 */
function buildBodyLong(
  tone: CoachTone,
  chosenMove: LearningMoveAnalysis | undefined,
  bestMove: LearningMoveAnalysis,
  playerLevel: PlayerLevel,
): string | undefined {
  if (!chosenMove) return undefined;
  if (tone === 'silent' || tone === 'celebrate') return undefined;

  // ── Praise near-best ─────────────────────────────────────────────────────
  if (tone === 'praise_near') {
    if (playerLevel === 'beginner') return undefined;
    if (chosenMove.explanationLong) return chosenMove.explanationLong;
    const bestLabel = bestMove.moveNotation;
    return playerLevel === 'advanced'
      ? `${bestLabel} marginally outperforms on board-end control, but the delta here is small enough that it won't affect game outcome. Both plays are sound.`
      : `The difference between your play and ${bestLabel} is minor. The edge comes down to which pip ends up on the board and which is easier for the opponent to match.`;
  }

  // ── Strategic note ────────────────────────────────────────────────────────
  if (tone === 'strategic_note' && playerLevel !== 'beginner') {
    const bestLabel = bestMove.moveNotation;
    const base = playerLevel === 'advanced'
      ? `When no immediate score is available, Racehorse becomes a board-architecture game. Every tile you play shifts which pip values are live on the open ends — and those ends determine who scores first on the next turn.`
      : `In positions where nothing scores right now, the most important question is: what numbers will be on the ends after your play? Good players think one move ahead even when nothing seems to be happening.`;
    const suffix = chosenMove.explanationLong
      ? chosenMove.explanationLong
      : `Here, ${bestLabel} works because ${bestMove.explanationShort.toLowerCase()}`;
    return `${base} ${suffix}`;
  }

  // ── Clarify risk ──────────────────────────────────────────────────────────
  if (tone === 'clarify_risk') {
    const replyThreat = chosenMove.riskFlags.includes('gives_easy_score_back');
    if (!replyThreat) return chosenMove.explanationLong;

    const base = playerLevel === 'advanced'
      ? `Scoring is correct here, but the resulting board creates a reply vector. Tracking what pip value your opponent might hold for the open end is part of what separates strong players from good ones.`
      : `Taking the score is the right call — but the board you leave behind matters too. When you open an end, think about whether your opponent is likely to match it next turn.`;

    if (chosenMove.explanationLong) return `${base} ${chosenMove.explanationLong}`;
    return base;
  }

  // ── Coach correct and alert ───────────────────────────────────────────────
  if (tone === 'coach_correct' || tone === 'alert') {
    const bestLabel = bestMove.moveNotation;
    const missedScore = bestMove.immediatePoints > 0 && chosenMove.immediatePoints === 0;

    if (missedScore) {
      const base = playerLevel === 'advanced'
        ? `In Racehorse dominoes, immediate scoring takes clear priority. The first-mover edge compounds — your opponent now must catch up or accept a deficit. There is almost no strategic justification for voluntarily passing on a scoring move.`
        : `The core rule in Racehorse is: if you can score points right now, you almost always should. ${bestLabel} creates a multiple of 5 on the open ends — that's immediate points on the board.`;
      if (bestMove.explanationLong) return `${base} ${bestMove.explanationLong}`;
      return base;
    }

    if (playerLevel === 'beginner') return undefined;
    if (bestMove.explanationLong) return bestMove.explanationLong;

    return playerLevel === 'advanced'
      ? `${bestLabel} creates better pip distribution on the open ends, which directly affects who scores next turn. The board-control advantage compounds — small positional edges become decisive over multiple turns.`
      : `${bestLabel} was stronger because of how it changes the numbers showing on the board. The "live" pip values on the open ends determine what tiles are useful — and right now, ${bestLabel} would have set up a better position.`;
  }

  // ── Gentle guide ──────────────────────────────────────────────────────────
  if (tone === 'gentle_guide') {
    if (playerLevel === 'beginner') return undefined;
    return chosenMove.explanationLong ?? bestMove.explanationLong ?? undefined;
  }

  return undefined;
}

// ─── Best-move label ──────────────────────────────────────────────────────────

function buildBestMoveLabel(
  bestMove: LearningMoveAnalysis,
  chosenMove: LearningMoveAnalysis | undefined,
  tone: CoachTone,
): string | undefined {
  if (!chosenMove) return undefined;
  if (tone === 'celebrate' || tone === 'silent') return undefined;
  if (bestMove.moveId === chosenMove.moveId) return undefined;

  const move = bestMove.move;
  if (move.type === 'pass') return 'Pass';
  if (!move.tile || !move.position) return bestMove.moveNotation;

  const { low, high } = move.tile;
  const posLabel =
    move.position === 'left'  ? 'on the left'  :
    move.position === 'right' ? 'on the right' :
    `on the ${move.position}`;

  return `[${low}|${high}] ${posLabel}`;
}

// ─── Retry recommendation ─────────────────────────────────────────────────────

function shouldRecommendRetry(
  interventionLevel: InterventionLevel,
  gameMode: LearnGameMode,
  tone: CoachTone,
): boolean {
  if (gameMode === 'guided') return false;
  if (tone === 'celebrate' || tone === 'praise_near' || tone === 'silent') return false;
  return interventionLevel === 'strong' && gameMode === 'challenge';
}

// ─── Teachable moments ────────────────────────────────────────────────────────

/**
 * Selects the concept tags most worth surfacing for the hand recap.
 * For corrections: leads with the BEST move's concepts (what to learn).
 * Deduplicates; caps at 3 for clarity.
 */
function resolveTeachableMoments(
  chosenMove: LearningMoveAnalysis | undefined,
  bestMove: LearningMoveAnalysis,
  tone: CoachTone,
): CoachingConceptTag[] {
  const seen = new Set<CoachingConceptTag>();
  const tags: CoachingConceptTag[] = [];

  const add = (t: CoachingConceptTag) => {
    if (!seen.has(t)) { seen.add(t); tags.push(t); }
  };

  // For corrections: lead with BEST move's concepts (the teaching target)
  if (
    tone === 'coach_correct' ||
    tone === 'alert' ||
    tone === 'strategic_note'
  ) {
    bestMove.conceptTags.forEach(add);
  }

  // Always include chosen move's concepts
  chosenMove?.conceptTags.forEach(add);

  // Risk-driven concepts
  if (chosenMove?.riskFlags.includes('gives_easy_score_back')) add('risk_management');
  if (chosenMove?.riskFlags.includes('opens_dangerous_end'))    add('defense');
  if (chosenMove?.riskFlags.includes('reduces_future_options')) add('flexibility');

  return tags.slice(0, 3);
}

// ─── Intervention decision (debug/logging) ────────────────────────────────────

/**
 * Produces the internal InterventionDecision record explaining WHY the
 * system chose this intervention level. Used by the debug panel only.
 */
export function resolveInterventionDecision(
  chosenMove: LearningMoveAnalysis | undefined,
  bestMove: LearningMoveAnalysis,
  interventionLevel: InterventionLevel,
  gameMode: LearnGameMode,
): InterventionDecision {
  const delta     = chosenMove?.scoreDeltaFromBest ?? 0;
  const chosenPts = chosenMove?.immediatePoints ?? 0;
  const bestPts   = bestMove.immediatePoints;

  let rationale: InterventionDecision['rationale'];

  if (!chosenMove || chosenMove.category === 'best' || chosenMove.category === 'excellent') {
    rationale = 'move_is_best_or_excellent';
  } else if (chosenMove.riskFlags.includes('self_blocks')) {
    rationale = 'severe_self_block';
  } else if (bestPts > 0 && chosenPts === 0 && delta > 34) {
    rationale = 'missed_clean_score';
  } else if (chosenMove.riskFlags.includes('opens_dangerous_end')) {
    rationale = 'opened_risk';
  } else if (chosenMove.category === 'blunder' && delta > 60) {
    rationale = 'huge_missed_score';
  } else if (chosenMove.category === 'blunder') {
    rationale = 'clear_blunder';
  } else if (chosenMove.category === 'dubious') {
    rationale = 'missed_better_move_teachable';
  } else {
    rationale = 'small_difference_trivial';
  }

  return {
    level:    interventionLevel,
    rationale,
    scoreDelta: delta,
    modeOverride: gameMode !== 'guided' ? gameMode : undefined,
  };
}

// ─── Pre-move recommendation builder ─────────────────────────────────────────

/**
 * Builds the suggestion shown BEFORE the player picks a tile.
 * Guided mode highlights the suggestion; training/challenge may suppress it.
 */
export function buildPreMoveRecommendation(
  result: MoveEvaluationResult,
  playerLevel: PlayerLevel,
  gameMode: LearnGameMode,
): PreMoveRecommendation {
  const best = result.bestMove;

  let promptText: string;

  if (result.isAmbiguousPosition) {
    promptText = playerLevel === 'beginner'
      ? `A few moves are about even here. ${best.moveNotation} is one solid option.`
      : `The top moves are nearly equal. ${best.moveNotation} has a slight edge on board structure.`;
  } else if (best.immediatePoints > 0) {
    promptText = playerLevel === 'beginner'
      ? `${best.moveNotation} scores points — that's your play.`
      : `${best.moveNotation} is the scoring move here. Take it.`;
  } else if (result.neitherScores) {
    promptText = playerLevel === 'beginner'
      ? `Nothing scores right now. ${best.moveNotation} gives you the best board position.`
      : `No score available. ${best.moveNotation} creates the best pip structure for next turn.`;
  } else {
    promptText = playerLevel === 'beginner'
      ? `${best.moveNotation} is the strongest play here.`
      : `${best.moveNotation} — ${best.explanationShort.toLowerCase()}`;
  }

  return {
    suggestedMove: best,
    promptText,
    showHighlight: gameMode === 'guided',
    confidence:   result.engineConfidence,
  };
}

// ─── Main entry point (public) ────────────────────────────────────────────────

/**
 * Builds the complete CoachingFeedbackPacket for one player move.
 *
 * This is the ONLY function Phase 4 (UI integration) should call.
 * It consumes a MoveEvaluationResult from Phase 2 and returns a
 * self-contained packet the UI can render without knowing anything
 * about engine internals.
 *
 * Pipeline:
 *   1. Resolve intervention level (with neitherScores softening)
 *   2. Select coaching tone
 *   3. Generate headline, bodyShort, bodyLong
 *   4. Resolve teachable moments and best-move label
 *   5. Assemble and return the packet
 */
export function buildCoachingFeedback(
  input: CoachingFeedbackInput,
): CoachingFeedbackPacket {
  const { result, playerLevel, gameMode } = input;
  const { bestMove, chosenMove, engineConfidence, isAmbiguousPosition, neitherScores } = result;

  // ── 1. Intervention level ────────────────────────────────────────────────
  const interventionLevel = computeInterventionLevel(
    chosenMove?.category ?? 'best',
    engineConfidence,
    isAmbiguousPosition,
    gameMode,
    neitherScores,
  );

  // ── 2. Tone ───────────────────────────────────────────────────────────────
  const hasRiskFlags      = (chosenMove?.riskFlags.length ?? 0) > 0;
  const immediateScore    = chosenMove?.immediatePoints ?? 0;
  const isEquivalentToBest = chosenMove?.isEquivalentToBest ?? false;

  const tone = selectTone(
    chosenMove?.category,
    interventionLevel,
    isAmbiguousPosition,
    neitherScores,
    hasRiskFlags,
    immediateScore,
    engineConfidence,
    isEquivalentToBest,
  );

  // ── 3. Message context ────────────────────────────────────────────────────
  const ctx: CoachingMessageContext = {
    recommendedMove:    bestMove,
    chosenMove,
    moveGrade:          chosenMove?.category,
    interventionLevel,
    isAmbiguousPosition,
    confidence:         engineConfidence,
    playerLevel,
    gameMode,
  };

  // ── 4. Copy generation ────────────────────────────────────────────────────
  const headline  = buildHeadline(
    tone, chosenMove?.category, playerLevel,
    isAmbiguousPosition, neitherScores,
    bestMove.immediatePoints > 0, hasRiskFlags,
  );
  const bodyShort = buildBodyShort(ctx, tone, chosenMove, bestMove, neitherScores);
  const bodyLong  = buildBodyLong(tone, chosenMove, bestMove, playerLevel);

  // ── 5. Supporting fields ──────────────────────────────────────────────────
  const bestMoveLabel    = buildBestMoveLabel(bestMove, chosenMove, tone);
  const retryRecommended = shouldRecommendRetry(interventionLevel, gameMode, tone);
  const teachableMoments = resolveTeachableMoments(chosenMove, bestMove, tone);

  // ── 6. Assemble ───────────────────────────────────────────────────────────
  return {
    recommendedMove:  bestMove,
    chosenMove,
    moveGrade:        chosenMove?.category,
    interventionLevel,
    coachHeadline:    headline,
    coachBodyShort:   bodyShort,
    coachBodyLong:    bodyLong ?? undefined,
    bestMoveLabel,
    retryRecommended: retryRecommended || undefined,
    teachableMoments,
    confidence:       engineConfidence,
  };
}
