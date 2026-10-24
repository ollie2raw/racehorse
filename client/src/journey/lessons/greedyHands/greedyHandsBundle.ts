import type { JourneyAuthoredLessonBundle } from '../../journeyAuthoredLessonBundle.ts';
import { GREEDY_HANDS_LESSON_DEFINITION } from './greedyHandsLesson.ts';
import { GREEDY_HANDS_STATIC_FEEDBACK } from './greedyHandsFeedback.ts';
import { evaluateGreedyHandsResponse } from './greedyHandsEvaluator.ts';
import { GREEDY_HANDS_GENERATED_FEEDBACK, GREEDY_HANDS_REPEAT_SCENARIOS, GREEDY_HANDS_SCENARIOS } from './greedyHandsScenarios.ts';

export const GREEDY_HANDS_BUNDLE: JourneyAuthoredLessonBundle = {
  contentId: GREEDY_HANDS_LESSON_DEFINITION.id,
  definition: GREEDY_HANDS_LESSON_DEFINITION,
  // the authored positions, then their explicit repeats (see the retry policy in greedyHandsScenarios.ts)
  scenarios: Object.fromEntries([...GREEDY_HANDS_SCENARIOS, ...GREEDY_HANDS_REPEAT_SCENARIOS].map((scenario) => [scenario.id, scenario])),
  feedback: { ...GREEDY_HANDS_STATIC_FEEDBACK, ...GREEDY_HANDS_GENERATED_FEEDBACK },
  presentation: {
    tableTitle: 'Fritz’s Table',
    lessonTitle: 'Greedy Hands',
    framingLine: 'A score keeps your turn going. What matters is the board you leave when it finally ends.',
    framingInstruction: 'Count what you take. Then count what the tiles you can’t see could take back.',
    completionLine: 'You priced the whole turn: what you took, and what you left the table to answer with.',
  },
  evaluateResponse: evaluateGreedyHandsResponse,
};
