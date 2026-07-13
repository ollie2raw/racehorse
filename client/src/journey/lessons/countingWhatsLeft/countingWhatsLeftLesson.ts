import type { JourneyContentId, JourneyLessonDefinition, JourneyNodeId, JourneySkillId } from '../../journeyContentContract.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { COUNTING_WHATS_LEFT_FEEDBACK_ID } from './countingWhatsLeftFeedback.ts';

export const COUNTING_WHATS_LEFT_CONTENT_ID = 'journey:ch1:counting-whats-left' as JourneyContentId;
export const COUNTING_WHATS_LEFT_NODE_ID = 'ch1-n08' as JourneyNodeId;
export const COUNTING_WHATS_LEFT_SKILL_ID = 'skill:counting-whats-left' as JourneySkillId;
const feedback = { kind: 'outcome_bundle', id: COUNTING_WHATS_LEFT_FEEDBACK_ID } as const;

export const COUNTING_WHATS_LEFT_LESSON_DEFINITION: JourneyLessonDefinition = {
  id: COUNTING_WHATS_LEFT_CONTENT_ID,
  nodeId: COUNTING_WHATS_LEFT_NODE_ID,
  chapterId: 'ch1-fritz-trail',
  skillId: COUNTING_WHATS_LEFT_SKILL_ID,
  contentVersion: 1,
  ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID },
  prerequisites: ['journey:ch1:open-end-discipline' as JourneyContentId],
  presentation: { tableContextId: 'table:fritz', rivalContextId: null },
  stages: [
    { id: 'welcome', kind: 'frame', copyRef: 'counting-whats-left:welcome', evidenceRole: 'none' },
    { id: 'count-known', kind: 'board_demo', scenarioRef: 'scenario:counting-demo', evidenceRole: 'none' },
    { id: 'guided-count', kind: 'guided_practice', scenarioRef: 'scenario:counting-guided', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'retry_required' },
    { id: 'independent-practice', kind: 'independent_practice', scenarioRef: 'scenario:counting-practice-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: 'variants:counting-practice' }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
    { id: 'proof', kind: 'mastery', scenarioRef: 'scenario:counting-proof-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: 'variants:counting-proof' }, evidenceRole: 'proof', failurePolicy: 'retry_required' },
  ],
  completion: { kind: 'required_stages', stageIds: ['independent-practice', 'proof'], owner: 'journey_lesson_controller' },
};
