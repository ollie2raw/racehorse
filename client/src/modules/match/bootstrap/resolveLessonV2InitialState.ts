import {
  createFixedBotMatch,
  type BotMatchState,
} from '../runtime/botEngine.ts';
import { generateAuthoringHandDeal } from '../../../learn/guidedAuthoring.ts';
import type { ResolveInitialBotMatchStateInput } from './resolveInitialBotMatchState.ts';

type LessonV2Module = typeof import('../../../learn/lessonV2.ts');

export function resolveLessonV2InitialState(
  input: ResolveInitialBotMatchStateInput,
  lessonV2: LessonV2Module,
): BotMatchState {
  const {
    winningScore,
    dealSize,
    isAuthoringV2Mode,
    isGuidedV2Mode,
  } = input;

  if (isAuthoringV2Mode) {
    const saved = lessonV2.loadV2AuthoringSession();
    if (saved?.matchSnapshot) {
      try {
        return JSON.parse(saved.matchSnapshot) as BotMatchState;
      } catch {
        // fall through
      }
    }
    return createFixedBotMatch(generateAuthoringHandDeal(0), 60, 7);
  }

  if (isGuidedV2Mode) {
    const v2Lesson = lessonV2.loadGuidedV2PlaybackLesson();
    if (lessonV2.canStartGuidedV2Lesson(v2Lesson) && v2Lesson) {
      const playback = lessonV2.initGuidedV2Playback(v2Lesson, 1);
      if (playback.state) {
        return playback.state;
      }
      const handStartOnly = lessonV2.restoreGuidedV2HandStart(v2Lesson, 1);
      if (handStartOnly.state) {
        return handStartOnly.state;
      }
      if (import.meta.env.DEV) {
        console.warn(
          '[guided-v2-init] playback restore failed; using empty fixed deal',
          lessonV2.validateGuidedV2LessonPlayback(v2Lesson),
        );
      }
    }
    return createFixedBotMatch(
      { player_tiles: [], fritz_tiles: [], boneyard: [], locked: [] },
      winningScore,
      dealSize,
    );
  }

  throw new Error('[resolveLessonV2InitialState] called without V2 mode flags');
}