import { describe, expect, it } from 'vitest';
import {
  FRITZ_CHALLENGE_DEFAULT_WINNING_SCORE,
  buildFritzChallengeIdentity,
  createGeneratedFritzChallenge,
  generateFritzChallengeHand,
  getFritzChallengeDrawTiles,
  getFritzChallengeDrawWinner,
  normalizeFritzChallengeShareCode,
} from './fritzChallenge';
import { dailyFritzDrawTilesMatchWinner } from './dailyFritz';

function tileKey(tile: { low: number; high: number }): string {
  return `${Math.min(tile.low, tile.high)}-${Math.max(tile.low, tile.high)}`;
}

describe('Fritz Challenge authority', () => {
  const seed = 'fixed-friend-challenge-seed';

  it('generates identical immutable hand vectors for the same challenge coordinates', () => {
    const first = generateFritzChallengeHand(seed, 2, 4, 7);
    const replay = generateFritzChallengeHand(seed, 2, 4, 7);
    expect(replay).toEqual(first);

    const playablePartition = [
      ...first.player_tiles,
      ...first.fritz_tiles,
      ...first.boneyard,
    ];
    expect(playablePartition).toHaveLength(28);
    expect(new Set(playablePartition.map(tileKey))).toHaveLength(28);
    expect(first.locked).toHaveLength(2);
    expect(first.locked.every((tile) => first.boneyard.some(
      (boneyardTile) => tileKey(boneyardTile) === tileKey(tile),
    ))).toBe(true);
  });

  it('separates games and hands while preserving deterministic replay', () => {
    const gameOne = generateFritzChallengeHand(seed, 1, 0, 7);
    const gameTwo = generateFritzChallengeHand(seed, 2, 0, 7);
    const nextHand = generateFritzChallengeHand(seed, 1, 1, 7);
    expect(gameTwo).not.toEqual(gameOne);
    expect(nextHand).not.toEqual(gameOne);
  });

  it('aligns every scripted draw with the predetermined opener', () => {
    for (const gameNumber of [1, 2, 3] as const) {
      const winner = getFritzChallengeDrawWinner(seed, gameNumber);
      const tiles = getFritzChallengeDrawTiles(seed, gameNumber);
      expect(dailyFritzDrawTilesMatchWinner(tiles, winner)).toBe(true);
    }
  });

  it('pins all authority versions into the challenge identity', () => {
    const challenge = createGeneratedFritzChallenge({
      creatorUserId: '11111111-1111-4111-8111-111111111111',
      fritzTier: 'elite',
      dealSize: 7,
      id: '22222222-2222-4222-8222-222222222222',
      shareCode: 'ABCDEFGH',
      seed,
      now: new Date('2026-07-26T12:00:00.000Z'),
    });
    expect(challenge.config.winningScore).toBe(FRITZ_CHALLENGE_DEFAULT_WINNING_SCORE);
    expect(buildFritzChallengeIdentity(challenge)).toBe(
      'fritz-challenge:22222222-2222-4222-8222-222222222222:r1:p2:v2:g1',
    );
  });

  it('normalizes human-entered share codes without accepting short codes', () => {
    expect(normalizeFritzChallengeShareCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeFritzChallengeShareCode('ABC')).toBeNull();
  });
});
