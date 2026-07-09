import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGuidedLessonBoot } from './useGuidedLessonBoot';

const { getLessonV2Module, isLessonV2Preloaded } = vi.hoisted(() => ({
  getLessonV2Module: vi.fn(),
  isLessonV2Preloaded: vi.fn(() => false),
}));

vi.mock('../match/bootstrap/lessonV2LazyRegistry.ts', () => ({
  getLessonV2Module,
  isLessonV2Preloaded,
}));

describe('useGuidedLessonBoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isLessonV2Preloaded.mockReturnValue(false);
  });

  it('does not synchronously touch lesson V2 registry before preload completes', () => {
    const { result } = renderHook(() =>
      useGuidedLessonBoot({
        mode: 'bot',
        isGuidedModeProp: false,
        isAuthoringModeProp: false,
        isAuthoringV2ModeProp: false,
        isGuidedV2ModeProp: true,
      }),
    );

    expect(getLessonV2Module).not.toHaveBeenCalled();
    expect(result.current.isGuidedV2Mode).toBe(true);
    expect(result.current.frozenV2Lesson).toBeNull();
    expect(result.current.guidedV2BootError).toBeNull();
    expect(result.current.guidedV2PlaybackReady).toBe(false);
  });
});
