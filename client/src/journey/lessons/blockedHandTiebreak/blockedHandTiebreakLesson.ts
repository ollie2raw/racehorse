import type { JourneyContentId, JourneyLessonDefinition, JourneyNodeId, JourneySkillId } from '../../journeyContentContract.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { BLOCKED_HAND_TIEBREAK_FEEDBACK_ID } from './blockedHandTiebreakFeedback.ts';

export const BLOCKED_HAND_TIEBREAK_CONTENT_ID = 'journey:ch2:blocked-hand-tiebreak' as JourneyContentId;
export const BLOCKED_HAND_TIEBREAK_NODE_ID = 'ch2-n07' as JourneyNodeId;
export const BLOCKED_HAND_TIEBREAK_SKILL_ID = 'skill:blocked-hand-tiebreak' as JourneySkillId;
export const BLOCKED_HAND_TIEBREAK_PRACTICE_VARIANT_SET_ID = 'variants:blocked-hand-tiebreak-practice';
export const BLOCKED_HAND_TIEBREAK_PROOF_VARIANT_SET_ID = 'variants:blocked-hand-tiebreak-proof';
const feedback = { kind: 'outcome_bundle', id: BLOCKED_HAND_TIEBREAK_FEEDBACK_ID } as const;

export const BLOCKED_HAND_TIEBREAK_LESSON_DEFINITION: JourneyLessonDefinition = {
  id: BLOCKED_HAND_TIEBREAK_CONTENT_ID,
  nodeId: BLOCKED_HAND_TIEBREAK_NODE_ID,
  chapterId: 'ch2-high-line',
  skillId: BLOCKED_HAND_TIEBREAK_SKILL_ID,
  contentVersion: 1,
  ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID },
  prerequisites: ['journey:ch1:doubles-arent-free' as JourneyContentId],
  presentation: { tableContextId: 'table:fritz', rivalContextId: null },
  stages: [
    { id: 'welcome', kind: 'frame', copyRef: 'blocked-hand-tiebreak:welcome', evidenceRole: 'none' },
    { id: 'tiebreak-demo', kind: 'board_demo', scenarioRef: 'scenario:tiebreak-demo', evidenceRole: 'none' },
    { id: 'guided-decision', kind: 'guided_practice', scenarioRef: 'scenario:tiebreak-guided', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'retry_required' },
    { id: 'independent-practice', kind: 'independent_practice', scenarioRef: 'scenario:tiebreak-practice-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: BLOCKED_HAND_TIEBREAK_PRACTICE_VARIANT_SET_ID }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
    { id: 'proof', kind: 'mastery', scenarioRef: 'scenario:tiebreak-proof-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: BLOCKED_HAND_TIEBREAK_PROOF_VARIANT_SET_ID }, evidenceRole: 'proof', failurePolicy: 'retry_required' },
  ],
  completion: { kind: 'required_stages', stageIds: ['independent-practice', 'proof'], owner: 'journey_lesson_controller' },
};
