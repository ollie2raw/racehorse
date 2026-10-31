// client/src/components/deal/scramblePlan.ts
//
// The opening of a match as one piece of staging: the face-down tiles you were picking from are gathered into a
// heap, riffled, and then each one leaves in turn: 14 into the two hands (alternating, as in a real deal) and the
// rest swept into the boneyard counter. Pure numbers; useHandDeal / scrambleDeal.ts do the DOM work.
//
// Every piece gets ONE animation. Its keyframes are relative to where it was lying (so the first keyframe is
// "exactly where the pick-a-tile screen left it", which is what makes the swap from that screen invisible), and every
// piece has the same duration so the whole thing is a single clock: a piece waits in the heap until its turn.
import { dealOrder, DEAL_FLIP_MS, type DealOwner, type DealRect, type DealTarget } from './dealPlan';
import type { PilePiece } from './pileSnapshot';

export interface Point {
  x: number;
  y: number;
}

export interface ScrambleKeyframe {
  /** 0..1 of the piece's whole animation. */
  offset: number;
  /** Where its centre is, relative to where it started lying. */
  dx: number;
  dy: number;
  rotateDeg: number;
  scale: number;
  opacity: number;
  /** Easing from the PREVIOUS keyframe to this one. */
  easing: string;
}

export type ScrambleDestination = DealOwner | 'boneyard';

export type ScrambleStep<T extends DealTarget = DealTarget> = {
  index: number;
  piece: PilePiece;
  destination: ScrambleDestination;
  /** The hand tile this piece becomes (absent for the boneyard). */
  target: T | null;
  keyframes: ScrambleKeyframe[];
  /** The whole animation; it lands at the end. Equal for every piece. */
  durationMs: number;
  /** Your cards turn face up after landing; nothing else does. */
  flipMs: number;
};

export interface ScramblePlan<T extends DealTarget = DealTarget> {
  steps: Array<ScrambleStep<T>>;
  /** From the start to the last piece landing and, if it is yours, turning over. */
  totalMs: number;
}

/** Tiles slide into a heap at the middle. */
export const GATHER_MS = 320;
/** Then riffle: this many passes, each a quick swap left and right. */
export const SHUFFLE_PASSES = 3;
export const SHUFFLE_MS = 420;
/** After the scramble, a piece leaves this often. */
export const LEAVE_STAGGER_MS = 30;
/** Time in the air from the heap to the hand (or boneyard). */
export const LEAVE_FLIGHT_MS = 380;
/** The heap is no wider than this (px) from its centre. */
export const HEAP_RADIUS_PX = 52;
/** How far a tile swings out during a riffle pass (px). */
export const RIFFLE_SWING_PX = 34;
/** How big a piece is once heaped (a little smaller: they are piled on top of one another). */
export const HEAP_SCALE = 0.92;
/** A tile entering the boneyard counter shrinks to this fraction of its size. */
export const BONEYARD_SCALE = 0.22;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GATHER_EASE = 'cubic-bezier(0.45, 0, 0.2, 1)';
const SHUFFLE_EASE = 'cubic-bezier(0.5, 0, 0.5, 1)';
const LEAVE_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** A number in [0, 1) that looks random but is the same every time. */
export function unit(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Where piece `i` of `n` lies in the heap, relative to the heap's centre. */
export function heapOffset(i: number, n: number): Point {
  const radius = 12 + (HEAP_RADIUS_PX - 12) * Math.sqrt((i + 0.5) / Math.max(1, n));
  const angle = i * GOLDEN_ANGLE;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function heapRotation(i: number): number {
  return ((i * 53 + 7) % 71) - 35;
}

function centreOf(rect: DealRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export interface ScrambleInput<T extends DealTarget> {
  pieces: PilePiece[];
  targets: T[];
  /** The middle of the board: where the heap forms. */
  center: Point;
  /** Where the boneyard counter is. */
  boneyard: Point;
  /** 1 = standard, lower = quicker. */
  pace?: number;
}

export function planScramble<T extends DealTarget>({ pieces, targets, center, boneyard, pace = 1 }: ScrambleInput<T>): ScramblePlan<T> {
  const scale = pace > 0 ? pace : 1;
  const gather = GATHER_MS * scale;
  const shuffle = SHUFFLE_MS * scale;
  const stagger = LEAVE_STAGGER_MS * scale;
  const flight = LEAVE_FLIGHT_MS * scale;
  const flip = Math.round(DEAL_FLIP_MS * scale);
  const scrambleEnd = gather + shuffle;

  const hands = dealOrder(targets).slice(0, pieces.length);
  const n = pieces.length;

  const steps = pieces.map<ScrambleStep<T>>((piece, index) => {
    const target = index < hands.length ? hands[index] : null;
    const destination: ScrambleDestination = target ? target.owner : 'boneyard';
    const launchAt = scrambleEnd + index * stagger;
    const durationMs = launchAt + flight;
    const at = (ms: number) => Math.min(1, Math.max(0, ms / durationMs));

    const heap = heapOffset(index, n);
    const heapX = center.x + heap.x - piece.cx;
    const heapY = center.y + heap.y - piece.cy;
    const heapRot = heapRotation(index);

    const keyframes: ScrambleKeyframe[] = [
      { offset: 0, dx: 0, dy: 0, rotateDeg: piece.rotationDeg, scale: 1, opacity: 1, easing: 'linear' },
      { offset: at(gather), dx: heapX, dy: heapY, rotateDeg: heapRot, scale: HEAP_SCALE, opacity: 1, easing: GATHER_EASE },
    ];

    // The riffle: alternate pieces swing opposite ways, then swap, then settle: three quick passes.
    for (let pass = 1; pass <= SHUFFLE_PASSES; pass += 1) {
      const last = pass === SHUFFLE_PASSES;
      const side = (index + pass) % 2 === 0 ? 1 : -1;
      const swing = last ? 0 : side * (RIFFLE_SWING_PX * (0.6 + 0.4 * unit(index * 7 + pass)));
      const lift = last ? 0 : (unit(index * 11 + pass) - 0.5) * 18;
      keyframes.push({
        offset: at(gather + (shuffle * pass) / SHUFFLE_PASSES),
        dx: heapX + swing,
        dy: heapY + lift,
        rotateDeg: heapRot + (last ? 0 : side * 16),
        scale: HEAP_SCALE,
        opacity: 1,
        easing: SHUFFLE_EASE,
      });
    }

    // Wait in the heap until this piece's turn, then leave.
    if (launchAt > scrambleEnd) {
      keyframes.push({ offset: at(launchAt), dx: heapX, dy: heapY, rotateDeg: heapRot, scale: HEAP_SCALE, opacity: 1, easing: 'linear' });
    }

    if (target) {
      const dest = centreOf(target.rect);
      keyframes.push({
        offset: 1,
        dx: dest.x - piece.cx,
        dy: dest.y - piece.cy,
        rotateDeg: 0,
        scale: piece.width > 0 ? target.rect.width / piece.width : 1,
        opacity: 1,
        easing: LEAVE_EASE,
      });
    } else {
      // Into the boneyard counter: it shrinks as it goes in, and disappears at the last moment.
      keyframes.push({
        offset: at(launchAt + flight * 0.82),
        dx: (boneyard.x - piece.cx) * 0.97,
        dy: (boneyard.y - piece.cy) * 0.97,
        rotateDeg: heapRot * 0.4,
        scale: BONEYARD_SCALE * 1.6,
        opacity: 1,
        easing: LEAVE_EASE,
      });
      keyframes.push({
        offset: 1,
        dx: boneyard.x - piece.cx,
        dy: boneyard.y - piece.cy,
        rotateDeg: 0,
        scale: BONEYARD_SCALE,
        opacity: 0,
        easing: 'ease-in',
      });
    }

    return { index, piece, destination, target, keyframes, durationMs, flipMs: target?.owner === 'you' ? flip : 0 };
  });

  const totalMs = steps.reduce((latest, step) => Math.max(latest, step.durationMs + step.flipMs), 0);
  return { steps, totalMs };
}
