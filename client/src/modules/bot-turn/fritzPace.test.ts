import { describe, expect, it } from 'vitest';
import {
  BOT_CHAIN_CONTINUE_DELAY_MS,
  BOT_FORCED_DRAW_THINK_DELAY_MS,
  BOT_OPENING_THINK_DELAY_MS,
  BOT_PLACE_SETTLE_MS,
  BOT_PLAYER_HANDOFF_DELAY_MS,
  BOT_POST_DRAW_PLAY_DELAY_MS,
  BOT_SCORE_HOLD_MS,
  FAST_PACE_SCALE,
  paceMs,
  resolveBotChainContinueDelayMs,
  resolveBotHandoffDelayMs,
  resolveBotOpeningDelayMs,
  resolveBotPostActionSettleMs,
  resolveBotPostDrawPlayDelayMs,
  resolveFritzPace,
} from './botTurnGuards.ts';

describe('Fritz pace: normal is the original cadence, untouched', () => {
  it('every resolver returns the original constant with no pace or with "normal"', () => {
    for (const pace of [undefined, 'normal'] as const) {
      expect(resolveBotOpeningDelayMs(true, pace)).toBe(BOT_OPENING_THINK_DELAY_MS);
      expect(resolveBotOpeningDelayMs(false, pace)).toBe(BOT_FORCED_DRAW_THINK_DELAY_MS);
      expect(resolveBotChainContinueDelayMs(pace)).toBe(BOT_CHAIN_CONTINUE_DELAY_MS);
      expect(resolveBotHandoffDelayMs(pace)).toBe(BOT_PLAYER_HANDOFF_DELAY_MS);
      expect(resolveBotPostDrawPlayDelayMs(pace)).toBe(BOT_POST_DRAW_PLAY_DELAY_MS);
      expect(resolveBotPostActionSettleMs(0, pace)).toBe(BOT_PLACE_SETTLE_MS);
      expect(resolveBotPostActionSettleMs(5, pace)).toBe(Math.max(BOT_PLACE_SETTLE_MS, BOT_SCORE_HOLD_MS));
    }
  });
});

describe('Fritz pace: fast shortens the pauses', () => {
  it('scales every pause by FAST_PACE_SCALE', () => {
    expect(resolveBotOpeningDelayMs(true, 'fast')).toBe(Math.round(BOT_OPENING_THINK_DELAY_MS * FAST_PACE_SCALE));
    expect(resolveBotOpeningDelayMs(false, 'fast')).toBe(Math.round(BOT_FORCED_DRAW_THINK_DELAY_MS * FAST_PACE_SCALE));
    expect(resolveBotChainContinueDelayMs('fast')).toBe(Math.round(BOT_CHAIN_CONTINUE_DELAY_MS * FAST_PACE_SCALE));
    expect(resolveBotHandoffDelayMs('fast')).toBe(Math.round(BOT_PLAYER_HANDOFF_DELAY_MS * FAST_PACE_SCALE));
    expect(resolveBotPostDrawPlayDelayMs('fast')).toBe(Math.round(BOT_POST_DRAW_PLAY_DELAY_MS * FAST_PACE_SCALE));
  });

  it('a simple reply drops from 1.56 s to about 0.62 s', () => {
    const normal = resolveBotHandoffDelayMs('normal') + resolveBotOpeningDelayMs(true, 'normal');
    const fast = resolveBotHandoffDelayMs('fast') + resolveBotOpeningDelayMs(true, 'fast');
    expect(normal).toBe(1560);
    expect(fast).toBe(624);
  });

  it('never cuts a tile\'s landing short: the settle after a play is the place animation, even for a scoring move', () => {
    expect(resolveBotPostActionSettleMs(0, 'fast')).toBe(BOT_PLACE_SETTLE_MS);
    expect(resolveBotPostActionSettleMs(8, 'fast')).toBeGreaterThanOrEqual(BOT_PLACE_SETTLE_MS);
  });

  it('every fast pause is still positive and shorter than normal', () => {
    for (const ms of [
      BOT_OPENING_THINK_DELAY_MS,
      BOT_FORCED_DRAW_THINK_DELAY_MS,
      BOT_CHAIN_CONTINUE_DELAY_MS,
      BOT_PLAYER_HANDOFF_DELAY_MS,
      BOT_POST_DRAW_PLAY_DELAY_MS,
    ]) {
      expect(paceMs(ms, 'fast')).toBeGreaterThan(0);
      expect(paceMs(ms, 'fast')).toBeLessThan(ms);
    }
  });
});

describe('Fritz pace: Daily Fritz is always normal', () => {
  it('ignores the preference in Daily Fritz, whatever it is', () => {
    expect(resolveFritzPace(true, 'fast')).toBe('normal');
    expect(resolveFritzPace(true, 'normal')).toBe('normal');
  });

  it('honours the preference everywhere else', () => {
    expect(resolveFritzPace(false, 'fast')).toBe('fast');
    expect(resolveFritzPace(false, 'normal')).toBe('normal');
  });
});
