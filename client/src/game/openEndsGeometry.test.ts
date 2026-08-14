// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  computeOpenEndsSum,
  explainOpenEndsSum,
  getScoringOpenEndPips,
  hydrateBoardForOpenEnds,
  auditOpenEndsBoard,
  endpointPipFromOrientation,
  branchTipPipFromGeometry,
  isMainlineHubCrossedGeometrically,
} from './openEndsGeometry';
import type { BoardState, PlacedTile, HubDouble } from '../types';

describe('openEndsGeometry', () => {
  const createBoard = (mainLine: PlacedTile[], hubDoubles: HubDouble[] = []): BoardState => ({
    mainLine,
    hubDoubles,
    leftEnd: -1,
    rightEnd: -1,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
  });

  it('1. returns 0 for an empty board', () => {
    const board = createBoard([]);
    expect(computeOpenEndsSum(board)).toBe(0);
  });

  it('2. returns sum of pips for a single-tile board', () => {
    const board = createBoard([{
      tile: { low: 3, high: 5 },
      orientation: 'horizontal-normal',
    }]);
    expect(computeOpenEndsSum(board)).toBe(8);
  });

  it('3. returns correct sum for a single double tile', () => {
    const board = createBoard([{
      tile: { low: 6, high: 6 },
      orientation: 'vertical-normal',
    }]);
    expect(computeOpenEndsSum(board)).toBe(12);
  });

  it('4. calculates ends correctly for normal 2-tile mainline', () => {
    // left: [4|5] (orient=flipped -> left end is 5)
    // right: [4|3] (orient=normal -> right end is 3)
    const board = createBoard([
      { tile: { low: 4, high: 5 }, orientation: 'horizontal-flipped' },
      { tile: { low: 4, high: 3 }, orientation: 'horizontal-normal' },
    ]);
    const ends = getScoringOpenEndPips(board);
    expect(ends).toEqual([5, 3]);
    expect(computeOpenEndsSum(board)).toBe(8);
  });

  it('5. doubles endpoint contribution if the mainline end tile is a double', () => {
    // left: [6|6] (double endpoint, left)
    // right: [6|2] (normal endpoint, right)
    const board = createBoard([
      { tile: { low: 6, high: 6 }, orientation: 'vertical-normal' },
      { tile: { low: 6, high: 2 }, orientation: 'horizontal-normal' },
    ]);
    const ends = getScoringOpenEndPips(board);
    expect(ends).toEqual([6, 6, 2]); // 6 is added twice since left is double
    expect(computeOpenEndsSum(board)).toBe(14);
  });

  it('6. endpointPipFromOrientation works for horizontal-normal left', () => {
    const placed = { tile: { low: 3, high: 5 }, orientation: 'horizontal-normal' as const };
    expect(endpointPipFromOrientation(placed, 'left')).toBe(3);
  });

  it('7. endpointPipFromOrientation works for horizontal-flipped left', () => {
    const placed = { tile: { low: 3, high: 5 }, orientation: 'horizontal-flipped' as const };
    expect(endpointPipFromOrientation(placed, 'left')).toBe(5);
  });

  it('8. endpointPipFromOrientation works for horizontal-normal right', () => {
    const placed = { tile: { low: 3, high: 5 }, orientation: 'horizontal-normal' as const };
    expect(endpointPipFromOrientation(placed, 'right')).toBe(5);
  });

  it('9. endpointPipFromOrientation works for horizontal-flipped right', () => {
    const placed = { tile: { low: 3, high: 5 }, orientation: 'horizontal-flipped' as const };
    expect(endpointPipFromOrientation(placed, 'right')).toBe(3);
  });

  it('10. endpointPipFromOrientation always returns high for double tiles', () => {
    const placed = { tile: { low: 4, high: 4 }, orientation: 'vertical-normal' as const };
    expect(endpointPipFromOrientation(placed, 'left')).toBe(4);
    expect(endpointPipFromOrientation(placed, 'right')).toBe(4);
  });

  it('11. branchTipPipFromGeometry returns hub value if branch has no tiles', () => {
    const branch = { branchIndex: 0, tiles: [] };
    expect(branchTipPipFromGeometry(5, branch as any)).toBe(5);
  });

  it('12. branchTipPipFromGeometry returns correct tip pip for a single-tile branch', () => {
    const branch = {
      branchIndex: 0,
      tiles: [{ tile: { low: 5, high: 2 }, orientation: 'vertical-normal' as const }],
    };
    expect(branchTipPipFromGeometry(5, branch as any)).toBe(2);
  });

  it('13. branchTipPipFromGeometry returns correct tip pip for multi-tile branch', () => {
    const branch = {
      branchIndex: 0,
      tiles: [
        { tile: { low: 5, high: 2 }, orientation: 'vertical-normal' as const },
        { tile: { low: 2, high: 6 }, orientation: 'vertical-normal' as const },
      ],
    };
    expect(branchTipPipFromGeometry(5, branch as any)).toBe(6);
  });

  it('14. isMainlineHubCrossedGeometrically returns true if double index is crossed', () => {
    const hub = {
      hubId: 0,
      laneType: 'mainline' as const,
      laneRef: 'mainline',
      tileIndex: 1,
      mainlineIndex: 1,
      hubValue: 6,
      isCrossed: false,
      leftSideFilled: false,
      rightSideFilled: false,
      branches: [],
    };
    expect(isMainlineHubCrossedGeometrically(hub, 3)).toBe(true);
    expect(isMainlineHubCrossedGeometrically(hub, 2)).toBe(false);
  });

  it('15. explainOpenEndsSum explains single-tile mainline correctly', () => {
    const board = createBoard([{ tile: { low: 3, high: 4 }, orientation: 'horizontal-normal' }]);
    const explanations = explainOpenEndsSum(board);
    expect(explanations.length).toBe(2);
    expect(explanations[0].pip).toBe(3);
    expect(explanations[1].pip).toBe(4);
  });

  it('16. explainOpenEndsSum explains multi-tile mainline with doubles correctly', () => {
    const board = createBoard([
      { tile: { low: 6, high: 6 }, orientation: 'vertical-normal' },
      { tile: { low: 6, high: 3 }, orientation: 'horizontal-normal' },
    ]);
    const explanations = explainOpenEndsSum(board);
    expect(explanations[0].source).toBe('open-double');
    expect(explanations[1].source).toBe('mainline-right');
  });

  it('17. auditOpenEndsBoard detects mainline end metadata mismatches', () => {
    const board = {
      leftEnd: 1, // should be 5
      rightEnd: 2, // should be 3
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: { low: 4, high: 5 }, orientation: 'horizontal-flipped' as const },
        { tile: { low: 4, high: 3 }, orientation: 'horizontal-normal' as const },
      ],
      hubDoubles: [],
    };
    const issues = auditOpenEndsBoard(board);
    expect(issues.some(i => i.code === 'mainline_end_metadata_mismatch')).toBe(true);
  });

  it('18. auditOpenEndsBoard reports no issues for a consistent board', () => {
    const board = {
      leftEnd: 5,
      rightEnd: 3,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: { low: 4, high: 5 }, orientation: 'horizontal-flipped' as const },
        { tile: { low: 4, high: 3 }, orientation: 'horizontal-normal' as const },
      ],
      hubDoubles: [],
    };
    const issues = auditOpenEndsBoard(board);
    expect(issues.length).toBe(0);
  });

  it('19. hydrateBoardForOpenEnds sets correct ends and double flags on a raw board', () => {
    const board = {
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: { low: 6, high: 6 }, orientation: 'vertical-normal' as const },
        { tile: { low: 6, high: 2 }, orientation: 'horizontal-normal' as const },
      ],
      hubDoubles: [],
    };
    const hydrated = hydrateBoardForOpenEnds(board);
    expect(hydrated.leftEnd).toBe(6);
    expect(hydrated.rightEnd).toBe(2);
    expect(hydrated.leftEndIsDouble).toBe(true);
    expect(hydrated.rightEndIsDouble).toBe(false);
  });

  it('20. computeOpenEndsSum calculates active branches of crossed hubs', () => {
    const board: any = {
      leftEnd: 1,
      rightEnd: 2,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: { low: 1, high: 5 }, orientation: 'horizontal-flipped' as const },
        { tile: { low: 5, high: 5 }, orientation: 'vertical-normal' as const },
        { tile: { low: 5, high: 2 }, orientation: 'horizontal-normal' as const },
      ],
      hubDoubles: [
        {
          hubId: 0,
          laneType: 'mainline' as const,
          laneRef: 'mainline',
          mainlineIndex: 1,
          tileIndex: 1,
          hubValue: 5,
          isCrossed: true,
          leftSideFilled: true,
          rightSideFilled: true,
          branches: [
            {
              branchIndex: 0,
              tiles: [{ tile: { low: 5, high: 3 }, orientation: 'vertical-normal' as const }],
              openEnd: 3,
              openEndIsDouble: false,
            },
            null, // empty branch
          ],
        },
      ],
    };
    // mainline ends: 5 (flipped [1|5]), 2. branch 0 end: 3. branch 1 end: none. Total = 5 + 2 + 3 = 10
    expect(computeOpenEndsSum(board as any)).toBe(10);
  });

  it('21. reconcileBoardOpenEndsMetadata correctly reconciles branch openEnd status', () => {
    const board: BoardState = {
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      mainLine: [
        { tile: { low: 1, high: 5 }, orientation: 'horizontal-flipped' as const },
        { tile: { low: 5, high: 5 }, orientation: 'vertical-normal' as const },
        { tile: { low: 5, high: 2 }, orientation: 'horizontal-normal' as const },
      ],
      hubDoubles: [
        {
          hubId: 0,
          laneType: 'mainline' as const,
          laneRef: 'mainline',
          mainlineIndex: 1,
          tileIndex: 1,
          hubValue: 5,
          isCrossed: false, // will be reconciled to true
          leftSideFilled: false,
          rightSideFilled: false,
          branches: [
            {
              branchIndex: 0,
              tiles: [{ tile: { low: 5, high: 4 }, orientation: 'vertical-normal' as const }],
            } as any,
            null,
          ],
        },
      ],
    };
    const reconciled = hydrateBoardForOpenEnds(board);
    expect(reconciled.leftEnd).toBe(5);
    expect(reconciled.rightEnd).toBe(2);
    expect(reconciled.hubDoubles[0].isCrossed).toBe(true);
    expect(reconciled.hubDoubles[0].branches[0]!.openEnd).toBe(4);
  });
});
