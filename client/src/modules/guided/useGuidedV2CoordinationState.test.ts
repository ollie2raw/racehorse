// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGuidedV2CoordinationState } from './useGuidedV2CoordinationState';
import { makeLessonV2 } from './guidedTestFixtures.ts';
import type { UseGuidedLessonBootResult } from './useGuidedLessonBoot.ts';

const { getLessonV2Module, isLessonV2Preloaded } = vi.hoisted(() => ({
  getLessonV2Module: vi.fn(),
  isLessonV2Preloaded: vi.fn(() => false),
}));

vi.mock('../match/bootstrap/lessonV2LazyRegistry.ts', () => ({
  getLessonV2Module,
  isLessonV2Preloaded,
}));

type BootSlice = Pick<UseGuidedLessonBootResult, 'isGuidedV2Mode' | 'frozenV2Lesson'>;

const lesson = makeLessonV2();

function slice(overrides: Partial<BootSlice> = {}): BootSlice {
  return { isGuidedV2Mode: true, frozenV2Lesson: lesson, ...overrides };
}

const canStart = vi.fn(() => true);
const initPlayback = vi.fn(() => ({ firstEventIndex: 3 }));

const index = (boot: BootSlice) =>
  renderHook(() => useGuidedV2CoordinationState(boot)).result.current.guidedV2EventIndex;

describe('useGuidedV2CoordinationState — lazy-init guard chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isLessonV2Preloaded.mockReturnValue(true);
    canStart.mockReturnValue(true);
    initPlayback.mockReturnValue({ firstEventIndex: 3 });
    getLessonV2Module.mockReturnValue({
      canStartGuidedV2Lesson: canStart,
      initGuidedV2Playback: initPlayback,
    });
  });

  it('not in guided V2 mode → index 0, registry untouched', () => {
    expect(index(slice({ isGuidedV2Mode: false }))).toBe(0);
    expect(isLessonV2Preloaded).not.toHaveBeenCalled();
    expect(getLessonV2Module).not.toHaveBeenCalled();
  });

  it('no frozen V2 lesson → index 0, registry untouched', () => {
    expect(index(slice({ frozenV2Lesson: null }))).toBe(0);
    expect(getLessonV2Module).not.toHaveBeenCalled();
  });

  it('lesson present but V2 module not preloaded → index 0, module not fetched', () => {
    isLessonV2Preloaded.mockReturnValue(false);
    expect(index(slice())).toBe(0);
    expect(getLessonV2Module).not.toHaveBeenCalled();
  });

  it('preloaded but the lesson cannot start → index 0, playback not initialised', () => {
    canStart.mockReturnValue(false);
    expect(index(slice())).toBe(0);
    expect(initPlayback).not.toHaveBeenCalled();
  });

  it('happy path → initGuidedV2Playback(lesson, 1).firstEventIndex', () => {
    expect(index(slice())).toBe(3);
    expect(canStart).toHaveBeenCalledWith(lesson);
    expect(initPlayback).toHaveBeenCalledWith(lesson, 1);
  });

  it('seeds the rest of the coordination state', () => {
    const { result } = renderHook(() => useGuidedV2CoordinationState(slice()));
    expect(result.current.isGuidedV2OffLine).toBe(false);
    expect(result.current.fritzV2LastAppliedIndexRef.current).toBe(-1);
    expect(typeof result.current.setGuidedV2EventIndex).toBe('function');
    expect(typeof result.current.setIsGuidedV2OffLine).toBe('function');
  });
});
