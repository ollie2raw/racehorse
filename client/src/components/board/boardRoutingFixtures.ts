// Deterministic board fixtures for the responsive routing work. Every board is
// built through game-core's real placement (canPlaceTileAt + simulatePlacement),
// never hand-forged, so topology, hub ids, exposed ends and open-end metadata
// are exactly what a live match produces. Used by unit/property tests and by the
// e2e harness (e2e/harness/board-routing.html). Not imported by the app.

import { canPlaceTileAt, getOpenEnds, simulatePlacement } from '@racehorse/game-core';
import type { BoardState, PlacementPosition, Tile } from '../../types';

/** n = ordinary tile, d = double. */
export type ArmStep = 'n' | 'd';

const tileKey = (t: Tile) => `${Math.min(t.low, t.high)}-${Math.max(t.low, t.high)}`;
const mk = (a: number, b: number): Tile => ({ low: Math.min(a, b), high: Math.max(a, b) });

export interface FixtureBuilder {
  board: BoardState;
  used: Set<string>;
}

export function startFixture(spinner = 6): FixtureBuilder {
  const t = mk(spinner, spinner);
  return { board: simulatePlacement(null, t, 'left'), used: new Set([tileKey(t)]) };
}

function openEndValue(board: BoardState, position: PlacementPosition): number {
  const end = getOpenEnds(board).find((e) => e.position === position);
  if (!end) throw new Error(`fixture: no open end at ${position}`);
  return end.matchValue;
}

/**
 * Append tiles at `position`, one per step. Tile choice is deterministic: the
 * lowest-pip chain of unused tiles that satisfies the requested double/ordinary
 * pattern, so the same steps always yield the same board. Throws if no such
 * chain exists or a placement is not legal.
 */
export function extend(fb: FixtureBuilder, position: PlacementPosition, steps: ArmStep[]): FixtureBuilder {
  let { board } = fb;
  const used = new Set(fb.used);
  const plan = planTiles(openEndValue(board, position), steps, used);
  if (!plan) throw new Error(`fixture: no feasible unused-tile chain for ${position} (${steps.join('')})`);
  for (const tile of plan) {
    if (!canPlaceTileAt(board, tile, position)) throw new Error(`fixture: illegal ${tileKey(tile)} at ${position}`);
    board = simulatePlacement(board, tile, position);
    used.add(tileKey(tile));
  }
  return { board, used };
}

/** Depth-first, lowest-pip-first search for a chain of unused tiles matching `steps`. */
function planTiles(match: number, steps: ArmStep[], used: Set<string>): Tile[] | null {
  if (steps.length === 0) return [];
  const [step, ...rest] = steps;
  const candidates = step === 'd' ? [mk(match, match)] : [0, 1, 2, 3, 4, 5, 6].filter((p) => p !== match).map((p) => mk(match, p));
  for (const tile of candidates) {
    const key = tileKey(tile);
    if (used.has(key)) continue;
    used.add(key);
    const tail = planTiles(step === 'd' ? match : tile.low === match ? tile.high : tile.low, rest, used);
    used.delete(key);
    if (tail) return [tile, ...tail];
  }
  return null;
}

/** Double-six spinner crossed on both sides, ready for up (arm 0) / down (arm 1) arms. */
export function crossedSpinner(): FixtureBuilder {
  let fb = startFixture(6);
  fb = extend(fb, 'right', ['n']);
  fb = extend(fb, 'left', ['n']);
  return fb;
}

export const armPosition = (hubId: number, arm: 0 | 1): PlacementPosition => `branch-${hubId}-${arm}`;

const rep = (n: number, step: ArmStep = 'n'): ArmStep[] => Array.from({ length: n }, () => step);

/** n ordinary tiles, with a double inserted at each index in `doubleAt` (0-based arm index). */
export function armSteps(length: number, doubleAt: number[] = []): ArmStep[] {
  const steps = rep(length);
  for (const i of doubleAt) steps[i] = 'd';
  return steps;
}

export interface ArmSpec {
  up?: ArmStep[];
  down?: ArmStep[];
}

/** Crossed 6-6 spinner at the centre with the requested up/down arms. */
export function spinnerWithArms(spec: ArmSpec): BoardState {
  let fb = crossedSpinner();
  const hubId = fb.board.hubDoubles[0].hubId as number;
  if (spec.up) fb = extend(fb, armPosition(hubId, 0), spec.up);
  if (spec.down) fb = extend(fb, armPosition(hubId, 1), spec.down);
  return fb.board;
}

/**
 * A crossed spinner at the centre plus a second crossed main-line double further
 * along the right of the main line, each with its own up/down arm: the "crossed
 * hub / branch from a hub near a boundary" case. Both hubs bend against the same
 * limit, so their runs must not collide.
 */
export function twoHubBoard(first: ArmSpec, second: ArmSpec, gapTiles = 2): BoardState {
  let fb = crossedSpinner();
  // Walk the right end out `gapTiles` ordinary tiles, drop a double, then one
  // more ordinary tile so the second double is crossed.
  fb = extend(fb, 'right', rep(gapTiles));
  fb = extend(fb, 'right', ['d']);
  fb = extend(fb, 'right', ['n']);
  const hubs = fb.board.hubDoubles.filter((h) => (h.laneType ?? 'mainline') === 'mainline');
  const centre = hubs.find((h) => h.hubValue === 6 && h.mainlineIndex !== undefined && h.mainlineIndex <= 1) ?? hubs[0];
  const outer = hubs.find((h) => h.hubId !== centre.hubId)!;
  const apply = (hubId: number, spec: ArmSpec) => {
    if (spec.up) fb = extend(fb, armPosition(hubId, 0), spec.up);
    if (spec.down) fb = extend(fb, armPosition(hubId, 1), spec.down);
  };
  // The outer hub draws first: the spinner's low-pip chains would otherwise starve it.
  apply(outer.hubId as number, second);
  apply(centre.hubId as number, first);
  return fb.board;
}

export const FIXTURES = {
  /** Long upward arm only. */
  longUp: () => spinnerWithArms({ up: armSteps(9) }),
  /** Longest single arm the 28-tile set allows: the "chain nearly fills the board" case. */
  longUpMax: () => spinnerWithArms({ up: armSteps(12) }),
  /** Long downward arm only. */
  longDown: () => spinnerWithArms({ down: armSteps(9) }),
  /** Top and bottom arms simultaneously long. */
  longBoth: () => spinnerWithArms({ up: armSteps(8), down: armSteps(8) }),
  /** Short/medium arms: must stay straight. */
  mediumBoth: () => spinnerWithArms({ up: armSteps(3), down: armSteps(3) }),
  /** Long horizontal main line (no arms). */
  longHorizontal: () => {
    let fb = startFixture(6);
    fb = extend(fb, 'right', rep(7));
    fb = extend(fb, 'left', rep(6));
    return fb.board;
  },
} as const;

export type FixtureName = keyof typeof FIXTURES;

// ─── Seeded random legal play (property tests) ───────────────────────────

/** mulberry32: tiny deterministic PRNG so a failing seed reproduces exactly. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plays random legal tiles onto random open ends of a fresh double-set board
 * until `maxTiles` are down or nothing fits. Every placement goes through
 * canPlaceTileAt + simulatePlacement, so the result is always a board the real
 * engine could have produced. Biased toward branch ends so long arms and nested
 * hubs actually occur.
 */
export function randomBoard(seed: number, maxTiles = 24): BoardState {
  const rand = seededRandom(seed);
  const all: Tile[] = [];
  for (let hi = 0; hi <= 6; hi += 1) for (let lo = 0; lo <= hi; lo += 1) all.push({ low: lo, high: hi });
  const pool = all.slice();
  const shuffled = <T,>(items: T[]) => items.slice().sort(() => rand() - 0.5);
  // Open with a double so a hub exists early.
  const doubles = pool.filter((t) => t.low === t.high);
  const first = doubles[Math.floor(rand() * doubles.length)];
  pool.splice(pool.indexOf(first), 1);
  let board = simulatePlacement(null, first, 'left');
  for (let placed = 1; placed < maxTiles; placed += 1) {
    const ends = getOpenEnds(board);
    const branchEnds = ends.filter((e) => e.position.startsWith('branch-'));
    const otherEnds = ends.filter((e) => !e.position.startsWith('branch-'));
    const order =
      rand() < 0.65 && branchEnds.length
        ? [...shuffled(branchEnds), ...shuffled(otherEnds)]
        : shuffled(ends);
    let done = false;
    for (const end of order) {
      const candidates = pool.filter((t) => canPlaceTileAt(board, t, end.position));
      if (!candidates.length) continue;
      const tile = candidates[Math.floor(rand() * candidates.length)];
      pool.splice(pool.indexOf(tile), 1);
      board = simulatePlacement(board, tile, end.position);
      done = true;
      break;
    }
    if (!done) break;
  }
  return board;
}
