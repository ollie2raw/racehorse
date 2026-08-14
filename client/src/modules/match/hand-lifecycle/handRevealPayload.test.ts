// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createBotMatch } from '../runtime/botEngine.ts';
import { buildHandRevealFromResult } from './handRevealPayload.ts';

describe('buildHandRevealFromResult', () => {
  it('maps hand-end fields and remaining tiles from the result state', () => {
    const state = createBotMatch(60, 7);
    const result = {
      state,
      handEnded: {
        winner: 'you' as const,
        reason: 'domino' as const,
        pointsAwarded: 12,
        loserPips: 8,
        calcText: '8 pips',
      },
    };
    const reveal = buildHandRevealFromResult(result);
    expect(reveal.winner).toBe('you');
    expect(reveal.pointsAwarded).toBe(12);
    expect(reveal.yourRemainingTiles).toBe(state.players.you.hand);
    expect(reveal.botRemainingTiles).toBe(state.players.bot.hand);
  });
});