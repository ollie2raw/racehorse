export const FRITZ_ROOKIE_ID = '00000000-0000-0000-0000-000000000002';
export const FRITZ_STANDARD_ID = '00000000-0000-0000-0000-000000000003';
export const FRITZ_ELITE_ID = '00000000-0000-0000-0000-000000000001';
export const FRITZ_MASTER_ID = '00000000-0000-0000-0000-000000000004';
export const FRITZ_GRANDMASTER_ID = '00000000-0000-0000-0000-000000000005';

export type FritzTier = 'rookie' | 'standard' | 'elite' | 'master' | 'grandmaster';

export const FRITZ_TIERS = {
  rookie: {
    id: FRITZ_ROOKIE_ID,
    label: 'Rookie',
    ratingLabel: '600',
    description: 'Learning the game. Good for beginners.',
    subdescription: undefined as string | undefined,
    difficulty: 'casual' as const,
    color: '#34d399',
  },
  standard: {
    id: FRITZ_STANDARD_ID,
    label: 'Standard',
    ratingLabel: '1000',
    description: 'Solid fundamentals. A real challenge.',
    subdescription: undefined as string | undefined,
    difficulty: 'standard' as const,
    color: '#60a5fa',
  },
  elite: {
    id: FRITZ_ELITE_ID,
    label: 'Elite',
    ratingLabel: '1600',
    description: 'Maximum strength. Unforgiving.',
    subdescription: 'The original Fritz.' as string | undefined,
    difficulty: 'hard' as const,
    color: '#f87171',
  },
  master: {
    id: FRITZ_MASTER_ID,
    label: 'Master',
    ratingLabel: '1950',
    description: 'Sampled endgame search. No mercy.',
    subdescription: undefined as string | undefined,
    difficulty: 'master' as const,
    color: '#f59e0b',
  },
  grandmaster: {
    id: FRITZ_GRANDMASTER_ID,
    label: 'Grandmaster',
    ratingLabel: '2100',
    description: 'Maximum fair search. Brutal precision.',
    subdescription: 'The strongest fair Fritz.' as string | undefined,
    difficulty: 'grandmaster' as const,
    color: '#a78bfa',
  },
} as const;

export function isFritzId(id: string): boolean {
  return id === FRITZ_ROOKIE_ID || id === FRITZ_STANDARD_ID || id === FRITZ_ELITE_ID || id === FRITZ_MASTER_ID || id === FRITZ_GRANDMASTER_ID;
}
