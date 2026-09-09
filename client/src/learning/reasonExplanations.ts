/**
 * Turns a move classification (reason + features + player level) into coaching
 * prose. Split out of `reasonTagging.ts` (REFACTOR_OPPORTUNITIES R4) — that file
 * classifies the move; this one writes it up. Pure functions, no behaviour
 * change; `tagMove` in `reasonTagging.ts` is the only caller.
 */
import type { CoachingReason, PlayerLevel } from './types.ts';
import type { MoveFeatures } from './reasonTagging.ts';

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
    remainingPlayableCount: _remainingPlayableCount, playerNextTurnScoringCount, playerEndCoverage,
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

