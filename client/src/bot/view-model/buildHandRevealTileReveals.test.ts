import { describe, expect, it } from 'vitest';
import { buildHandRevealTileReveals } from './buildHandRevealTileReveals.ts';

describe('buildHandRevealTileReveals', () => {
  it('returns an empty list when hand reveal is null', () => {
    expect(buildHandRevealTileReveals(null, 'Fritz')).toEqual([]);
  });

  it('builds tile reveals when hand reveal is present', () => {
    const reveals = buildHandRevealTileReveals(
      {
        winner: 'you',
        reason: 'domino',
        pointsAwarded: 12,
        loserPips: 9,
        calcText: '9 pips',
        yourRemainingTiles: [],
        botRemainingTiles: [{ low: 3, high: 4 }, { low: 5, high: 5 }],
      },
      'Fritz',
    );
    expect(reveals).toHaveLength(2);
    expect(reveals[0]?.ownerLabel).toBe('You');
    expect(reveals[1]?.ownerLabel).toBe('Fritz');
  });
});