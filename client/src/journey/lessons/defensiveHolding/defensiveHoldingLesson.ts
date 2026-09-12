import type { JourneyContentId, JourneyLessonDefinition, JourneyNodeId, JourneySkillId } from '../../journeyContentContract.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { DEFENSIVE_HOLDING_FEEDBACK_ID } from './defensiveHoldingFeedback.ts';

export const DEFENSIVE_HOLDING_CONTENT_ID = 'journey:ch4:defensive-holding' as JourneyContentId;
export const DEFENSIVE_HOLDING_NODE_ID = 'ch4-n07' as JourneyNodeId;
export const DEFENSIVE_HOLDING_SKILL_ID = 'skill:defensive-holding' as JourneySkillId;
export const DEFENSIVE_HOLDING_PRACTICE_VARIANT_SET_ID = 'variants:defensive-holding-practice';
export const DEFENSIVE_HOLDING_PROOF_VARIANT_SET_ID = 'variants:defensive-holding-proof';
const feedback = { kind: 'outcome_bundle', id: DEFENSIVE_HOLDING_FEEDBACK_ID } as const;

export const DEFENSIVE_HOLDING_LESSON_DEFINITION: JourneyLessonDefinition = {
  id: DEFENSIVE_HOLDING_CONTENT_ID,
  nodeId: DEFENSIVE_HOLDING_NODE_ID,
  chapterId: 'ch4-pressure-circuit',
  skillId: DEFENSIVE_HOLDING_SKILL_ID,
  contentVersion: 1,
  ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID },
  prerequisites: ['journey:ch3:endgame-hand-shape' as JourneyContentId],
  presentation: { tableContextId: 'table:fritz', rivalContextId: null },
  stages: [
    { id: 'welcome', kind: 'frame', copyRef: 'defensive-holding:welcome', evidenceRole: 'none' },
    { id: 'holding-demo', kind: 'board_demo', scenarioRef: 'scenario:holding-demo', evidenceRole: 'none' },
    { id: 'guided-decision', kind: 'guided_practice', scenarioRef: 'scenario:holding-guided', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'retry_required' },
    { id: 'independent-practice', kind: 'independent_practice', scenarioRef: 'scenario:holding-practice-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: DEFENSIVE_HOLDING_PRACTICE_VARIANT_SET_ID }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
    { id: 'proof', kind: 'mastery', scenarioRef: 'scenario:holding-proof-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: DEFENSIVE_HOLDING_PROOF_VARIANT_SET_ID }, evidenceRole: 'proof', failurePolicy: 'retry_required' },
  ],
  completion: { kind: 'required_stages', stageIds: ['independent-practice', 'proof'], owner: 'journey_lesson_controller' },
};
