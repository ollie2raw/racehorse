import { useCallback } from 'react';
import type { MoveEntry } from '../../../game/moveLogger.ts';
import type { BotMatchState } from '../runtime/botEngine.ts';
import type { ReplayRecorder } from '../../replay/index.ts';

export function useReplayMoveAppender(
  matchRef: React.MutableRefObject<BotMatchState>,
  replayRecorder: ReplayRecorder,
  moveCounterRef: React.MutableRefObject<number>,
): (
  entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>,
  handNumber?: number,
) => void {
  return useCallback((entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>, handNumber?: number) => {
    replayRecorder.recordMove(entry, handNumber ?? matchRef.current.handNumber);
    moveCounterRef.current = replayRecorder.getNextMoveNumber();
  }, [matchRef, replayRecorder, moveCounterRef]);
}
