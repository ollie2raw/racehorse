import { describe, expect, it } from 'vitest';
import { createBotMatch, type BotHandDeal } from '../runtime/botEngine.ts';
import { createEndOfRunMatchState, tryApplyDailyFritzNextHand } from './dailyFritzHandService.ts';

const sampleDeal: BotHandDeal = {
  player_tiles: [
    { low: 0, high: 0 },
    { low: 0, high: 1 },
    { low: 0, high: 2 },
    { low: 0, high: 3 },
    { low: 0, high: 4 },
    { low: 0, high: 5 },
    { low: 0, high: 6 },
  ],
  fritz_tiles: [
    { low: 1, high: 1 },
    { low: 1, high: 2 },
    { low: 1, high: 3 },
    { low: 1, high: 4 },
    { low: 1, high: 5 },
    { low: 1, high: 6 },
    { low: 2, high: 2 },
  ],
  boneyard: [
    { low: 2, high: 3 },
    { low: 2, high: 4 },
    { low: 2, high: 5 },
    { low: 2, high: 6 },
    { low: 3, high: 3 },
    { low: 3, high: 4 },
    { low: 3, high: 5 },
  ],
  locked: [{ low: 3, high: 6 }],
};

describe('tryApplyDailyFritzNextHand', () => {
  it('refuses when the hand is still live', () => {
    const match = createBotMatch(60, 7);
    expect(tryApplyDailyFritzNextHand(match, sampleDeal).applied).toBe(false);
  });

  it('applies a fixed deal when handOver', () => {
    const match = {
      ...createBotMatch(60, 7),
      handOver: true,
      handNumber: 1,
    };
    const result = tryApplyDailyFritzNextHand(match, sampleDeal);
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.nextState.handOver).toBe(false);
      expect(result.nextState.handNumber).toBe(2);
    }
  });
});

describe('createEndOfRunMatchState', () => {
  it('marks game over with the higher-scoring player as winner', () => {
    const base = createBotMatch(60, 7);
    const match = {
      ...base,
      handOver: true,
      players: {
        you: { ...base.players.you, score: 70 },
        bot: { ...base.players.bot, score: 40 },
      },
    };
    const next = createEndOfRunMatchState(match);
    expect(next.gameOver).toBe(true);
    expect(next.handOver).toBe(false);
    expect(next.winnerId).toBe('you');
  });
});