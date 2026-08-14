// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadLearnProgress,
  saveLearnProgress,
  saveLearnLastPosition,
  markLearnLessonCompleted,
  isLearnLessonCompleted,
  loadProgress,
  saveProgress,
  setLastLocation,
  markLessonCompleted,
} from './storage';

const STORAGE_KEY = 'rh_learn_progress_v1';

describe('progress storage', () => {
  beforeEach(() => {
    // Clear mock localStorage before each test
    window.localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. loadLearnProgress returns default progress when storage is empty', () => {
    const progress = loadLearnProgress();
    expect(progress).toEqual({
      lastLessonId: null,
      lastStepIndex: 0,
      completedLessonIds: [],
    });
  });

  it('2. loadLearnProgress handles JSON parsing errors gracefully and returns default', () => {
    window.localStorage.setItem(STORAGE_KEY, 'invalid-json{');
    const progress = loadLearnProgress();
    expect(progress.lastLessonId).toBeNull();
    expect(progress.lastStepIndex).toBe(0);
  });

  it('3. loadLearnProgress parses valid progress from localStorage', () => {
    const record = {
      lastLessonId: 'intro',
      lastStepIndex: 5,
      completedLessonIds: ['basics'],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    expect(loadLearnProgress()).toEqual(record);
  });

  it('4. sanitizes lastLessonId if it is not a string', () => {
    const record = {
      lastLessonId: 123,
      lastStepIndex: 5,
      completedLessonIds: [],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    expect(loadLearnProgress().lastLessonId).toBeNull();
  });

  it('5. sanitizes lastStepIndex if it is negative or not finite', () => {
    const record = {
      lastLessonId: 'intro',
      lastStepIndex: -10,
      completedLessonIds: [],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    expect(loadLearnProgress().lastStepIndex).toBe(0);
  });

  it('6. sanitizes non-finite step index to 0', () => {
    const record = {
      lastLessonId: 'intro',
      lastStepIndex: NaN,
      completedLessonIds: [],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    expect(loadLearnProgress().lastStepIndex).toBe(0);
  });

  it('7. filters out non-string lesson IDs from completed list', () => {
    const record = {
      lastLessonId: 'intro',
      lastStepIndex: 2,
      completedLessonIds: ['basics', 123, null, 'advanced'],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    expect(loadLearnProgress().completedLessonIds).toEqual(['basics', 'advanced']);
  });

  it('8. deduplicates completed lesson IDs', () => {
    const record = {
      lastLessonId: 'intro',
      lastStepIndex: 2,
      completedLessonIds: ['basics', 'basics', 'advanced'],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    expect(loadLearnProgress().completedLessonIds).toEqual(['basics', 'advanced']);
  });

  it('9. saveLearnProgress stores sanitized version in localStorage', () => {
    const record = {
      lastLessonId: 'intro',
      lastStepIndex: -5, // should sanitize to 0
      completedLessonIds: ['basics', 'basics'],
    };
    saveLearnProgress(record);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.lastStepIndex).toBe(0);
    expect(parsed.completedLessonIds).toEqual(['basics']);
  });

  it('10. saveLearnLastPosition updates lastLessonId and stepIndex', () => {
    const updated = saveLearnLastPosition('lesson-2', 4);
    expect(updated.lastLessonId).toBe('lesson-2');
    expect(updated.lastStepIndex).toBe(4);
    expect(loadLearnProgress().lastLessonId).toBe('lesson-2');
  });

  it('11. markLearnLessonCompleted adds lesson to completed list without duplication', () => {
    markLearnLessonCompleted('intro');
    let progress = loadLearnProgress();
    expect(progress.completedLessonIds).toContain('intro');
    expect(progress.lastLessonId).toBe('intro');
    expect(progress.lastStepIndex).toBe(0);

    // mark again
    markLearnLessonCompleted('intro');
    progress = loadLearnProgress();
    expect(progress.completedLessonIds.filter((id) => id === 'intro').length).toBe(1);
  });

  it('12. isLearnLessonCompleted checks completed lesson status correctly', () => {
    expect(isLearnLessonCompleted('intro')).toBe(false);
    markLearnLessonCompleted('intro');
    expect(isLearnLessonCompleted('intro')).toBe(true);
  });

  it('13. legacy loadProgress behaves identical to loadLearnProgress', () => {
    const record = {
      lastLessonId: 'intro',
      lastStepIndex: 5,
      completedLessonIds: ['basics'],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    expect(loadProgress()).toEqual(record);
  });

  it('14. legacy saveProgress behaves identical to saveLearnProgress', () => {
    const record = {
      lastLessonId: 'intro',
      lastStepIndex: 12,
      completedLessonIds: ['basics'],
    };
    saveProgress(record);
    expect(loadLearnProgress()).toEqual(record);
  });

  it('15. legacy setLastLocation updates state correctly', () => {
    const updated = setLastLocation('lesson-5', 2);
    expect(updated.lastLessonId).toBe('lesson-5');
    expect(updated.lastStepIndex).toBe(2);
  });

  it('16. legacy markLessonCompleted updates state correctly', () => {
    const updated = markLessonCompleted('lesson-5');
    expect(updated.completedLessonIds).toContain('lesson-5');
    expect(updated.lastLessonId).toBe('lesson-5');
    expect(updated.lastStepIndex).toBe(0);
  });

  it('17. sanitizeProgress handles null/non-object inputs gracefully by returning defaults', () => {
    window.localStorage.setItem(STORAGE_KEY, 'null');
    expect(loadLearnProgress().completedLessonIds).toEqual([]);
  });

  it('18. sanitizeProgress retains string values in completed lesson ids', () => {
    saveLearnProgress({
      lastLessonId: 'lesson-1',
      lastStepIndex: 1,
      completedLessonIds: ['l-1', 'l-2'],
    });
    expect(isLearnLessonCompleted('l-1')).toBe(true);
    expect(isLearnLessonCompleted('l-2')).toBe(true);
    expect(isLearnLessonCompleted('l-3')).toBe(false);
  });

  it('19. check output formatting does not crash on stringified functions', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"lastLessonId": "lesson", "lastStepIndex": 3, "completedLessonIds": []}');
    expect(loadLearnProgress().lastLessonId).toBe('lesson');
  });

  it('20. handle load when local storage throws error', () => {
    const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Blocked storage');
    });
    expect(loadLearnProgress().lastLessonId).toBeNull();
    spy.mockRestore();
  });
});
