import { describe, expect, it } from 'vitest';
import { buildBotTurnScheduleKey } from './useBotTurnEffect.ts';

describe('buildBotTurnScheduleKey', () => {
  it('stays stable across mid-turn board/hand/boneyard churn', () => {
    const base = {
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    };
    const a = buildBotTurnScheduleKey(base);
    const b = buildBotTurnScheduleKey(base);
    expect(a).toBe(b);
    expect(a).toBe('bot:1:false:false:0');
  });

  it('changes when the turn owner or hand identity changes', () => {
    const bot = buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    });
    const you = buildBotTurnScheduleKey({
      currentPlayer: 'you',
      handNumber: 1,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    });
    const nextHand = buildBotTurnScheduleKey({
      currentPlayer: 'bot',
      handNumber: 2,
      handOver: false,
      gameOver: false,
      retryNonce: 0,
    });
    expect(bot).not.toBe(you);
    expect(bot).not.toBe(nextHand);
  });
});
