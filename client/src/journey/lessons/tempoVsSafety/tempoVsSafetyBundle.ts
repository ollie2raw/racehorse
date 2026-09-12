import type { JourneyAuthoredLessonBundle } from '../../journeyAuthoredLessonBundle.ts';
import { TEMPO_VS_SAFETY_LESSON_DEFINITION } from './tempoVsSafetyLesson.ts';
import { TEMPO_VS_SAFETY_FEEDBACK } from './tempoVsSafetyFeedback.ts';
import { evaluateTempoVsSafetyResponse } from './tempoVsSafetyEvaluator.ts';
import { TEMPO_VS_SAFETY_SCENARIOS } from './tempoVsSafetyScenarios.ts';

export const TEMPO_VS_SAFETY_BUNDLE: JourneyAuthoredLessonBundle = {
  contentId: TEMPO_VS_SAFETY_LESSON_DEFINITION.id,
  definition: TEMPO_VS_SAFETY_LESSON_DEFINITION,
  scenarios: Object.fromEntries(TEMPO_VS_SAFETY_SCENARIOS.map((scenario) => [scenario.id, scenario])),
  feedback: TEMPO_VS_SAFETY_FEEDBACK,
  presentation: {
    tableTitle: 'Fritz’s Table',
    lessonTitle: 'Tempo vs. Safety',
    framingLine: 'The bigger number on the scoreboard isn’t always the better move on the board.',
    framingInstruction: 'Before you take the score, check what taking it costs your next turn.',
    completionLine: 'You stopped grading a play by its score alone. You checked what it left you able to do next.',
  },
  evaluateResponse: evaluateTempoVsSafetyResponse,
};
