import type { JourneyAuthoredLessonBundle } from '../../journeyAuthoredLessonBundle.ts';
import { READING_THE_BONEYARD_LESSON_DEFINITION } from './readingTheBoneyardLesson.ts';
import { READING_THE_BONEYARD_FEEDBACK } from './readingTheBoneyardFeedback.ts';
import { evaluateReadingTheBoneyardResponse } from './readingTheBoneyardEvaluator.ts';
import { READING_THE_BONEYARD_SCENARIOS } from './readingTheBoneyardScenarios.ts';

export const READING_THE_BONEYARD_BUNDLE: JourneyAuthoredLessonBundle = {
  contentId: READING_THE_BONEYARD_LESSON_DEFINITION.id,
  definition: READING_THE_BONEYARD_LESSON_DEFINITION,
  scenarios: Object.fromEntries(READING_THE_BONEYARD_SCENARIOS.map((scenario) => [scenario.id, scenario])),
  feedback: READING_THE_BONEYARD_FEEDBACK,
  presentation: {
    tableTitle: 'Fritz’s Table',
    lessonTitle: 'Reading the Boneyard',
    framingLine: 'Every tile you can’t see is either in the boneyard or in Fritz’s hand. The count doesn’t care which.',
    framingInstruction: 'Count what’s genuinely still unseen, then play toward the end where fewer of them are waiting.',
    completionLine: 'You stopped guessing at what Fritz might be holding. You counted it.',
  },
  evaluateResponse: evaluateReadingTheBoneyardResponse,
};
