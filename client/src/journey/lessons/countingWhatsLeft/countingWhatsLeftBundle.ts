import type { JourneyAuthoredLessonBundle } from '../../journeyAuthoredLessonBundle.ts';
import { COUNTING_WHATS_LEFT_LESSON_DEFINITION } from './countingWhatsLeftLesson.ts';
import { COUNTING_WHATS_LEFT_FEEDBACK } from './countingWhatsLeftFeedback.ts';
import { evaluateCountingWhatsLeftResponse } from './countingWhatsLeftEvaluator.ts';
import { COUNTING_WHATS_LEFT_SCENARIOS } from './countingWhatsLeftScenarios.ts';

export const COUNTING_WHATS_LEFT_BUNDLE: JourneyAuthoredLessonBundle = {
  contentId: COUNTING_WHATS_LEFT_LESSON_DEFINITION.id,
  definition: COUNTING_WHATS_LEFT_LESSON_DEFINITION,
  scenarios: Object.fromEntries(COUNTING_WHATS_LEFT_SCENARIOS.map((scenario) => [scenario.id, scenario])),
  feedback: COUNTING_WHATS_LEFT_FEEDBACK,
  presentation: { tableTitle: 'Fritz’s Table', lessonTitle: 'Counting What’s Left', framingLine: 'You don’t need to know where every tile is. Start with what’s already accounted for.', framingInstruction: 'The board and your hand tell you how many possibilities are still unseen.', completionLine: 'You counted the possibilities, then read the position. That’s stronger than guessing.' },
  evaluateResponse: evaluateCountingWhatsLeftResponse,
};
