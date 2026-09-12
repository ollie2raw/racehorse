import type { JourneyAuthoredLessonBundle } from '../../journeyAuthoredLessonBundle.ts';
import { DEFENSIVE_HOLDING_LESSON_DEFINITION } from './defensiveHoldingLesson.ts';
import { DEFENSIVE_HOLDING_FEEDBACK } from './defensiveHoldingFeedback.ts';
import { evaluateDefensiveHoldingResponse } from './defensiveHoldingEvaluator.ts';
import { DEFENSIVE_HOLDING_SCENARIOS } from './defensiveHoldingScenarios.ts';

export const DEFENSIVE_HOLDING_BUNDLE: JourneyAuthoredLessonBundle = {
  contentId: DEFENSIVE_HOLDING_LESSON_DEFINITION.id,
  definition: DEFENSIVE_HOLDING_LESSON_DEFINITION,
  scenarios: Object.fromEntries(DEFENSIVE_HOLDING_SCENARIOS.map((scenario) => [scenario.id, scenario])),
  feedback: DEFENSIVE_HOLDING_FEEDBACK,
  presentation: {
    tableTitle: 'Fritz’s Table',
    lessonTitle: 'Defensive Holding',
    framingLine: 'The end you leave open matters as much as the tile you played to leave it.',
    framingInstruction: 'Before you play, count which end is actually the harder one for Fritz to answer.',
    completionLine: 'You stopped exposing the crowded end out of habit. You checked which one was actually guarded.',
  },
  evaluateResponse: evaluateDefensiveHoldingResponse,
};
