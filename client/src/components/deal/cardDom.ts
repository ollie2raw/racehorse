// client/src/components/deal/cardDom.ts
//
// The flying cards of the deal, as DOM: how a card is built so it looks like the tile it becomes, and how it
// lands. Shared by the simple deal (useHandDeal.ts) and the opening scramble (scrambleDeal.ts).
import type { DealRect } from './dealPlan';

export type CardLook = Partial<CSSStyleDeclaration>;

export interface Looks {
  /** Your tiles: the ivory body of a hand tile. */
  you: CardLook;
  /** Fritz's: a face-down rack tile. */
  fritz: CardLook;
}

/**
 * Copy the look of a real tile, so a flying card is the same object that lands: the fill, the border, the shadows
 * and, easy to forget, the corner radius (a first version left it out and the cards flew in as sharp slabs).
 */
export function cardLook(sample: Element | null, fallbackRadius: string): CardLook {
  if (!sample) {
    return { backgroundColor: 'rgb(244, 235, 218)', border: '2px solid rgba(108, 92, 68, 0.62)', borderRadius: fallbackRadius };
  }
  const style = window.getComputedStyle(sample);
  return {
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    border: style.border,
    borderRadius: style.borderRadius,
    boxShadow: style.boxShadow,
  };
}

/** A face-down domino: the real tile's body plus the seam across its middle, so the flying card reads as a tile. */
export function dressAsTileBack(card: HTMLElement, size: { width: number; height: number }): void {
  const seam = document.createElement('div');
  seam.className = 'hand-deal-card__seam';
  // The seam runs across the short side, as on a domino: a wide card is split left/right, a tall one top/bottom.
  if (size.width >= size.height) seam.classList.add('hand-deal-card__seam--vertical');
  card.appendChild(seam);
}

/** A face-down card at `rect`, in `look`, on <body> (like the tile-flight copy, so nothing can clip it). */
export function createCard(rect: DealRect, look: CardLook, cards: HTMLElement[], seam = true): HTMLElement {
  const card = document.createElement('div');
  card.className = 'hand-deal-card';
  card.setAttribute('aria-hidden', 'true');
  Object.assign(card.style, look);
  if (seam) dressAsTileBack(card, rect);
  card.style.left = `${rect.left}px`;
  card.style.top = `${rect.top}px`;
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
  document.body.appendChild(card);
  cards.push(card);
  return card;
}

/**
 * A card has arrived at its real tile. Fritz's stays face down and is simply replaced by his rack tile. Yours turns
 * over: it closes edge-on, then your real tile opens face up in its place.
 *
 * The turn uses the individual `scale` property, not `transform`: a card that travelled by a transform keeps it
 * (animations fill forwards), and a second `transform` animation would throw its position away.
 */
export function landCard(card: HTMLElement, real: HTMLElement, flipMs: number, done: () => void): void {
  const reveal = () => real.setAttribute('data-dealt', '');
  const finish = () => {
    card.remove();
    done();
  };
  if (flipMs <= 0) {
    reveal();
    finish();
    return;
  }
  const half = flipMs / 2;
  try {
    const close = card.animate([{ scale: '1 1' }, { scale: '0 1' }], { duration: half, easing: 'ease-in', fill: 'forwards' });
    close.onfinish = () => {
      reveal();
      try {
        real.animate([{ scale: '0 1' }, { scale: '1 1' }], { duration: half, easing: 'ease-out' });
      } catch {
        /* the tile is already revealed; the opening is only polish */
      }
      finish();
    };
  } catch {
    reveal();
    finish();
  }
}
