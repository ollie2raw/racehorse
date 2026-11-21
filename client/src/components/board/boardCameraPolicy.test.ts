/**
 * Camera policy A (full recentre, the default) against policy B (comfort hold, config/boardCameraPolicy.ts) on the same real-game replays.
 *
 * B is not asserted to be "better because it moves less". It has to move less WITHOUT costing what the player needs: every tile in view, tiles
 * as readable, corrections not distractingly larger. Those bounds are the test; the full comparison is printed with BOARD_CAMERA_REPORT=1:
 *   BOARD_CAMERA_REPORT=1 npx vitest run src/components/board/boardCameraPolicy.test.ts --reporter=verbose
 * B uses the production comfort test (isBoardComfortable) and the production fit (modelCameraFit), so it shares A's geometry by construction.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BoardState } from '../../types.ts';
import { playGame, VARIANTS, type Policy } from '../../../../packages/game-core/src/__tests__/support/engineHarness';
import { advanceWorldOrigin, boundsCenter, type WorldOrigin } from './boardWorldFrame.ts';
import { computeBoardLayout, type BoardLayout } from './boardLayout.ts';
import { BOARD_UNIT_PX, READABLE_FLOOR_PX, countBoardTiles, layoutOptionsFor, modelCameraFit, simulateSpring, VIEWPORT_PROFILES, type ViewportProfile } from './boardQualityMetrics.ts';
import { isBoardComfortable } from './boardCameraComfort.ts';

vi.setConfig({ testTimeout: 120_000 });
const U = BOARD_UNIT_PX;
const POLICIES: Policy[] = ['random', 'scoreGreedy', 'doubles', 'branch'];
const pipKey = (t: { low: number; high: number }) => `${Math.min(t.low, t.high)}-${Math.max(t.low, t.high)}`;
const pips = (t: { tile: { low: number; high: number } }) => pipKey(t.tile);

interface Cam { cx: number; cy: number; s: number } // world-frame point at the container centre, and scale
interface Step { layout: BoardLayout; origin: WorldOrigin; count: number; end: 'left' | 'right' | 'other'; handStart: boolean }

function replay(seed: string, policy: Policy, profile: ViewportProfile): Step[] {
  const options = layoutOptionsFor(profile);
  const run = playGame(seed, VARIANTS[0], policy, { keepStates: true });
  const steps: Step[] = [];
  let prevBoard: BoardState | null = null;
  let prev: BoardLayout | null = null;
  let origin: WorldOrigin = { x: 0, y: 0 };
  for (const state of run.states) {
    const board = state.board as unknown as BoardState | null;
    const count = countBoardTiles(board);
    if (!board || count === 0) { prevBoard = null; prev = null; continue; }
    const layout = computeBoardLayout(board, [], options);
    const contiguous = prev !== null && prevBoard !== null && count === countBoardTiles(prevBoard) + 1;
    origin = contiguous ? advanceWorldOrigin(prev!, origin, layout) : boundsCenter(layout);
    let end: Step['end'] = 'other';
    if (contiguous && board.mainLine.length === prevBoard!.mainLine.length + 1) {
      if (pipKey(board.mainLine[0].tile) !== pipKey(prevBoard!.mainLine[0].tile) && pipKey(board.mainLine[1].tile) === pipKey(prevBoard!.mainLine[0].tile)) end = 'left';
      else if (pipKey(board.mainLine[board.mainLine.length - 1].tile) !== pipKey(prevBoard!.mainLine[prevBoard!.mainLine.length - 1].tile)) end = 'right';
    }
    steps.push({ layout, origin, count, end, handStart: !contiguous });
    prevBoard = board; prev = layout;
  }
  return steps;
}

const fitCam = (st: Step, p: ViewportProfile): Cam => {
  const bc = boundsCenter(st.layout);
  return { cx: bc.x - st.origin.x, cy: bc.y - st.origin.y, s: modelCameraFit(st.layout, st.count, p).scale };
};
/** The camera the live hook has as a target: screen = container centre + camera + scale * (tile - origin) * U, with camera = -scale * centre * U. */
const comfortable = (st: Step, cam: Cam, p: ViewportProfile) => {
  const bc = boundsCenter(st.layout);
  return isBoardComfortable({
    layout: st.layout,
    worldOffsetUnits: { x: bc.x - st.origin.x, y: bc.y - st.origin.y },
    camera: { x: -cam.s * cam.cx * U, y: -cam.s * cam.cy * U, scale: cam.s },
    unitPx: U, containerWidth: p.containerWidth, containerHeight: p.containerHeight,
    reserved: p.phoneLandscape ? p.reserved : [],
  });
};
type PolicyFn = (st: Step, prev: Cam | null, p: ViewportProfile) => Cam;
const policyA: PolicyFn = (st, _prev, p) => fitCam(st, p);
const policyB: PolicyFn = (st, prev, p) => (!prev || st.handStart || !comfortable(st, prev, p) ? fitCam(st, p) : prev);

const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; };

function evaluate(corpus: Step[][], fn: PolicyFn, p: ViewportProfile) {
  let n = 0; let moved = 0; let clipped = 0; let placements = 0; let under18 = 0; let abrupt = 0; let moves = 0; let refitsEqualA = 0; let refits = 0;
  const move: number[] = []; const moveL: number[] = []; const moveR: number[] = []; const edge: number[] = []; const peaks: number[] = []; let totalMove = 0;
  for (const hand of corpus) {
    let prev: Cam | null = null;
    let prevStep: Step | null = null;
    for (const st of hand) {
      const cam = fn(st, prev, p);
      if (prev && prevStep && !st.handStart) {
        n += 1;
        const before = new Map(prevStep.layout.tiles.map((t) => [pips(t), { x: (t.x - prevStep!.origin.x - prev!.cx) * prev!.s * U, y: (t.y - prevStep!.origin.y - prev!.cy) * prev!.s * U }]));
        let mv = 0;
        const survivors: Array<{ x: number; y: number }> = [];
        for (const t of st.layout.tiles) {
          const a = before.get(pips(t));
          if (!a) continue;
          survivors.push({ x: (t.x - st.origin.x) * U, y: (t.y - st.origin.y) * U });
          mv = Math.max(mv, Math.hypot((t.x - st.origin.x - cam.cx) * cam.s * U - a.x, (t.y - st.origin.y - cam.cy) * cam.s * U - a.y));
        }
        move.push(mv); totalMove += mv;
        (st.end === 'left' ? moveL : st.end === 'right' ? moveR : []).push(mv);
        if (mv > 2) {
          moved += 1;
          const sp = simulateSpring({ x: -prev.s * prev.cx * U, y: -prev.s * prev.cy * U, scale: prev.s }, { x: -cam.s * cam.cx * U, y: -cam.s * cam.cy * U, scale: cam.s }, survivors);
          peaks.push(sp.peakFramePx); moves += 1;
          if (sp.peakFramePx > 8) abrupt += 1;
        }
        const a = fitCam(st, p);
        if (cam.cx !== prev.cx || cam.cy !== prev.cy || cam.s !== prev.s) { refits += 1; if (Math.abs(cam.s - a.s) < 1e-9 && Math.abs(cam.cx - a.cx) < 1e-9 && Math.abs(cam.cy - a.cy) < 1e-9) refitsEqualA += 1; }
      }
      placements += 1;
      const W = p.containerWidth; const H = p.containerHeight;
      let anyClipped = false;
      for (const t of st.layout.tiles) {
        const hw = (t.rotation === 0 ? 1 : 0.5) * cam.s * U; const hh = (t.rotation === 0 ? 0.5 : 1) * cam.s * U;
        const x = (t.x - st.origin.x - cam.cx) * cam.s * U; const y = (t.y - st.origin.y - cam.cy) * cam.s * U;
        if (x - hw < -W / 2 - 0.5 || x + hw > W / 2 + 0.5 || y - hh < -H / 2 - 0.5 || y + hh > H / 2 + 0.5) anyClipped = true;
      }
      if (anyClipped) clipped += 1;
      const e = cam.s * U; edge.push(e); if (e < READABLE_FLOOR_PX) under18 += 1;
      prev = cam; prevStep = st;
    }
  }
  return {
    n, movedPct: (100 * moved) / n, clippedPct: (100 * clipped) / placements, under18Pct: (100 * under18) / placements, edgeP5: pct(edge, 0.05), edgeP50: pct(edge, 0.5),
    moveP50: pct(move, 0.5), moveP95: pct(move, 0.95), moveLp50: pct(moveL, 0.5), moveRp50: pct(moveR, 0.5), totalMovePerPlacement: totalMove / n,
    abruptPct: (100 * abrupt) / Math.max(1, moves), refits, refitsEqualA,
  };
}

const PROFILES = [VIEWPORT_PROFILES[0], VIEWPORT_PROFILES[1], VIEWPORT_PROFILES[2], VIEWPORT_PROFILES[5]];

describe('camera policy B (comfort hold) against policy A (full recentre) on the same replays', () => {
  for (const profile of PROFILES) {
    it(`${profile.name}: B costs nothing the player needs and moves less`, () => {
      const corpus: Step[][] = [];
      for (const policy of POLICIES) for (let g = 0; g < 8; g += 1) corpus.push(replay(`camera-policy-v1:${policy}:${g}`, policy, profile));
      const a = evaluate(corpus, policyA, profile);
      const b = evaluate(corpus, policyB, profile);
      if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BOARD_CAMERA_REPORT) {
        const f = (x: number, d = 1) => x.toFixed(d);
        for (const [name, r] of [['A', a], ['B', b]] as const) {
          console.warn(`POLICY|${profile.name}|${name}|placements moved ${f(r.movedPct, 0)}%|move px p50/p95 ${f(r.moveP50, 0)}/${f(r.moveP95, 0)}|total move/placement ${f(r.totalMovePerPlacement, 0)} px|abrupt(>8px/frame) ${f(r.abruptPct)}%|tile edge p5/p50 ${f(r.edgeP5, 0)}/${f(r.edgeP50, 0)} px|under 18px ${f(r.under18Pct)}%|clipped ${f(r.clippedPct)}%|L/R move p50 ${f(r.moveLp50, 0)}/${f(r.moveRp50, 0)}|refits equal to A ${r.refitsEqualA}/${r.refits}`);
        }
      }
      // It is the same fit: whenever B moves the camera it lands exactly where A would.
      expect(b.refitsEqualA, 'B refits identically to A').toBe(b.refits);
      // Visibility: B never shows less of the board than A does.
      expect(b.clippedPct).toBeLessThanOrEqual(a.clippedPct + 1e-9);
      // Readability: B is not allowed to buy stillness with smaller tiles (the 18 px floor is the programme's decision).
      expect(b.edgeP5).toBeGreaterThanOrEqual(a.edgeP5 - 1.5);
      expect(b.under18Pct).toBeLessThanOrEqual(a.under18Pct + 1);
      // It must actually move less...
      expect(b.movedPct).toBeLessThanOrEqual(a.movedPct - 5);
      // ...without distractingly larger corrections or a rougher glide.
      expect(b.moveP95).toBeLessThanOrEqual(a.moveP95 * 1.5);
      expect(b.abruptPct).toBeLessThanOrEqual(12);
      // Left and right placements are treated alike (median moves within 40% of each other, both policies).
      for (const r of [a, b]) {
        const lo = Math.min(r.moveLp50, r.moveRp50); const hi = Math.max(r.moveLp50, r.moveRp50);
        expect(hi === 0 || lo / hi >= 0.6, `L/R p50 ${r.moveLp50}/${r.moveRp50}`).toBe(true);
      }
    });
  }
});
