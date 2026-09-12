import type { JourneyContentId, JourneyLessonDefinition, JourneyNodeId, JourneySkillId } from '../../journeyContentContract.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { ENDGAME_HAND_SHAPE_FEEDBACK_ID } from './endgameHandShapeFeedback.ts';

export const ENDGAME_HAND_SHAPE_CONTENT_ID = 'journey:ch3:endgame-hand-shape' as JourneyContentId;
export const ENDGAME_HAND_SHAPE_NODE_ID = 'ch3-n07' as JourneyNodeId;
export const ENDGAME_HAND_SHAPE_SKILL_ID = 'skill:endgame-hand-shape' as JourneySkillId;
export const ENDGAME_HAND_SHAPE_PRACTICE_VARIANT_SET_ID = 'variants:endgame-hand-shape-practice';
export const ENDGAME_HAND_SHAPE_PROOF_VARIANT_SET_ID = 'variants:endgame-hand-shape-proof';
const feedback = { kind: 'outcome_bundle', id: ENDGAME_HAND_SHAPE_FEEDBACK_ID } as const;

export const ENDGAME_HAND_SHAPE_LESSON_DEFINITION: JourneyLessonDefinition = {
  id: ENDGAME_HAND_SHAPE_CONTENT_ID,
  nodeId: ENDGAME_HAND_SHAPE_NODE_ID,
  chapterId: 'ch3-long-march',
  skillId: ENDGAME_HAND_SHAPE_SKILL_ID,
  contentVersion: 1,
  ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID },
  prerequisites: ['journey:ch2:blocked-hand-tiebreak' as JourneyContentId],
  presentation: { tableContextId: 'table:fritz', rivalContextId: null },
  stages: [
    { id: 'welcome', kind: 'frame', copyRef: 'endgame-hand-shape:welcome', evidenceRole: 'none' },
    { id: 'shape-demo', kind: 'board_demo', scenarioRef: 'scenario:shape-demo', evidenceRole: 'none' },
    { id: 'guided-decision', kind: 'guided_practice', scenarioRef: 'scenario:shape-guided', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'retry_required' },
    { id: 'independent-practice', kind: 'independent_practice', scenarioRef: 'scenario:shape-practice-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: ENDGAME_HAND_SHAPE_PRACTICE_VARIANT_SET_ID }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
    { id: 'proof', kind: 'mastery', scenarioRef: 'scenario:shape-proof-1', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: ENDGAME_HAND_SHAPE_PROOF_VARIANT_SET_ID }, evidenceRole: 'proof', failurePolicy: 'retry_required' },
  ],
  completion: { kind: 'required_stages', stageIds: ['independent-practice', 'proof'], owner: 'journey_lesson_controller' },
};
