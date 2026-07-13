import type {
  JourneyContentId,
  JourneyLessonDefinition,
  JourneyNodeId,
  JourneySkillId,
} from '../../journeyContentContract.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { OPEN_END_DISCIPLINE_FEEDBACK_ID } from './openEndDisciplineFeedback.ts';
import {
  OPEN_END_DISCIPLINE_VARIANT_SET_ID,
} from './openEndDisciplineScenarios.ts';

export const OPEN_END_DISCIPLINE_CONTENT_ID = 'journey:ch1:open-end-discipline' as JourneyContentId;
export const OPEN_END_DISCIPLINE_NODE_ID = 'ch1-n07' as JourneyNodeId;
export const OPEN_END_DISCIPLINE_SKILL_ID = 'skill:open-end-discipline' as JourneySkillId;

const outcomeFeedback = { kind: 'outcome_bundle', id: OPEN_END_DISCIPLINE_FEEDBACK_ID } as const;

export const OPEN_END_DISCIPLINE_LESSON_DEFINITION: JourneyLessonDefinition = {
  id: OPEN_END_DISCIPLINE_CONTENT_ID,
  nodeId: OPEN_END_DISCIPLINE_NODE_ID,
  chapterId: 'ch1-fritz-trail',
  skillId: OPEN_END_DISCIPLINE_SKILL_ID,
  contentVersion: 1,
  ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID },
  prerequisites: ['ch1-n06' as JourneyContentId],
  presentation: { tableContextId: 'table:fritz', rivalContextId: null },
  stages: [
    { id: 'welcome', kind: 'frame', copyRef: 'open-end-discipline:welcome', evidenceRole: 'none' },
    { id: 'read-board', kind: 'board_demo', scenarioRef: 'scenario:open-end-demo', evidenceRole: 'none' },
    {
      id: 'guided-decision',
      kind: 'guided_practice',
      scenarioRef: 'scenario:open-end-guided',
      feedbackRef: outcomeFeedback,
      retry: { kind: 'same_scenario' },
      evidenceRole: 'none',
      failurePolicy: 'retry_required',
    },
    {
      id: 'independent-practice',
      kind: 'independent_practice',
      scenarioRef: 'scenario:open-end-practice-1',
      feedbackRef: outcomeFeedback,
      retry: { kind: 'fresh_variant', variantSetId: OPEN_END_DISCIPLINE_VARIANT_SET_ID },
      evidenceRole: 'practice',
      failurePolicy: 'retry_required',
    },
    {
      id: 'proof',
      kind: 'mastery',
      scenarioRef: 'scenario:open-end-proof',
      feedbackRef: outcomeFeedback,
      retry: { kind: 'same_scenario' },
      evidenceRole: 'proof',
      failurePolicy: 'retry_required',
    },
  ],
  completion: {
    kind: 'required_stages',
    stageIds: ['independent-practice', 'proof'],
    owner: 'journey_lesson_controller',
  },
};
