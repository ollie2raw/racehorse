/**
 * learning/buildHandSummary.ts
 *
 * Phase 5 implementation: hand summary builder.
 *
 * Consumes HandMoveRecord[] collected during a hand, produces the
 * HandLearningSummary that drives the end-of-hand recap card and
 * the profile update.
 *
 * Pure function: (input) → output, no side effects, no React.
 */

import type { CoachingConceptTag } from './types.ts';
import type { HandSummaryInput, HandLearningSummary } from './handSummary.ts';

// ---------------------------------------------------------------------------
// Key lesson copy (one per concept, deduplicated across hands by the caller)
// ---------------------------------------------------------------------------

const KEY_LESSON_COPY: Record<CoachingConceptTag, string> = {
  scoring:        'When a scoring play is available, take it — points compound quickly.',
  safety:         'Watch for easy return scores after your play; they often cost more than a turn.',
  defense:        'Think about what end value you leave open before you commit.',
  flexibility:    'Preserving variety in your hand keeps more options alive.',
  tempo:          'Creating pressure through scoring is stronger than defensive waiting.',
  board_control:  'Controlling which pip values are live on the open ends is a long-game skill.',
  risk_management:'Weigh the reply threat before trading points for a risky open end.',
  endgame:        'Late-game decisions turn on pip counts — track what you need to get out.',
};

// ---------------------------------------------------------------------------
// Encouragement lines (randomised; caller should pass a seed or use profile)
// ---------------------------------------------------------------------------

const WIN_LINES = [
  'Nice hand — you read the board well.',
  'You won this one clean. Keep it up.',
  "Good hand. Your scoring instincts are sharpening.",
];

const SOLID_LINES = [
  'Solid accuracy this hand — those small margins add up.',
  'Strong fundamentals showing through.',
  'Most of your choices were tight. That\'s real progress.',
];

const DEVELOPING_LINES = [
  'Every hand is a chance to tighten your game.',
  'You\'re building the pattern — keep scanning for scores first.',
  'Learning the board takes repetition. You\'re getting there.',
];

const TOUGH_LINES = [
  'Tough hand — the learning is in the misses. Review the key lesson.',
  'Hard position. The coach notes will help next time.',
  'Even strong players have rough hands. Stay with it.',
];

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildHandSummary(input: HandSummaryInput): HandLearningSummary {
  const { moveRecords, handScore, playerWonHand } = input;

  // Handle trivially short hands (pass-only, forced draw, etc.)
  if (moveRecords.length === 0) {
    return {
      handScore,
      moveAccuracy: 1,
      bestMovesPlayed:      0,
      excellentMovesPlayed: 0,
      goodMovesPlayed:      0,
      dubiousMovesPlayed:   0,
      blundersPlayed:       0,
      totalMoves:           0,
      missedScores:         0,
      defensiveMistakes:    0,
      flexibilityMistakes:  0,
      strongestConcept:     'scoring',
      weakestConcept:       'scoring',
      keyLesson:            KEY_LESSON_COPY.scoring,
      encouragement:        playerWonHand ? WIN_LINES[0]! : DEVELOPING_LINES[0]!,
    };
  }

  // ── Move-quality counters ─────────────────────────────────────────────────
  let best = 0, excellent = 0, good = 0, dubious = 0, blunders = 0;
  let missedScores = 0, defensiveMistakes = 0, flexibilityMistakes = 0;

  // Concept hit/miss tallies
  const conceptHits:   Partial<Record<CoachingConceptTag, number>> = {};
  const conceptMisses: Partial<Record<CoachingConceptTag, number>> = {};

  for (const record of moveRecords) {
    switch (record.category) {
      case 'best':      best++;      break;
      case 'excellent': excellent++; break;
      case 'good':      good++;      break;
      case 'dubious':   dubious++;   break;
      case 'blunder':   blunders++;  break;
    }

    if (record.immediatePointsMissed > 0) missedScores++;

    const isPositive = record.category === 'best' || record.category === 'excellent';

    for (const tag of record.conceptTags) {
      if (isPositive) {
        conceptHits[tag] = (conceptHits[tag] ?? 0) + 1;
      } else {
        conceptMisses[tag] = (conceptMisses[tag] ?? 0) + 1;
      }
    }

    // Categorise mistake type for detailed breakdown
    if (!isPositive) {
      const tags = record.conceptTags;
      if (tags.includes('defense') || tags.includes('risk_management')) {
        defensiveMistakes++;
      }
      if (tags.includes('flexibility') || tags.includes('board_control')) {
        flexibilityMistakes++;
      }
    }
  }

  const total    = moveRecords.length;
  const accuracy = (best + excellent) / total;

  // ── Strongest / weakest concept ───────────────────────────────────────────
  const allConcepts: CoachingConceptTag[] = [
    'scoring', 'safety', 'defense', 'flexibility',
    'board_control', 'risk_management', 'tempo', 'endgame',
  ];

  let strongestConcept: CoachingConceptTag = 'scoring';
  let weakestConcept:   CoachingConceptTag = 'scoring';
  let maxHit  = -1;
  let maxMiss = -1;

  for (const c of allConcepts) {
    const hits   = conceptHits[c]   ?? 0;
    const misses = conceptMisses[c] ?? 0;
    if (hits   > maxHit)  { maxHit  = hits;   strongestConcept = c; }
    if (misses > maxMiss) { maxMiss = misses;  weakestConcept   = c; }
  }

  // Missed scores trump everything else as the key lesson
  if (missedScores > 0 && missedScores >= Math.floor(total / 2)) {
    weakestConcept = 'scoring';
  }

  const keyLesson = KEY_LESSON_COPY[weakestConcept];

  // ── Encouragement ─────────────────────────────────────────────────────────
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

  let encouragement: string;
  if (playerWonHand) {
    encouragement = pick(WIN_LINES);
  } else if (accuracy >= 0.8) {
    encouragement = pick(SOLID_LINES);
  } else if (accuracy >= 0.5) {
    encouragement = pick(DEVELOPING_LINES);
  } else {
    encouragement = pick(TOUGH_LINES);
  }

  return {
    handScore,
    moveAccuracy: accuracy,
    bestMovesPlayed:      best,
    excellentMovesPlayed: excellent,
    goodMovesPlayed:      good,
    dubiousMovesPlayed:   dubious,
    blundersPlayed:       blunders,
    totalMoves:           total,
    missedScores,
    defensiveMistakes,
    flexibilityMistakes,
    strongestConcept,
    weakestConcept,
    keyLesson,
    encouragement,
  };
}
