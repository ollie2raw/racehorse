import type { JourneyAuthoredLessonBundle } from '../../journeyAuthoredLessonBundle.ts';
import { BLOCKED_HAND_TIEBREAK_LESSON_DEFINITION } from './blockedHandTiebreakLesson.ts';
import { BLOCKED_HAND_TIEBREAK_FEEDBACK } from './blockedHandTiebreakFeedback.ts';
import { evaluateBlockedHandTiebreakResponse } from './blockedHandTiebreakEvaluator.ts';
import { BLOCKED_HAND_TIEBREAK_SCENARIOS } from './blockedHandTiebreakScenarios.ts';

export const BLOCKED_HAND_TIEBREAK_BUNDLE: JourneyAuthoredLessonBundle = {
  contentId: BLOCKED_HAND_TIEBREAK_LESSON_DEFINITION.id,
  definition: BLOCKED_HAND_TIEBREAK_LESSON_DEFINITION,
  scenarios: Object.fromEntries(BLOCKED_HAND_TIEBREAK_SCENARIOS.map((scenario) => [scenario.id, scenario])),
  feedback: BLOCKED_HAND_TIEBREAK_FEEDBACK,
  presentation: {
    tableTitle: 'Fritz’s Table',
    lessonTitle: 'Reading the Blocked-Hand Tiebreak',
    framingLine: 'When nobody can play, the hand doesn’t end in a tie. It ends by pip count.',
    framingInstruction: 'Before you play, check what each legal move leaves behind — not just what it scores.',
    completionLine: 'You stopped judging a play only by what it scores. You checked what it leaves you holding.',
  },
  evaluateResponse: evaluateBlockedHandTiebreakResponse,
};
