// client/src/components/deal/useHandDeal.ts
//
// The deal: when a hand begins, cards fly out of the pile at the middle of the board, alternating to your tray and
// Fritz's rack (choreography in dealPlan.ts); yours turn face up as they land.
//
// Purely presentation. It never reads or writes game state: the hand already exists in the DOM, so the real tiles are
// simply held hidden (CSS, handDeal.css) and revealed one by one as their card arrives. Because it must never be able
// to lock a player out of their own hand, every path ends the same way: the hide attribute comes off, every card
// is removed and every reveal marker is cleared, whether the deal finished, was cut short, was never possible
// (tiles not found, no Web Animations, reduced motion, hidden tab) or the screen unmounted.
import { useLayoutEffect, useRef } from 'react';
import { planDeal, type DealRect, type DealStep, type DealTarget } from './dealPlan';

const ROOT = '.bot-match-screen';
const HAND_TILES = '.hand-area:not(.pre-game-draw-hand-dock) .domino-tile:not(.board-tile)';
const RACK_TILES = '.rh-tile-rack__tile';
const BOARD = '.board-container';
/** Wait this long for the hand to appear in the DOM before giving up on the deal. */
const WAIT_FOR_TILES_MS = 600;
/** If the deal has not ended this long after it should have, end it anyway. */
const SAFETY_SLACK_MS = 800;

export interface HandDealOptions {
  /** The hand number; a new one means a new deal. 0 while the pre-game draw is still going. */
  handNumber: number;
  /** The pre-game draw is on screen: the deal comes right after it. */
  preGameDrawActive: boolean;
  /** Off for guided lessons and anything that must not be staged. */
  enabled: boolean;
  /** 1 = the standard deal, lower = quicker. */
  pace: number;
}

function rectOf(el: Element): DealRect | null {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Copy the look of one of Fritz's face-down rack tiles, so a flying card is the same object that lands in his rack. */
function cardLook(sample: Element | null): Partial<CSSStyleDeclaration> {
  if (!sample) return { backgroundColor: '#e9e2d0', border: '1px solid rgba(0, 0, 0, 0.35)', borderRadius: '6px' };
  const style = window.getComputedStyle(sample);
  return {
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    border: style.border,
    boxShadow: style.boxShadow,
  };
}

export function useHandDeal({ handNumber, preGameDrawActive, enabled, pace }: HandDealOptions): void {
  // The hand already on screen when the screen mounted (a reload mid-match) is not dealt again.
  const handledRef = useRef<number | null>(null);
  if (handledRef.current === null) handledRef.current = handNumber > 0 && !preGameDrawActive ? handNumber : 0;

  useLayoutEffect(() => {
    if (!enabled || preGameDrawActive || handNumber <= 0 || handNumber === handledRef.current) return;
    handledRef.current = handNumber;

    const root = document.querySelector<HTMLElement>(ROOT);
    if (
      !root ||
      document.hidden ||
      prefersReducedMotion() ||
      typeof HTMLElement.prototype.animate !== 'function'
    ) {
      return;
    }

    // Hide the real tiles before the first paint, so the hand never flashes in and then vanishes.
    root.setAttribute('data-hand-deal', 'pending');

    const cards: HTMLElement[] = [];
    const timers: number[] = [];
    let raf = 0;
    let ended = false;

    const end = () => {
      if (ended) return;
      ended = true;
      window.cancelAnimationFrame(raf);
      for (const timer of timers) window.clearTimeout(timer);
      for (const card of cards) card.remove();
      root.removeAttribute('data-hand-deal');
      for (const tile of root.querySelectorAll('[data-dealt]')) tile.removeAttribute('data-dealt');
    };

    const begin = () => {
      const handTiles = [...root.querySelectorAll<HTMLElement>(HAND_TILES)];
      const rackTiles = [...root.querySelectorAll<HTMLElement>(RACK_TILES)];
      const targets: Array<DealTarget & { el: HTMLElement }> = [];
      for (const el of handTiles) {
        const rect = rectOf(el);
        if (rect) targets.push({ owner: 'you', rect, el });
      }
      for (const el of rackTiles) {
        const rect = rectOf(el);
        if (rect) targets.push({ owner: 'fritz', rect, el });
      }
      if (targets.length === 0) return end();

      const boardRect = (() => {
        const board = root.querySelector(BOARD);
        return (board && rectOf(board)) ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      })();
      const origin = { x: boardRect.left + boardRect.width / 2, y: boardRect.top + boardRect.height / 2 };
      const look = cardLook(rackTiles[0] ?? null);

      const plan = planDeal(targets, pace);
      let remaining = plan.steps.length;
      const oneLanded = () => {
        remaining -= 1;
        if (remaining <= 0) end();
      };

      for (const step of plan.steps) launch(step, step.el, origin, look, oneLanded, cards);
      showDeck(plan.steps, origin, look, cards);
      timers.push(window.setTimeout(end, plan.totalMs + SAFETY_SLACK_MS));
    };

    // The hand may render a frame after the hand number changes: wait for it, but not for long.
    const started = performance.now();
    const waitForTiles = () => {
      if (ended) return;
      if (root.querySelector(HAND_TILES)) return begin();
      if (performance.now() - started > WAIT_FOR_TILES_MS) return end();
      raf = window.requestAnimationFrame(waitForTiles);
    };
    try {
      waitForTiles();
    } catch {
      end();
    }
    return end;
  }, [handNumber, preGameDrawActive, enabled, pace]);
}

/** A face-down domino: a soft bevel and a seam across the middle, so the flying card reads as a tile, not a blank. */
function dressAsTileBack(card: HTMLElement, rect: DealRect): void {
  card.style.boxShadow = 'inset 0 0 0 1.5px rgba(0, 0, 0, 0.1), inset 0 -3px 0 rgba(0, 0, 0, 0.1)';
  const seam = document.createElement('div');
  seam.className = 'hand-deal-card__seam';
  // The seam runs across the short side, as on a domino: a wide card is split left/right, a tall one top/bottom.
  if (rect.width >= rect.height) seam.classList.add('hand-deal-card__seam--vertical');
  card.appendChild(seam);
}

/** The pile the cards come from: a small stack at the middle of the board that rises, is dealt from, and fades. */
function showDeck(
  steps: Array<{ rect: DealRect; owner: string; delayMs: number }>,
  origin: { x: number; y: number },
  look: Partial<CSSStyleDeclaration>,
  cards: HTMLElement[],
): void {
  const sample = steps.find((step) => step.owner === 'you') ?? steps[0];
  if (!sample) return;
  const width = sample.rect.width * 0.6;
  const height = sample.rect.height * 0.6;
  const lastOut = steps.reduce((latest, step) => Math.max(latest, step.delayMs), 0);
  const deck = document.createElement('div');
  deck.className = 'hand-deal-card hand-deal-deck';
  deck.setAttribute('aria-hidden', 'true');
  Object.assign(deck.style, look);
  // A few stacked edges under the top card. Inline, because the face copied from the rack tile sets its own shadow.
  deck.style.boxShadow =
    '0 2px 0 rgb(190, 181, 158), 0 4px 0 rgb(160, 151, 130), 0 6px 0 rgb(130, 122, 104)';
  deck.style.left = `${origin.x - width / 2}px`;
  deck.style.top = `${origin.y - height / 2}px`;
  deck.style.width = `${width}px`;
  deck.style.height = `${height}px`;
  document.body.appendChild(deck);
  cards.push(deck);
  const total = lastOut + 280;
  try {
    const animation = deck.animate(
      [
        { opacity: 0, transform: 'scale(0.88)' },
        { opacity: 1, transform: 'scale(1)', offset: 0.12 },
        { opacity: 1, transform: 'scale(1)', offset: 0.82 },
        { opacity: 0, transform: 'scale(0.96)' },
      ],
      { duration: total, easing: 'ease-out', fill: 'both' },
    );
    animation.onfinish = () => deck.remove();
  } catch {
    deck.remove();
  }
}

function launch(
  step: DealStep,
  real: HTMLElement,
  origin: { x: number; y: number },
  look: Partial<CSSStyleDeclaration>,
  landed: () => void,
  cards: HTMLElement[],
): void {
  const { rect } = step;
  const card = document.createElement('div');
  card.className = 'hand-deal-card';
  card.setAttribute('aria-hidden', 'true');
  Object.assign(card.style, look);
  dressAsTileBack(card, rect);
  card.style.left = `${rect.left}px`;
  card.style.top = `${rect.top}px`;
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
  document.body.appendChild(card);
  cards.push(card);

  const dx = origin.x - (rect.left + rect.width / 2);
  const dy = origin.y - (rect.top + rect.height / 2);
  const reveal = () => real.setAttribute('data-dealt', '');
  const finish = () => {
    card.remove();
    landed();
  };

  try {
    const flight = card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(${step.fromRotateDeg}deg) scale(${step.fromScale})`, opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1 },
      ],
      { duration: step.flightMs, delay: step.delayMs, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' },
    );
    flight.onfinish = () => {
      if (step.flipMs <= 0) {
        // Fritz's card lands face down, straight into his rack.
        reveal();
        finish();
        return;
      }
      // Yours turns over: the card closes edge-on, then your real tile opens face up in its place.
      const half = step.flipMs / 2;
      const close = card.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
        duration: half,
        easing: 'ease-in',
        fill: 'forwards',
      });
      close.onfinish = () => {
        reveal();
        real.animate([{ scale: '0 1' }, { scale: '1 1' }], { duration: half, easing: 'ease-out' });
        finish();
      };
    };
  } catch {
    reveal();
    finish();
  }
}
