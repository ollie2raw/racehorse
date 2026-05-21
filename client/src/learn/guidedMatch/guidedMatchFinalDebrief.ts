import { GUIDED_MATCH_STANDARD_LESSON_ID } from './guidedMatchRecorderEngine';

export type GuidedMatchFinalDebrief = {
  title: string;
  bodyParagraphs: string[];
  takeaway: string;
  conceptChips?: string[];
};

/** Post-game teaching copy for the canonical standard guided match (final pressure move finish). */
export const STANDARD_GUIDED_MATCH_FINAL_DEBRIEF: GuidedMatchFinalDebrief = {
  title: 'Why this worked',
  bodyParagraphs: [
    'After you played 5–2, every open end became a 2. Fritz had to keep finding 2s just to stay alive.',
    'The rare part is what happened next: Fritz drew the double-2, scored, and was forced to keep drawing until the boneyard locked. When the last two locked tiles were also 2s, Fritz had no playable tile left — and his leftover pips gave you the win.',
  ],
  takeaway: 'Narrow the board, force pressure, and finish before the extra tiles help Fritz.',
  conceptChips: ['LOCKED ON 2s', 'FORCED DRAW', 'PIP WIN'],
};

export function getGuidedMatchFinalDebrief(
  lessonId: string | null | undefined,
): GuidedMatchFinalDebrief | null {
  if (lessonId === GUIDED_MATCH_STANDARD_LESSON_ID) {
    return STANDARD_GUIDED_MATCH_FINAL_DEBRIEF;
  }
  return null;
}
