export const FRITZ_ROOKIE_ID = '00000000-0000-0000-0000-000000000002';
export const FRITZ_STANDARD_ID = '00000000-0000-0000-0000-000000000003';
export const FRITZ_ELITE_ID = '00000000-0000-0000-0000-000000000001';

export type FritzTier = 'rookie' | 'standard' | 'elite';

export const FRITZ_TIERS = {
  rookie: {
    id: FRITZ_ROOKIE_ID,
    label: 'Rookie',
    ratingLabel: '1000',
    description: 'Learning the game. Good for beginners.',
    difficulty: 'casual' as const,
    color: '#34d399',
  },
  standard: {
    id: FRITZ_STANDARD_ID,
    label: 'Standard',
    ratingLabel: '1400',
    description: 'Solid fundamentals. A real challenge.',
    difficulty: 'standard' as const,
    color: '#60a5fa',
  },
  elite: {
    id: FRITZ_ELITE_ID,
    label: 'Elite',
    ratingLabel: '1800',
    description: 'Maximum strength. Unforgiving.',
    difficulty: 'hard' as const,
    color: '#f87171',
  },
} as const;

export function isFritzId(id: string): boolean {
  return id === FRITZ_ROOKIE_ID || id === FRITZ_STANDARD_ID || id === FRITZ_ELITE_ID;
}
