import { describe, expect, it } from 'vitest';
import { classifyDailyFritzRecovery, projectDailyFritzRecoveryResult } from './dailyFritzRecoveryEligibility';
import { normalizeDailyFritzSetResult } from './http/stores/dailyFritzStore';

function game(gameNumber: number, playerWon = true) {
  return { gameNumber, playerWon, seed: 'seed', playerScore: 60, fritzScore: 20, pointDiff: 40, completedAt: '2026-10-01T00:00:00Z' };
}

describe('lightweight recovery eligibility matches the real completion decision', () => {
  it('covers every best-of-three win/loss combination, both aliases, and instant skunks', () => {
    const results: Record<string, unknown>[] = [];
    for (let count = 0; count <= 3; count += 1) {
      for (let mask = 0; mask < 2 ** count; mask += 1) {
        for (const winner of [undefined, 'player', 'fritz']) {
          for (const alias of ['setWinner', 'set_winner']) {
            for (const instant of [false, true]) {
              results.push({ version: 2, format: 'best_of_3', games: Array.from({ length: count }, (_, i) => game(i + 1, Boolean(mask & (1 << i)))), [alias]: winner, instantSkunk: instant, instant_skunk: instant, authority: { large: 'omitted' }, active_checkpoint: { large: 'omitted' } });
            }
          }
        }
      }
    }
    results.push({ version: 2, format: 'best_of_3', games: [game(1)], setWinner: 'player', set_winner: 'fritz', instantSkunk: true });
    for (const result of results) {
      const projected = projectDailyFritzRecoveryResult(result);
      expect(Boolean(normalizeDailyFritzSetResult(projected)?.setWinner)).toBe(Boolean(normalizeDailyFritzSetResult(result)?.setWinner));
      expect(classifyDailyFritzRecovery(projected) === 'complete').toBe(Boolean(normalizeDailyFritzSetResult(result)?.setWinner));
      expect(projected).not.toHaveProperty('authority');
      expect(projected).not.toHaveProperty('active_checkpoint');
    }
    expect(classifyDailyFritzRecovery({ version: 2, format: 'best_of_3', games: [game(1)], set_winner: 'fritz', instant_skunk: true })).toBe('complete');
    expect(classifyDailyFritzRecovery({ version: 2, format: 'best_of_3', games: [game(1), game(2, false)] })).toBe('incomplete');
  });

  it('separates absent/unplayed state from malformed results without trusting winner aliases alone', () => {
    expect(classifyDailyFritzRecovery(null)).toBe('incomplete');
    expect(classifyDailyFritzRecovery({ version: null, games: null })).toBe('incomplete');
    for (const result of [
      { version: 1, games: [] },
      { version: 2, format: 'best_of_3', games: [{ ...game(1), seed: '' }], setWinner: 'player' },
      { version: 2, format: 'best_of_3', games: [game(2)], set_winner: 'fritz' },
      { version: 2, format: 'best_of_3', games: [game(1), game(1)], setWinner: 'player' },
      { version: 2, format: 'best_of_3', games: [game(1), game(2), game(3), game(4)] },
    ]) expect(classifyDailyFritzRecovery(result)).toBe('ambiguous');
  });

  it.each(['gameNumber', 'playerScore', 'fritzScore', 'pointDiff', 'movesUsed', 'handsPlayed'])('isolates unsafe numeric coercion in games[].%s', (field) => {
    const result = JSON.parse(JSON.stringify({
      version: 2, format: 'best_of_3', setWinner: 'player',
      games: [{ ...game(1), [field]: { toString: 'invalid', valueOf: 'invalid' } }],
    }));
    const before = structuredClone(result);
    expect(() => normalizeDailyFritzSetResult(result)).toThrow(TypeError);
    expect(classifyDailyFritzRecovery(projectDailyFritzRecoveryResult(result))).toBe('ambiguous');
    expect(result).toEqual(before);
  });

  it.each(['playerGamesWon', 'player_games_won', 'fritzGamesWon', 'fritz_games_won'])('isolates unsafe normalization of %s on full results', (field) => {
    const result = JSON.parse(JSON.stringify({ version: 2, format: 'best_of_3', games: [game(1), game(2)], [field]: { toString: null, valueOf: false } }));
    expect(() => normalizeDailyFritzSetResult(result)).toThrow(TypeError);
    expect(classifyDailyFritzRecovery(result)).toBe('ambiguous');
  });

  it('handles malformed result containers and property-access exceptions without guessing completion', () => {
    for (const result of [false, 0, '', 'corrupt', [], [game(1)]]) expect(classifyDailyFritzRecovery(result)).toBe('ambiguous');
    const result = Object.defineProperty({}, 'version', { get() { throw new Error('unreadable version'); } });
    expect(classifyDailyFritzRecovery(result)).toBe('ambiguous');
  });

  it('preserves supported numeric/string coercions and optional game counters', () => {
    const result = {
      version: 2, format: 'best_of_3', playerGamesWon: '2', fritz_games_won: '0',
      games: [1, 2].map((number) => ({ ...game(number), gameNumber: String(number), playerScore: '60', fritzScore: '20', pointDiff: '40', movesUsed: '12', handsPlayed: '1' })),
    };
    expect(classifyDailyFritzRecovery(projectDailyFritzRecoveryResult(result))).toBe('complete');
    expect(Boolean(normalizeDailyFritzSetResult(result)?.setWinner)).toBe(true);
  });
});
