import { describe, expect, it } from 'vitest';
import { getOpenEnds } from '@racehorse/game-core';
import type { BoardState, PlacementPosition } from '../../types.ts';
import { computeOpenEndsSum } from '../../game/openEndsGeometry.ts';
import {
  deepFreeze,
  playGame,
  VARIANTS,
  type Policy,
} from '../../../../packages/game-core/src/__tests__/support/engineHarness';
import { computeBoardLayout, type BoardLayout, type BoardLayoutOptions } from './boardLayout.ts';
import {
  FIXTURES,
  armPosition,
  armSteps,
  crossedSpinner,
  extend,
  randomBoard,
  spinnerWithArms,
  twoHubBoard,
} from './boardRoutingFixtures.ts';
import { HEIGHT_BUCKET_PX, bucketContainerHeight, resolveVerticalArmExtent } from './boardRouting.ts';

// ─── helpers ─────────────────────────────────────────────────

const ext = (maxVerticalArmExtent: number): BoardLayoutOptions => ({ maxVerticalArmExtent });

const box = (t: BoardLayout['tiles'][number]) => {
  const horizontal = t.rotation === 0; // rotation 0 lies along x, doubles included
  const halfW = horizontal ? 1 : 0.5;
  const halfH = horizontal ? 0.5 : 1;
  return { l: t.x - halfW, r: t.x + halfW, t: t.y - halfH, b: t.y + halfH };
};

function overlapPairs(layout: BoardLayout): string[] {
  const out: string[] = [];
  const boxes = layout.tiles.map((t) => ({ key: t.key, ...box(t) }));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.l < b.r - 1e-6 && a.r > b.l + 1e-6 && a.t < b.b - 1e-6 && a.b > b.t + 1e-6) {
        out.push(a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`);
      }
    }
  }
  return out;
}

const armKeyPrefix = (hubId: number, arm: number) => `branch-${hubId}-${arm}-`;
const armTiles = (layout: BoardLayout, hubId: number, arm: number) =>
  layout.tiles
    .filter((t) => t.key.startsWith(armKeyPrefix(hubId, arm)))
    .sort((a, b) => Number(a.key.split('-')[3]) - Number(b.key.split('-')[3]));
const hubX = (layout: BoardLayout) => layout.tiles.find((t) => t.key.startsWith('main-') && t.key.endsWith('-6-6'))!.x;
const isDoubleKey = (key: string) => {
  const parts = key.split('-');
  return parts[parts.length - 1] === parts[parts.length - 2];
};
const onAxis = (layout: BoardLayout, t: BoardLayout['tiles'][number]) => Math.abs(t.x - hubX(layout)) < 1e-6;

/** Distance from the hub centre to the far edge of the last on-axis tile of an arm. */
function straightReach(layout: BoardLayout, hubY: number, tiles: BoardLayout['tiles']): number {
  const straight = tiles.filter((t) => onAxis(layout, t));
  if (!straight.length) return 0;
  return Math.max(...straight.map((t) => Math.abs(t.y - hubY) + (t.rotation === 0 ? 0.5 : 1)));
}

const HUB = 0;

// ─── straight inside the bounds, turning near them ───────────

describe('viewport-aware vertical arm routing', () => {
  it('keeps arms straight while they sit comfortably inside the bounds', () => {
    const layout = computeBoardLayout(spinnerWithArms({ up: armSteps(3), down: armSteps(3) }), [], ext(12));
    expect(layout.bends).toEqual([]);
    for (const arm of [0, 1]) for (const t of armTiles(layout, HUB, arm)) expect(onAxis(layout, t)).toBe(true);
  });

  it('keeps arms straight when nothing is limited (static views, unmeasured containers)', () => {
    const layout = computeBoardLayout(FIXTURES.longBoth(), []);
    expect(layout.bends).toEqual([]);
  });

  it('turns an upward arm sideways before it crosses the top bound', () => {
    const layout = computeBoardLayout(FIXTURES.longUp(), [], ext(8));
    // reach before tile i = 1.2 + 2.15 i; tile i turns when reach + 2 > 8 -> i = 3.
    expect(layout.bends).toEqual([{ hubId: HUB, arm: 0, tileIndex: 3, dir: 1 }]);
    const arm = armTiles(layout, HUB, 0);
    const corner = arm[3];
    const lastVertical = arm[2];
    // The corner sits on the outer half of the last vertical tile, then runs level.
    expect(corner.y).toBeCloseTo(lastVertical.y - 0.5, 6);
    const rowY = corner.y;
    arm.slice(3).forEach((t) => expect(t.y).toBeCloseTo(rowY, 6));
    for (let i = 4; i < arm.length; i += 1) expect(arm[i].x).toBeGreaterThan(arm[i - 1].x);
    expect(rowY).toBeLessThan(0); // up is -y
  });

  it('turns a downward arm sideways before it crosses the bottom bound', () => {
    const layout = computeBoardLayout(FIXTURES.longDown(), [], ext(8));
    expect(layout.bends).toEqual([{ hubId: HUB, arm: 1, tileIndex: 3, dir: 1 }]);
    const arm = armTiles(layout, HUB, 1);
    expect(arm[3].y).toBeGreaterThan(0); // down is +y
    arm.slice(3).forEach((t) => expect(t.y).toBeCloseTo(arm[3].y, 6));
  });

  it('turns top and bottom arms independently, on the same side, without colliding', () => {
    const layout = computeBoardLayout(FIXTURES.longBoth(), [], ext(8));
    expect(layout.bends.map((b) => [b.arm, b.tileIndex, b.dir])).toEqual([
      [0, 3, 1],
      [1, 3, 1],
    ]);
    expect(overlapPairs(layout)).toEqual([]);
  });

  it('cuts the vertical footprint of a long arm and uses the unused width instead', () => {
    const straight = computeBoardLayout(FIXTURES.longUpMax(), []);
    const routed = computeBoardLayout(FIXTURES.longUpMax(), [], ext(8));
    expect(routed.maxY - routed.minY).toBeLessThan((straight.maxY - straight.minY) * 0.6);
    expect(routed.maxX - routed.minX).toBeGreaterThan(straight.maxX - straight.minX);
  });
});

// ─── doubles never turn the corner ───────────────────────────

describe('double rule: the bend vertex is never a double', () => {
  // With limit 8 an ordinary tile turns at index 3 (see above).
  it('a double exactly where the turn would occur is laid across the arm; the turn waits', () => {
    const board = spinnerWithArms({ up: armSteps(8, [3]) });
    const layout = computeBoardLayout(board, [], ext(8));
    const arm = armTiles(layout, HUB, 0);
    expect(onAxis(layout, arm[3])).toBe(true);
    expect(arm[3].rotation).toBe(0); // lies across the arm, not twisted round a corner
    // Tile 4 is ordinary but follows a double (nothing can wrap a double): still straight.
    expect(onAxis(layout, arm[4])).toBe(true);
    // Tile 5 is the first ordinary tile that follows an ordinary tile: it is the corner.
    expect(layout.bends).toEqual([{ hubId: HUB, arm: 0, tileIndex: 5, dir: 1 }]);
    expect(isDoubleKey(arm[5].key)).toBe(false);
    expect(isDoubleKey(arm[4].key)).toBe(false);
  });

  it('a double just before the threshold also defers the turn to the next qualifying tile', () => {
    const layout = computeBoardLayout(spinnerWithArms({ up: armSteps(8, [2]) }), [], ext(8));
    expect(layout.bends).toEqual([{ hubId: HUB, arm: 0, tileIndex: 4, dir: 1 }]);
    const arm = armTiles(layout, HUB, 0);
    expect(isDoubleKey(arm[2].key)).toBe(true);
    expect(onAxis(layout, arm[2])).toBe(true);
    expect(onAxis(layout, arm[3])).toBe(true);
  });

  it('a double after the turn lies across the horizontal run and is never the corner', () => {
    const layout = computeBoardLayout(spinnerWithArms({ up: armSteps(9, [5]) }), [], ext(8));
    expect(layout.bends[0].tileIndex).toBe(3);
    const arm = armTiles(layout, HUB, 0);
    expect(isDoubleKey(arm[5].key)).toBe(true);
    expect(arm[5].rotation).toBe(90); // across a horizontal run
    expect(arm[5].y).toBeCloseTo(arm[3].y, 6);
  });

  it('two doubles can never be adjacent in one lane (same pip, same tile)', () => {
    expect(() => spinnerWithArms({ up: armSteps(6, [3, 4]) })).toThrow();
  });

  it('holds on every board a generated game reaches, at every limit', () => {
    for (const board of gameBoards()) {
      for (const limit of [3.5, 5, 8, 12]) {
        const layout = computeBoardLayout(board, [], ext(limit));
        for (const bend of layout.bends ?? []) {
          const hub = board.hubDoubles.find((h) => h.hubId === bend.hubId)!;
          const tiles = hub.branches[bend.arm]!.tiles;
          expect(tiles[bend.tileIndex].tile.low === tiles[bend.tileIndex].tile.high, 'corner tile').toBe(false);
          expect(bend.tileIndex).toBeGreaterThan(0);
          const prev = tiles[bend.tileIndex - 1].tile;
          expect(prev.low === prev.high, 'tile before the corner').toBe(false);
        }
      }
    }
  });
});

// ─── hubs, branches, nesting ─────────────────────────────────

describe('hubs and nested branches', () => {
  it('bends arms of a hub that is not the spinner without overlap (crossed hub near the side)', () => {
    const board = twoHubBoard({ up: armSteps(5) }, { up: armSteps(5), down: armSteps(3) });
    const layout = computeBoardLayout(board, [], ext(8));
    expect(layout.bends?.length).toBeGreaterThan(0);
    expect(overlapPairs(layout)).toEqual([]);
  });

  it('two long hubs side by side never collide: runs go to different sides or one stays straight', () => {
    const board = twoHubBoard({ up: armSteps(5), down: armSteps(3) }, { up: armSteps(3), down: armSteps(2) });
    const base = new Set(overlapPairs(computeBoardLayout(board, [])));
    const routed = overlapPairs(computeBoardLayout(board, [], ext(8))).filter((p) => !base.has(p));
    expect(routed).toEqual([]);
  });

  it('resolves colliding runs deterministically: the run that would cross another hub takes the free side or stays straight', () => {
    const board = twoHubBoard({ up: armSteps(5), down: armSteps(3) }, { up: armSteps(3), down: armSteps(2) });
    // At limit 8 only the spinner's up arm turns, to the stable default side (right).
    expect(computeBoardLayout(board, [], ext(8)).bends).toEqual([{ hubId: 0, arm: 0, tileIndex: 3, dir: 1 }]);
    // At limit 5 every arm wants to turn right and they would cross each other's columns:
    // the resolver keeps one run (on the side that is free of the other hub) and straightens the rest.
    const tight = computeBoardLayout(board, [], ext(5));
    expect(tight.bends).toEqual([{ hubId: 0, arm: 0, tileIndex: 1, dir: -1 }]);
    const base = new Set(overlapPairs(computeBoardLayout(board, [])));
    expect(overlapPairs(tight).filter((p) => !base.has(p))).toEqual([]);
    expect(JSON.stringify(computeBoardLayout(board, [], ext(5)))).toBe(JSON.stringify(tight));
  });

  it('a nested branch hub inside a vertical arm keeps its horizontal arms and does not overlap', () => {
    let fb = crossedSpinner();
    fb = extend(fb, armPosition(HUB, 0), armSteps(6, [1]));
    const child = fb.board.hubDoubles.find((h) => h.laneType === 'branch')!;
    expect(child.isCrossed).toBe(true);
    fb = extend(fb, armPosition(child.hubId as number, 0), armSteps(2));
    fb = extend(fb, armPosition(child.hubId as number, 1), armSteps(2));
    const layout = computeBoardLayout(fb.board, [], ext(8));
    expect(overlapPairs(layout)).toEqual([]);
    expect(layout.tiles).toHaveLength(computeBoardLayout(fb.board, []).tiles.length);
  });

  it('a hub whose double sits inside the bent run still lays out without overlap', () => {
    let fb = crossedSpinner();
    fb = extend(fb, armPosition(HUB, 0), armSteps(8, [5]));
    const child = fb.board.hubDoubles.find((h) => h.laneType === 'branch')!;
    fb = extend(fb, armPosition(child.hubId as number, 0), armSteps(2));
    const layout = computeBoardLayout(fb.board, [], ext(8));
    expect(layout.bends.some((b) => b.hubId === HUB && b.arm === 0)).toBe(true);
    expect(overlapPairs(layout)).toEqual([]);
  });
});

// ─── routing is visual only ──────────────────────────────────

describe('topology, legality and scoring are independent of routing', () => {
  it('lays out a deep-frozen board (routing never mutates it) with the same tiles and arm order', () => {
    for (const make of Object.values(FIXTURES)) {
      const board = deepFreeze(make());
      const straight = computeBoardLayout(board, []);
      for (const limit of [3.5, 6, 9]) {
        const routed = computeBoardLayout(board, [], ext(limit));
        expect(routed.tiles.map((t) => t.key).sort()).toEqual(straight.tiles.map((t) => t.key).sort());
      }
    }
  });

  it('open ends, legal positions and the scoring sum match the independent oracle on generated games', () => {
    let checked = 0;
    for (const { board, oracleSum } of gameBoardsWithOracle()) {
      const frozen = deepFreeze(JSON.parse(JSON.stringify(board)) as BoardState);
      const endsBefore = JSON.stringify(getOpenEnds(frozen));
      for (const options of [{}, ext(3.5), ext(8), { maxVerticalArmTiles: 2 }] as BoardLayoutOptions[]) {
        computeBoardLayout(frozen, [], options);
      }
      expect(JSON.stringify(getOpenEnds(frozen))).toBe(endsBefore);
      expect(computeOpenEndsSum(frozen)).toBe(oracleSum);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('is deterministic: same board and viewport limit give the identical layout', () => {
    const board = FIXTURES.longBoth();
    expect(JSON.stringify(computeBoardLayout(board, [], ext(8)))).toBe(JSON.stringify(computeBoardLayout(board, [], ext(8))));
  });

  it('places each arm zone against the last tile, straight or around the corner', () => {
    const board = FIXTURES.longBoth();
    const positions: PlacementPosition[] = [armPosition(HUB, 0), armPosition(HUB, 1)];
    const layout = computeBoardLayout(board, positions, ext(8));
    for (const [arm, position] of positions.entries()) {
      const zone = layout.zones.find((z) => z.position === position)!;
      const last = armTiles(layout, HUB, arm).slice(-1)[0];
      const lb = box(last);
      const zb = { l: zone.x - zone.width / 2, r: zone.x + zone.width / 2, t: zone.y - zone.height / 2, b: zone.y + zone.height / 2 };
      const dx = Math.max(0, zb.l - lb.r, lb.l - zb.r);
      const dy = Math.max(0, zb.t - lb.b, lb.t - zb.b);
      expect(Math.hypot(dx, dy), `${position} zone gap`).toBeLessThan(0.3);
      for (const t of layout.tiles) {
        const b = box(t);
        const overlap = zb.l < b.r - 1e-6 && zb.r > b.l + 1e-6 && zb.t < b.b - 1e-6 && zb.b > b.t + 1e-6;
        expect(overlap, `${position} zone overlaps ${t.key}`).toBe(false);
      }
    }
  });
});

// ─── stability ───────────────────────────────────────────────

describe('routing stability', () => {
  it('appending a tile to an arm never moves the tiles already placed', () => {
    let fb = crossedSpinner();
    fb = extend(fb, armPosition(HUB, 0), armSteps(2));
    let previous = computeBoardLayout(fb.board, [], ext(8));
    for (const step of ['n', 'n', 'd', 'n', 'n', 'n', 'n'] as const) {
      fb = extend(fb, armPosition(HUB, 0), [step]);
      const next = computeBoardLayout(fb.board, [], ext(8));
      for (const t of previous.tiles) {
        const same = next.tiles.find((n) => n.key === t.key)!;
        expect(same, `${t.key} still present`).toBeDefined();
        expect([same.x, same.y, same.rotation]).toEqual([t.x, t.y, t.rotation]);
      }
      previous = next;
    }
  });

  it('adding tiles to the other arm or to the main line never flips a bend to the other side', () => {
    let fb = crossedSpinner();
    fb = extend(fb, armPosition(HUB, 0), armSteps(7));
    const initialDir = computeBoardLayout(fb.board, [], ext(8)).bends[0].dir;
    for (const position of ['right', 'left', 'right', 'left', 'right', armPosition(HUB, 1)] as PlacementPosition[]) {
      fb = extend(fb, position, ['n']);
      const bends = computeBoardLayout(fb.board, [], ext(8)).bends;
      expect(bends.find((b) => b.arm === 0)!.dir).toBe(initialDir);
    }
  });

  it('ignores container-height jitter inside one bucket and only re-routes across a bucket edge', () => {
    const base = 32 * 20; // 640, a bucket edge
    for (const jitter of [0, 1, 7, 15, HEIGHT_BUCKET_PX - 1]) {
      expect(resolveVerticalArmExtent(base + jitter)).toBe(resolveVerticalArmExtent(base));
    }
    expect(resolveVerticalArmExtent(base + HEIGHT_BUCKET_PX)).toBeGreaterThan(resolveVerticalArmExtent(base)!);
    expect(bucketContainerHeight(base + 5)).toBe(base);
  });

  it('does not route before the container is measured', () => {
    expect(resolveVerticalArmExtent(0)).toBeUndefined();
    expect(resolveVerticalArmExtent(Number.NaN)).toBeUndefined();
  });
});

// ─── the safe-bounds model ───────────────────────────────────

describe('safe-bounds model', () => {
  it('gives a taller container a longer straight run, never less than room for the first tiles', () => {
    const heights = [200, 400, 508, 640, 756, 900];
    const extents = heights.map((h) => resolveVerticalArmExtent(h)!);
    for (let i = 1; i < extents.length; i += 1) expect(extents[i]).toBeGreaterThanOrEqual(extents[i - 1]);
    expect(Math.min(...extents)).toBeGreaterThanOrEqual(3.5);
  });

  it('keeps short and medium chains straight on laptop-class and desktop containers', () => {
    // 3 tiles per arm: 1440x900 viewport (674px board container) and 1512x982 (756px).
    for (const containerHeight of [674, 756]) {
      const layout = computeBoardLayout(FIXTURES.mediumBoth(), [], ext(resolveVerticalArmExtent(containerHeight)!));
      expect(layout.bends, `${containerHeight}px`).toEqual([]);
    }
  });

  it('turns the long chain from the reported laptop screenshot well inside the container', () => {
    const limit = resolveVerticalArmExtent(756)!;
    const layout = computeBoardLayout(FIXTURES.longUpMax(), [], ext(limit));
    expect(layout.bends.length).toBe(1);
    // Straight reach stays within the limit plus the worst deferral (a double + the ordinary tile after it).
    const arm = armTiles(layout, HUB, 0);
    expect(straightReach(layout, 0, arm)).toBeLessThanOrEqual(limit + 3.35);
  });

  it('bounds every arm of every generated game by the limit plus the deferral allowance', () => {
    const limit = 8;
    let arms = 0;
    for (const board of gameBoards()) {
      const layout = computeBoardLayout(board, [], ext(limit));
      for (const hub of board.hubDoubles) {
        if ((hub.laneType ?? 'mainline') !== 'mainline' || typeof hub.hubId !== 'number') continue;
        for (const arm of [0, 1]) {
          if (!hub.branches[arm]) continue;
          const tiles = armTiles(layout, hub.hubId, arm);
          const hubTile = layout.tiles.find((t) => t.key.startsWith(`main-${hub.mainlineIndex ?? hub.tileIndex}-`))!;
          const straight = tiles.filter((t) => Math.abs(t.x - hubTile.x) < 1e-6);
          if (!straight.length) continue;
          const reach = Math.max(...straight.map((t) => Math.abs(t.y - hubTile.y) + (t.rotation === 0 ? 0.5 : 1)));
          // A resolver override (collision) may leave an arm straight; those boards are dense multi-hub ones.
          const bent = layout.bends.some((b) => b.hubId === hub.hubId && b.arm === arm);
          // Past the threshold only a double, or an ordinary tile that follows a double,
          // can stay straight, so each double on the axis defers the turn by at most one
          // double + one ordinary tile (3.3 units).
          const doubles = straight.filter((t) => isDoubleKey(t.key)).length;
          if (bent) expect(reach).toBeLessThanOrEqual(limit + 3.35 * Math.max(1, doubles));
          arms += 1;
        }
      }
    }
    expect(arms).toBeGreaterThan(50);
  });
});

// ─── no overlap introduced by routing ────────────────────────

describe('routing never introduces an overlap', () => {
  it('is overlap-free on every curated long-arm fixture at every limit', () => {
    for (const [name, make] of Object.entries(FIXTURES)) {
      const board = make();
      for (const limit of [3.5, 5, 8, 12]) {
        expect(overlapPairs(computeBoardLayout(board, [], ext(limit))), `${name} @ ${limit}`).toEqual([]);
      }
    }
  });

  it('introduces no overlap the straight layout lacked, on 300 seeded random legal boards', () => {
    let bent = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const board = randomBoard(seed);
      const base = new Set(overlapPairs(computeBoardLayout(board, [])));
      for (const options of [ext(3.5), ext(5), ext(8), { maxVerticalArmTiles: 2 }] as BoardLayoutOptions[]) {
        const layout = computeBoardLayout(board, [], options);
        if (layout.bends?.length) bent += 1;
        const fresh = overlapPairs(layout).filter((p) => !base.has(p));
        expect(fresh, `seed ${seed} ${JSON.stringify(options)}`).toEqual([]);
      }
    }
    expect(bent).toBeGreaterThan(300);
  });

  it('introduces no overlap on boards a generated game reaches', () => {
    for (const board of gameBoards()) {
      const base = new Set(overlapPairs(computeBoardLayout(board, [])));
      for (const limit of [3.5, 6, 9]) {
        const fresh = overlapPairs(computeBoardLayout(board, [], ext(limit))).filter((p) => !base.has(p));
        expect(fresh).toEqual([]);
      }
    }
  });
});

// ─── phone routing is untouched ──────────────────────────────

describe('phone (tile-count) routing', () => {
  it('still bends after two tiles and never uses the viewport extent', () => {
    const layout = computeBoardLayout(FIXTURES.longBoth(), [], { maxVerticalArmTiles: 2 });
    expect(layout.bends.map((b) => [b.arm, b.tileIndex])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(overlapPairs(layout)).toEqual([]);
  });
});

// ─── corpus ──────────────────────────────────────────────────

const POLICIES: Policy[] = ['random', 'scoreGreedy', 'doubles', 'branch'];

function* gameBoardsWithOracle(): Generator<{ board: BoardState; oracleSum: number }> {
  for (const variant of VARIANTS.slice(0, 2)) {
    for (const policy of POLICIES) {
      for (let g = 0; g < 3; g += 1) {
        const run = playGame(`board-routing-v1:${variant.name}:${policy}:${g}`, variant, policy, { keepStates: true });
        for (let i = 0; i < run.states.length; i += 1) {
          const board = run.states[i].board as unknown as BoardState | null;
          const oracleSum = run.openEndsSums[i];
          if (board && oracleSum !== null) yield { board, oracleSum };
        }
      }
    }
  }
}

function gameBoards(): BoardState[] {
  const boards: BoardState[] = [];
  for (const { board } of gameBoardsWithOracle()) if (board.hubDoubles.length > 0) boards.push(board);
  return boards;
}
