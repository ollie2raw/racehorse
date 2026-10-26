// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOT_FLY_TILE_MS, resolveBotFlyTileMs, type FritzPace } from '../bot-turn/botTurnGuards.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { usePlayerDrawAnimation } from './usePlayerDrawAnimation.ts';
import type { DrawAnimationDeps } from './types.ts';

type Entry = { x: number; y: number; toX: number; toY: number; id: number; ms?: number };

function el(): HTMLButtonElement {
  const e = document.createElement('button');
  e.getBoundingClientRect = () => ({ left: 10, top: 20, width: 40, height: 60, right: 50, bottom: 80, x: 10, y: 20, toJSON: () => ({}) }) as DOMRect;
  return e;
}

function harness(pace?: FritzPace) {
  let flying: Entry[] = [];
  const setFlyingTiles = vi.fn((update: Entry[] | ((prev: Entry[]) => Entry[])) => {
    flying = typeof update === 'function' ? update(flying) : update;
  });
  const drawAnimation = {
    boneyardRef: { current: el() },
    handAreaRef: { current: el() },
    opponentPillRef: { current: el() },
    guidedBoneyardAnchorRef: { current: null },
    guidedFritzAnchorRef: { current: null },
    rootRef: { current: null },
    boardStageRef: { current: null },
    flyingTileIdRef: { current: 0 },
    setDrawPulseIndex: vi.fn(),
    setFlyingTiles,
  } as unknown as DrawAnimationDeps;
  const { result } = renderHook(() => usePlayerDrawAnimation({ drawAnimation, fritzPace: pace }));
  const state = { players: { you: { hand: [{ low: 1, high: 2 }] }, bot: { hand: [{ low: 3, high: 4 }] } } } as unknown as BotMatchState;
  return { trigger: result.current.triggerDrawStepAnimation, state, flying: () => flying };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('usePlayerDrawAnimation: the flying tile follows the pace, for Fritz only', () => {
  it('at normal pace a Fritz draw carries no length of its own and is removed at the original 861 ms', () => {
    const h = harness('normal');
    act(() => h.trigger('bot', h.state));
    expect(h.flying()).toHaveLength(1);
    expect(h.flying()[0].ms).toBeUndefined();
    act(() => void vi.advanceTimersByTime(BOT_FLY_TILE_MS - 1));
    expect(h.flying()).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(2));
    expect(h.flying()).toHaveLength(0);
  });

  it('with no pace given it behaves exactly as normal', () => {
    const h = harness();
    act(() => h.trigger('bot', h.state));
    expect(h.flying()[0].ms).toBeUndefined();
  });

  it('at fast pace a Fritz draw carries the shorter length and is removed when it lands, not later', () => {
    const fast = resolveBotFlyTileMs('fast');
    const h = harness('fast');
    act(() => h.trigger('bot', h.state));
    expect(h.flying()[0].ms).toBe(fast);
    act(() => void vi.advanceTimersByTime(fast - 1));
    expect(h.flying()).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(2));
    expect(h.flying()).toHaveLength(0);
  });

  it('the player\'s own draw is never sped up, even at fast pace', () => {
    const h = harness('fast');
    act(() => h.trigger('you', h.state));
    expect(h.flying()).toHaveLength(1);
    expect(h.flying()[0].ms).toBeUndefined();
    act(() => void vi.advanceTimersByTime(BOT_FLY_TILE_MS + 1));
    expect(h.flying()).toHaveLength(0);
  });
});
