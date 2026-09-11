// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BoardState, PlacedTile, Move } from '../../types';
import { useBoardRenderLayout, type UseBoardRenderLayoutParams } from './useBoardRenderLayout';

function placed(low: number, high: number, orientation = 'horizontal-normal'): PlacedTile {
  return { tile: { low, high }, orientation: orientation as PlacedTile['orientation'] };
}

function emptyBoard(): BoardState {
  return { mainLine: [], leftEnd: null, rightEnd: null, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] } as unknown as BoardState;
}

function oneTileBoard(): BoardState {
  return {
    mainLine: [placed(3, 4)],
    leftEnd: 3,
    rightEnd: 4,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
    hubDoubles: [],
  };
}

function baseParams(overrides: Partial<UseBoardRenderLayoutParams> = {}): UseBoardRenderLayoutParams {
  return {
    board: emptyBoard(),
    legalMoves: [],
    selectedTile: null,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    showOpenEndGlow: false,
    staticView: false,
    profileDailyFritz: false,
    cameraScale: 1,
    ...overrides,
  };
}

describe('useBoardRenderLayout', () => {
  it('treats an empty mainLine as a resetting board with a default left camera-fit target', () => {
    const { result } = renderHook(() => useBoardRenderLayout(baseParams()));
    expect(result.current.boardTileCount).toBe(0);
    expect(result.current.isResettingBoard).toBe(true);
    expect(result.current.cameraFitPositions).toEqual(['left']);
    expect(result.current.layout.tiles).toHaveLength(0);
  });

  it('counts main-line + branch tiles once a board is placed', () => {
    const { result } = renderHook(() => useBoardRenderLayout(baseParams({ board: oneTileBoard() })));
    expect(result.current.boardTileCount).toBe(1);
    expect(result.current.isResettingBoard).toBe(false);
    expect(result.current.layout.tiles).toHaveLength(1);
  });

  it('derives validPositions from legalMoves that match the selected tile', () => {
    const board = oneTileBoard();
    const legalMoves: Move[] = [
      { type: 'play', tile: { low: 4, high: 5 }, position: 'right' },
      { type: 'play', tile: { low: 9, high: 9 }, position: 'left' }, // different tile — filtered out
      { type: 'pass' },
    ];
    const { result } = renderHook(() =>
      useBoardRenderLayout(baseParams({ board, legalMoves, selectedTile: { low: 4, high: 5 } })),
    );
    expect(result.current.validPositions).toEqual(['right']);
    // A tile is selected → cameraFitPositions follows the board's open ends
    // (left/right), not just the tile's own legal placements.
    expect(result.current.cameraFitPositions).toEqual(['left', 'right']);
  });

  it('computes placementZones from validPositions independent of the camera-fit layout', () => {
    const board = oneTileBoard();
    const legalMoves: Move[] = [{ type: 'play', tile: { low: 4, high: 5 }, position: 'right' }];
    const { result } = renderHook(() =>
      useBoardRenderLayout(baseParams({ board, legalMoves, selectedTile: { low: 4, high: 5 } })),
    );
    expect(result.current.placementZones.length).toBeGreaterThan(0);
    expect(result.current.placementZones.some((z) => z.position === 'right')).toBe(true);
  });

  it('only computes a glowLayout when showOpenEndGlow is set', () => {
    const board = oneTileBoard();
    const off = renderHook(() => useBoardRenderLayout(baseParams({ board, showOpenEndGlow: false })));
    expect(off.result.current.glowLayout).toBeNull();

    const on = renderHook(() => useBoardRenderLayout(baseParams({ board, showOpenEndGlow: true })));
    expect(on.result.current.glowLayout).not.toBeNull();
    expect(on.result.current.glowLayout!.tiles.length).toBe(on.result.current.layout.tiles.length);
  });

  it('keys resetSignature on handNumber/gameOver/isResettingBoard, not on unrelated prop changes', () => {
    const { result, rerender } = renderHook(
      (props: UseBoardRenderLayoutParams) => useBoardRenderLayout(props),
      { initialProps: baseParams({ board: oneTileBoard(), handNumber: 3 }) },
    );
    const first = result.current.resetSignature;

    // Unrelated change (selectedTile) — signature stays put.
    rerender(baseParams({ board: oneTileBoard(), handNumber: 3, selectedTile: { low: 1, high: 2 } }));
    expect(result.current.resetSignature).toBe(first);

    // handNumber change — signature changes.
    rerender(baseParams({ board: oneTileBoard(), handNumber: 4 }));
    expect(result.current.resetSignature).not.toBe(first);
  });
});
