// client/src/components/board/useBoardRenderLayout.ts
//
// Extracted verbatim from Board.tsx (D2 Tier-1, step 1 — see
// docs/scoping/D2-board-tsx-decomposition-scoping.md). Pure derivation: given
// the board + selection props, computes the positioned-tile layout, the
// placement-zone hit targets, and the open-end glow layout that the render
// and the camera-fit effects (useBoardCamera, still in Board.tsx) both read.
// No refs, no DOM, no state — every value here is a useMemo over its inputs.
import { useCallback, useEffect, useMemo } from 'react';
import type { Tile, BoardState, PlacementPosition, Move } from '../../types';
import { tileEquals } from '../../game/tileUtils';
import {
  recordDailyFritzBoardMetric,
  recordDailyFritzLayoutDebug,
  traceCameraDebug,
  traceDailyFritzBoardEvent,
} from '../boardDiagnostics';
import { computeBoardLayout, type BoardLayout } from './boardLayout';

export interface UseBoardRenderLayoutParams {
  board: BoardState | null;
  legalMoves: Move[];
  selectedTile: Tile | null;
  handNumber: number;
  handOver: boolean;
  gameOver: boolean;
  showOpenEndGlow: boolean;
  staticView: boolean;
  profileDailyFritz: boolean;
  /** Read only for debug tracing (not a dependency) — matches the original's parity. */
  cameraScale: number;
}

export interface UseBoardRenderLayoutResult {
  boardTileCount: number;
  isResettingBoard: boolean;
  openEndPositions: PlacementPosition[];
  validPositions: PlacementPosition[];
  cameraFitPositions: PlacementPosition[];
  layout: BoardLayout;
  placementZones: BoardLayout['zones'];
  glowLayout: BoardLayout | null;
  resetSignature: string;
}

export function useBoardRenderLayout({
  board,
  legalMoves,
  selectedTile,
  handNumber,
  handOver,
  gameOver,
  showOpenEndGlow,
  staticView,
  profileDailyFritz,
  cameraScale,
}: UseBoardRenderLayoutParams): UseBoardRenderLayoutResult {
  const boardTileCount = board
    ? board.mainLine.length +
      board.hubDoubles.reduce(
        (sum, hub) =>
          sum +
          (hub.branches ?? []).reduce(
            (branchSum, branch) => branchSum + (branch?.tiles?.length ?? 0),
            0,
          ),
        0,
      )
    : 0;

  const isResettingBoard = !board || board.mainLine.length === 0;

  const openEndPositions = useMemo(() => {
    if (!board || isResettingBoard) return [] as PlacementPosition[];
    const positions: PlacementPosition[] = ['left', 'right'];
    for (const hub of board.hubDoubles ?? []) {
      if (typeof hub.hubId !== 'number' || !hub.isCrossed) continue;
      const hubId = hub.hubId;
      positions.push(`branch-${hubId}-0`, `branch-${hubId}-1`);
    }
    return positions;
  }, [board, isResettingBoard]);

  const validPositions = useMemo((): PlacementPosition[] => {
    if (!selectedTile) return [];
    return legalMoves
      .filter((m) => m.type === 'play' && m.tile && selectedTile && tileEquals(m.tile, selectedTile))
      .map((m) => m.position!)
      .filter(Boolean);
  }, [selectedTile, legalMoves]);

  const cameraFitPositions = useMemo(() => {
    if (staticView) return [] as PlacementPosition[];
    if (isResettingBoard) {
      return validPositions.length > 0 ? validPositions : (['left'] as PlacementPosition[]);
    }
    return selectedTile != null || showOpenEndGlow ? openEndPositions : [];
  }, [staticView, isResettingBoard, validPositions, openEndPositions, selectedTile, showOpenEndGlow]);

  const logLayoutDebug = useCallback(
    (validPositionsCount: number, selectedTileKey: string | null, layout: BoardLayout) => {
      if (typeof window === 'undefined') return;
      const timestamp =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? Number(performance.now().toFixed(2))
          : Date.now();
      recordDailyFritzLayoutDebug({
        tag: '[layout-debug]',
        timestamp,
        handNumber,
        handOver,
        gameOver,
        boardTileCount,
        openEndPositions,
        validPositionsCount,
        selectedTile: selectedTileKey,
        computedBounds: {
          minX: Number(layout.minX.toFixed(2)),
          maxX: Number(layout.maxX.toFixed(2)),
          minY: Number(layout.minY.toFixed(2)),
          maxY: Number(layout.maxY.toFixed(2)),
        },
        zoomScale: Number(cameraScale.toFixed(3)),
      });
    },
    [boardTileCount, cameraScale, gameOver, handNumber, handOver, openEndPositions],
  );

  // Keep the camera/layout stable when the player selects a tile.
  const layout = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- performance.now() timing probe inside the layout memo — instrumentation, not a value the memo returns
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    traceCameraDebug('[camera-debug] computeLayout input', {
      boardTileCount,
      openEndPositions: cameraFitPositions,
      validPositions,
      selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
    });
    const nextLayout = computeBoardLayout(isResettingBoard ? null : board, cameraFitPositions);
    traceCameraDebug('[camera-debug] computeLayout output', {
      minX: Number(nextLayout.minX.toFixed(2)),
      maxX: Number(nextLayout.maxX.toFixed(2)),
      minY: Number(nextLayout.minY.toFixed(2)),
      maxY: Number(nextLayout.maxY.toFixed(2)),
      scale: Number(cameraScale.toFixed(3)),
    });
    if (profileDailyFritz) {
      // eslint-disable-next-line react-hooks/purity -- performance.now() timing probe — instrumentation
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      recordDailyFritzBoardMetric('computeLayout', end - start);
      logLayoutDebug(validPositions.length, selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null, nextLayout);
    }
    return nextLayout;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the layout memo keys on the inputs that change its geometry; boardTileCount/cameraScale are derived from those and would only add churn
  }, [board, cameraFitPositions, profileDailyFritz, logLayoutDebug, selectedTile, validPositions, isResettingBoard]);

  const placementZones = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- performance.now() timing probe — instrumentation
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const zones = computeBoardLayout(isResettingBoard ? null : board, validPositions).zones;
    if (profileDailyFritz) {
      // eslint-disable-next-line react-hooks/purity -- performance.now() timing probe — instrumentation
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      recordDailyFritzBoardMetric('computeLayout', end - start);
      traceDailyFritzBoardEvent('[render] placementZones', {
        count: zones.length,
        selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
      });
    }
    return zones;
  }, [board, validPositions, profileDailyFritz, selectedTile, isResettingBoard]);

  useEffect(() => {
    if (!profileDailyFritz) return;
    traceDailyFritzBoardEvent('[render] Board props', {
      selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
      legalMovesCount: legalMoves.length,
    });
  }, [profileDailyFritz, selectedTile, legalMoves.length]);

  const glowLayout = useMemo(() => {
    if (!showOpenEndGlow) return null;
    return computeBoardLayout(isResettingBoard ? null : board, openEndPositions);
  }, [showOpenEndGlow, board, openEndPositions, isResettingBoard]);

  const resetSignature = useMemo(
    () => `${handNumber}:${gameOver}:${isResettingBoard}`,
    [gameOver, handNumber, isResettingBoard],
  );

  return {
    boardTileCount,
    isResettingBoard,
    openEndPositions,
    validPositions,
    cameraFitPositions,
    layout,
    placementZones,
    glowLayout,
    resetSignature,
  };
}
