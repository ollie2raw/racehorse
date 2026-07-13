import type { JourneyAuthoredLessonBundle } from '../../journeyAuthoredLessonBundle.ts';
import { OPEN_END_DISCIPLINE_LESSON_DEFINITION } from './openEndDisciplineLesson.ts';
import { OPEN_END_DISCIPLINE_FEEDBACK } from './openEndDisciplineFeedback.ts';
import { evaluateOpenEndDisciplineDecision } from './openEndDisciplineEvaluator.ts';
import { OPEN_END_DISCIPLINE_SCENARIOS } from './openEndDisciplineScenarios.ts';

export const OPEN_END_DISCIPLINE_BUNDLE: JourneyAuthoredLessonBundle = {
  contentId: OPEN_END_DISCIPLINE_LESSON_DEFINITION.id,
  definition: OPEN_END_DISCIPLINE_LESSON_DEFINITION,
  scenarios: Object.fromEntries(OPEN_END_DISCIPLINE_SCENARIOS.map((scenario) => [scenario.id, scenario])),
  feedback: OPEN_END_DISCIPLINE_FEEDBACK,
  presentation: { tableTitle: 'Fritz’s Table', lessonTitle: 'Open-End Discipline', framingLine: 'Everybody who beats you later started right here.', framingInstruction: 'Before you play, read what your move leaves open.', completionLine: 'You read what came after the move. That’s the point.' },
  evaluateResponse: (scenario, response) => {
    if (response.kind !== 'move') throw new Error(`Open-End Discipline expects move responses, received ${response.kind}.`);
    return evaluateOpenEndDisciplineDecision({ scenario: scenario as Parameters<typeof evaluateOpenEndDisciplineDecision>[0]['scenario'], action: response.action });
  },
};
