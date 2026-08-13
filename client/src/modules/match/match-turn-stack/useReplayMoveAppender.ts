import { useCallback } from 'react';
import type { MoveEntry } from '../../../game/moveLogger.ts';
import type { BotMatchState } from '../runtime/botEngine.ts';
import type { ReplayRecorder } from '../../replay/index.ts';
import { isDuplicateDailyFritzActionEvidence } from '../../../dailyFritz/dailyFritzMoveEvidence.ts';

export function useReplayMoveAppender(
  matchRef: React.MutableRefObject<BotMatchState>,
  replayRecorder: ReplayRecorder,
  moveCounterRef: React.MutableRefObject<number>,
  isDailyFritzMode = false,
): (
  entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>,
  handNumber?: number,
) => boolean {
  return useCallback((entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>, handNumber?: number) => {
    const targetHandNumber = handNumber ?? matchRef.current.handNumber;
    if (
      isDailyFritzMode
      && isDuplicateDailyFritzActionEvidence(replayRecorder.getMoveLog(), entry, targetHandNumber)
    ) {
      return false;
    }
    replayRecorder.recordMove(entry, targetHandNumber);
    moveCounterRef.current = replayRecorder.getNextMoveNumber();
    return true;
  }, [isDailyFritzMode, matchRef, replayRecorder, moveCounterRef]);
}
