import type { JourneyAuthoredLessonBundle } from '../../journeyAuthoredLessonBundle.ts';
import { ENDGAME_HAND_SHAPE_LESSON_DEFINITION } from './endgameHandShapeLesson.ts';
import { ENDGAME_HAND_SHAPE_FEEDBACK } from './endgameHandShapeFeedback.ts';
import { evaluateEndgameHandShapeResponse } from './endgameHandShapeEvaluator.ts';
import { ENDGAME_HAND_SHAPE_SCENARIOS } from './endgameHandShapeScenarios.ts';

export const ENDGAME_HAND_SHAPE_BUNDLE: JourneyAuthoredLessonBundle = {
  contentId: ENDGAME_HAND_SHAPE_LESSON_DEFINITION.id,
  definition: ENDGAME_HAND_SHAPE_LESSON_DEFINITION,
  scenarios: Object.fromEntries(ENDGAME_HAND_SHAPE_SCENARIOS.map((scenario) => [scenario.id, scenario])),
  feedback: ENDGAME_HAND_SHAPE_FEEDBACK,
  presentation: {
    tableTitle: 'Fritz’s Table',
    lessonTitle: 'Endgame Hand Shape',
    framingLine: 'Late in a hand, the tile you play matters less than the tiles it leaves behind.',
    framingInstruction: 'Before you commit, check whether your remaining tiles still have somewhere to go.',
    completionLine: 'You stopped playing the first legal tile you saw. You checked what stayed alive after it.',
  },
  evaluateResponse: evaluateEndgameHandShapeResponse,
};
