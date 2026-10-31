// client/src/components/deal/scrambleDeal.ts
//
// The opening of a match, as DOM: the face-down tiles you were just picking from are scrambled in a heap, then dealt
// into both hands, and the rest sweep into the boneyard counter (choreography in scramblePlan.ts).
//
// Every card starts exactly where its tile was lying on the pick-a-tile screen (pileSnapshot.ts), so when that screen
// is replaced by the live one the cards simply carry on from the same spots. useHandDeal owns hiding the real tiles
// and ending the whole thing; this module only builds and runs the cards.
import { createCard, landCard, type CardLook } from './cardDom';
import type { DealTarget } from './dealPlan';
import type { PileSnapshot } from './pileSnapshot';
import { planScramble, type Point, type ScrambleStep } from './scramblePlan';

export type ScrambleTarget = DealTarget & { el: HTMLElement };

export interface ScrambleOptions {
  snapshot: PileSnapshot;
  targets: ScrambleTarget[];
  /** The middle of the board: where the heap forms. */
  center: Point;
  /** The boneyard counter: where the rest of the pile goes. */
  boneyard: { point: Point; el: Element | null };
  /** Used for a pile whose look could not be read. */
  fallbackLook: CardLook;
  pace: number;
  /** Every card and the pile's pieces are added here so the caller can always remove them. */
  cards: HTMLElement[];
  /** One call per piece, as each arrives. */
  onLanded: () => void;
}

/** Start the scramble. Returns how long it runs, so the caller can set a safety timer. */
export function runScramble(options: ScrambleOptions): number {
  const { snapshot, targets, center, boneyard, fallbackLook, pace, cards, onLanded } = options;
  const plan = planScramble({ pieces: snapshot.pieces, targets, center, boneyard: boneyard.point, pace });
  const look: CardLook = snapshot.look ? { ...snapshot.look } : fallbackLook;
  const arrivals = plan.steps.filter((step) => step.destination === 'boneyard').length;
  let arrived = 0;

  for (const step of plan.steps) {
    const { piece } = step;
    const card = createCard(
      { left: piece.cx - piece.width / 2, top: piece.cy - piece.height / 2, width: piece.width, height: piece.height },
      look,
      cards,
      // The pick-a-tile backs already carry their own divider; drawing a second one would sit a hair off the first.
      false,
    );
    try {
      const animation = card.animate(frames(step), { duration: step.durationMs, fill: 'forwards' });
      animation.onfinish = () => {
        if (step.target) {
          landCard(card, step.target.el, step.flipMs, onLanded);
          return;
        }
        // Into the boneyard counter: it takes the tile in with a small pulse, then the counter is the only thing left.
        arrived += 1;
        if (arrived % 3 === 0 || arrived === arrivals) pulse(boneyard.el);
        card.remove();
        onLanded();
      };
    } catch {
      // No animation for this piece: its real tile (if any) is revealed straight away so nothing is ever left hidden.
      step.target?.el.setAttribute('data-dealt', '');
      card.remove();
      onLanded();
    }
  }
  return plan.totalMs;
}

/** WAAPI wants the easing of a segment on the keyframe that STARTS it; the plan states the easing of arriving at one. */
function frames(step: ScrambleStep): Keyframe[] {
  return step.keyframes.map((k, i) => ({
    offset: k.offset,
    transform: `translate(${k.dx}px, ${k.dy}px) rotate(${k.rotateDeg}deg) scale(${k.scale})`,
    opacity: k.opacity,
    easing: step.keyframes[i + 1]?.easing ?? 'linear',
  }));
}

function pulse(counter: Element | null): void {
  if (!counter || typeof (counter as HTMLElement).animate !== 'function') return;
  try {
    (counter as HTMLElement).animate([{ scale: '1' }, { scale: '1.14' }, { scale: '1' }], { duration: 200, easing: 'ease-out' });
  } catch {
    /* a missed pulse is invisible */
  }
}
