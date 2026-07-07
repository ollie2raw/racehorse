import type { LessonV2Event } from '../../../learn/lessonV2.ts';

export function countAuthoringV2PlayerPlays(events: readonly LessonV2Event[]): number {
  return events.filter((event) => event.actor === 'player' && event.action === 'play').length;
}