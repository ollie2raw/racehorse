// client/src/components/board/boardCameraFit.ts
//
// The live board camera's fit targets, as a pure function. Extracted verbatim from
// useBoardCamera.fitCameraToContainer so the same numbers can be exercised outside
// React (boardQualityMetrics.ts replays real games through them). Behaviour is
// unchanged: useBoardCamera calls this for the non-static path.

export interface BoardFitTargetsInput {
  containFullBoard: boolean;
  resolvedFitMode: 'default' | 'guided';
  /** Larger of the layout's width and height, in layout units. */
  layoutSpanUnits: number;
  boardTileCount: number;
}

export interface BoardFitTargets {
  /** Fraction of the container the board's longest side should fill. */
  targetFill: number;
  /** Upper bound on the fitted camera scale. */
  maxFitScale: number;
}

export function resolveBoardFitTargets({
  containFullBoard,
  resolvedFitMode,
  layoutSpanUnits,
  boardTileCount,
}: BoardFitTargetsInput): BoardFitTargets {
  const targetFill = containFullBoard
    ? 0.78
    : resolvedFitMode === 'guided'
      ? layoutSpanUnits <= 3
        ? 1.08
        : layoutSpanUnits <= 5
          ? 0.94
          : layoutSpanUnits <= 8
            ? 0.88
            : layoutSpanUnits >= 10
              ? 0.93
              : 0.9
      : layoutSpanUnits <= 3
        ? 0.52
        : layoutSpanUnits <= 5
          ? 0.65
          : layoutSpanUnits <= 8
            ? 0.82
            : layoutSpanUnits >= 10
              ? 0.92
              : 0.9;
  const maxFitScale = containFullBoard
    ? 1.8
    : resolvedFitMode === 'guided'
      ? boardTileCount <= 1
        ? 4.4
        : boardTileCount <= 4
          ? 3.2
          : boardTileCount <= 8
            ? 2.2
            : 1.6
      : boardTileCount <= 1
        ? 2.4
        : boardTileCount <= 4
          ? 2.1
          : boardTileCount <= 8
            ? 1.8
            : 1.65;
  return { targetFill, maxFitScale };
}
