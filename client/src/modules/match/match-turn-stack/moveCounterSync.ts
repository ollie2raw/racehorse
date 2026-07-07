import type { MoveEntry } from '../../../game/moveLogger.ts';

export function resolveNextMoveCounter(moveLog: readonly MoveEntry[]): number {
  const lastMoveNumber = moveLog.reduce(
    (max, entry) => Math.max(max, entry.moveNumber ?? 0),
    0,
  );
  return Math.max(1, lastMoveNumber + 1);
}