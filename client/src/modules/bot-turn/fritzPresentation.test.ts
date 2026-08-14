// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildFritzScoreCeremonyMessage,
  buildFritzTurnLabel,
} from './fritzPresentation.ts';

describe('fritzPresentation copy', () => {
  it('builds a simple +points score callout', () => {
    expect(buildFritzScoreCeremonyMessage('Fritz', 5, 5)).toBe('+5');
    expect(buildFritzScoreCeremonyMessage('Fritz', 5, 12)).toBe('+5');
  });

  it('keeps the turn pill calm: thinking, drawing, or your move', () => {
    expect(
      buildFritzTurnLabel({
        opponentLabel: 'Fritz',
        botTurn: false,
        presentation: null,
        handOver: false,
        gameOver: false,
      }),
    ).toBe('Your move');

    expect(
      buildFritzTurnLabel({
        opponentLabel: 'Fritz',
        botTurn: true,
        presentation: { phase: 'thinking', drawCount: 0, turnScoreTotal: 0, lastScorePoints: 0 },
        handOver: false,
        gameOver: false,
      }),
    ).toBe('Fritz is thinking…');

    expect(
      buildFritzTurnLabel({
        opponentLabel: 'Fritz',
        botTurn: true,
        presentation: { phase: 'drawing', drawCount: 3, turnScoreTotal: 0, lastScorePoints: 0 },
        handOver: false,
        gameOver: false,
      }),
    ).toBe('Fritz is drawing…');

    // Score/chain/settle chatter stays off the pill.
    expect(
      buildFritzTurnLabel({
        opponentLabel: 'Fritz',
        botTurn: true,
        presentation: { phase: 'scoring', drawCount: 0, turnScoreTotal: 12, lastScorePoints: 5 },
        handOver: false,
        gameOver: false,
      }),
    ).toBe('Fritz is thinking…');

    expect(
      buildFritzTurnLabel({
        opponentLabel: 'Fritz',
        botTurn: true,
        presentation: { phase: 'chaining', drawCount: 0, turnScoreTotal: 12, lastScorePoints: 0 },
        handOver: false,
        gameOver: false,
      }),
    ).toBe('Fritz is thinking…');
  });
});
