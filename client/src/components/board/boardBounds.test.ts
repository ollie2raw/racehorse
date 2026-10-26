import { describe, expect, it } from 'vitest';
import type { BoardState } from '../../types.ts';
import { playGame, VARIANTS, type Policy } from '../../../../packages/game-core/src/__tests__/support/engineHarness';
import { allOpenEndPositions, envelopeOf } from './boardBounds.ts';
import { computeBoardLayout } from './boardLayout.ts';
import { clearScaleForReserved } from './boardCameraReserve.ts';
import { FIXTURES } from './boardRoutingFixtures.ts';
import { countBoardTiles } from './boardQualityMetrics.ts';

const PHONE = { maxVerticalArmTiles: 1, exactBoundsMarginUnits: 0.4 } as const;

describe('exact layout bounds', () => {
  it('are tighter than the flat 2.5-unit pad on a long board', () => {
    const flat = computeBoardLayout(FIXTURES.longBoth(), [], { maxVerticalArmTiles: 1 });
    const exact = computeBoardLayout(FIXTURES.longBoth(), [], PHONE);
    expect(exact.maxY - exact.minY).toBeLessThan(flat.maxY - flat.minY);
  });

  it('do not change when the player selects a tile (valid positions differ)', () => {
    const board = FIXTURES.longBoth();
    const none = computeBoardLayout(board, [], PHONE);
    const some = computeBoardLayout(board, allOpenEndPositions(board), PHONE);
    const one = computeBoardLayout(board, ['left'], { ...PHONE, pendingTileIsDouble: true });
    for (const l of [some, one]) {
      expect([l.minX, l.maxX, l.minY, l.maxY]).toEqual([none.minX, none.maxX, none.minY, none.maxY]);
    }
  });

  it('keep the tiles, zones and bends identical to the flat-padded layout', () => {
    const board = FIXTURES.longBoth();
    const flat = computeBoardLayout(board, ['left'], { maxVerticalArmTiles: 1 });
    const exact = computeBoardLayout(board, ['left'], PHONE);
    expect(exact.tiles).toEqual(flat.tiles);
    expect(exact.zones).toEqual(flat.zones);
    expect(exact.bends).toEqual(flat.bends);
  });

  it('envelopeOf spans tiles and zones plus the margin', () => {
    const e = envelopeOf(
      [
        {
          tiles: [{ tile: { low: 1, high: 2 }, x: 0, y: 0, rotation: 0, flipped: false, key: 'a' }],
          zones: [{ position: 'left', x: -5, y: 0, width: 2, height: 1, dirX: -1, dirY: 0, lane: 'horizontal', key: 'z' }],
        },
      ],
      0.5,
    );
    expect(e).toEqual({ minX: -6.5, maxX: 1.5, minY: -1, maxY: 1 });
  });
});

// ─── corpus invariant: no drop zone is ever clipped by the bounds ─────────

const POLICIES: Policy[] = ['random', 'scoreGreedy', 'doubles', 'branch'];

function* boards(): Generator<BoardState> {
  for (const policy of POLICIES) {
    for (let g = 0; g < 3; g += 1) {
      const run = playGame(`board-bounds-v1:${policy}:${g}`, VARIANTS[0], policy, { keepStates: true });
      for (const state of run.states) {
        const board = state.board as unknown as BoardState | null;
        if (board && countBoardTiles(board) > 0) yield board;
      }
    }
  }
}

describe('exact bounds on real games', () => {
  it('contain every tile and every possible drop-zone footprint, whatever is selected', () => {
    let checked = 0;
    for (const board of boards()) {
      const everyZone = allOpenEndPositions(board);
      const reference = computeBoardLayout(board, [], PHONE);
      for (const pendingTileIsDouble of [false, true]) {
        const layout = computeBoardLayout(board, everyZone, { ...PHONE, pendingTileIsDouble });
        // Selection never moves the bounds.
        expect([layout.minX, layout.maxX, layout.minY, layout.maxY]).toEqual([reference.minX, reference.maxX, reference.minY, reference.maxY]);
        for (const z of layout.zones) {
          expect(z.x - z.width / 2, `zone ${z.key} left`).toBeGreaterThanOrEqual(layout.minX - 1e-9);
          expect(z.x + z.width / 2, `zone ${z.key} right`).toBeLessThanOrEqual(layout.maxX + 1e-9);
          expect(z.y - z.height / 2, `zone ${z.key} top`).toBeGreaterThanOrEqual(layout.minY - 1e-9);
          expect(z.y + z.height / 2, `zone ${z.key} bottom`).toBeLessThanOrEqual(layout.maxY + 1e-9);
        }
        for (const t of layout.tiles) {
          const halfW = t.rotation === 0 ? 1 : 0.5;
          const halfH = t.rotation === 0 ? 0.5 : 1;
          expect(t.x - halfW).toBeGreaterThanOrEqual(layout.minX - 1e-9);
          expect(t.x + halfW).toBeLessThanOrEqual(layout.maxX + 1e-9);
          expect(t.y - halfH).toBeGreaterThanOrEqual(layout.minY - 1e-9);
          expect(t.y + halfH).toBeLessThanOrEqual(layout.maxY + 1e-9);
        }
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('clearScaleForReserved', () => {
  const layout = {
    tiles: [
      { tile: { low: 1, high: 2 }, x: -4, y: 0, rotation: 0, flipped: false, key: 'l' },
      { tile: { low: 2, high: 3 }, x: 4, y: 0, rotation: 0, flipped: false, key: 'r' },
    ],
    minX: -6,
    maxX: 6,
    minY: -1.5,
    maxY: 1.5,
  };
  const base = {
    layout,
    unitPx: 84,
    containerWidth: 800,
    containerHeight: 200,
    cameraX: 0,
    cameraY: 0,
    fitScale: 0.5,
    minScale: 0.1,
  };

  it('returns the fit scale when nothing is reserved or nothing touches', () => {
    expect(clearScaleForReserved({ ...base, reserved: [] })).toBe(0.5);
    expect(clearScaleForReserved({ ...base, reserved: [{ left: 0, top: 0, right: 40, bottom: 20 }] })).toBe(0.5);
  });

  it('shrinks until the right tile clears an overlay on the right', () => {
    // Right tile centre at 400 + 4*84*s, half width 84*s: at s=0.5 spans 568..652 px.
    const reserved = [{ left: 600, top: 0, right: 800, bottom: 200 }];
    const s = clearScaleForReserved({ ...base, reserved });
    expect(s).toBeLessThan(0.5);
    expect(s).toBeGreaterThanOrEqual(0.1);
    const rightEdge = 400 + 4 * 84 * s + 84 * s + 4; // + clearance
    expect(rightEdge).toBeLessThanOrEqual(600 + 0.5);
  });

  it('never goes below the camera floor even if an overlay cannot be cleared', () => {
    const reserved = [{ left: 0, top: 0, right: 800, bottom: 200 }];
    expect(clearScaleForReserved({ ...base, reserved })).toBe(0.1);
  });
});
