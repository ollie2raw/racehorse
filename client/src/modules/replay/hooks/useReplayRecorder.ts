import { useRef, useSyncExternalStore } from 'react';
import type { MoveEntry } from '../../../game/moveLogger.ts';
import { ReplayRecorder } from '../ReplayRecorder.ts';

export function useReplayRecorder(initialLog: MoveEntry[]): {
  recorder: ReplayRecorder;
  moveLog: readonly MoveEntry[];
} {
  const recorderRef = useRef<ReplayRecorder | null>(null);
  if (recorderRef.current === null) {
    recorderRef.current = new ReplayRecorder(initialLog);
  }
  const recorder = recorderRef.current;
  const moveLog = useSyncExternalStore(
    recorder.subscribe.bind(recorder),
    recorder.getMoveLog.bind(recorder),
    recorder.getMoveLog.bind(recorder),
  );
  return { recorder, moveLog };
}