import { describe, expect, it } from 'vitest';
import {
  BOT_FORCED_DRAW_DELAY_MS,
  BOT_THINK_DELAY_MS,
  resolveBotTurnDelayMs,
  shouldContinueBotTurnAtTimer,
  shouldScheduleBotTurn,
} from './botTurnGuards.ts';

describe('resolveBotTurnDelayMs', () => {
  it('keeps a deliberate pause for legal Fritz moves', () => {
    expect(resolveBotTurnDelayMs(true)).toBe(BOT_THINK_DELAY_MS);
  });

  it('keeps at least a half-second pause before forced draw or pass', () => {
    expect(resolveBotTurnDelayMs(false)).toBe(BOT_FORCED_DRAW_DELAY_MS);
    expect(BOT_FORCED_DRAW_DELAY_MS).toBeGreaterThanOrEqual(500);
    expect(BOT_THINK_DELAY_MS).toBeGreaterThanOrEqual(500);
  });
});

describe('shouldScheduleBotTurn', () => {
  const base = {
    match: { currentPlayer: 'bot' as const, handOver: false, gameOver: false },
    drawSequenceActive: false,
    preGameDrawActive: false,
    isDailyFritzMode: false,
    isGuidedTranscriptMode: false,
    isGuidedV2Mode: false,
    isGuidedV2OffLine: false,
  };

  it('allows bot turn when all guards pass', () => {
    expect(shouldScheduleBotTurn(base)).toBe(true);
  });

  it('blocks when it is not bot turn', () => {
    expect(
      shouldScheduleBotTurn({
        ...base,
        match: { currentPlayer: 'you', handOver: false, gameOver: false },
      }),
    ).toBe(false);
  });

  it('blocks when draw sequence is active', () => {
    expect(shouldScheduleBotTurn({ ...base, drawSequenceActive: true })).toBe(false);
  });

  it('blocks guided transcript mode', () => {
    expect(shouldScheduleBotTurn({ ...base, isGuidedTranscriptMode: true })).toBe(false);
  });

  it('blocks guided v2 on-line mode', () => {
    expect(
      shouldScheduleBotTurn({
        ...base,
        isGuidedV2Mode: true,
        isGuidedV2OffLine: false,
      }),
    ).toBe(false);
  });

  it('allows guided v2 off-line mode', () => {
    expect(
      shouldScheduleBotTurn({
        ...base,
        isGuidedV2Mode: true,
        isGuidedV2OffLine: true,
      }),
    ).toBe(true);
  });
});

describe('shouldContinueBotTurnAtTimer', () => {
  it('requires live bot turn', () => {
    expect(
      shouldContinueBotTurnAtTimer({
        match: { currentPlayer: 'you', handOver: false, gameOver: false },
        isDailyFritzMode: false,
      }),
    ).toBe(false);
  });

  it('allows bot turn when hand is live', () => {
    expect(
      shouldContinueBotTurnAtTimer({
        match: { currentPlayer: 'bot', handOver: false, gameOver: false },
        isDailyFritzMode: false,
      }),
    ).toBe(true);
  });
});
