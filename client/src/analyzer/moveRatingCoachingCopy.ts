import type { MoveRating } from './moveAnalyzer';

export type CoachingCopyTier = 'precise' | 'heuristic';

/**
 * Rounds an absolute score gap to one decimal and drops a trailing ".0" so
 * whole-number gaps don't read as fake precision (e.g. "2 points" not
 * "2.0 points").
 */
function formatGap(gap: number): string {
  const rounded = Math.round(Math.abs(gap) * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} point${rounded === 1 ? '' : 's'}`;
}

/**
 * Phase C coaching-copy increment (game-review-oracle-upgrade-2026-09-13.md):
 * data-driven copy explaining WHY a move's rating is what it is, grounded
 * only in numbers the system already computed -- never invented tactical
 * commentary. A lookup keyed by (rating, tier), not free-text generation.
 *
 * Two tiers, matching the honesty split the badge system already draws:
 * - 'precise' (exact/search oracle results): the real, calibrated
 *   normalized score gap (`loss.expectedPointDifferential`) is cited when
 *   the caller has one; without it, the copy still describes the bucket
 *   truthfully (what the bucket means) without inventing a number.
 * - 'heuristic': the underlying rawScore is explicitly documented
 *   (reviewContracts.ts) as *not* a real point differential -- this tier's
 *   copy is qualitative only and ignores any gap the caller passes, for
 *   the same reason classifyHeuristicResult coarsens to 3 buckets instead
 *   of the full 6-way scale.
 *
 * Brilliant is a precise-tier-only bucket meaning "exact match with the
 * best option" -- there is no real gap to cite for it, so a passed gap is
 * always ignored for that rating specifically.
 */
export function moveRatingCoachingCopy(
  rating: MoveRating,
  tier: CoachingCopyTier,
  scoreGap?: number,
): string | null {
  if (tier === 'heuristic') {
    switch (rating) {
      case 'Good':
        return 'A reasonable option among the choices available, by the engine\'s early-position estimate.';
      case 'Inaccuracy':
        return 'A weaker option among the choices available, by the engine\'s early-position estimate.';
      case 'Blunder':
        return 'The weakest option among the choices available, by the engine\'s early-position estimate.';
      default:
        // The heuristic classifier only ever produces Good/Inaccuracy/Blunder
        // buckets -- any other rating reaching here would be a caller error,
        // not a real case to write copy for.
        return null;
    }
  }

  const gap = rating === 'Brilliant' ? undefined : scoreGap;
  switch (rating) {
    case 'Brilliant':
      return 'The exact top-scoring line for this position.';
    case 'Great':
      return gap !== undefined
        ? `Very close to the best option -- about ${formatGap(gap)} behind.`
        : 'Very close to the best option available.';
    case 'Good':
      return gap !== undefined
        ? `A solid option, about ${formatGap(gap)} behind the best available.`
        : 'A solid, close option compared to the best available.';
    case 'Inaccuracy':
      return gap !== undefined
        ? `About ${formatGap(gap)} behind the best option -- a noticeably weaker choice.`
        : 'A noticeably weaker choice than the best option available.';
    case 'Mistake':
      return gap !== undefined
        ? `About ${formatGap(gap)} behind the best option -- a significant miss.`
        : 'A significant miss compared to the best option available.';
    case 'Blunder':
      return gap !== undefined
        ? `About ${formatGap(gap)} behind the best option -- the costliest choice available.`
        : 'The costliest choice available this turn.';
  }
}
