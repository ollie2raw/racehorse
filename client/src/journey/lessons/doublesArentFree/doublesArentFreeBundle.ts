import type { JourneyAuthoredLessonBundle } from '../../journeyAuthoredLessonBundle.ts';
import { DOUBLES_ARENT_FREE_LESSON_DEFINITION } from './doublesArentFreeLesson.ts';
import { DOUBLES_ARENT_FREE_FEEDBACK } from './doublesArentFreeFeedback.ts';
import { evaluateDoublesResponse } from './doublesArentFreeEvaluator.ts';
import { DOUBLES_ARENT_FREE_SCENARIOS } from './doublesArentFreeScenarios.ts';

export const DOUBLES_ARENT_FREE_BUNDLE: JourneyAuthoredLessonBundle = {
  contentId: DOUBLES_ARENT_FREE_LESSON_DEFINITION.id,
  definition: DOUBLES_ARENT_FREE_LESSON_DEFINITION,
  scenarios: Object.fromEntries(DOUBLES_ARENT_FREE_SCENARIOS.map((scenario) => [scenario.id, scenario])),
  feedback: DOUBLES_ARENT_FREE_FEEDBACK,
  presentation: { tableTitle: 'Fritz’s Table', lessonTitle: 'Doubles Aren’t Free', framingLine: 'A double makes noise. That doesn’t mean it made your hand better.', framingInstruction: 'Before you commit it, check what your other tiles can do next.', completionLine: 'You stopped treating the double like a prize. You played it when the position paid for it.' },
  evaluateResponse: evaluateDoublesResponse,
};
