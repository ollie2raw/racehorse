import { describe, expect, it } from 'vitest';
import { generateDailyFritzRun } from '../../dailyFritz';
import {
  buildDailyFritzRunFingerprint,
  getDailyFritzHandForGame,
} from './dailyFritzStore';

describe('Daily Fritz run deal authority', () => {
  it('prefers persisted game-1 hand deals over regenerated tiles', () => {
    const run = generateDailyFritzRun('2026-07-24', 'elite', 7, 60);
    const mutated = {
      ...run,
      handDeals: run.handDeals.map((deal, index) => (
        index === 0
          ? {
              ...deal,
              player_tiles: [{ low: 0, high: 0 }],
              fritz_tiles: [{ low: 1, high: 1 }],
              boneyard: deal.boneyard,
              locked: deal.locked,
            }
          : deal
      )),
    };
    const hand = getDailyFritzHandForGame(mutated, 1, 0);
    expect(hand.player_tiles).toEqual([{ low: 0, high: 0 }]);
    expect(hand.fritz_tiles).toEqual([{ low: 1, high: 1 }]);
  });

  it('still generates on-demand hands beyond the persisted snapshot', () => {
    const run = generateDailyFritzRun('2026-07-24', 'elite', 7, 60);
    const hand = getDailyFritzHandForGame(run, 1, run.handDeals.length);
    expect(hand.player_tiles).toHaveLength(7);
    expect(hand.fritz_tiles).toHaveLength(7);
  });

  it('builds a stable run fingerprint that changes when deals change', () => {
    const run = generateDailyFritzRun('2026-07-24', 'elite', 7, 60);
    const a = buildDailyFritzRunFingerprint(run);
    const b = buildDailyFritzRunFingerprint(run);
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
    const altered = {
      ...run,
      handDeals: run.handDeals.map((deal, index) => (
        index === 0
          ? { ...deal, player_tiles: [{ low: 6, high: 6 }, ...deal.player_tiles.slice(1)] }
          : deal
      )),
    };
    expect(buildDailyFritzRunFingerprint(altered)).not.toBe(a);
  });
});
