import type { LearnProgressRecord } from './types';

const LEARN_PROGRESS_KEY = 'rh_learn_progress_v1';

const DEFAULT_PROGRESS: LearnProgressRecord = {
  lastLessonId: null,
  lastStepIndex: 0,
  completedLessonIds: [],
};

function sanitizeProgress(value: unknown): LearnProgressRecord {
  if (!value || typeof value !== 'object') return DEFAULT_PROGRESS;
  const parsed = value as Partial<LearnProgressRecord>;
  const completedRaw = Array.isArray(parsed.completedLessonIds)
    ? parsed.completedLessonIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    lastLessonId: typeof parsed.lastLessonId === 'string' ? parsed.lastLessonId : null,
    lastStepIndex: Number.isFinite(parsed.lastStepIndex)
      ? Math.max(0, Number(parsed.lastStepIndex))
      : 0,
    completedLessonIds: Array.from(new Set(completedRaw)),
  };
}

export function loadLearnProgress(): LearnProgressRecord {
  if (typeof window === 'undefined') return DEFAULT_PROGRESS;
  try {
    const raw = window.localStorage.getItem(LEARN_PROGRESS_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    return sanitizeProgress(JSON.parse(raw));
  } catch {
    return DEFAULT_PROGRESS;
  }
}

export function saveLearnProgress(progress: LearnProgressRecord): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LEARN_PROGRESS_KEY, JSON.stringify(sanitizeProgress(progress)));
}

export function saveLearnLastPosition(lessonId: string, stepIndex: number): LearnProgressRecord {
  const current = loadLearnProgress();
  const next: LearnProgressRecord = {
    ...current,
    lastLessonId: lessonId,
    lastStepIndex: Math.max(0, stepIndex),
  };
  saveLearnProgress(next);
  return next;
}

export function markLearnLessonCompleted(lessonId: string): LearnProgressRecord {
  const current = loadLearnProgress();
  const completedLessonIds = current.completedLessonIds.includes(lessonId)
    ? current.completedLessonIds
    : [...current.completedLessonIds, lessonId];
  const next: LearnProgressRecord = {
    ...current,
    lastLessonId: lessonId,
    lastStepIndex: 0,
    completedLessonIds,
  };
  saveLearnProgress(next);
  return next;
}

export function isLearnLessonCompleted(lessonId: string): boolean {
  return loadLearnProgress().completedLessonIds.includes(lessonId);
}

export function loadProgress(): LearnProgressRecord {
  return loadLearnProgress();
}

export function saveProgress(progress: LearnProgressRecord): void {
  saveLearnProgress(progress);
}

export function setLastLocation(lessonId: string, stepIndex: number): LearnProgressRecord {
  return saveLearnLastPosition(lessonId, stepIndex);
}

export function markLessonCompleted(lessonId: string): LearnProgressRecord {
  return markLearnLessonCompleted(lessonId);
}
