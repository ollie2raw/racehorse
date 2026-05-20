import type { GuidedMatchLesson } from './guidedMatchTypes';

export function serializeGuidedMatchLesson(lesson: GuidedMatchLesson): string {
  return JSON.stringify(lesson, null, 2);
}

export async function copyGuidedMatchLessonJson(lesson: GuidedMatchLesson): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(serializeGuidedMatchLesson(lesson));
    return true;
  } catch {
    return false;
  }
}

export function downloadGuidedMatchLessonJson(
  lesson: GuidedMatchLesson,
  filename = `${lesson.lessonId}.json`,
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([serializeGuidedMatchLesson(lesson)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
