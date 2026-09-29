import { describe, expect, it } from 'vitest';
import { buildHandOverReasonCopy, resolveBotHandDisplayWinner } from './handOverCopy';

const tile = (low: number, high: number) => ({ id: `${low}-${high}`, low, high }) as never;

describe('resolveBotHandDisplayWinner', () => {
  it('credits the player who went out when the leftover pips scored 0', () => {
    expect(
      resolveBotHandDisplayWinner({
        winner: null,
        reason: 'domino',
        yourRemainingTiles: [],
        botRemainingTiles: [tile(1, 2)],
      }),
    ).toBe('you');
    expect(
      resolveBotHandDisplayWinner({
        winner: null,
        reason: 'domino',
        yourRemainingTiles: [tile(0, 1)],
        botRemainingTiles: [],
      }),
    ).toBe('bot');
  });

  it('keeps a scored winner and a genuine blocked tie', () => {
    expect(
      resolveBotHandDisplayWinner({
        winner: 'bot',
        reason: 'domino',
        yourRemainingTiles: [tile(3, 4)],
        botRemainingTiles: [],
      }),
    ).toBe('bot');
    expect(
      resolveBotHandDisplayWinner({
        winner: null,
        reason: 'blocked',
        yourRemainingTiles: [tile(1, 1)],
        botRemainingTiles: [tile(0, 2)],
      }),
    ).toBeNull();
  });
});

describe('buildHandOverReasonCopy', () => {
  it('explains a 0-point go-out instead of implying nothing happened', () => {
    expect(
      buildHandOverReasonCopy({
        youWentOut: true,
        opponentWentOut: false,
        isBlocked: false,
        opponentName: 'Fritz',
        pointsAwarded: 0,
      }),
    ).toBe("You went out — Fritz's leftover pips round to 0 points.");
  });
});
