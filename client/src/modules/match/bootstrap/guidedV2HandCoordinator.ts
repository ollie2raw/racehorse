import {
  type BotMatchState,
} from '../runtime/botEngine.ts';
import { initGuidedV2Playback, type LessonV2 } from '../../../learn/lessonV2.ts';

export type GuidedV2HandAdvancePlan = {
  nextState: BotMatchState;
  firstEventIndex: number;
};

/** Resolve the next hand for guided V2 playback from the frozen lesson snapshot. */
export function planGuidedV2HandAdvance(
  frozenV2Lesson: LessonV2,
  currentHandNumber: number,
): GuidedV2HandAdvancePlan | null {
  const nextHandNumber = currentHandNumber + 1;
  const playback = initGuidedV2Playback(frozenV2Lesson, nextHandNumber);
  if (!playback.state) return null;
  return {
    nextState: {
      ...playback.state,
      opponentPassedOnEnds: [],
      opponentDrawCount: 0,
      opponentKnownMissing: [],
    },
    firstEventIndex: playback.firstEventIndex,
  };
}