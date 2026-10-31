// client/src/components/deal/useHandDeal.ts
//
// The deal. When a hand begins, cards fly into your tray and Fritz's rack, alternating, and yours turn face up as they
// land (choreography in dealPlan.ts). The FIRST hand of a match is staged as one continuous piece with the pick-a-tile
// screen before it: those same tiles are scrambled in a heap, 14 are dealt into the two hands, and the rest sweep into
// the boneyard counter (scramblePlan.ts / scrambleDeal.ts). Later hands, which have no pile on screen, deal from a
// small heap of tiles at the middle of the board.
//
// This file is only the shell: it decides WHEN a deal happens and guarantees how it ends. The staging itself
// (dealRuntime.ts and what it uses) is loaded on demand, because it is presentation that plays once a hand and
// has no business weighing down the match screen. It is fetched as soon as the screen mounts, long before the
// pick-a-tile phase is over; if it ever were not ready the deal is simply skipped.
//
// Purely presentation. It never reads or writes game state: the hand already exists in the DOM, so the real tiles are
// simply held hidden (CSS, handDeal.css) and revealed one by one as their card arrives. Because it must never be able
// to lock a player out of their own hand, every path ends the same way: the hide attribute comes off, every card
// is removed and every reveal marker is cleared, whether the deal finished, was cut short, was never possible
// (code not loaded, tiles not found, no Web Animations, reduced motion, hidden tab) or the screen unmounted.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { beginDeal, endDeal } from '../../utils/dealGate';
import type * as DealRuntime from './dealRuntime';
import { takePileSnapshot } from './pileSnapshot';

const ROOT = '.bot-match-screen';
const HAND_TILES = '.hand-area:not(.pre-game-draw-hand-dock) .domino-tile:not(.board-tile)';
/** Wait this long for the hand to appear in the DOM before giving up on the deal. */
const WAIT_FOR_TILES_MS = 600;
/** If the deal has not ended this long after it should have, end it anyway. */
const SAFETY_SLACK_MS = 800;

let runtime: typeof DealRuntime | null = null;
let loading: Promise<void> | null = null;

/** Fetch the staging code. Safe to call again and again; a failure only means no staged deal, never a hidden hand. */
export function preloadDealRuntime(): Promise<void> {
  if (runtime) return Promise.resolve();
  loading ??= import('./dealRuntime')
    .then((loaded) => {
      runtime = loaded;
    })
    .catch(() => {
      loading = null; // try again next time
    });
  return loading;
}

/** Test seam. */
export function resetDealRuntimeForTests(): void {
  runtime = null;
  loading = null;
}

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

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useHandDeal({ handNumber, preGameDrawActive, enabled, pace }: HandDealOptions): void {
  // The hand already on screen when the screen mounted (a reload mid-match) is not dealt again.
  const handledRef = useRef<number | null>(null);
  if (handledRef.current === null) handledRef.current = handNumber > 0 && !preGameDrawActive ? handNumber : 0;

  // Start fetching the staging code now: the pick-a-tile phase gives it seconds to arrive.
  useEffect(() => {
    if (enabled) void preloadDealRuntime();
  }, [enabled]);

  useLayoutEffect(() => {
    const newHand = !preGameDrawActive && handNumber > 0 && handNumber !== handledRef.current;
    // Taken (and so cleared) for every new hand, whether or not it is staged: a deal that was skipped must not leave
    // the pick-a-tile pile behind for a later hand to replay from stale positions.
    const pile = newHand ? takePileSnapshot() : null;
    if (!enabled || !newHand) return;
    handledRef.current = handNumber;

    const stage = runtime;
    const root = document.querySelector<HTMLElement>(ROOT);
    if (
      !stage ||
      !root ||
      document.hidden ||
      prefersReducedMotion() ||
      typeof HTMLElement.prototype.animate !== 'function'
    ) {
      return;
    }

    // Hide the real tiles before the first paint, so the hand never flashes in and then vanishes.
    root.setAttribute('data-hand-deal', 'pending');
    beginDeal(); // Fritz's opening move waits for the cards to land (utils/dealGate.ts)

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
      endDeal();
      for (const tile of root.querySelectorAll('[data-dealt]')) tile.removeAttribute('data-dealt');
    };

    const begin = () => {
      let totalMs: number | null = null;
      try {
        totalMs = stage.startDeal({ root, pile, pace, cards, onDone: end });
      } catch {
        totalMs = null;
      }
      if (totalMs === null) return end();
      timers.push(window.setTimeout(end, totalMs + SAFETY_SLACK_MS));
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
