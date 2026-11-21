/**
 * The camera pipeline end to end, on real games, in the quantity the player sees: pixels on the screen.
 *
 *   layout (computeBoardLayout) -> world origin (advanceWorldOrigin) -> fit scale (modelCameraFit) -> camera target -> spring
 *   screen position of a tile = container centre + camera + scale * (tile - origin) * unit
 *
 * Tiles are identified by their pips here, NOT by the layout's key, on purpose: the first version of the world frame was tested by key, and a
 * key that changed on every left placement made the test skip exactly the tiles it was meant to check (the bug it missed: left placements
 * teleported the whole board; see boardWorldFrame.ts). These tests would fail on that.
 */
import { describe, expect, it, vi } from 'vitest';

// The corpus checks walk thousands of placements; under the full suite's parallel load the 5 s default is not enough (it timed out there, never alone).
vi.setConfig({ testTimeout: 60_000 });
import type { BoardState } from '../../types.ts';
import { playGame, VARIANTS, type Policy } from '../../../../packages/game-core/src/__tests__/support/engineHarness';
import { advanceWorldOrigin, boundsCenter, type WorldOrigin } from './boardWorldFrame.ts';
import { computeBoardLayout, type BoardLayout } from './boardLayout.ts';
import { BOARD_UNIT_PX, countBoardTiles, layoutOptionsFor, modelCameraFit, VIEWPORT_PROFILES, type ViewportProfile } from './boardQualityMetrics.ts';
import { cameraOf, createCameraSpring, isCameraSettled, stepCameraSpring, type CameraTarget } from './cameraSpring.ts';

type End = 'left' | 'right' | 'other';
interface Step {
  board: BoardState;
  layout: BoardLayout;
  origin: WorldOrigin;
  target: CameraTarget;
  end: End;
  count: number;
  /** The previous step's layout/origin, for survivors. Null on the first tile of a hand. */
  prev: { layout: BoardLayout; origin: WorldOrigin; target: CameraTarget } | null;
  overflowed: boolean;
}

const POLICIES: Policy[] = ['random', 'scoreGreedy', 'doubles', 'branch'];
const pips = (t: { tile: { low: number; high: number } }) => `${Math.min(t.tile.low, t.tile.high)}-${Math.max(t.tile.low, t.tile.high)}`;
const pipKey = (t: { low: number; high: number }) => `${Math.min(t.low, t.high)}-${Math.max(t.low, t.high)}`;

function endOf(before: BoardState, after: BoardState): End {
  if (after.mainLine.length !== before.mainLine.length + 1) return 'other';
  if (pipKey(after.mainLine[0].tile) !== pipKey(before.mainLine[0].tile) && pipKey(after.mainLine[1].tile) === pipKey(before.mainLine[0].tile)) return 'left';
  if (pipKey(after.mainLine[after.mainLine.length - 1].tile) !== pipKey(before.mainLine[before.mainLine.length - 1].tile)) return 'right';
  return 'other';
}

/** Replays a game the way Board.tsx does: world frame advanced per layout, camera target from the fit. */
function replay(seed: string, policy: Policy, profile: ViewportProfile): Step[] {
  const options = layoutOptionsFor(profile);
  const run = playGame(seed, VARIANTS[0], policy, { keepStates: true });
  const steps: Step[] = [];
  let prevBoard: BoardState | null = null;
  let prev: Step['prev'] = null;
  let origin: WorldOrigin = { x: 0, y: 0 };
  for (const state of run.states) {
    const board = state.board as unknown as BoardState | null;
    const count = countBoardTiles(board);
    if (!board || count === 0) { prevBoard = null; prev = null; continue; }
    const layout = computeBoardLayout(board, [], options);
    const contiguous = prev !== null && prevBoard !== null && count === countBoardTiles(prevBoard) + 1;
    origin = contiguous ? advanceWorldOrigin(prev!.layout, origin, layout) : boundsCenter(layout);
    const fit = modelCameraFit(layout, count, profile);
    const bc = boundsCenter(layout);
    const target: CameraTarget = {
      x: -fit.scale * (bc.x - origin.x) * BOARD_UNIT_PX,
      y: -fit.scale * (bc.y - origin.y) * BOARD_UNIT_PX,
      scale: fit.scale,
    };
    if (contiguous) steps.push({ board, layout, origin, target, end: endOf(prevBoard!, board), count, prev, overflowed: fit.overflowed });
    prevBoard = board;
    prev = { layout, origin, target };
  }
  return steps;
}

const PROFILES = [VIEWPORT_PROFILES[0], VIEWPORT_PROFILES[1], VIEWPORT_PROFILES[2]];

function corpus() {
  const all: Array<{ profile: ViewportProfile; steps: Step[] }> = [];
  for (const profile of PROFILES) for (const policy of POLICIES) for (let g = 0; g < 8; g += 1) all.push({ profile, steps: replay(`camera-pipeline-v1:${policy}:${g}`, policy, profile) });
  return all;
}
const CORPUS = corpus();

/** On-screen move (px) of a tile the instant the layout changes, before the camera has moved: the camera is still at the previous target. */
function jumpsPx(step: Step): number[] {
  const prev = step.prev!;
  const cam = prev.target; // the spring is at the previous target (settled) when the new layout renders
  const before = new Map(prev.layout.tiles.map((t) => [pips(t), t]));
  const out: number[] = [];
  for (const t of step.layout.tiles) {
    const was = before.get(pips(t));
    if (!was) continue;
    const a = { x: cam.x + cam.scale * (was.x - prev.origin.x) * BOARD_UNIT_PX, y: cam.y + cam.scale * (was.y - prev.origin.y) * BOARD_UNIT_PX };
    const b = { x: cam.x + cam.scale * (t.x - step.origin.x) * BOARD_UNIT_PX, y: cam.y + cam.scale * (t.y - step.origin.y) * BOARD_UNIT_PX };
    out.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return out;
}

describe('camera pipeline: a placement never moves a placed tile on screen by itself (left and right alike)', () => {
  it('the corpus contains left placements, right placements and placements at both ends of one board', () => {
    const steps = CORPUS.flatMap((c) => c.steps);
    expect(steps.filter((s) => s.end === 'left').length).toBeGreaterThan(300);
    expect(steps.filter((s) => s.end === 'right').length).toBeGreaterThan(300);
  });

  it('test 1 and 2: a LEFT-end placement and a RIGHT-end placement both leave placed tiles where they were (only genuinely re-routed tiles move)', () => {
    for (const end of ['left', 'right'] as const) {
      let placements = 0;
      let placementsWithAJump = 0;
      for (const { steps } of CORPUS) {
        for (const step of steps.filter((s) => s.end === end)) {
          placements += 1;
          // A jump is only acceptable when the router moved a tile relative to the rest (a bend appearing).
          const moved = jumpsPx(step).filter((px) => px > 0.5);
          const reRouted = step.layout.bends.length !== step.prev!.layout.bends.length;
          if (moved.length > 0 && !reRouted) placementsWithAJump += 1;
        }
      }
      expect(placements, end).toBeGreaterThan(300);
      expect(placementsWithAJump, `${end}: placements where a placed tile jumped without a re-route`).toBe(0);
    }
  });

  it('every tile of the previous layout is still there, with the same key, after a placement at either end', () => {
    for (const { steps } of CORPUS) {
      for (const step of steps) {
        if (step.end === 'other') continue;
        const keys = new Set(step.layout.tiles.map((t) => t.key));
        for (const t of step.prev!.layout.tiles) expect(keys.has(t.key), `${step.end}: ${t.key}`).toBe(true);
      }
    }
  });

  it('test 3: alternating left and right placements keep the frame continuous', () => {
    let alternating = 0;
    for (const { steps } of CORPUS) {
      for (let i = 1; i < steps.length; i += 1) {
        const a = steps[i - 1].end;
        const b = steps[i].end;
        if (!((a === 'left' && b === 'right') || (a === 'right' && b === 'left'))) continue;
        alternating += 1;
        const reRouted = steps[i].layout.bends.length !== steps[i].prev!.layout.bends.length;
        if (!reRouted) expect(Math.max(0, ...jumpsPx(steps[i]))).toBeLessThan(0.5);
      }
    }
    expect(alternating).toBeGreaterThan(100);
  });

  it('test 4 and 5: expanding one way for several tiles in a row, or both ways, stays continuous', () => {
    let runs = 0;
    for (const { steps } of CORPUS) {
      for (let i = 0; i + 3 < steps.length; i += 1) {
        const window = steps.slice(i, i + 4);
        if (!window.every((s) => s.end === window[0].end) || window[0].end === 'other') continue;
        runs += 1;
        for (const s of window) {
          if (s.layout.bends.length !== s.prev!.layout.bends.length) continue;
          expect(Math.max(0, ...jumpsPx(s))).toBeLessThan(0.5);
        }
      }
    }
    expect(runs).toBeGreaterThan(20);
  });
});

describe('camera pipeline: board geometry is stable (the two root causes of the left/right camera bug)', () => {
  it('root cause 1: a tile keeps its layout key through a placement at either end (the key used to contain its position in the main line)', () => {
    let left = 0;
    for (const { steps } of CORPUS) {
      for (const step of steps) {
        if (step.end !== 'left') continue;
        left += 1;
        const old = step.prev!.layout.tiles.filter((t) => t.key.startsWith('main-'));
        const now = new Set(step.layout.tiles.map((t) => t.key));
        expect(old.every((t) => now.has(t.key)), 'every previous main-line key is still present after a left placement').toBe(true);
      }
    }
    expect(left).toBeGreaterThan(300);
  });

  it('root cause 2: a bent arm does not change side when the main line re-centres (phone routing flipped it whenever hubX crossed zero)', () => {
    let compared = 0;
    let flips = 0;
    for (const { steps } of CORPUS) {
      for (const step of steps) {
        for (const bend of step.prev!.layout.bends) {
          const now = step.layout.bends.find((b) => b.hubId === bend.hubId && b.arm === bend.arm);
          if (!now) continue;
          compared += 1;
          if (now.dir !== bend.dir) flips += 1;
        }
      }
    }
    // Measured on this corpus: 99 of 1923 bend observations (5.1%) flipped with the old phone rule; 8 of 1921 (0.4%) now. The remaining flips are the
    // collision resolver choosing the other side on purpose (a real re-route, covered by the jump tests above).
    expect(compared).toBeGreaterThan(1500);
    expect(flips / compared, `${flips} of ${compared} bends changed side`).toBeLessThan(0.01);
  });
});

describe('camera pipeline: a geometry change that needs no camera movement', () => {
  it('test 12: selecting a tile (the open-end drop zones join the bounds) does not move the camera', () => {
    let boards = 0;
    let changed = 0;
    for (const { profile, steps } of CORPUS.slice(0, 12)) {
      const options = layoutOptionsFor(profile);
      for (const step of steps) {
        const open: Array<'left' | 'right'> = ['left', 'right'];
        const bare = step.layout;
        const selected = computeBoardLayout(step.board, open, options);
        boards += 1;
        const same = ['minX', 'maxX', 'minY', 'maxY'].every((k) => Math.abs((bare as unknown as Record<string, number>)[k] - (selected as unknown as Record<string, number>)[k]) < 1e-6);
        if (!same || Math.abs(modelCameraFit(bare, step.count, profile).scale - modelCameraFit(selected, step.count, profile).scale) > 1e-3) changed += 1;
      }
    }
    expect(boards).toBeGreaterThan(500);
    // Measured on 4331 boards x 3 profiles: 0.3% change the bounds on a desktop profile, 0.0% change the fit anywhere.
    expect(changed / boards).toBeLessThan(0.01);
  });
});

describe('camera pipeline: framing and visibility', () => {
  it('test 6, 7 and 11: once settled the board is centred in the container and, unless the camera floor stops it, fits inside it (every profile)', () => {
    for (const { profile, steps } of CORPUS) {
      for (const step of steps) {
        if (step.overflowed) continue; // the documented floor case: cannot be whole and readable (docs/board-camera-baseline.md)
        const cam = step.target;
        const bc = boundsCenter(step.layout);
        // centre of the layout bounds on screen, relative to the container centre
        const cx = cam.x + cam.scale * (bc.x - step.origin.x) * BOARD_UNIT_PX;
        const cy = cam.y + cam.scale * (bc.y - step.origin.y) * BOARD_UNIT_PX;
        expect(Math.abs(cx), `${profile.name} x centre`).toBeLessThan(0.01);
        expect(Math.abs(cy), `${profile.name} y centre`).toBeLessThan(0.01);
        const w = cam.scale * (step.layout.maxX - step.layout.minX) * BOARD_UNIT_PX;
        const h = cam.scale * (step.layout.maxY - step.layout.minY) * BOARD_UNIT_PX;
        expect(w, `${profile.name} width`).toBeLessThanOrEqual(profile.containerWidth + 0.5);
        expect(h, `${profile.name} height`).toBeLessThanOrEqual(profile.containerHeight + 0.5);
      }
    }
  });

  it('every tile centre is inside the container once settled, for both ends, in every profile', () => {
    for (const { profile, steps } of CORPUS) {
      for (const step of steps) {
        if (step.overflowed) continue;
        for (const t of step.layout.tiles) {
          const x = step.target.x + step.target.scale * (t.x - step.origin.x) * BOARD_UNIT_PX;
          const y = step.target.y + step.target.scale * (t.y - step.origin.y) * BOARD_UNIT_PX;
          expect(Math.abs(x)).toBeLessThanOrEqual(profile.containerWidth / 2);
          expect(Math.abs(y)).toBeLessThanOrEqual(profile.containerHeight / 2);
        }
      }
    }
  });
});

describe('camera pipeline: rapid and overlapping placements (the spring)', () => {
  /** Plays the spring at 60 fps, retargeting at the given times; returns the final camera and the largest per-frame tile move. */
  function playSpring(start: CameraTarget, retargets: Array<{ atMs: number; target: CameraTarget }>, tile: { x: number; y: number }, totalMs: number) {
    let state = createCameraSpring(start);
    let target = start;
    let prevPos = { x: start.x + start.scale * tile.x, y: start.y + start.scale * tile.y };
    let peak = 0;
    let overshoot = 0;
    for (let ms = 0; ms < totalMs; ms += 1000 / 60) {
      for (const r of retargets) if (r.atMs <= ms && r.atMs > ms - 1000 / 60) target = r.target;
      state = stepCameraSpring(state, target, 1 / 60);
      const cam = cameraOf(state);
      const pos = { x: cam.x + cam.scale * tile.x, y: cam.y + cam.scale * tile.y };
      peak = Math.max(peak, Math.hypot(pos.x - prevPos.x, pos.y - prevPos.y));
      prevPos = pos;
      overshoot = Math.max(overshoot, Math.max(0, (cam.x - target.x) * Math.sign(start.x - target.x) * -1));
    }
    return { final: cameraOf(state), settled: isCameraSettled(state, target), peak, overshoot };
  }

  it('test 8, 9 and 10: two placements 100 ms apart blend into one motion that ends exactly on the last target, without a jump or oscillation', () => {
    const a: CameraTarget = { x: 0, y: 0, scale: 1 };
    const b: CameraTarget = { x: 60, y: 0, scale: 0.9 };
    const c: CameraTarget = { x: 120, y: 0, scale: 0.8 };
    const tile = { x: 100, y: 0 };
    const direct = playSpring(a, [{ atMs: 0, target: c }], tile, 3000);
    const overlapped = playSpring(a, [{ atMs: 0, target: b }, { atMs: 100, target: c }], tile, 3000);
    expect(overlapped.settled).toBe(true);
    expect(overlapped.final.x).toBeCloseTo(c.x, 1);
    expect(overlapped.final.scale).toBeCloseTo(c.scale, 3);
    // Retargeting keeps the velocity: the per-frame move of a tile never exceeds what the unobstructed move needs by more than a small factor.
    expect(overlapped.peak).toBeLessThan(direct.peak * 1.5 + 1);
    expect(overlapped.overshoot).toBeLessThan(0.5);
  });
});
