// client/src/components/deal/dealRuntime.ts
//
// The staging itself: reads where the real tiles are, then builds and runs the cards. Loaded on demand (see
// useHandDeal.ts): it is presentation that plays once a hand, so it stays out of the match screen's main code.
// useHandDeal owns hiding the real tiles and ending everything; this module only starts the cards.
import { createCard, cardLook, dressAsTileBack, landCard, type CardLook, type Looks } from './cardDom';
import { planDeal, type DealRect, type DealStep, type DealTarget } from './dealPlan';
import type { PileSnapshot } from './pileSnapshot';
import { runScramble, type ScrambleTarget } from './scrambleDeal';

const HAND_TILES = '.hand-area:not(.pre-game-draw-hand-dock) .domino-tile:not(.board-tile)';
const RACK_TILES = '.rh-tile-rack__tile';
const BOARD = '.board-container';
const BONEYARD = '.boneyard-pill';

export interface StartDealOptions {
  root: HTMLElement;
  /** The pick-a-tile pile, when there is one (the first hand of a match). */
  pile: PileSnapshot | null;
  pace: number;
  /** Every card is added here so the caller can always remove them. */
  cards: HTMLElement[];
  /** Called once, when the last card has landed. */
  onDone: () => void;
}

function rectOf(el: Element): DealRect | null {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

/** Start the deal. Returns how long it will run, or null if there is nothing to deal into. */
export function startDeal({ root, pile, pace, cards, onDone }: StartDealOptions): number | null {
  const handTiles = [...root.querySelectorAll<HTMLElement>(HAND_TILES)];
  const rackTiles = [...root.querySelectorAll<HTMLElement>(RACK_TILES)];
  const targets: ScrambleTarget[] = [];
  for (const el of handTiles) {
    const rect = rectOf(el);
    if (rect) targets.push({ owner: 'you', rect, el });
  }
  for (const el of rackTiles) {
    const rect = rectOf(el);
    if (rect) targets.push({ owner: 'fritz', rect, el });
  }
  if (targets.length === 0) return null;

  const boardRect =
    (() => {
      const board = root.querySelector(BOARD);
      return board && rectOf(board);
    })() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const center = { x: boardRect.left + boardRect.width / 2, y: boardRect.top + boardRect.height / 2 };
  const looks: Looks = {
    you: cardLook(handTiles[0]?.querySelector('.domino-body') ?? handTiles[0] ?? null, '7px'),
    fritz: cardLook(rackTiles[0] ?? null, '5px'),
  };

  let remaining: number;
  const oneLanded = () => {
    remaining -= 1;
    if (remaining <= 0) onDone();
  };

  if (pile && pile.pieces.length >= targets.length) {
    // The opening: the pick-a-tile pile is scrambled, dealt, and what is left goes into the boneyard counter.
    const counter = root.querySelector(BONEYARD);
    const counterRect = counter && rectOf(counter);
    const point = counterRect
      ? { x: counterRect.left + counterRect.width / 2, y: counterRect.top + counterRect.height / 2 }
      : { x: boardRect.left + boardRect.width - 56, y: boardRect.top + 44 };
    remaining = pile.pieces.length;
    return runScramble({
      snapshot: pile,
      targets,
      center,
      boneyard: { point, el: counter },
      fallbackLook: looks.you,
      pace,
      cards,
      onLanded: oneLanded,
    });
  }

  const plan = planDeal(targets, pace);
  remaining = plan.steps.length;
  for (const step of plan.steps) launch(step, step.el, center, looks, oneLanded, cards);
  showHeap(plan.steps, center, looks.you, cards);
  return plan.totalMs;
}

/** How the tiles of the heap at the middle of the board are scattered: offset (px), tilt (deg), bottom to top. */
const HEAP: ReadonlyArray<{ x: number; y: number; deg: number }> = [
  { x: -6, y: 5, deg: -13 },
  { x: 7, y: 4, deg: 9 },
  { x: -3, y: -3, deg: 5 },
  { x: 5, y: -4, deg: -7 },
  { x: 0, y: 0, deg: 2 },
];

/**
 * The heap a later hand's cards come from: a small stack of face-down tiles at the middle of the board that rises,
 * is dealt from, and fades. A heap of real-looking tiles, because a single blank slab read as a stray rectangle.
 */
function showHeap(
  steps: Array<{ rect: DealRect; owner: string; delayMs: number }>,
  center: { x: number; y: number },
  look: CardLook,
  cards: HTMLElement[],
): void {
  const sample = steps.find((step) => step.owner === 'you') ?? steps[0];
  if (!sample) return;
  const width = sample.rect.width * 0.75;
  const height = sample.rect.height * 0.75;
  const lastOut = steps.reduce((latest, step) => Math.max(latest, step.delayMs), 0);
  const heap = document.createElement('div');
  heap.className = 'hand-deal-pile';
  heap.setAttribute('aria-hidden', 'true');
  heap.style.left = `${center.x - width / 2}px`;
  heap.style.top = `${center.y - height / 2}px`;
  heap.style.width = `${width}px`;
  heap.style.height = `${height}px`;
  for (const piece of HEAP) {
    const tile = document.createElement('div');
    tile.className = 'hand-deal-pile__tile';
    Object.assign(tile.style, look);
    tile.style.transform = `translate(${piece.x}px, ${piece.y}px) rotate(${piece.deg}deg)`;
    dressAsTileBack(tile, { width, height });
    heap.appendChild(tile);
  }
  document.body.appendChild(heap);
  cards.push(heap);
  const total = lastOut + 280;
  try {
    const animation = heap.animate(
      [
        { opacity: 0, transform: 'scale(0.9)' },
        { opacity: 1, transform: 'scale(1)', offset: 0.12 },
        { opacity: 1, transform: 'scale(1)', offset: 0.82 },
        { opacity: 0, transform: 'scale(0.96)' },
      ],
      { duration: total, easing: 'ease-out', fill: 'both' },
    );
    animation.onfinish = () => heap.remove();
  } catch {
    heap.remove();
  }
}

function launch(
  step: DealStep & DealTarget,
  real: HTMLElement,
  center: { x: number; y: number },
  looks: Looks,
  landed: () => void,
  cards: HTMLElement[],
): void {
  const { rect } = step;
  const card = createCard(rect, step.owner === 'you' ? looks.you : looks.fritz, cards);
  const dx = center.x - (rect.left + rect.width / 2);
  const dy = center.y - (rect.top + rect.height / 2);
  try {
    const flight = card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(${step.fromRotateDeg}deg) scale(${step.fromScale})`, opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1 },
      ],
      { duration: step.flightMs, delay: step.delayMs, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' },
    );
    flight.onfinish = () => landCard(card, real, step.flipMs, landed);
  } catch {
    real.setAttribute('data-dealt', '');
    card.remove();
    landed();
  }
}
