import type { JourneyContentId, JourneyLessonDefinition, JourneyNodeId, JourneySkillId } from '../../journeyContentContract.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { READING_THE_BONEYARD_FEEDBACK_ID } from './readingTheBoneyardFeedback.ts';

export const READING_THE_BONEYARD_CONTENT_ID = 'journey:ch5:reading-the-boneyard' as JourneyContentId;
export const READING_THE_BONEYARD_NODE_ID = 'ch5-n07' as JourneyNodeId;
export const READING_THE_BONEYARD_SKILL_ID = 'skill:reading-the-boneyard' as JourneySkillId;
export const READING_THE_BONEYARD_PRACTICE_VARIANT_SET_ID = 'variants:reading-the-boneyard-practice';
export const READING_THE_BONEYARD_PROOF_VARIANT_SET_ID = 'variants:reading-the-boneyard-proof';
const feedback = { kind: 'outcome_bundle', id: READING_THE_BONEYARD_FEEDBACK_ID } as const;

export const READING_THE_BONEYARD_LESSON_DEFINITION: JourneyLessonDefinition = {
  id: READING_THE_BONEYARD_CONTENT_ID,
  nodeId: READING_THE_BONEYARD_NODE_ID,
  chapterId: 'ch5-iron-mile',
  skillId: READING_THE_BONEYARD_SKILL_ID,
  contentVersion: 1,
  ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID },
  prerequisites: ['journey:ch4:defensive-holding' as JourneyContentId],
  presentation: { tableContextId: 'table:fritz', rivalContextId: null },
  stages: [
    { id: 'welcome', kind: 'frame', copyRef: 'reading-the-boneyard:welcome', evidenceRole: 'none' },
    { id: 'boneyard-demo', kind: 'board_demo', scenarioRef: 'scenario:boneyard-demo', evidenceRole: 'none' },
    { id: 'guided-count', kind: 'guided_practice', scenarioRef: 'scenario:boneyard-guided', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'retry_required' },
    { id: 'independent-practice', kind: 'independent_practice', scenarioRef: 'scenario:boneyard-practice-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: READING_THE_BONEYARD_PRACTICE_VARIANT_SET_ID }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
    { id: 'proof', kind: 'mastery', scenarioRef: 'scenario:boneyard-proof-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: READING_THE_BONEYARD_PROOF_VARIANT_SET_ID }, evidenceRole: 'proof', failurePolicy: 'retry_required' },
  ],
  completion: { kind: 'required_stages', stageIds: ['independent-practice', 'proof'], owner: 'journey_lesson_controller' },
};
