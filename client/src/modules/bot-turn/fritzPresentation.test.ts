// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildFritzScoreCeremonyMessage,
  buildFritzTurnLabel,
  isFritzTurnHeldByPresentation,
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

describe('isFritzTurnHeldByPresentation', () => {
  const drawing = { phase: 'drawing', drawCount: 1, turnScoreTotal: 0, lastScorePoints: 0 } as const;
  it('holds only while the hand is live, the draw lock is up AND Fritz is presenting draws', () => {
    expect(isFritzTurnHeldByPresentation({ handActive: true, presentation: drawing, drawSequenceActive: true })).toBe(true);
    // the human's own forced draws raise the lock but never a Fritz "drawing" phase
    expect(isFritzTurnHeldByPresentation({ handActive: true, presentation: null, drawSequenceActive: true })).toBe(false);
    expect(isFritzTurnHeldByPresentation({ handActive: true, presentation: { ...drawing, phase: 'thinking' }, drawSequenceActive: true })).toBe(false);
    // lock released -> never stuck on Fritz's turn even if the phase lingers a tick
    expect(isFritzTurnHeldByPresentation({ handActive: true, presentation: drawing, drawSequenceActive: false })).toBe(false);
    expect(isFritzTurnHeldByPresentation({ handActive: false, presentation: drawing, drawSequenceActive: true })).toBe(false);
  });
});
