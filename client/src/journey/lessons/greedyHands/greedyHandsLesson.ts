import type { JourneyContentId, JourneyLessonDefinition, JourneyNodeId, JourneySkillId } from '../../journeyContentContract.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { GREEDY_HANDS_FEEDBACK_ID } from './greedyHandsFeedback.ts';

export const GREEDY_HANDS_CONTENT_ID = 'journey:ch1:greedy-hands' as JourneyContentId;
export const GREEDY_HANDS_NODE_ID = 'ch1-n11' as JourneyNodeId;
export const GREEDY_HANDS_SKILL_ID = 'skill:greedy-hands' as JourneySkillId;
export const GREEDY_HANDS_PRACTICE_COST_VARIANT_SET_ID = 'variants:greedy-hands-practice-cost';
export const GREEDY_HANDS_PRACTICE_TAKE_VARIANT_SET_ID = 'variants:greedy-hands-practice-take';
export const GREEDY_HANDS_PROOF_VARIANT_SET_ID = 'variants:greedy-hands-proof';

const feedback = { kind: 'outcome_bundle', id: GREEDY_HANDS_FEEDBACK_ID } as const;

/**
 * Greedy Hands: price the whole turn. Take what a play scores, then count what the ends it leaves — once your turn
 * is over — let the tiles you cannot see score back. Sometimes the points are worth it; the lesson teaches the
 * comparison, not a rule against scoring.
 *
 * Stages: welcome → turn walk-through → one guided decision (retry the same position) → TWO practice stages, so a
 * clean run meets both kinds of position (a score that costs more than it is worth, then a score that is right
 * even though a quieter play looks safer) → a proof position. Each practice and proof stage retries on a fresh
 * position from its own pool. All three of those stages are required.
 */
export const GREEDY_HANDS_LESSON_DEFINITION: JourneyLessonDefinition = {
  id: GREEDY_HANDS_CONTENT_ID,
  nodeId: GREEDY_HANDS_NODE_ID,
  chapterId: 'ch1-fritz-trail',
  skillId: GREEDY_HANDS_SKILL_ID,
  contentVersion: 1,
  ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID },
  prerequisites: [],
  presentation: { tableContextId: 'table:fritz', rivalContextId: null },
  stages: [
    { id: 'welcome', kind: 'frame', copyRef: 'greedy-hands:welcome', evidenceRole: 'none' },
    { id: 'turn-demo', kind: 'board_demo', scenarioRef: 'scenario:greedy-demo', evidenceRole: 'none' },
    { id: 'guided-decision', kind: 'guided_practice', scenarioRef: 'scenario:greedy-guided', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'retry_required' },
    { id: 'independent-practice', kind: 'independent_practice', scenarioRef: 'scenario:greedy-practice-cost-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: GREEDY_HANDS_PRACTICE_COST_VARIANT_SET_ID }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
    { id: 'practice-take', kind: 'independent_practice', scenarioRef: 'scenario:greedy-practice-take-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: GREEDY_HANDS_PRACTICE_TAKE_VARIANT_SET_ID }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
    { id: 'proof', kind: 'mastery', scenarioRef: 'scenario:greedy-proof-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: GREEDY_HANDS_PROOF_VARIANT_SET_ID }, evidenceRole: 'proof', failurePolicy: 'retry_required' },
  ],
  completion: { kind: 'required_stages', stageIds: ['independent-practice', 'practice-take', 'proof'], owner: 'journey_lesson_controller' },
};
