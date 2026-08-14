export const FRITZ_ROOKIE_ID = '00000000-0000-0000-0000-000000000002';
export const FRITZ_STANDARD_ID = '00000000-0000-0000-0000-000000000003';
export const FRITZ_ELITE_ID = '00000000-0000-0000-0000-000000000001';
export const FRITZ_MASTER_ID = '00000000-0000-0000-0000-000000000004';

export type FritzTier = 'rookie' | 'standard' | 'elite' | 'master';

/** Play vs Fritz UI accent hex (matches PlayVsFritz.tsx TIER_COLORS). */
export const FRITZ_TIER_PVF_COLORS: Record<FritzTier, string> = {
  rookie: '#4ADE80',
  standard: '#3B82F6',
  elite: '#E7B64A',
  master: '#A855F7',
};

export const HAND_OVER_DEFAULT_ACCENT = FRITZ_TIER_PVF_COLORS.elite;

export const FRITZ_TIERS = {
  rookie: {
    id: FRITZ_ROOKIE_ID,
    label: 'Rookie',
    ratingLabel: '~800',
    description: 'Forgiving learning opponent — same shuffle and draw as every tier.',
    subdescription: undefined as string | undefined,
    difficulty: 'casual' as const,
    color: 'var(--tier-rookie)',
  },
  standard: {
    id: FRITZ_STANDARD_ID,
    label: 'Standard',
    ratingLabel: '~1200',
    description: 'Balanced casual opponent — move quality only, not tile luck.',
    subdescription: undefined as string | undefined,
    difficulty: 'standard' as const,
    color: 'var(--tier-standard)',
  },
  elite: {
    id: FRITZ_ELITE_ID,
    label: 'Elite',
    ratingLabel: '~1700',
    description: 'Strong competitive opponent — Daily Fritz strength.',
    subdescription: 'The original Fritz.' as string | undefined,
    difficulty: 'hard' as const,
    color: 'var(--tier-elite)',
  },
  master: {
    id: FRITZ_MASTER_ID,
    label: 'Master',
    ratingLabel: '~2200',
    description: 'Brutal expert challenge — sharpest endgame, honest rules.',
    subdescription: undefined as string | undefined,
    difficulty: 'master' as const,
    color: 'var(--tier-master)',
  },
} as const;

export function isFritzId(id: string): boolean {
  return id === FRITZ_ROOKIE_ID || id === FRITZ_STANDARD_ID || id === FRITZ_ELITE_ID || id === FRITZ_MASTER_ID;
}
