import { useRef, useState } from 'react';
import {
  getLessonV2Module,
  isLessonV2Preloaded,
} from '../match/bootstrap/lessonV2LazyRegistry.ts';
import type { UseGuidedLessonBootResult } from './index.ts';

export type GuidedV2CoordinationState = {
  guidedV2EventIndex: number;
  setGuidedV2EventIndex: React.Dispatch<React.SetStateAction<number>>;
  isGuidedV2OffLine: boolean;
  setIsGuidedV2OffLine: React.Dispatch<React.SetStateAction<boolean>>;
  fritzV2LastAppliedIndexRef: React.MutableRefObject<number>;
};

export function useGuidedV2CoordinationState(
  guidedBoot: Pick<UseGuidedLessonBootResult, 'isGuidedV2Mode' | 'frozenV2Lesson'>,
): GuidedV2CoordinationState {
  const { isGuidedV2Mode, frozenV2Lesson } = guidedBoot;
  const [guidedV2EventIndex, setGuidedV2EventIndex] = useState(() => {
    if (!isGuidedV2Mode) return 0;
    if (!frozenV2Lesson) return 0;
    if (!isLessonV2Preloaded()) return 0;
    const lessonV2 = getLessonV2Module();
    if (!lessonV2.canStartGuidedV2Lesson(frozenV2Lesson)) return 0;
    return lessonV2.initGuidedV2Playback(frozenV2Lesson, 1).firstEventIndex;
  });
  const [isGuidedV2OffLine, setIsGuidedV2OffLine] = useState(false);
  const fritzV2LastAppliedIndexRef = useRef<number>(-1);

  return {
    guidedV2EventIndex,
    setGuidedV2EventIndex,
    isGuidedV2OffLine,
    setIsGuidedV2OffLine,
    fritzV2LastAppliedIndexRef,
  };
}
