import {
  computeOpenEndsSum,
  explainOpenEndsSum,
  getScoringOpenEndPips,
} from './openEndsGeometry.ts';
import { simulatePlacement } from '../bot/botEngine.ts';
import type { PlacementPosition, Tile } from '../types.ts';

function t(a: number, b: number): Tile {
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[openEndsGeometry.behaviorTests] ${msg}`);
}

function expectEqual(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`[openEndsGeometry.behaviorTests] ${msg}: expected ${e}, got ${a}`);
  }
}

function buildScreenshotLayout() {
  let board = simulatePlacement(null, t(0, 0), 'left');
  board = simulatePlacement(board, t(6, 0), 'left');
  board = simulatePlacement(board, t(0, 3), 'right');
  board = simulatePlacement(board, t(5, 5), 'branch-0-0');
  board = simulatePlacement(board, t(2, 5), 'branch-0-0');
  board = simulatePlacement(board, t(2, 2), 'branch-0-0');
  board = simulatePlacement(board, t(4, 4), 'branch-0-1');
  board = simulatePlacement(board, t(4, 5), 'branch-0-1');
  board = simulatePlacement(board, t(3, 5), 'branch-0-1');
  board = simulatePlacement(board, t(3, 3), 'branch-0-1');
  return board;
}

function findOpenDoublePosition(tile: string): PlacementPosition {
  const contributions = explainOpenEndsSum(buildScreenshotLayout());
  const hit = contributions.find((entry) => entry.source === 'open-double' && entry.tile === tile);
  if (!hit) throw new Error(`Missing contribution for ${tile}`);
  return hit.position;
}

function run(): void {
  {
    const board = buildScreenshotLayout();
    expectEqual(computeOpenEndsSum(board), 19, 'screenshot layout total');
    expectEqual(
      getScoringOpenEndPips(board).reduce((sum, pip) => sum + pip, 0),
      19,
      'screenshot layout pip breakdown total',
    );

    const contributions = explainOpenEndsSum(board).map((entry) => ({
      source: entry.source,
      tile: entry.tile,
      pip: entry.pip,
      value: entry.value,
    }));
    expectEqual(contributions, [
      { source: 'mainline-left', tile: undefined, pip: 6, value: 6 },
      { source: 'mainline-right', tile: undefined, pip: 3, value: 3 },
      { source: 'open-double', tile: '[2|2]', pip: 2, value: 4 },
      { source: 'open-double', tile: '[3|3]', pip: 3, value: 6 },
    ], 'screenshot layout contribution breakdown');
  }

  {
    let board = buildScreenshotLayout();
    board = simulatePlacement(board, t(1, 2), findOpenDoublePosition('[2|2]'));
    const contributions = explainOpenEndsSum(board);
    assert(!contributions.some((entry) => entry.tile === '[2|2]'), '[2|2] should drop out once crossed');
    expectEqual(computeOpenEndsSum(board), 16, '[2|2] crossed layout total');
  }

  {
    let board = buildScreenshotLayout();
    board = simulatePlacement(board, t(1, 3), findOpenDoublePosition('[3|3]'));
    const contributions = explainOpenEndsSum(board);
    assert(!contributions.some((entry) => entry.tile === '[3|3]'), '[3|3] should drop out once crossed');
    expectEqual(computeOpenEndsSum(board), 14, '[3|3] crossed layout total');
  }

  {
    let board = simulatePlacement(null, t(1, 1), 'left');
    board = simulatePlacement(board, t(1, 3), 'right');
    board = simulatePlacement(board, t(4, 1), 'left');
    board = simulatePlacement(board, t(3, 3), 'right');
    expectEqual(computeOpenEndsSum(board), 10, 'crossed double with empty branches counts only mainline ends');
  }

  {
    let board = simulatePlacement(null, t(1, 1), 'left');
    board = simulatePlacement(board, t(1, 3), 'right');
    board = simulatePlacement(board, t(4, 1), 'left');
    board = simulatePlacement(board, t(3, 3), 'right');
    board = simulatePlacement(board, t(1, 5), 'branch-0-0');
    expectEqual(computeOpenEndsSum(board), 15, 'populated branch tip contributes after crossed double opens branches');
  }

  {
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(3, 5), 'right');
    board = simulatePlacement(board, t(2, 3), 'left');
    board = simulatePlacement(board, t(3, 6), 'branch-0-0');
    board = simulatePlacement(board, t(6, 6), 'branch-0-0');
    const contributions = explainOpenEndsSum(board);
    assert(
      contributions.some((entry) => entry.source === 'open-double' && entry.tile === '[6|6]' && entry.value === 12),
      'partially crossed double tip should contribute full tile value',
    );
    expectEqual(computeOpenEndsSum(board), 19, 'partially crossed double tip total');
  }

  console.log('openEndsGeometry.behaviorTests.ts: all passed');
}

run();
