import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { botMatchDebugLog } from '../match/runtime/botMatchDebug.ts';
import {
  loadAuthoringSession,
  loadFrozenLesson,
  loadOriginalGuidedTranscript,
  loadOriginalGuidedTranscriptDraft,
  type FrozenLesson,
  type GuidedTranscript,
} from '../../learn/guidedAuthoring.ts';
import type { LessonV2 } from '../../learn/lessonV2.ts';
import {
  getLessonV2Module,
  isLessonV2Preloaded,
} from '../match/bootstrap/lessonV2LazyRegistry.ts';

export type GuidedInitSource = 'full-matchStateJson' | 'reduced-snapshot' | 'seeded-deal' | 'random' | null;

export type UseGuidedLessonBootArgs = {
  mode: string;
  isGuidedModeProp: boolean;
  isAuthoringModeProp: boolean;
  isAuthoringV2ModeProp: boolean;
  isGuidedV2ModeProp: boolean;
};

export type UseGuidedLessonBootResult = {
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
  isLearnAcademyMode: boolean;
  frozenV2Lesson: LessonV2 | null;
  guidedV2BootError: string | null;
  guidedV2PlaybackReady: boolean;
  frozenLesson: FrozenLesson | null;
  guidedTranscript: GuidedTranscript | null;
  guidedInitSourceRef: MutableRefObject<GuidedInitSource>;
  isGuidedTranscriptMode: boolean;
  isGuidedFrozenLessonMode: boolean;
  lessonLayoutMode: boolean;
};

export function useGuidedLessonBoot({
  mode,
  isGuidedModeProp,
  isAuthoringModeProp,
  isAuthoringV2ModeProp,
  isGuidedV2ModeProp,
}: UseGuidedLessonBootArgs): UseGuidedLessonBootResult {
  const isGuidedMode = isGuidedModeProp && mode === 'bot';
  const isAuthoringMode = isAuthoringModeProp && mode === 'bot';
  const isAuthoringV2Mode = isAuthoringV2ModeProp && mode === 'bot';
  const isGuidedV2Mode = isGuidedV2ModeProp && mode === 'bot';
  const isLearnAcademyMode = isGuidedMode || isAuthoringMode || isAuthoringV2Mode || isGuidedV2Mode;
  const lessonV2Ready = !isGuidedV2Mode || isLessonV2Preloaded();

  const frozenV2Lesson = useMemo(() => {
    if (!isGuidedV2Mode || !lessonV2Ready) return null;
    return getLessonV2Module().loadGuidedV2PlaybackLesson();
  }, [isGuidedV2Mode, lessonV2Ready]);

  const guidedV2BootError = useMemo(() => {
    if (!isGuidedV2Mode || !lessonV2Ready) return null;
    const lessonV2 = getLessonV2Module();
    if (!lessonV2.canStartGuidedV2Lesson(frozenV2Lesson)) {
      return lessonV2.validateGuidedV2Lesson(frozenV2Lesson);
    }
    return null;
  }, [isGuidedV2Mode, lessonV2Ready, frozenV2Lesson]);

  const guidedV2PlaybackReady =
    isGuidedV2Mode && guidedV2BootError === null && frozenV2Lesson !== null;

  const [frozenLesson] = useState<FrozenLesson | null>(() => {
    if (!isGuidedMode) return null;
    const frozen = loadFrozenLesson();
    if (frozen) {
      botMatchDebugLog('[guided-debug] frozen step0 hand =', frozen.steps[0]?.playerHand ?? []);
      const firstReal = frozen.steps.find((s) => s.chosenMove !== null);
      if (firstReal?.matchStateJson) {
        try {
          const ms = JSON.parse(firstReal.matchStateJson) as BotMatchState;
          botMatchDebugLog(
            '[guided-debug] parsed matchStateJson hand =',
            ms.players.you.hand.map((t) => `${t.low}|${t.high}`),
          );
        } catch {
          console.warn('[guided-debug] matchStateJson present but failed to parse');
        }
      } else {
        console.warn(
          '[guided-debug] matchStateJson absent or null on firstRealStep',
          '— seeded PRNG fallback will run',
          'firstRealStep.stepIndex:', firstReal?.stepIndex,
        );
      }
      return frozen;
    }
    const authoring = loadAuthoringSession();
    if (authoring && authoring.steps.some((s) => s.chosenMove !== null)) {
      console.log('[guided-debug] frozen step0 hand = (authoring fallback)', authoring.steps[0]?.playerHand ?? []);
      return authoring;
    }
    return null;
  });

  const [guidedTranscript] = useState<GuidedTranscript | null>(() => {
    if (!isGuidedMode || isAuthoringMode || isGuidedV2Mode) return null;
    const published = loadOriginalGuidedTranscript();
    if (published) return published;
    const draft = loadOriginalGuidedTranscriptDraft();
    if (draft?.transcript) return draft.transcript;
    return null;
  });

  const guidedInitSourceRef = useRef<GuidedInitSource>(null);

  const isGuidedTranscriptMode =
    isGuidedMode && !isAuthoringMode && !isGuidedV2Mode && guidedTranscript !== null;
  const isGuidedFrozenLessonMode =
    isGuidedMode && !isAuthoringMode && !isGuidedV2Mode && frozenLesson !== null;
  const lessonLayoutMode =
    isGuidedTranscriptMode || isGuidedFrozenLessonMode || guidedV2PlaybackReady;

  return {
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    isLearnAcademyMode,
    frozenV2Lesson,
    guidedV2BootError,
    guidedV2PlaybackReady,
    frozenLesson,
    guidedTranscript,
    guidedInitSourceRef,
    isGuidedTranscriptMode,
    isGuidedFrozenLessonMode,
    lessonLayoutMode,
  };
}
