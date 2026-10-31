// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useHandDeal, type HandDealOptions } from './useHandDeal';

/**
 * The deal hides the real tiles while cards fly to them, so the rule that matters most is the one in the file header:
 * it must never be able to leave a hand hidden. These tests cover the ways it can start, and every way it can end.
 */

const SIZE = { width: 60, height: 120 };

function mountScreen(handTiles = 3, rackTiles = 3) {
  document.body.innerHTML = `
    <div class="bot-match-screen">
      <div class="board-container"></div>
      <div class="rh-tile-rack">${'<span class="rh-tile-rack__tile"></span>'.repeat(rackTiles)}</div>
      <div class="hand-area">${'<div class="domino-tile"></div>'.repeat(handTiles)}</div>
    </div>`;
  const rect = (left: number) => ({ left, top: 10, right: left + SIZE.width, bottom: 10 + SIZE.height, ...SIZE, x: left, y: 10, toJSON: () => ({}) });
  document.querySelectorAll('.board-container, .rh-tile-rack__tile, .hand-area .domino-tile').forEach((el, i) => {
    (el as HTMLElement).getBoundingClientRect = () => rect(i * 70) as DOMRect;
  });
  return document.querySelector('.bot-match-screen') as HTMLElement;
}

let animations: Array<{ onfinish: null | (() => void) }>;

/** Every animation finishes on the next microtask, so a whole deal plays out in a few ticks. */
function installAnimate() {
  animations = [];
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function animate() {
    const animation: { onfinish: null | (() => void); oncancel: null | (() => void); playbackRate: number } = {
      onfinish: null,
      oncancel: null,
      playbackRate: 1,
    };
    animations.push(animation);
    queueMicrotask(() => animation.onfinish?.());
    return animation;
  };
}

const settle = () => act(async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
});

const opts = (over: Partial<HandDealOptions> = {}): HandDealOptions => ({
  handNumber: 0,
  preGameDrawActive: true,
  enabled: true,
  pace: 1,
  ...over,
});

describe('useHandDeal', () => {
  beforeEach(() => {
    installAnimate();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  it('deals when the pre-game draw ends and the first hand begins, then leaves nothing behind', async () => {
    const root = mountScreen();
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts() });
    rerender(opts({ handNumber: 1, preGameDrawActive: false }));

    expect(root.getAttribute('data-hand-deal')).toBe('pending'); // the tiles are held before anything is painted
    await settle();

    expect(animations.length).toBeGreaterThan(6); // cards flew
    expect(root.hasAttribute('data-hand-deal')).toBe(false);
    expect(document.querySelectorAll('.hand-deal-card, .hand-deal-pile')).toHaveLength(0);
    expect(root.querySelectorAll('[data-dealt]')).toHaveLength(0);
  });

  it('deals a card for every tile in both hands, and a pile for them to come from', async () => {
    // Animations that never finish, so the cards are still in the air when we count them.
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = () => ({ onfinish: null, oncancel: null, playbackRate: 1 });
    mountScreen(4, 4);
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts() });
    rerender(opts({ handNumber: 1, preGameDrawActive: false }));
    await act(async () => {
      await Promise.resolve();
    });
    // 8 cards and a pile of tiles are on screen the instant the deal begins.
    expect(document.querySelectorAll('.hand-deal-card')).toHaveLength(8);
    expect(document.querySelectorAll('.hand-deal-pile')).toHaveLength(1);
    expect(document.querySelectorAll('.hand-deal-pile__tile').length).toBeGreaterThan(2);
  });

  it('deals each new hand', async () => {
    const root = mountScreen();
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts({ handNumber: 1, preGameDrawActive: false }) });
    expect(root.hasAttribute('data-hand-deal')).toBe(false); // hand 1 was already on screen at mount: no deal
    rerender(opts({ handNumber: 2, preGameDrawActive: false }));
    expect(root.getAttribute('data-hand-deal')).toBe('pending');
    await settle();
    expect(root.hasAttribute('data-hand-deal')).toBe(false);
  });

  it('does not deal a hand that was already on screen when the page loaded (a reload mid-match)', () => {
    const root = mountScreen();
    renderHook(() => useHandDeal(opts({ handNumber: 3, preGameDrawActive: false })));
    expect(root.hasAttribute('data-hand-deal')).toBe(false);
    expect(document.querySelectorAll('.hand-deal-card')).toHaveLength(0);
  });

  it('never hides the hand when the deal is off', () => {
    const root = mountScreen();
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts({ enabled: false }) });
    rerender(opts({ enabled: false, handNumber: 1, preGameDrawActive: false }));
    expect(root.hasAttribute('data-hand-deal')).toBe(false);
  });

  it('never hides the hand when animation is unavailable', () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    const root = mountScreen();
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts() });
    rerender(opts({ handNumber: 1, preGameDrawActive: false }));
    expect(root.hasAttribute('data-hand-deal')).toBe(false);
  });

  it('never hides the hand for someone who asked for reduced motion', () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
    const root = mountScreen();
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts() });
    rerender(opts({ handNumber: 1, preGameDrawActive: false }));
    expect(root.hasAttribute('data-hand-deal')).toBe(false);
  });

  it('lets go if the hand never appears, instead of waiting forever', async () => {
    const root = mountScreen(0, 3); // a screen with no hand tiles
    const { rerender } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts() });
    rerender(opts({ handNumber: 1, preGameDrawActive: false }));
    expect(root.getAttribute('data-hand-deal')).toBe('pending');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(root.hasAttribute('data-hand-deal')).toBe(false);
  });

  it('puts everything back if the screen goes away mid-deal', () => {
    // Animations that never finish: the deal is still running when the screen unmounts.
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = () => ({ onfinish: null, oncancel: null, playbackRate: 1 });
    const root = mountScreen();
    const { rerender, unmount } = renderHook((props: HandDealOptions) => useHandDeal(props), { initialProps: opts() });
    rerender(opts({ handNumber: 1, preGameDrawActive: false }));
    expect(root.getAttribute('data-hand-deal')).toBe('pending');
    unmount();
    expect(root.hasAttribute('data-hand-deal')).toBe(false);
    expect(document.querySelectorAll('.hand-deal-card')).toHaveLength(0);
  });
});
