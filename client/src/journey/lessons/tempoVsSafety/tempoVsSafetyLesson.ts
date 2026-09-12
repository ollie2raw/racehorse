import type { JourneyContentId, JourneyLessonDefinition, JourneyNodeId, JourneySkillId } from '../../journeyContentContract.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { TEMPO_VS_SAFETY_FEEDBACK_ID } from './tempoVsSafetyFeedback.ts';

export const TEMPO_VS_SAFETY_CONTENT_ID = 'journey:ch6:tempo-vs-safety' as JourneyContentId;
export const TEMPO_VS_SAFETY_NODE_ID = 'ch6-n07' as JourneyNodeId;
export const TEMPO_VS_SAFETY_SKILL_ID = 'skill:tempo-vs-safety' as JourneySkillId;
export const TEMPO_VS_SAFETY_PRACTICE_VARIANT_SET_ID = 'variants:tempo-vs-safety-practice';
export const TEMPO_VS_SAFETY_PROOF_VARIANT_SET_ID = 'variants:tempo-vs-safety-proof';
const feedback = { kind: 'outcome_bundle', id: TEMPO_VS_SAFETY_FEEDBACK_ID } as const;

export const TEMPO_VS_SAFETY_LESSON_DEFINITION: JourneyLessonDefinition = {
  id: TEMPO_VS_SAFETY_CONTENT_ID,
  nodeId: TEMPO_VS_SAFETY_NODE_ID,
  chapterId: 'ch6-master-table',
  skillId: TEMPO_VS_SAFETY_SKILL_ID,
  contentVersion: 1,
  ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID },
  prerequisites: ['journey:ch5:reading-the-boneyard' as JourneyContentId],
  presentation: { tableContextId: 'table:fritz', rivalContextId: null },
  stages: [
    { id: 'welcome', kind: 'frame', copyRef: 'tempo-vs-safety:welcome', evidenceRole: 'none' },
    { id: 'tradeoff-demo', kind: 'board_demo', scenarioRef: 'scenario:tradeoff-demo', evidenceRole: 'none' },
    { id: 'guided-decision', kind: 'guided_practice', scenarioRef: 'scenario:tradeoff-guided', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'retry_required' },
    { id: 'independent-practice', kind: 'independent_practice', scenarioRef: 'scenario:tradeoff-practice-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: TEMPO_VS_SAFETY_PRACTICE_VARIANT_SET_ID }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
    { id: 'proof', kind: 'mastery', scenarioRef: 'scenario:tradeoff-proof-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: TEMPO_VS_SAFETY_PROOF_VARIANT_SET_ID }, evidenceRole: 'proof', failurePolicy: 'retry_required' },
  ],
  completion: { kind: 'required_stages', stageIds: ['independent-practice', 'proof'], owner: 'journey_lesson_controller' },
};
