import { describe, expect, it } from 'vitest';
import type { DealTarget } from './dealPlan';
import {
  BONEYARD_SCALE,
  GATHER_MS,
  HEAP_RADIUS_PX,
  LEAVE_FLIGHT_MS,
  LEAVE_STAGGER_MS,
  SHUFFLE_MS,
  heapOffset,
  planScramble,
  scatterIndex,
  unit,
} from './scramblePlan';
import type { PilePiece } from './pileSnapshot';

const center = { x: 640, y: 400 };
const boneyard = { x: 1190, y: 150 };

const pieces = (n: number): PilePiece[] =>
  Array.from({ length: n }, (_, i) => ({ cx: 200 + (i % 7) * 120, cy: 160 + Math.floor(i / 7) * 110, width: 88, height: 44, rotationDeg: (i * 13) % 50 - 25 }));

const hand = (n: number, owner: DealTarget['owner']): DealTarget[] =>
  Array.from({ length: n }, (_, i) => ({ owner, rect: { left: 140 + i * 130, top: owner === 'you' ? 700 : 30, width: owner === 'you' ? 126 : 19, height: owner === 'you' ? 64 : 30 } }));

const targets = [...hand(7, 'you'), ...hand(7, 'fritz')];
const plan = planScramble({ pieces: pieces(26), targets, center, boneyard });

describe('planScramble: where each piece goes', () => {
  it('deals 14 pieces into the hands, alternating, and sends the rest to the boneyard', () => {
    expect(plan.steps.slice(0, 14).map((s) => s.destination)).toEqual(['you', 'fritz', 'you', 'fritz', 'you', 'fritz', 'you', 'fritz', 'you', 'fritz', 'you', 'fritz', 'you', 'fritz']);
    expect(plan.steps.slice(14).every((s) => s.destination === 'boneyard')).toBe(true);
    expect(plan.steps.filter((s) => s.destination === 'boneyard')).toHaveLength(12);
  });

  it('gives every hand tile exactly one piece', () => {
    const used = plan.steps.map((s) => s.target).filter(Boolean);
    expect(new Set(used).size).toBe(14);
  });

  it('sends everything to the boneyard when there is nothing to deal into', () => {
    const empty = planScramble({ pieces: pieces(5), targets: [], center, boneyard });
    expect(empty.steps.every((s) => s.destination === 'boneyard')).toBe(true);
  });

  it('never deals more than it has pieces for', () => {
    const short = planScramble({ pieces: pieces(4), targets, center, boneyard });
    expect(short.steps.filter((s) => s.target)).toHaveLength(4);
  });
});

describe('planScramble: the timeline', () => {
  it('leaves one after another once the scramble is over', () => {
    const scrambleEnd = GATHER_MS + SHUFFLE_MS;
    plan.steps.forEach((s, i) => expect(s.durationMs).toBe(scrambleEnd + i * LEAVE_STAGGER_MS + LEAVE_FLIGHT_MS));
  });

  it('every keyframe list starts exactly where the piece was lying and ends at its destination', () => {
    for (const s of plan.steps) {
      const first = s.keyframes[0];
      expect(first).toMatchObject({ offset: 0, dx: 0, dy: 0, rotateDeg: s.piece.rotationDeg, scale: 1, opacity: 1 });
      const last = s.keyframes[s.keyframes.length - 1];
      expect(last.offset).toBe(1);
      if (s.target) {
        expect(last.dx).toBeCloseTo(s.target.rect.left + s.target.rect.width / 2 - s.piece.cx);
        expect(last.dy).toBeCloseTo(s.target.rect.top + s.target.rect.height / 2 - s.piece.cy);
        expect(last.scale).toBeCloseTo(s.target.rect.width / s.piece.width);
        expect(last.opacity).toBe(1);
      } else {
        expect(last.dx).toBeCloseTo(boneyard.x - s.piece.cx);
        expect(last.dy).toBeCloseTo(boneyard.y - s.piece.cy);
        expect(last.scale).toBeCloseTo(BONEYARD_SCALE);
        expect(last.opacity).toBe(0); // gone as it enters the counter
      }
    }
  });

  it('keyframe offsets only ever move forward, inside 0..1', () => {
    for (const s of plan.steps) {
      for (let i = 1; i < s.keyframes.length; i += 1) {
        expect(s.keyframes[i].offset).toBeGreaterThanOrEqual(s.keyframes[i - 1].offset);
        expect(s.keyframes[i].offset).toBeLessThanOrEqual(1);
      }
    }
  });

  it('heaps every piece within the heap radius of the centre before it leaves', () => {
    for (const s of plan.steps) {
      const heapped = s.keyframes[1];
      const x = s.piece.cx + heapped.dx - center.x;
      const y = s.piece.cy + heapped.dy - center.y;
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(HEAP_RADIUS_PX + 0.001);
    }
  });

  it('mixes the heap: after the swirl every piece sits in a NEW place, still inside the heap', () => {
    const centreOfHeap = (s: (typeof plan.steps)[number], k: { dx: number; dy: number }) => ({ x: s.piece.cx + k.dx - center.x, y: s.piece.cy + k.dy - center.y });
    let moved = 0;
    const slots = new Set<string>();
    for (const s of plan.steps) {
      const gathered = centreOfHeap(s, s.keyframes[1]);
      const settled = centreOfHeap(s, s.keyframes[4]);
      expect(Math.hypot(settled.x, settled.y)).toBeLessThanOrEqual(HEAP_RADIUS_PX + 0.001);
      if (Math.hypot(settled.x - gathered.x, settled.y - gathered.y) > 1) moved += 1;
      slots.add(`${settled.x.toFixed(2)},${settled.y.toFixed(2)}`);
    }
    expect(moved, 'almost every piece changes place').toBeGreaterThanOrEqual(plan.steps.length - 1);
    expect(slots.size, 'and no two pieces share a place').toBe(plan.steps.length);
  });

  it('throws tiles OUT during the swirl, well beyond the heap, so the mix is visible', () => {
    for (const s of plan.steps) {
      const out = s.keyframes[3]; // the widest pass
      const x = s.piece.cx + out.dx - center.x;
      const y = s.piece.cy + out.dy - center.y;
      expect(Math.hypot(x, y)).toBeGreaterThan(HEAP_RADIUS_PX * 0.9);
    }
  });

  it('leaves along a curve, not a straight line', () => {
    for (const s of plan.steps) {
      const end = s.keyframes[s.keyframes.length - 1];
      const mid = s.keyframes.find((k) => k.offset > s.keyframes[4].offset && k !== end && Math.abs(k.dx - s.keyframes[4].dx) + Math.abs(k.dy - s.keyframes[4].dy) > 1)!;
      const start = s.keyframes[4];
      // Distance of the middle point from the straight line start -> end: a bow means it is clearly off the line.
      const lx = end.dx - start.dx;
      const ly = end.dy - start.dy;
      const length = Math.hypot(lx, ly) || 1;
      const off = Math.abs((mid.dx - start.dx) * ly - (mid.dy - start.dy) * lx) / length;
      expect(off, `piece ${s.index} flies a straight line`).toBeGreaterThan(8);
    }
  });

  it('turns only your cards over, and the whole opening lasts a couple of seconds', () => {
    expect(plan.steps.filter((s) => s.flipMs > 0).every((s) => s.destination === 'you')).toBe(true);
    expect(plan.totalMs).toBeGreaterThan(1500);
    expect(plan.totalMs).toBeLessThan(2600);
  });

  it('scales every duration with pace', () => {
    const fast = planScramble({ pieces: pieces(26), targets, center, boneyard, pace: 0.6 });
    expect(fast.totalMs).toBeLessThan(plan.totalMs * 0.7);
  });

  it('is the same every time', () => {
    const again = planScramble({ pieces: pieces(26), targets, center, boneyard });
    expect(JSON.stringify(again.steps.map((s) => s.keyframes))).toBe(JSON.stringify(plan.steps.map((s) => s.keyframes)));
  });
});

describe('heap and noise helpers', () => {
  it('scatterIndex is a permutation: every slot of the heap is used exactly once', () => {
    for (const n of [1, 2, 5, 14, 26, 28]) {
      const slots = new Set(Array.from({ length: n }, (_, i) => scatterIndex(i, n)));
      expect(slots.size).toBe(n);
      for (const slot of slots) expect(slot).toBeLessThan(n);
    }
  });

  it('spreads pieces across the heap without leaving it', () => {
    const offsets = Array.from({ length: 26 }, (_, i) => heapOffset(i, 26));
    for (const o of offsets) expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(HEAP_RADIUS_PX + 0.001);
    expect(new Set(offsets.map((o) => `${o.x.toFixed(1)},${o.y.toFixed(1)}`)).size).toBe(26);
  });

  it('unit() is deterministic and stays in range', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(unit(i)).toBe(unit(i));
      expect(unit(i)).toBeGreaterThanOrEqual(0);
      expect(unit(i)).toBeLessThan(1);
    }
  });
});
