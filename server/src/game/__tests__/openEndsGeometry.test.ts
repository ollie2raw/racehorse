import { describe, it, expect } from 'vitest';
import { simulatePlacement } from '../scoring';
import {
  assertOpenEndsSumConsistent,
  auditOpenEndsBoard,
  computeOpenEndsSum,
  getScoringOpenEndPips,
  hydrateBoardForOpenEnds,
  reconcileBoardOpenEndsMetadata,
} from '../openEndsGeometry';
import type { BoardState } from '../types';
import { isDouble } from '../types';

function t(a: number, b: number) {
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

function expectOpenCount(board: BoardState, expected: number) {
  expect(computeOpenEndsSum(board)).toBe(expected);
  expect(getScoringOpenEndPips(board).reduce((s, p) => s + p, 0)).toBe(expected);
  assertOpenEndsSumConsistent(board, 'test');
}

function buildCaseB(): BoardState {
  let board = simulatePlacement(null, t(1, 1), 'left');
  board = simulatePlacement(board, t(1, 3), 'right');
  board = simulatePlacement(board, t(4, 1), 'left');
  board = simulatePlacement(board, t(3, 3), 'right');
  return board;
}

function withPhantomEmptyBranches(board: BoardState): BoardState {
  return {
    ...board,
    hubDoubles: board.hubDoubles.map((hub) =>
      hub.isCrossed || hub.laneType === 'mainline'
        ? {
            ...hub,
            branches: [
              { tiles: [], openEnd: hub.hubValue, openEndIsDouble: false },
              { tiles: [], openEnd: hub.hubValue, openEndIsDouble: false },
            ],
          }
        : hub,
    ),
  };
}

function buildScreenshotLayout(): BoardState {
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

describe('openEndsGeometry — Racehorse open count rules', () => {
  it('Case A: [1|1][1|3] → 5 (uncrossed double-1 + open 3)', () => {
    let board = simulatePlacement(null, t(1, 1), 'left');
    board = simulatePlacement(board, t(1, 3), 'right');
    expectOpenCount(board, 5);
  });

  it('Case B: [4|1][1|1][1|3][3|3] crossed double-1, empty branches → 10', () => {
    const board = buildCaseB();
    expectOpenCount(board, 10);
  });

  it('Case C: Case B + branch [1|5] on arm 0 → 15', () => {
    let board = buildCaseB();
    board = simulatePlacement(board, t(1, 5), 'branch-0-0');
    expectOpenCount(board, 15);
  });

  it('Case D: phantom empty branch objects must not inflate count (still 10)', () => {
    const board = buildCaseB();
    const inflated = withPhantomEmptyBranches(board);
    expect(auditOpenEndsBoard(inflated).some((i) => i.code === 'empty_branch_object')).toBe(true);
    expectOpenCount(inflated, 10);
    expectOpenCount(reconcileBoardOpenEndsMetadata(inflated), 10);
  });

  it('Case E: multiple crossed doubles with only empty branch slots → mainline ends only', () => {
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(3, 5), 'right');
    board = simulatePlacement(board, t(2, 3), 'left');
    board = simulatePlacement(board, t(5, 5), 'left');
    board = simulatePlacement(board, t(4, 5), 'left');
    const inflated = withPhantomEmptyBranches(board);
    expectOpenCount(inflated, 4 + 5);
  });

  it('Case F: mixed empty and populated branch arms count only populated tips', () => {
    let board = buildCaseB();
    board = simulatePlacement(board, t(1, 5), 'branch-0-0');
    const withEmptySibling: BoardState = {
      ...board,
      hubDoubles: board.hubDoubles.map((hub) =>
        hub.hubValue === 1 && hub.laneType !== 'branch'
          ? {
              ...hub,
              branches: [
                hub.branches[0],
                { tiles: [], openEnd: 1, openEndIsDouble: false },
              ],
            }
          : hub,
      ),
    };
    expectOpenCount(withEmptySibling, 15);
  });

  it('Case G: uncrossed double-3 on branch tip counts 6', () => {
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(3, 5), 'right');
    board = simulatePlacement(board, t(2, 3), 'left');
    board = simulatePlacement(board, t(3, 6), 'branch-0-0');
    board = simulatePlacement(board, t(6, 6), 'branch-0-0');
    expectOpenCount(board, 19);
    const last = board.hubDoubles[0].branches[0]!.tiles.at(-1)!.tile;
    expect(isDouble(last)).toBe(true);
  });

  it('Case H: crossed branch double-1 drops out, but the continued lane tip still counts', () => {
    let board = simulatePlacement(null, t(6, 6), 'left');
    board = simulatePlacement(board, t(5, 6), 'left');
    board = simulatePlacement(board, t(6, 3), 'right');
    board = simulatePlacement(board, t(6, 1), 'branch-0-0');
    board = simulatePlacement(board, t(1, 1), 'branch-0-0');
    board = simulatePlacement(board, t(1, 2), 'branch-0-0');

    const hubB = board.hubDoubles.find((h) => h.laneType === 'branch' && h.hubValue === 1);
    expect(hubB?.isCrossed).toBe(true);

    const metadataSum =
      (board.leftEndIsDouble ? board.leftEnd * 2 : board.leftEnd) +
      (board.rightEndIsDouble ? board.rightEnd * 2 : board.rightEnd) +
      board.hubDoubles.reduce((acc, hub) => {
        if (!hub.isCrossed) return acc;
        return (
          acc +
          hub.branches.reduce((armAcc, branch) => {
            if (!branch) return armAcc;
            return armAcc + (branch.openEndIsDouble ? branch.openEnd * 2 : branch.openEnd);
          }, 0)
        );
      }, 0);

    expect(metadataSum).toBe(computeOpenEndsSum(board));
    expectOpenCount(board, 10);
  });

  it('screenshot layout: open [2|2], open [3|3], single 6, single 3 totals 19', () => {
    const board = buildScreenshotLayout();
    const sum = computeOpenEndsSum(board);
    const pips = getScoringOpenEndPips(board);
    if (sum !== 19) {
      console.log('sum', sum, 'pips', pips, 'hubs', board.hubDoubles);
    }
    expectOpenCount(board, 19);
  });

  it('screenshot layout after [2|2] is crossed drops [2|2] and uses the new tip only', () => {
    let board = buildScreenshotLayout();
    board = simulatePlacement(board, t(1, 2), 'branch-0-0');
    expectOpenCount(board, 16);
  });

  it('screenshot layout after [3|3] is crossed drops [3|3] and uses the new tip only', () => {
    let board = buildScreenshotLayout();
    board = simulatePlacement(board, t(1, 3), 'branch-0-1');
    expectOpenCount(board, 14);
  });

  it('display invariant: canonical sum equals pip breakdown', () => {
    const board = buildCaseB();
    const sum = computeOpenEndsSum(board);
    const pipSum = getScoringOpenEndPips(board).reduce((a, b) => a + b, 0);
    expect(sum).toBe(pipSum);
    expect(sum).toBe(10);
  });
});

describe('hydration and snapshot compatibility', () => {
  function staleCaseBSerialized(): BoardState {
    const board = buildCaseB();
    return {
      ...board,
      leftEnd: 99,
      rightEnd: 88,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: board.hubDoubles.map((hub) =>
        hub.hubValue === 1
          ? {
              ...hub,
              isCrossed: false,
              branches: [
                { tiles: [], openEnd: 1, openEndIsDouble: false },
                { tiles: [], openEnd: 1, openEndIsDouble: false },
              ],
            }
          : { ...hub, isCrossed: false },
      ),
    };
  }

  /** Mirrors client projectRenderableBoard branch coercion + hydrate. */
  function projectRenderableBoardLike(raw: BoardState): BoardState {
    const hubDoubles = raw.hubDoubles.map((hub) => {
      const hubValue = hub.hubValue;
      const branchesRaw = hub.branches;
      const branches: BoardState['hubDoubles'][number]['branches'] = [0, 1].map((armIdx) => {
        const branch = branchesRaw[armIdx];
        if (!branch || branch.tiles.length === 0) return null;
        return branch;
      });
      return { ...hub, branches };
    });
    return hydrateBoardForOpenEnds({
      ...raw,
      hubDoubles,
    });
  }

  it('hydrates old serialized boards with empty branch objects and stale metadata', () => {
    const stale = staleCaseBSerialized();
    expect(auditOpenEndsBoard(stale).length).toBeGreaterThan(0);

    const hydrated = hydrateBoardForOpenEnds(stale);
    expectOpenCount(hydrated, 10);
    expect(auditOpenEndsBoard(hydrated).length).toBe(0);
  });

  it('multiplayer-style projection yields geometry-correct open count', () => {
    const projected = projectRenderableBoardLike(staleCaseBSerialized());
    expectOpenCount(projected, 10);
    expect(projected.hubDoubles[0]?.isCrossed).toBe(true);
    expect(projected.hubDoubles[0]?.branches[0]).toBeNull();
  });
});
