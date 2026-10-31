// client/src/components/deal/scramblePlan.ts
//
// The opening of a match as one piece of staging: the face-down tiles you were picking from are gathered into a
// heap, swirled and mixed, and then each one leaves in turn: 14 into the two hands (alternating, as in a real deal)
// and the rest swept into the boneyard counter. Pure numbers; useHandDeal / scrambleDeal.ts do the DOM work.
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
  /** Easing used to ARRIVE at this keyframe from the previous one. */
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
/** Then the heap is swirled and mixed: tiles orbit outward and back in, ending in a different arrangement. */
export const SHUFFLE_MS = 560;
/** After the scramble, a piece leaves this often. */
export const LEAVE_STAGGER_MS = 30;
/** Time in the air from the heap to the hand (or boneyard). */
export const LEAVE_FLIGHT_MS = 380;
/** The heap is no wider than this (px) from its centre. */
export const HEAP_RADIUS_PX = 64;
/** How far out the swirl throws a tile, as a multiple of its place in the heap, at the first and second pass. */
export const SWIRL_REACH = [2.0, 2.6] as const;
/** A tile near the middle of the heap is thrown at least this far (px) at each pass, so the whole heap swirls. */
export const SWIRL_MIN_RADIUS_PX = [72, 96] as const;
/** How far round the heap's centre the tiles have turned at each of those passes (degrees). */
export const SWIRL_TURN_DEG = [100, 215] as const;
/** How far a leaving tile bows away from a straight line to its destination (px, before the per-piece variation). */
export const LEAVE_ARC_PX = 46;
/** How big a piece is once heaped (a little smaller: they are piled on top of one another). */
export const HEAP_SCALE = 0.92;
/** A tile entering the boneyard counter shrinks to this fraction of its size. */
export const BONEYARD_SCALE = 0.22;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GATHER_EASE = 'cubic-bezier(0.45, 0, 0.2, 1)';
const SWIRL_EASE = 'cubic-bezier(0.45, 0.05, 0.55, 0.95)';
const LEAVE_OUT_EASE = 'cubic-bezier(0.35, 0, 0.7, 1)';
const LEAVE_IN_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** A number in [0, 1) that looks random but is the same every time. */
export function unit(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Where slot `i` of `n` lies in the heap, relative to the heap's centre. */
export function heapOffset(i: number, n: number): Point {
  const radius = 14 + (HEAP_RADIUS_PX - 14) * Math.sqrt((i + 0.5) / Math.max(1, n));
  const angle = i * GOLDEN_ANGLE;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function heapRotation(i: number): number {
  return ((i * 53 + 7) % 71) - 35;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Which slot of the heap piece `i` ends up in after the mix. A permutation of 0..n-1 (every slot used once), and for
 * any real heap one that moves almost every piece: that is what makes it a scramble and not a wobble.
 */
export function scatterIndex(i: number, n: number): number {
  if (n <= 1) return 0;
  const step = [7, 9, 11, 5, 3, 13, 1].find((k) => gcd(k, n) === 1) ?? 1;
  return (i * step + 3) % n;
}

function rotateAround(p: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
}

function centreOf(rect: DealRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** A point `fraction` of the way from `a` to `b`, pushed sideways by `bow` px (positive = to the left of a -> b). */
function bowed(a: Point, b: Point, fraction: number, bow: number): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: a.x + dx * fraction + (-dy / length) * bow, y: a.y + dy * fraction + (dx / length) * bow };
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
    const here = { x: piece.cx, y: piece.cy };
    const rel = (p: Point) => ({ dx: p.x - here.x, dy: p.y - here.y });
    const abs = (offset: Point): Point => ({ x: center.x + offset.x, y: center.y + offset.y });

    // Where it gathers, and where it will end up after the mix (a different slot).
    const first = heapOffset(index, n);
    const slot = scatterIndex(index, n);
    const settled = abs(heapOffset(slot, n));
    const gathered = abs(first);
    const heapRot = heapRotation(index);
    const settledRot = heapRotation(slot) + 360;

    const keyframes: ScrambleKeyframe[] = [
      { offset: 0, dx: 0, dy: 0, rotateDeg: piece.rotationDeg, scale: 1, opacity: 1, easing: 'linear' },
      { offset: at(gather), ...rel(gathered), rotateDeg: heapRot, scale: HEAP_SCALE, opacity: 1, easing: GATHER_EASE },
    ];

    // The mix: two passes that throw each tile out along a turning spiral, then it falls into its NEW place in the heap.
    SWIRL_REACH.forEach((reach, pass) => {
      const swirled = abs(
        (() => {
          const p = rotateAround(first, SWIRL_TURN_DEG[pass]);
          const length = Math.hypot(p.x, p.y) || 1;
          const radius = Math.max(length * reach, SWIRL_MIN_RADIUS_PX[pass]);
          return { x: (p.x / length) * radius, y: (p.y / length) * radius };
        })(),
      );
      keyframes.push({
        offset: at(gather + (shuffle * (pass + 1)) / 3),
        ...rel(swirled),
        rotateDeg: heapRot + (pass + 1) * 145,
        scale: HEAP_SCALE,
        opacity: 1,
        easing: SWIRL_EASE,
      });
    });
    keyframes.push({ offset: at(scrambleEnd), ...rel(settled), rotateDeg: settledRot, scale: HEAP_SCALE, opacity: 1, easing: SWIRL_EASE });

    // Wait in the heap until this piece's turn, then leave along a curve (a straight line reads as a conveyor belt).
    if (launchAt > scrambleEnd) {
      keyframes.push({ offset: at(launchAt), ...rel(settled), rotateDeg: settledRot, scale: HEAP_SCALE, opacity: 1, easing: 'linear' });
    }
    const side = index % 2 === 0 ? 1 : -1;
    const bow = side * LEAVE_ARC_PX * (0.6 + 0.8 * unit(index * 5 + 2));

    if (target) {
      const dest = centreOf(target.rect);
      keyframes.push({ offset: at(launchAt + flight * 0.45), ...rel(bowed(settled, dest, 0.45, bow)), rotateDeg: 360 + side * 35, scale: 1, opacity: 1, easing: LEAVE_OUT_EASE });
      keyframes.push({
        offset: 1,
        ...rel(dest),
        rotateDeg: 360,
        scale: piece.width > 0 ? target.rect.width / piece.width : 1,
        opacity: 1,
        easing: LEAVE_IN_EASE,
      });
    } else {
      // Into the boneyard counter: it arcs over, shrinks as it goes in, and disappears at the last moment.
      keyframes.push({ offset: at(launchAt + flight * 0.45), ...rel(bowed(settled, boneyard, 0.45, bow)), rotateDeg: 360 + side * 50, scale: 0.8, opacity: 1, easing: LEAVE_OUT_EASE });
      keyframes.push({
        offset: at(launchAt + flight * 0.82),
        ...rel(bowed(settled, boneyard, 0.97, bow * 0.15)),
        rotateDeg: 360 + 20,
        scale: BONEYARD_SCALE * 1.6,
        opacity: 1,
        easing: LEAVE_IN_EASE,
      });
      keyframes.push({ offset: 1, ...rel(boneyard), rotateDeg: 360 + 30, scale: BONEYARD_SCALE, opacity: 0, easing: 'ease-in' });
    }

    return { index, piece, destination, target, keyframes, durationMs, flipMs: target?.owner === 'you' ? flip : 0 };
  });

  const totalMs = steps.reduce((latest, step) => Math.max(latest, step.durationMs + step.flipMs), 0);
  return { steps, totalMs };
}
