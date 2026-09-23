import type { MoveRating } from './moveAnalyzer';

export type CoachingCopyTier = 'precise' | 'heuristic';

/**
 * Formats an absolute score gap for user-facing copy.
 * - Exactly 0 → null (caller must use tied/best wording, never "0 points behind")
 * - Positive but below 0.1 display precision → "less than 0.1 point"
 * - Otherwise one decimal, dropping trailing ".0"
 */
export function formatScoreGapForDisplay(gap: number): string | null {
  const abs = Math.abs(gap);
  if (abs === 0 || Object.is(abs, -0)) return null;
  if (abs < 0.1) return 'less than 0.1 point';
  const rounded = Math.round(abs * 10) / 10;
  if (rounded === 0) return 'less than 0.1 point';
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} point${rounded === 1 ? '' : 's'}`;
}

/**
 * Phase C coaching-copy increment (game-review-oracle-upgrade-2026-09-13.md):
 * data-driven copy explaining WHY a move's rating is what it is, grounded
 * only in numbers the system already computed -- never invented tactical
 * commentary. A lookup keyed by (rating, tier), not free-text generation.
 *
 * Classification-aware: badge semantics and WHY copy must never contradict
 * (e.g. Mistake cannot say "A solid option"; Best cannot say "behind").
 */
export function moveRatingCoachingCopy(
  rating: MoveRating,
  tier: CoachingCopyTier,
  scoreGap?: number,
): string | null {
  if (tier === 'heuristic') {
    switch (rating) {
      case 'Good':
        return 'A reasonable option among the choices available, by Fritz\'s early-position read.';
      case 'Inaccuracy':
        return 'A weaker option among the choices available, by Fritz\'s early-position read.';
      case 'Blunder':
        return 'The weakest option among the choices available, by Fritz\'s early-position read.';
      case 'Brilliant':
      case 'Great':
        return 'Matches Fritz\'s early-position read for this turn.';
      case 'Mistake':
        return 'A meaningful miss relative to Fritz\'s early-position read.';
      default:
        return null;
    }
  }

  const gapLabel =
    rating === 'Brilliant'
      ? null
      : scoreGap === undefined
        ? undefined
        : formatScoreGapForDisplay(scoreGap);

  switch (rating) {
    case 'Brilliant':
      return 'The exact top-scoring line for this position.';
    case 'Great':
      if (gapLabel === null && scoreGap !== undefined) {
        return 'Tied with the best option available.';
      }
      return gapLabel
        ? `Very close to the best option -- about ${gapLabel} behind.`
        : 'Very close to the best option available.';
    case 'Good':
      if (gapLabel === null && scoreGap !== undefined) {
        return 'Tied with the best option available.';
      }
      return gapLabel
        ? `A solid option, about ${gapLabel} behind the best available.`
        : 'A solid, close option compared to the best available.';
    case 'Inaccuracy':
      if (gapLabel === null && scoreGap !== undefined) {
        return 'A small miss relative to the best option — within display precision of even.';
      }
      return gapLabel
        ? `About ${gapLabel} behind the best option -- a small miss.`
        : 'A small miss compared to the best option available.';
    case 'Mistake':
      if (gapLabel === null && scoreGap !== undefined) {
        return 'A meaningful miss relative to the best option.';
      }
      return gapLabel
        ? `About ${gapLabel} behind the best option -- a meaningful miss.`
        : 'A meaningful miss compared to the best option available.';
    case 'Blunder':
      if (gapLabel === null && scoreGap !== undefined) {
        return 'A major miss relative to the best option available.';
      }
      return gapLabel
        ? `About ${gapLabel} behind the best option -- a major miss.`
        : 'A major miss compared to the best option available.';
  }
}

/**
 * WHY-this-rating for calibrated (exact/search) labels, including Best.
 * Separate from MoveRating so Best is first-class and cannot fall through
 * to legacy Good/"solid option" wording.
 */
export function calibratedRatingCoachingCopy(
  label: 'Best' | 'Inaccuracy' | 'Mistake' | 'Blunder',
  scoreGap?: number,
): string {
  const gapLabel = scoreGap === undefined ? undefined : formatScoreGapForDisplay(scoreGap);

  switch (label) {
    case 'Best':
      return gapLabel == null
        ? 'Top move — matches the review reference for this position.'
        : 'Top move within the review\'s supported comparison.';
    case 'Inaccuracy':
      return gapLabel
        ? `About ${gapLabel} behind the best option -- a small miss.`
        : 'A small miss compared to the best option available.';
    case 'Mistake':
      return gapLabel
        ? `About ${gapLabel} behind the best option -- a meaningful miss.`
        : 'A meaningful miss compared to the best option available.';
    case 'Blunder':
      return gapLabel
        ? `About ${gapLabel} behind the best option -- a major miss.`
        : 'A major miss compared to the best option available.';
  }
}

export function forcedDecisionCoachingCopy(): string {
  return 'Only legal move — not graded.';
}

export function unavailableDecisionCoachingCopy(): string {
  return 'Review data unavailable for this decision — not graded.';
}
