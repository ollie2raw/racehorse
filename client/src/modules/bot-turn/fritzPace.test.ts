import { describe, expect, it } from 'vitest';
import {
  BOT_CHAIN_CONTINUE_DELAY_MS,
  BOT_DRAW_STEP_MS,
  BOT_FLY_TILE_MS,
  FAST_DRAW_SCALE,
  FLY_TILE_CSS_BASE_MS,
  flyTileCssMs,
  BOT_FORCED_DRAW_THINK_DELAY_MS,
  BOT_OPENING_THINK_DELAY_MS,
  BOT_PLACE_SETTLE_MS,
  BOT_PLAYER_HANDOFF_DELAY_MS,
  BOT_POST_DRAW_PLAY_DELAY_MS,
  BOT_SCORE_HOLD_MS,
  FAST_PACE_SCALE,
  paceDrawMs,
  paceMs,
  resolveBotDrawStepMs,
  resolveBotFlyTileMs,
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

describe('Fritz pace: his draw animation', () => {
  it('normal pace is the original 861 ms step and flying tile, untouched', () => {
    expect(resolveBotDrawStepMs()).toBe(BOT_DRAW_STEP_MS);
    expect(resolveBotDrawStepMs('normal')).toBe(861);
    expect(resolveBotFlyTileMs('normal')).toBe(BOT_FLY_TILE_MS);
  });

  it('fast scales the step and the flying tile together, so the step still waits for the tile to land', () => {
    expect(resolveBotDrawStepMs('fast')).toBe(Math.round(BOT_DRAW_STEP_MS * FAST_DRAW_SCALE));
    expect(resolveBotDrawStepMs('fast')).toBe(resolveBotFlyTileMs('fast'));
  });

  it('is scaled less than the pauses: an animation shrunk as hard as a pause reads as a flicker', () => {
    expect(FAST_DRAW_SCALE).toBeGreaterThan(FAST_PACE_SCALE);
    expect(resolveBotDrawStepMs('fast')).toBeGreaterThan(paceMs(BOT_DRAW_STEP_MS, 'fast'));
    expect(resolveBotDrawStepMs('fast')).toBeLessThan(BOT_DRAW_STEP_MS);
    expect(paceDrawMs(1000, 'fast')).toBe(600);
    expect(paceDrawMs(1000)).toBe(1000);
  });
});

describe('flying tile CSS length keeps the normal-pace shape', () => {
  it('at normal pace the CSS length is the 1138 ms base that the 861 ms cleanup has always cut at ~76%', () => {
    expect(flyTileCssMs(BOT_FLY_TILE_MS)).toBe(FLY_TILE_CSS_BASE_MS);
  });

  it('a faster flight is cut at the same fraction of its animation, just sooner', () => {
    const fast = resolveBotFlyTileMs('fast');
    expect(fast / flyTileCssMs(fast)).toBeCloseTo(BOT_FLY_TILE_MS / FLY_TILE_CSS_BASE_MS, 2);
    expect(flyTileCssMs(fast)).toBeLessThan(FLY_TILE_CSS_BASE_MS);
  });
});
