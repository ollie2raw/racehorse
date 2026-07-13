import type { JourneyContentId, JourneyLessonDefinition, JourneyNodeId, JourneySkillId } from '../../journeyContentContract.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { DOUBLES_ARENT_FREE_FEEDBACK_ID } from './doublesArentFreeFeedback.ts';

export const DOUBLES_ARENT_FREE_CONTENT_ID = 'journey:ch1:doubles-arent-free' as JourneyContentId;
export const DOUBLES_ARENT_FREE_NODE_ID = 'ch1-n09' as JourneyNodeId;
export const DOUBLES_ARENT_FREE_SKILL_ID = 'skill:doubles-arent-free' as JourneySkillId;
export const DOUBLES_PRACTICE_VARIANT_SET_ID = 'variants:doubles-practice';
export const DOUBLES_PROOF_VARIANT_SET_ID = 'variants:doubles-proof';
const feedback = { kind: 'outcome_bundle', id: DOUBLES_ARENT_FREE_FEEDBACK_ID } as const;

export const DOUBLES_ARENT_FREE_LESSON_DEFINITION: JourneyLessonDefinition = {
  id: DOUBLES_ARENT_FREE_CONTENT_ID, nodeId: DOUBLES_ARENT_FREE_NODE_ID, chapterId: 'ch1-fritz-trail', skillId: DOUBLES_ARENT_FREE_SKILL_ID,
  contentVersion: 1, ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID }, prerequisites: ['journey:ch1:counting-whats-left' as JourneyContentId],
  presentation: { tableContextId: 'table:fritz', rivalContextId: null },
  stages: [
    { id: 'welcome', kind: 'frame', copyRef: 'doubles-arent-free:welcome', evidenceRole: 'none' },
    { id: 'double-demo', kind: 'board_demo', scenarioRef: 'scenario:doubles-demo', evidenceRole: 'none' },
    { id: 'guided-decision', kind: 'guided_practice', scenarioRef: 'scenario:doubles-guided', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'retry_required' },
    { id: 'independent-practice', kind: 'independent_practice', scenarioRef: 'scenario:doubles-practice-hold-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: DOUBLES_PRACTICE_VARIANT_SET_ID }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
    { id: 'proof', kind: 'mastery', scenarioRef: 'scenario:doubles-proof-hold-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: DOUBLES_PROOF_VARIANT_SET_ID }, evidenceRole: 'proof', failurePolicy: 'retry_required' },
  ],
  completion: { kind: 'required_stages', stageIds: ['independent-practice', 'proof'], owner: 'journey_lesson_controller' },
};
