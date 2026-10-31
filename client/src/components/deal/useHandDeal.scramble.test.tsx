// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PileSnapshot } from './pileSnapshot';
import type { HandDealOptions } from './useHandDeal';

/**
 * The opening of a match: the pick-a-tile pile is scrambled, dealt into both hands, and the rest sweeps into the
 * boneyard counter. The hook's safety rules are covered in useHandDeal.test.tsx; these cover the staged path.
 */

const take = vi.hoisted(() => vi.fn<() => PileSnapshot | null>());
vi.mock('./pileSnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pileSnapshot')>()),
  takePileSnapshot: take,
}));

const { preloadDealRuntime, useHandDeal } = await import('./useHandDeal');
const { isDealInProgress, resetDealGateForTests } = await import('../../utils/dealGate');

const pile = (count: number): PileSnapshot => ({
  look: { backgroundColor: 'rgb(244, 235, 218)', backgroundImage: 'none', border: '2px solid rgb(100, 90, 70)', borderRadius: '7px', boxShadow: 'none' },
  pieces: Array.from({ length: count }, (_, i) => ({ cx: 200 + (i % 7) * 100, cy: 200 + Math.floor(i / 7) * 80, width: 88, height: 44, rotationDeg: i * 4 })),
});

function mountScreen(handTiles = 7, rackTiles = 7) {
  document.body.innerHTML = `
    <div class="bot-match-screen">
      <div class="board-container"></div>
      <div class="boneyard-pill">12</div>
      <div class="rh-tile-rack">${'<span class="rh-tile-rack__tile"></span>'.repeat(rackTiles)}</div>
      <div class="hand-area">${'<div class="domino-tile"></div>'.repeat(handTiles)}</div>
    </div>`;
  const rect = (left: number) => ({ left, top: 10, right: left + 60, bottom: 130, width: 60, height: 120, x: left, y: 10, toJSON: () => ({}) });
  document.querySelectorAll('.board-container, .boneyard-pill, .rh-tile-rack__tile, .hand-area .domino-tile').forEach((el, i) => {
    (el as HTMLElement).getBoundingClientRect = () => rect(i * 70) as DOMRect;
  });
  return document.querySelector('.bot-match-screen') as HTMLElement;
}

const opts = (over: Partial<HandDealOptions> = {}): HandDealOptions => ({ handNumber: 0, preGameDrawActive: true, enabled: true, pace: 1, ...over });

/** Animations that never finish by themselves, so the staging can be inspected mid-flight. */
function holdAnimations() {
  const made: Array<{ onfinish: null | (() => void); keyframes: Keyframe[] }> = [];
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function animate(keyframes: Keyframe[]) {
    const animation = { onfinish: null as null | (() => void), oncancel: null, playbackRate: 1, keyframes };
    made.push(animation);
    return animation;
  };
  return made;
}

describe('useHandDeal: the opening scramble', () => {
  beforeEach(async () => {
    await preloadDealRuntime();
    take.mockReset();
    resetDealGateForTests();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    resetDealGateForTests();
  });

  it('flies the pile itself: one card per pick-a-tile tile, each one animation from where it lay, and no stand-in heap', async () => {
    take.mockReturnValue(pile(26));
    const made = holdAnimations();
    mountScreen();
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts() });
    rerender(opts({ handNumber: 1, preGameDrawActive: false }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelectorAll('.hand-deal-card')).toHaveLength(26);
    expect(document.querySelectorAll('.hand-deal-pile')).toHaveLength(0);
    expect(made).toHaveLength(26);
    // Each card starts exactly where its tile was lying: the first keyframe is "no movement" at the tile's own tilt.
    const first = (made[3].keyframes[0] as { transform: string }).transform;
    expect(first).toMatch(/^translate\(0px, 0px\) rotate\(12deg\) scale\(1\)$/);
  });

  it('holds Fritz\'s opening move for the length of the deal, and lets go the moment it ends', async () => {
    take.mockReturnValue(pile(26));
    const made = holdAnimations();
    const root = mountScreen();
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts() });
    expect(isDealInProgress()).toBe(false);
    rerender(opts({ handNumber: 1, preGameDrawActive: false }));
    expect(isDealInProgress()).toBe(true);
    expect(root.getAttribute('data-hand-deal')).toBe('pending');

    // Land every card. Yours turn over first (a second animation each); finish those too.
    for (let guard = 0; guard < 6 && isDealInProgress(); guard += 1) {
      await act(async () => {
        for (const animation of [...made]) animation.onfinish?.();
        await Promise.resolve();
      });
    }
    expect(isDealInProgress()).toBe(false);
    expect(root.hasAttribute('data-hand-deal')).toBe(false);
    expect(document.querySelectorAll('.hand-deal-card')).toHaveLength(0);
  });

  it('falls back to the small heap when the pile has fewer tiles than the hands need', async () => {
    take.mockReturnValue(pile(5));
    holdAnimations();
    mountScreen();
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts() });
    rerender(opts({ handNumber: 1, preGameDrawActive: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelectorAll('.hand-deal-pile')).toHaveLength(1);
    expect(document.querySelectorAll('.hand-deal-card')).toHaveLength(14);
  });

  it('deals from the small heap when there is no pile at all (a later hand)', async () => {
    take.mockReturnValue(null);
    holdAnimations();
    mountScreen();
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts({ handNumber: 1, preGameDrawActive: false }) });
    rerender(opts({ handNumber: 2, preGameDrawActive: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelectorAll('.hand-deal-pile')).toHaveLength(1);
  });

  it('takes the pile for every new hand even when the deal is off, so it can never be replayed later', () => {
    take.mockReturnValue(pile(26));
    mountScreen();
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts({ enabled: false }) });
    rerender(opts({ enabled: false, handNumber: 1, preGameDrawActive: false }));
    expect(take).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.hand-deal-card')).toHaveLength(0);
  });

  it('never leaves Fritz waiting when the screen goes away mid-deal', () => {
    take.mockReturnValue(pile(26));
    holdAnimations();
    mountScreen();
    const { rerender, unmount } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts() });
    rerender(opts({ handNumber: 1, preGameDrawActive: false }));
    expect(isDealInProgress()).toBe(true);
    unmount();
    expect(isDealInProgress()).toBe(false);
  });
});
