import type { FritzTier } from './fritzConfig';

/** Display order for the tier details panel (low → high). */
export const FRITZ_TIER_DETAILS_ORDER: FritzTier[] = ['rookie', 'standard', 'elite', 'master'];

export const FRITZ_TIER_ROLE_LABELS: Record<FritzTier, string> = {
  rookie: 'Beginner',
  standard: 'Balanced',
  elite: 'Competitive',
  master: 'Expert',
};

export const FRITZ_TIER_DETAILS_INTRO =
  'The numbers below (like ~600 or ~1800) are approximate strength labels so you can compare tiers. They are not calibrated human Elo ratings.';

export const FRITZ_TIER_DETAILS_BODY: Record<FritzTier, string> = {
  rookie:
    'Beginner-friendly. Fritz makes more human-like mistakes, so you can learn without constant pressure.',
  standard: 'Balanced play — the best starting point for most players.',
  elite: 'Competitive Fritz, in the same strength family as Daily Fritz Classic.',
  master: 'Expert challenge with the strongest endgame and search behavior Fritz offers.',
};

export const FRITZ_TIER_DETAILS_DAILY_NOTE =
  'Daily Fritz Classic uses Elite Fritz — today’s competitive daily challenge on that tier.';
