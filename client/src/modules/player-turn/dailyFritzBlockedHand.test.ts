import { describe, expect, it } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { isDailyFritzLockedBoneyardNoMove } from './dailyFritzBlockedHand.ts';

describe('isDailyFritzLockedBoneyardNoMove', () => {
  it('is false when the boneyard still has live tiles', () => {
    const match = createBotMatch(60, 7);
    expect(isDailyFritzLockedBoneyardNoMove(match)).toBe(false);
  });

  it('is true when boneyard is locked and bot has no legal moves', () => {
    const match = {
      ...createBotMatch(60, 7),
      boneyard: [],
      deadTiles: [],
      players: {
        ...createBotMatch(60, 7).players,
        bot: { ...createBotMatch(60, 7).players.bot, hand: [] },
      },
      board: createBotMatch(60, 7).board,
    };
    expect(isDailyFritzLockedBoneyardNoMove(match)).toBe(true);
  });
});