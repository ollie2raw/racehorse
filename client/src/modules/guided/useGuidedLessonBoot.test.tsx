// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGuidedLessonBoot, type UseGuidedLessonBootArgs } from './useGuidedLessonBoot';
import { makeFrozenLesson, makeAuthoredStep, makeGuidedTranscript, makeLessonV2 } from './guidedTestFixtures.ts';
import type {
  AuthoringSession,
  FrozenLesson,
  GuidedTranscript,
  GuidedTranscriptDraft,
} from '../../learn/guidedAuthoring.ts';

const { getLessonV2Module, isLessonV2Preloaded } = vi.hoisted(() => ({
  getLessonV2Module: vi.fn(),
  isLessonV2Preloaded: vi.fn(() => false),
}));

vi.mock('../match/bootstrap/lessonV2LazyRegistry.ts', () => ({
  getLessonV2Module,
  isLessonV2Preloaded,
}));

const {
  loadFrozenLesson,
  loadAuthoringSession,
  loadOriginalGuidedTranscript,
  loadOriginalGuidedTranscriptDraft,
} = vi.hoisted(() => ({
  loadFrozenLesson: vi.fn<() => FrozenLesson | null>(() => null),
  loadAuthoringSession: vi.fn<() => AuthoringSession | null>(() => null),
  loadOriginalGuidedTranscript: vi.fn<() => GuidedTranscript | null>(() => null),
  loadOriginalGuidedTranscriptDraft: vi.fn<() => GuidedTranscriptDraft | null>(() => null),
}));

vi.mock('../../learn/guidedAuthoring.ts', async (orig) => ({
  ...(await orig<typeof import('../../learn/guidedAuthoring.ts')>()),
  loadFrozenLesson,
  loadAuthoringSession,
  loadOriginalGuidedTranscript,
  loadOriginalGuidedTranscriptDraft,
}));

/** All boot flags off, `bot` mode. Override per case. */
function args(overrides: Partial<UseGuidedLessonBootArgs> = {}): UseGuidedLessonBootArgs {
  return {
    mode: 'bot',
    isGuidedModeProp: false,
    isAuthoringModeProp: false,
    isAuthoringV2ModeProp: false,
    isGuidedV2ModeProp: false,
    ...overrides,
  };
}

const boot = (a: Partial<UseGuidedLessonBootArgs> = {}) =>
  renderHook(() => useGuidedLessonBoot(args(a))).result.current;

describe('useGuidedLessonBoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isLessonV2Preloaded.mockReturnValue(false);
    loadFrozenLesson.mockReturnValue(null);
    loadAuthoringSession.mockReturnValue(null);
    loadOriginalGuidedTranscript.mockReturnValue(null);
    loadOriginalGuidedTranscriptDraft.mockReturnValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('does not synchronously touch lesson V2 registry before preload completes', () => {
    const r = boot({ isGuidedV2ModeProp: true });
    expect(getLessonV2Module).not.toHaveBeenCalled();
    expect(r.isGuidedV2Mode).toBe(true);
    expect(r.frozenV2Lesson).toBeNull();
    expect(r.guidedV2BootError).toBeNull();
    expect(r.guidedV2PlaybackReady).toBe(false);
  });

  describe('mode gate — every flag is `prop && mode === "bot"`', () => {
    it('a non-bot mode forces all four learn flags false even with every prop set', () => {
      const r = boot({
        mode: 'ghost',
        isGuidedModeProp: true,
        isAuthoringModeProp: true,
        isAuthoringV2ModeProp: true,
        isGuidedV2ModeProp: true,
      });
      expect(r.isGuidedMode).toBe(false);
      expect(r.isAuthoringMode).toBe(false);
      expect(r.isAuthoringV2Mode).toBe(false);
      expect(r.isGuidedV2Mode).toBe(false);
      expect(r.isLearnAcademyMode).toBe(false);
      expect(r.lessonLayoutMode).toBe(false);
      expect(loadFrozenLesson).not.toHaveBeenCalled();
    });

    it('bot mode passes each prop straight through', () => {
      expect(boot({ isGuidedModeProp: true }).isGuidedMode).toBe(true);
      expect(boot({ isAuthoringModeProp: true }).isAuthoringMode).toBe(true);
      expect(boot({ isAuthoringV2ModeProp: true }).isAuthoringV2Mode).toBe(true);
      expect(boot({ isGuidedV2ModeProp: true }).isGuidedV2Mode).toBe(true);
    });

    it('isLearnAcademyMode is the OR of the four', () => {
      expect(boot().isLearnAcademyMode).toBe(false);
      expect(boot({ isAuthoringV2ModeProp: true }).isLearnAcademyMode).toBe(true);
    });
  });

  describe('frozenLesson source', () => {
    it('uses loadFrozenLesson when it returns a lesson', () => {
      const frozen = makeFrozenLesson();
      loadFrozenLesson.mockReturnValue(frozen);
      const r = boot({ isGuidedModeProp: true });
      expect(r.frozenLesson).toBe(frozen);
      expect(loadAuthoringSession).not.toHaveBeenCalled();
      expect(r.isGuidedFrozenLessonMode).toBe(true);
      expect(r.lessonLayoutMode).toBe(true);
    });

    it('falls back to the authoring session when it has a step with a chosen move', () => {
      const authoring = makeFrozenLesson({
        steps: [makeAuthoredStep({ chosenMove: '0|0:left' })],
      }) as AuthoringSession;
      loadAuthoringSession.mockReturnValue(authoring);
      const r = boot({ isGuidedModeProp: true });
      expect(r.frozenLesson).toBe(authoring);
      expect(r.isGuidedFrozenLessonMode).toBe(true);
    });

    it('ignores an authoring session whose every step has a null chosen move', () => {
      loadAuthoringSession.mockReturnValue(
        makeFrozenLesson({ steps: [makeAuthoredStep({ chosenMove: null })] }) as AuthoringSession,
      );
      const r = boot({ isGuidedModeProp: true });
      expect(r.frozenLesson).toBeNull();
      expect(r.isGuidedFrozenLessonMode).toBe(false);
    });

    it('does not load a frozen lesson at all when not in guided mode', () => {
      loadFrozenLesson.mockReturnValue(makeFrozenLesson());
      const r = boot({ isAuthoringV2ModeProp: true });
      expect(loadFrozenLesson).not.toHaveBeenCalled();
      expect(r.frozenLesson).toBeNull();
    });
  });

  describe('guidedTranscript source', () => {
    it('uses the published transcript when present', () => {
      const published = makeGuidedTranscript();
      loadOriginalGuidedTranscript.mockReturnValue(published);
      const r = boot({ isGuidedModeProp: true });
      expect(r.guidedTranscript).toBe(published);
      expect(r.isGuidedTranscriptMode).toBe(true);
      expect(r.lessonLayoutMode).toBe(true);
    });

    it('falls back to the draft transcript', () => {
      const draftTranscript = makeGuidedTranscript();
      loadOriginalGuidedTranscriptDraft.mockReturnValue({ transcript: draftTranscript, activeStepIndex: null });
      const r = boot({ isGuidedModeProp: true });
      expect(r.guidedTranscript).toBe(draftTranscript);
      expect(r.isGuidedTranscriptMode).toBe(true);
    });

    it('is null in authoring mode even when a transcript is stored', () => {
      loadOriginalGuidedTranscript.mockReturnValue(makeGuidedTranscript());
      const r = boot({ isGuidedModeProp: true, isAuthoringModeProp: true });
      expect(r.guidedTranscript).toBeNull();
      expect(r.isGuidedTranscriptMode).toBe(false);
    });

    it('is null in guided V2 mode even when a transcript is stored', () => {
      loadOriginalGuidedTranscript.mockReturnValue(makeGuidedTranscript());
      const r = boot({ isGuidedModeProp: true, isGuidedV2ModeProp: true });
      expect(r.guidedTranscript).toBeNull();
    });
  });

  describe('mode truth table', () => {
    it('transcript present, no frozen lesson → transcript mode only', () => {
      loadOriginalGuidedTranscript.mockReturnValue(makeGuidedTranscript());
      const r = boot({ isGuidedModeProp: true });
      expect(r.isGuidedTranscriptMode).toBe(true);
      expect(r.isGuidedFrozenLessonMode).toBe(false);
      expect(r.lessonLayoutMode).toBe(true);
    });

    it('frozen lesson present, no transcript → frozen mode only', () => {
      loadFrozenLesson.mockReturnValue(makeFrozenLesson());
      const r = boot({ isGuidedModeProp: true });
      expect(r.isGuidedFrozenLessonMode).toBe(true);
      expect(r.isGuidedTranscriptMode).toBe(false);
      expect(r.lessonLayoutMode).toBe(true);
    });

    it('authoring mode suppresses both transcript and frozen modes', () => {
      loadFrozenLesson.mockReturnValue(makeFrozenLesson());
      loadOriginalGuidedTranscript.mockReturnValue(makeGuidedTranscript());
      const r = boot({ isGuidedModeProp: true, isAuthoringModeProp: true });
      expect(r.isGuidedTranscriptMode).toBe(false);
      expect(r.isGuidedFrozenLessonMode).toBe(false);
    });

    it('a ready V2 playback drives lessonLayoutMode with no transcript or frozen lesson', () => {
      isLessonV2Preloaded.mockReturnValue(true);
      const lesson = makeLessonV2();
      getLessonV2Module.mockReturnValue({
        loadGuidedV2PlaybackLesson: () => lesson,
        canStartGuidedV2Lesson: () => true,
        validateGuidedV2Lesson: () => null,
      });
      const r = boot({ isGuidedV2ModeProp: true });
      expect(r.frozenV2Lesson).toBe(lesson);
      expect(r.guidedV2BootError).toBeNull();
      expect(r.guidedV2PlaybackReady).toBe(true);
      expect(r.lessonLayoutMode).toBe(true);
      expect(r.isGuidedTranscriptMode).toBe(false);
      expect(r.isGuidedFrozenLessonMode).toBe(false);
    });

    it('a V2 lesson that cannot start surfaces the validation error and is not playback-ready', () => {
      isLessonV2Preloaded.mockReturnValue(true);
      getLessonV2Module.mockReturnValue({
        loadGuidedV2PlaybackLesson: () => makeLessonV2(),
        canStartGuidedV2Lesson: () => false,
        validateGuidedV2Lesson: () => 'lesson has no events',
      });
      const r = boot({ isGuidedV2ModeProp: true });
      expect(r.guidedV2BootError).toBe('lesson has no events');
      expect(r.guidedV2PlaybackReady).toBe(false);
      expect(r.lessonLayoutMode).toBe(false);
    });
  });

  it('guidedInitSourceRef is a stable mutable ref seeded to null', () => {
    const { result, rerender } = renderHook(() => useGuidedLessonBoot(args()));
    const first = result.current.guidedInitSourceRef;
    expect(first.current).toBeNull();
    first.current = 'random';
    rerender();
    expect(result.current.guidedInitSourceRef).toBe(first);
    expect(result.current.guidedInitSourceRef.current).toBe('random');
  });
});
