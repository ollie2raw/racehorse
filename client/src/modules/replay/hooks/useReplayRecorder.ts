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
    // eslint-disable-next-line react-hooks/refs -- lazy-initialized singleton read during render — the React useRef-docs idiom (if (!ref.current) ref.current = new X()); the rule does not model it
    recorder.subscribe.bind(recorder),
    // eslint-disable-next-line react-hooks/refs -- lazy-initialized singleton read during render — the React useRef-docs idiom (if (!ref.current) ref.current = new X()); the rule does not model it
    recorder.getMoveLog.bind(recorder),
    // eslint-disable-next-line react-hooks/refs -- lazy-initialized singleton read during render — the React useRef-docs idiom (if (!ref.current) ref.current = new X()); the rule does not model it
    recorder.getMoveLog.bind(recorder),
  );
  // eslint-disable-next-line react-hooks/refs -- lazy-initialized singleton read during render — the React useRef-docs idiom (if (!ref.current) ref.current = new X()); the rule does not model it
  return { recorder, moveLog };
}