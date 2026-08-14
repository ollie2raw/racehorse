// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  BOT_CHAIN_CONTINUE_DELAY_MS,
  BOT_DRAW_STEP_MS,
  BOT_FLY_TILE_MS,
  BOT_FORCED_DRAW_DELAY_MS,
  BOT_FORCED_DRAW_THINK_DELAY_MS,
  BOT_OPENING_THINK_DELAY_MS,
  BOT_PLACE_SETTLE_MS,
  BOT_PLAYER_HANDOFF_DELAY_MS,
  BOT_POST_DRAW_PLAY_DELAY_MS,
  BOT_SCORE_HOLD_MS,
  BOT_SCORE_CUE_DELAY_MS,
  BOT_THINK_DELAY_MS,
  resolveBotChainContinueDelayMs,
  resolveBotOpeningDelayMs,
  resolveBotPostActionSettleMs,
  resolveBotTurnDelayMs,
  shouldContinueBotTurnAtTimer,
  shouldScheduleBotTurn,
} from './botTurnGuards.ts';

describe('resolveBotTurnDelayMs', () => {
  it('uses longer opening think for legal plays and dig beat for forced draws', () => {
    expect(resolveBotOpeningDelayMs(true)).toBe(BOT_OPENING_THINK_DELAY_MS);
    expect(resolveBotOpeningDelayMs(false)).toBe(BOT_FORCED_DRAW_THINK_DELAY_MS);
    expect(resolveBotTurnDelayMs(true)).toBe(BOT_OPENING_THINK_DELAY_MS);
    expect(resolveBotTurnDelayMs(false)).toBe(BOT_FORCED_DRAW_THINK_DELAY_MS);
    expect(BOT_THINK_DELAY_MS).toBe(BOT_OPENING_THINK_DELAY_MS);
    expect(BOT_FORCED_DRAW_DELAY_MS).toBe(BOT_FORCED_DRAW_THINK_DELAY_MS);
    expect(BOT_OPENING_THINK_DELAY_MS).toBe(1000);
    expect(BOT_FORCED_DRAW_THINK_DELAY_MS).toBe(1650);
  });

  it('keeps chain continues shorter than opening thinks', () => {
    expect(resolveBotChainContinueDelayMs()).toBe(BOT_CHAIN_CONTINUE_DELAY_MS);
    expect(BOT_CHAIN_CONTINUE_DELAY_MS).toBeLessThan(BOT_OPENING_THINK_DELAY_MS);
    expect(BOT_CHAIN_CONTINUE_DELAY_MS).toBe(825);
  });

  it('keeps draw step aligned with fly duration and place/score settles readable', () => {
    expect(BOT_DRAW_STEP_MS).toBe(BOT_FLY_TILE_MS);
    expect(BOT_DRAW_STEP_MS).toBe(861);
    expect(BOT_POST_DRAW_PLAY_DELAY_MS).toBe(900);
    expect(BOT_PLACE_SETTLE_MS).toBe(650);
    expect(BOT_SCORE_HOLD_MS).toBeGreaterThanOrEqual(BOT_PLACE_SETTLE_MS);
    expect(BOT_SCORE_CUE_DELAY_MS).toBeLessThan(BOT_PLACE_SETTLE_MS);
    expect(BOT_PLAYER_HANDOFF_DELAY_MS).toBe(560);
    expect(resolveBotPostActionSettleMs(0)).toBe(BOT_PLACE_SETTLE_MS);
    expect(resolveBotPostActionSettleMs(5)).toBe(Math.max(BOT_PLACE_SETTLE_MS, BOT_SCORE_HOLD_MS));
  });
});

describe('shouldScheduleBotTurn', () => {
  const base = {
    match: { currentPlayer: 'bot' as const, handOver: false, gameOver: false },
    drawSequenceActive: false,
    botTurnInFlight: false,
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

  it('blocks while a bot action/chain is in flight', () => {
    expect(shouldScheduleBotTurn({ ...base, botTurnInFlight: true })).toBe(false);
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
