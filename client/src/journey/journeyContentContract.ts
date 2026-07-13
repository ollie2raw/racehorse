import type { AppMode } from '../types.ts';
import type { BotDealSize } from '../bot/botEngine.ts';
import type { FritzTier } from '../bot/fritzConfig.ts';
import type { JourneyNodeAction, JourneyNodeType } from './journeyTypes.ts';

export const CORE_JOURNEY_RULESET_ID = 'racehorse-core-journey' as const;

export type JourneyNodeId = string & { readonly __journeyNodeId: unique symbol };
export type JourneyContentId = string & { readonly __journeyContentId: unique symbol };
export type JourneySkillId = string & { readonly __journeySkillId: unique symbol };
export type JourneyFeedbackId = string & { readonly __journeyFeedbackId: unique symbol };

export type JourneyRulesetRef =
  | { kind: 'core_journey'; id: typeof CORE_JOURNEY_RULESET_ID }
  | { kind: 'table_tradition'; id: string };

export type JourneySupportStatus = 'supported' | 'legacyFallback' | 'placeholder' | 'unsupported';
export type JourneyMigrationClass = 'legacy' | 'premium';
export type JourneyRuntimeAvailability = 'available' | 'unavailable';

export type JourneyRuntimeCapability =
  | { kind: 'briefing_acknowledgement'; briefingId: string }
  | { kind: 'static_decision'; puzzleId: string }
  | { kind: 'interactive_board_decision'; puzzleId: string }
  | {
      kind: 'bot_match';
      fritzTier: FritzTier;
      dealSize: BotDealSize;
      trialFormat: 'fullMatch' | 'shortRace';
      winningScore: number;
    }
  | {
      kind: 'boss_match';
      fritzTier: FritzTier;
      dealSize: BotDealSize;
      trialFormat: 'fullMatch' | 'shortRace';
      winningScore: number;
    }
  | { kind: 'lesson_sequence'; lessonId: string }
  | { kind: 'external_navigation'; mode: AppMode; params?: Record<string, unknown> }
  | { kind: 'unsupported'; reason: string };

export type JourneyCompletionAuthority =
  | { kind: 'briefing_acknowledged'; owner: 'journey_ui' }
  | { kind: 'decision_correct'; owner: 'journey_ui'; puzzleId: string }
  | { kind: 'interactive_scenario_success'; owner: 'journey_ui'; puzzleId: string }
  | { kind: 'bot_result'; owner: 'journey_match_bridge'; requiredResult: 'win' }
  | { kind: 'boss_result'; owner: 'journey_match_bridge'; requiredResult: 'win' }
  | { kind: 'lesson_controller_result'; owner: 'journey_lesson_controller' }
  | { kind: 'external_navigation'; owner: 'external_route'; completion: 'none' }
  | { kind: 'none'; owner: 'none'; reason: string };

export type JourneyPresentationContextRef = {
  tableContextId: string | null;
  rivalContextId: string | null;
};

export type JourneyLegacyFallback = {
  requestedCapability: JourneyRuntimeCapability['kind'];
  actualCapability: JourneyRuntimeCapability['kind'];
  reason: string;
};

export type JourneyLegacySource = {
  actionKind: JourneyNodeAction['kind'];
  requestedCapability: JourneyRuntimeCapability['kind'];
  actualCapability: JourneyRuntimeCapability['kind'];
  fallback: JourneyLegacyFallback | null;
  requirements: string[];
  completionCriteria: string;
  rewardText: string;
  briefingId: string | null;
  puzzleId: string | null;
};

export type JourneyContentDescriptorBase = {
  contentId: JourneyContentId;
  nodeId: JourneyNodeId;
  chapterId: string;
  nodeType: JourneyNodeType;
  title: string;
  ruleset: JourneyRulesetRef;
  supportStatus: JourneySupportStatus;
  runtimeAvailability: JourneyRuntimeAvailability;
  runtime: JourneyRuntimeCapability;
  completion: JourneyCompletionAuthority;
  presentation: JourneyPresentationContextRef;
};

export type LegacyJourneyContentDescriptor = JourneyContentDescriptorBase & {
  migrationClass: 'legacy';
  legacy: JourneyLegacySource;
};

export type PremiumJourneyContentDescriptor = JourneyContentDescriptorBase & {
  migrationClass: 'premium';
  lesson: {
    definitionId: JourneyContentId;
    contentVersion: number;
  };
};

export type JourneyContentDescriptor =
  | LegacyJourneyContentDescriptor
  | PremiumJourneyContentDescriptor;

export type JourneyContentDescriptorResolution =
  | { kind: 'found'; descriptor: JourneyContentDescriptor }
  | { kind: 'missing'; nodeId: string };

export type JourneyFeedbackRef =
  | { kind: 'outcome_bundle'; id: JourneyFeedbackId }
  | { kind: 'controller_defined'; id: JourneyFeedbackId };

export type JourneyLessonRetryPolicy =
  | { kind: 'same_scenario' }
  | { kind: 'fresh_variant'; variantSetId: string }
  | { kind: 'controller_defined' };

export type JourneyStageEvidenceRole = 'none' | 'practice' | 'proof' | 'review';
export type JourneyStageFailurePolicy = 'retry_required' | 'allow_continue' | 'finish_attempt';

export type JourneyLessonStage =
  | { id: string; kind: 'frame'; copyRef: string; evidenceRole: 'none' }
  | { id: string; kind: 'board_demo'; scenarioRef: string; evidenceRole: 'none' }
  | { id: string; kind: 'decision'; scenarioRef: string; feedbackRef: JourneyFeedbackRef; retry: JourneyLessonRetryPolicy; evidenceRole: 'none' | 'practice'; failurePolicy: JourneyStageFailurePolicy }
  | { id: string; kind: 'guided_practice'; scenarioRef: string; feedbackRef: JourneyFeedbackRef; retry: JourneyLessonRetryPolicy; evidenceRole: 'none' | 'practice'; failurePolicy: JourneyStageFailurePolicy }
  | { id: string; kind: 'independent_practice'; scenarioRef: string; feedbackRef: JourneyFeedbackRef; retry: JourneyLessonRetryPolicy; evidenceRole: 'practice'; failurePolicy: JourneyStageFailurePolicy }
  | { id: string; kind: 'authored_scenario'; scenarioRef: string; feedbackRef: JourneyFeedbackRef; retry: JourneyLessonRetryPolicy; evidenceRole: 'none' | 'practice'; failurePolicy: JourneyStageFailurePolicy }
  | { id: string; kind: 'mastery'; scenarioRef: string; feedbackRef: JourneyFeedbackRef; retry: JourneyLessonRetryPolicy; evidenceRole: 'proof'; failurePolicy: JourneyStageFailurePolicy }
  | { id: string; kind: 'review'; scenarioRef: string; feedbackRef: JourneyFeedbackRef; retry: JourneyLessonRetryPolicy; evidenceRole: 'review'; failurePolicy: JourneyStageFailurePolicy };

export type JourneyLessonCompletionRule =
  | { kind: 'required_stages'; stageIds: string[]; owner: 'journey_lesson_controller' }
  | {
      kind: 'scorecard';
      requiredStageIds: string[];
      keyDecisionIds: string[];
      aggregateThresholdRef: string;
      failurePolicy: JourneyScorecardFailurePolicy;
      owner: 'journey_lesson_controller';
    };

export type JourneyScorecardFailurePolicy =
  | { kind: 'end_session' }
  | { kind: 'retry_stage'; stageId: string };

export type JourneyLessonDefinition = {
  id: JourneyContentId;
  nodeId: JourneyNodeId;
  chapterId: string;
  skillId: JourneySkillId;
  contentVersion: number;
  ruleset: JourneyRulesetRef;
  prerequisites: JourneyContentId[];
  presentation?: JourneyPresentationContextRef;
  stages: JourneyLessonStage[];
  completion: JourneyLessonCompletionRule;
};

export function getRequestedCapability(action: JourneyNodeAction): JourneyRuntimeCapability['kind'] {
  switch (action.kind) {
    case 'placeholder': return 'briefing_acknowledgement';
    case 'navigate': return 'external_navigation';
    case 'botMatch': return 'bot_match';
    case 'puzzle': return 'static_decision';
    case 'lesson': return 'lesson_sequence';
    default: return assertNever(action);
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled Journey contract value: ${String(value)}`);
}
