import {
  validateJourneyLessonDefinitionPrimitive,
  type JourneyContentValidationContext,
} from './journeyContentValidationPrimitives.ts';
import type {
  JourneyContentId,
  JourneyFeedbackRef,
  JourneyLessonCompletionRule,
  JourneyLessonDefinition,
  JourneyLessonRetryPolicy,
  JourneyLessonStage,
  JourneyStageEvidenceRole,
  JourneyStageFailurePolicy,
  JourneyNodeId,
} from './journeyContentContract.ts';
import type {
  JourneyAttemptId,
  JourneyAttemptResult,
  JourneyDecisionSummary,
  JourneyEvidenceEvent,
  JourneyScoreEvidence,
} from './journeyEvidenceTypes.ts';
import { validateJourneyEvidenceEvent } from './journeyEvidenceValidation.ts';

export const JOURNEY_LESSON_SESSION_SCHEMA_VERSION = 1 as const;
export const JOURNEY_LESSON_EXECUTION_ID_LIMIT = 256 as const;
export const JOURNEY_LESSON_ATTEMPT_ID_LIMIT = 256 as const;
export const JOURNEY_LESSON_EMITTED_ATTEMPT_ID_LIMIT = 256 as const;
export const JOURNEY_LESSON_HINT_ID_LIMIT = 256 as const;
export const JOURNEY_LESSON_SCENARIO_HISTORY_LIMIT = 128 as const;
export const JOURNEY_LESSON_OUTCOME_HISTORY_LIMIT = 128 as const;

export type JourneyLessonSessionStatus = 'ready' | 'active' | 'completed' | 'ended' | 'abandoned';
export type JourneyLessonSessionPhase =
  | 'ready'
  | 'presenting'
  | 'awaiting_result'
  | 'feedback'
  | 'awaiting_retry'
  | 'awaiting_controller_retry'
  | 'awaiting_scorecard'
  | 'completed'
  | 'ended'
  | 'abandoned';

export type JourneyStageOutcome = 'completed' | 'passed' | 'failed' | 'abandoned';

export type JourneyLessonExecutionIdentity = {
  sessionId: string;
  stageId: string;
  executionId: string;
  attemptId: JourneyAttemptId;
};

export type JourneyStageOutcomeSummary = {
  stageId: string;
  executionId: string;
  attemptId: JourneyAttemptId;
  outcome: JourneyStageOutcome;
  accepted: boolean;
  feedbackOutcomeKey: string;
  decisionSummary: JourneyDecisionSummary;
  score: JourneyScoreEvidence | null;
  completedAt: string;
  sessionId: string;
  scenarioRef: string;
  startedAt: string;
  attemptOrdinal: number;
  hintsUsed: number;
  mistakeCategoryIds: string[];
};

export type JourneyLessonActiveExecution = {
  sessionId: string;
  executionId: string;
  attemptId: JourneyAttemptId;
  stageId: string;
  scenarioRef: string;
  startedAt: string;
  ordinal: number;
};

export type JourneyLessonActiveAttempt = {
  attemptId: JourneyAttemptId;
  executionId: string;
  stageId: string;
  startedAt: string;
  hintsUsed: number;
  mistakeCategoryIds: string[];
  usedHintIds: string[];
};

export type JourneyLessonFeedbackState = {
  executionId: string;
  attemptId: JourneyAttemptId;
  stageId: string;
  outcome: JourneyStageOutcome;
  outcomeKey: string;
  feedbackRef: JourneyFeedbackRef;
};

export type JourneyLessonRetryState = {
  stageId: string;
  policy: JourneyLessonRetryPolicy;
  priorScenarioRefs: string[];
  ordinal: number;
};

export type JourneyLessonCompletionResult = {
  completedAt: string;
  rule: JourneyLessonCompletionRule['kind'];
};

export type JourneyLessonSessionState = {
  schemaVersion: typeof JOURNEY_LESSON_SESSION_SCHEMA_VERSION;
  sessionId: string;
  contentId: JourneyContentId;
  nodeId: JourneyNodeId;
  contentVersion: number;
  skillId: string;
  definitionId: JourneyContentId;
  status: JourneyLessonSessionStatus;
  phase: JourneyLessonSessionPhase;
  currentStageId: string | null;
  currentStageIndex: number;
  completedStageIds: string[];
  activeExecution: JourneyLessonActiveExecution | null;
  activeAttempt: JourneyLessonActiveAttempt | null;
  activeScenarioRef: string | null;
  stageOutcomes: JourneyStageOutcomeSummary[];
  feedback: JourneyLessonFeedbackState | null;
  pendingRetry: JourneyLessonRetryState | null;
  pendingScorecardRequestId: string | null;
  pendingScorecardRequestAt: string | null;
  usedExecutionIds: string[];
  usedAttemptIds: string[];
  emittedAttemptIds: string[];
  attemptOrdinalByStageId: Record<string, number>;
  scenarioHistoryByStageId: Record<string, string[]>;
  outcomeHistory: JourneyStageOutcomeSummary[];
  lessonStartedEmitted: boolean;
  startedAt: string;
  latestTransitionAt: string;
  completion: JourneyLessonCompletionResult | null;
  endedReason: string | null;
};

export type JourneyLessonExecutionRequest = {
  sessionId: string;
  executionId: string;
  attemptId: JourneyAttemptId;
  stageId: string;
  stageKind: JourneyLessonStage['kind'];
  scenarioRef: string;
  retry: JourneyLessonRetryPolicy;
  evidenceRole: JourneyStageEvidenceRole;
  failurePolicy: JourneyStageFailurePolicy;
};

export type JourneyLessonEffect =
  | { kind: 'emit_evidence'; event: JourneyEvidenceEvent }
  | { kind: 'present_stage'; sessionId: string; stageId: string; stageKind: 'frame' | 'board_demo'; reference: string }
  | { kind: 'stage_ready'; sessionId: string; stageId: string; stageKind: Exclude<JourneyLessonStage['kind'], 'frame' | 'board_demo'> }
  | { kind: 'execute_stage'; request: JourneyLessonExecutionRequest }
  | { kind: 'present_feedback'; sessionId: string; stageId: string; executionId: string; feedbackRef: JourneyFeedbackRef; outcomeKey: string; outcome: JourneyStageOutcome }
  | { kind: 'retry_available'; sessionId: string; stageId: string; policy: JourneyLessonRetryPolicy }
  | { kind: 'request_fresh_variant'; sessionId: string; stageId: string; variantSetId: string; priorScenarioRefs: string[]; attemptOrdinal: number }
  | { kind: 'request_controller_retry'; sessionId: string; stageId: string; priorScenarioRefs: string[]; attemptOrdinal: number }
  | { kind: 'request_scorecard_evaluation'; sessionId: string; requestId: string; requestedAt: string; thresholdRef: string; outcomes: JourneyStageOutcomeSummary[] }
  | { kind: 'lesson_completed'; sessionId: string; completedAt: string }
  | { kind: 'lesson_ended'; sessionId: string; reason: string };

export type JourneyLessonCommand =
  | { kind: 'start'; sessionId: string; timestamp: string }
  | { kind: 'continue_stage'; stageId: string; timestamp: string; scorecardRequestId?: string }
  | { kind: 'begin_execution'; identity: JourneyLessonExecutionIdentity; startedAt: string; scenarioRef?: string }
  | { kind: 'record_hint'; identity: JourneyLessonExecutionIdentity; hintId: string; timestamp: string }
  | {
      kind: 'submit_result';
      identity: JourneyLessonExecutionIdentity;
      completedAt: string;
      outcome: JourneyStageOutcome;
      feedbackOutcomeKey: string;
      decisionSummary: JourneyDecisionSummary;
      mistakeCategoryIds: string[];
      score: JourneyScoreEvidence | null;
      reviewReasonIds?: string[];
    }
  | { kind: 'acknowledge_feedback'; identity: JourneyLessonExecutionIdentity; timestamp: string; scorecardRequestId?: string }
  | { kind: 'retry_stage'; identity: JourneyLessonExecutionIdentity; startedAt: string; scenarioRef: string }
  | { kind: 'resolve_controller_retry'; identity: JourneyLessonExecutionIdentity; startedAt: string; scenarioRef: string }
  | { kind: 'scorecard_evaluation_result'; sessionId: string; requestId: string; passed: boolean; timestamp: string }
  | { kind: 'abandon'; timestamp: string; reason: string; reviewReasonIds?: string[] };

export type JourneyLessonTransitionError = {
  code: 'invalid_command' | 'stale_session' | 'stale_stage' | 'stale_execution' | 'stale_attempt' | 'definition_mismatch' | 'stale_timestamp' | 'illegal_transition' | 'invalid_result' | 'invalid_retry' | 'stale_evaluation';
  message: string;
};

export type JourneyLessonTransitionResult =
  | { kind: 'accepted'; state: JourneyLessonSessionState; effects: JourneyLessonEffect[] }
  | { kind: 'rejected'; state: JourneyLessonSessionState; error: JourneyLessonTransitionError };

export type JourneyLessonSessionInput = {
  sessionId: string;
  startedAt: string;
  validationContext?: JourneyContentValidationContext;
};

function validTimestamp(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function validId(value: string): boolean {
  return value.trim().length > 0;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Journey lesson controller value: ${String(value)}`);
}

function cloneState(state: JourneyLessonSessionState): JourneyLessonSessionState {
  return {
    ...state,
    completedStageIds: [...state.completedStageIds],
    activeExecution: state.activeExecution ? { ...state.activeExecution } : null,
    activeAttempt: state.activeAttempt ? { ...state.activeAttempt, mistakeCategoryIds: [...state.activeAttempt.mistakeCategoryIds], usedHintIds: [...state.activeAttempt.usedHintIds] } : null,
    stageOutcomes: state.stageOutcomes.map((outcome) => ({ ...outcome, decisionSummary: { ...outcome.decisionSummary }, score: outcome.score ? { ...outcome.score } : null, mistakeCategoryIds: [...outcome.mistakeCategoryIds] })),
    outcomeHistory: state.outcomeHistory.map((outcome) => ({ ...outcome, decisionSummary: { ...outcome.decisionSummary }, score: outcome.score ? { ...outcome.score } : null, mistakeCategoryIds: [...outcome.mistakeCategoryIds] })),
    feedback: state.feedback ? { ...state.feedback, feedbackRef: { ...state.feedback.feedbackRef } } : null,
    pendingRetry: state.pendingRetry ? { ...state.pendingRetry, priorScenarioRefs: [...state.pendingRetry.priorScenarioRefs], policy: { ...state.pendingRetry.policy } as JourneyLessonRetryPolicy } : null,
    emittedAttemptIds: [...state.emittedAttemptIds],
    usedExecutionIds: [...state.usedExecutionIds],
    usedAttemptIds: [...state.usedAttemptIds],
    attemptOrdinalByStageId: { ...state.attemptOrdinalByStageId },
    scenarioHistoryByStageId: Object.fromEntries(Object.entries(state.scenarioHistoryByStageId).map(([key, refs]) => [key, [...refs]])),
    completion: state.completion ? { ...state.completion } : null,
  };
}

function rejected(state: JourneyLessonSessionState, code: JourneyLessonTransitionError['code'], message: string): JourneyLessonTransitionResult {
  return { kind: 'rejected', state, error: { code, message } };
}

function accepted(state: JourneyLessonSessionState, effects: JourneyLessonEffect[]): JourneyLessonTransitionResult {
  return { kind: 'accepted', state, effects };
}

function stageAt(definition: JourneyLessonDefinition, state: JourneyLessonSessionState): JourneyLessonStage | null {
  return definition.stages[state.currentStageIndex] ?? null;
}

function definitionIdentityError(state: JourneyLessonSessionState, definition: JourneyLessonDefinition): string | null {
  if (state.schemaVersion !== JOURNEY_LESSON_SESSION_SCHEMA_VERSION) return 'Unsupported lesson session schema version.';
  if (definition.id !== state.definitionId || definition.id !== state.contentId) return 'Lesson definition/content identity does not match the session.';
  if (definition.nodeId !== state.nodeId) return 'Lesson definition node does not match the session.';
  if (definition.skillId !== state.skillId) return 'Lesson definition skill does not match the session.';
  if (definition.contentVersion !== state.contentVersion) return 'Lesson definition content version does not match the session.';
  const stage = stageAt(definition, state);
  if (!stage || stage.id !== state.currentStageId) return 'Current stage does not match the lesson definition.';
  return null;
}

function identityMatches(state: JourneyLessonSessionState, identity: JourneyLessonExecutionIdentity, expected: JourneyLessonExecutionIdentity | null): JourneyLessonTransitionError['code'] | null {
  if (identity.sessionId !== state.sessionId) return 'stale_session';
  if (!expected || identity.stageId !== expected.stageId) return 'stale_stage';
  if (identity.executionId !== expected.executionId) return 'stale_execution';
  if (identity.attemptId !== expected.attemptId) return 'stale_attempt';
  return null;
}

function guardTimestamp(state: JourneyLessonSessionState, timestamp: string): JourneyLessonTransitionError | null {
  if (!validTimestamp(timestamp)) return { code: 'invalid_command', message: 'Command timestamp is invalid.' };
  if (Date.parse(timestamp) < Date.parse(state.latestTransitionAt)) return { code: 'stale_timestamp', message: 'Command timestamp precedes the latest session transition.' };
  return null;
}

function defaultControllerValidationContext(definition: JourneyLessonDefinition): JourneyContentValidationContext {
  return {
    canonicalNodeIds: new Set([String(definition.nodeId)]),
    chapterByNodeId: new Map([[String(definition.nodeId), definition.chapterId]]),
    knownContentIds: new Set([String(definition.id), ...definition.prerequisites.map(String)]),
  };
}

function isInteractive(stage: JourneyLessonStage): stage is Exclude<JourneyLessonStage, { kind: 'frame' | 'board_demo' }> {
  return stage.kind !== 'frame' && stage.kind !== 'board_demo';
}

function isAcceptedOutcome(stage: JourneyLessonStage, outcome: JourneyStageOutcome): boolean {
  if (outcome === 'abandoned' || outcome === 'failed') return false;
  if (stage.evidenceRole === 'proof' || stage.evidenceRole === 'review') return outcome === 'passed';
  return outcome === 'completed' || outcome === 'passed';
}

function evidenceResult(outcome: JourneyStageOutcome): JourneyAttemptResult {
  switch (outcome) {
    case 'passed': return 'passed';
    case 'abandoned': return 'abandoned';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    default: return assertNever(outcome);
  }
}

function stageEffect(state: JourneyLessonSessionState, stage: JourneyLessonStage): JourneyLessonEffect {
  if (stage.kind === 'frame') return { kind: 'present_stage', sessionId: state.sessionId, stageId: stage.id, stageKind: stage.kind, reference: stage.copyRef };
  if (stage.kind === 'board_demo') return { kind: 'present_stage', sessionId: state.sessionId, stageId: stage.id, stageKind: stage.kind, reference: stage.scenarioRef };
  if (!state.activeExecution) return { kind: 'stage_ready', sessionId: state.sessionId, stageId: stage.id, stageKind: stage.kind };
  return { kind: 'execute_stage', request: { sessionId: state.sessionId, executionId: state.activeExecution.executionId, attemptId: state.activeExecution.attemptId, stageId: stage.id, stageKind: stage.kind, scenarioRef: state.activeExecution.scenarioRef, retry: stage.retry, evidenceRole: stage.evidenceRole, failurePolicy: stage.failurePolicy } };
}

function lessonStartEvent(state: JourneyLessonSessionState): JourneyEvidenceEvent {
  return {
    kind: 'lesson_started',
    contentId: state.contentId,
    nodeId: state.nodeId,
    contentVersion: { kind: 'versioned', version: state.contentVersion },
    skillId: state.skillId as never,
    timestamp: state.startedAt,
  };
}

function advanceAfterStage(definition: JourneyLessonDefinition, state: JourneyLessonSessionState, timestamp: string): { state: JourneyLessonSessionState; effects: JourneyLessonEffect[] } {
  const nextIndex = state.currentStageIndex + 1;
  if (nextIndex >= definition.stages.length) {
    const required = definition.completion.kind === 'required_stages' ? definition.completion.stageIds : definition.completion.requiredStageIds;
    const complete = required.every((stageId) => state.completedStageIds.includes(stageId));
    if (!complete) {
      return { state: { ...state, status: 'ended', phase: 'ended', activeExecution: null, activeAttempt: null, latestTransitionAt: timestamp, endedReason: 'Required stages were not completed.' }, effects: [{ kind: 'lesson_ended', sessionId: state.sessionId, reason: 'Required stages were not completed.' }] };
    }
    if (definition.completion.kind === 'scorecard') {
      return { state: { ...state, phase: 'awaiting_scorecard', pendingScorecardRequestId: null, activeExecution: null, activeAttempt: null, latestTransitionAt: timestamp }, effects: [] };
    }
    return completeSession(state, timestamp, definition.completion.kind);
  }
  const nextStage = definition.stages[nextIndex];
  const next = { ...state, currentStageIndex: nextIndex, currentStageId: nextStage.id, phase: 'presenting' as const, activeExecution: null, activeAttempt: null, activeScenarioRef: null, feedback: null, pendingRetry: null, pendingScorecardRequestId: null, latestTransitionAt: timestamp };
  return { state: next, effects: [stageEffect(next, nextStage)] };
}

function completeSession(state: JourneyLessonSessionState, timestamp: string, rule: JourneyLessonCompletionRule['kind']): { state: JourneyLessonSessionState; effects: JourneyLessonEffect[] } {
  const next = { ...state, status: 'completed' as const, phase: 'completed' as const, activeExecution: null, activeAttempt: null, feedback: null, pendingScorecardRequestId: null, pendingScorecardRequestAt: null, latestTransitionAt: timestamp, completion: { completedAt: timestamp, rule }, endedReason: null };
  return { state: next, effects: [{ kind: 'lesson_completed', sessionId: state.sessionId, completedAt: timestamp }] };
}

function emitAttempt(state: JourneyLessonSessionState, stage: Exclude<JourneyLessonStage, { kind: 'frame' | 'board_demo' }>, result: Extract<JourneyLessonCommand, { kind: 'submit_result' }>, active: JourneyLessonActiveExecution): JourneyEvidenceEvent | null {
  if (stage.evidenceRole === 'none') return null;
  const attemptKind = stage.evidenceRole;
  return {
    kind: 'attempt_recorded',
    attempt: {
      attemptId: active.attemptId,
      contentId: state.contentId,
      nodeId: state.nodeId,
      contentVersion: { kind: 'versioned', version: state.contentVersion },
      skillId: state.skillId as never,
      attemptKind,
      result: evidenceResult(result.outcome),
      startedAt: active.startedAt,
      completedAt: result.outcome === 'abandoned' ? null : result.completedAt,
      decisionSummary: { ...result.decisionSummary },
      hintsUsed: state.activeAttempt?.hintsUsed ?? 0,
      mistakeCategoryIds: [...result.mistakeCategoryIds] as never[],
      score: result.score ? { ...result.score } : null,
      stageIds: [stage.id],
      reviewReasonIds: stage.evidenceRole === 'review' ? [...(result.reviewReasonIds ?? [])] as never[] : [],
    },
  };
}

function startExecution(state: JourneyLessonSessionState, stage: Exclude<JourneyLessonStage, { kind: 'frame' | 'board_demo' }>, identity: JourneyLessonExecutionIdentity, startedAt: string, scenarioRef: string): JourneyLessonTransitionResult {
  if (identity.sessionId !== state.sessionId) return rejected(state, 'stale_session', 'Execution session does not match.');
  if (identity.stageId !== stage.id) return rejected(state, 'stale_stage', 'Execution stage does not match.');
  if (!validId(identity.executionId) || !validId(identity.attemptId) || !validTimestamp(startedAt) || !validId(scenarioRef)) return rejected(state, 'invalid_command', 'Execution, attempt, timestamp, and scenario references are required.');
  if (state.usedExecutionIds.includes(identity.executionId)) return rejected(state, 'stale_execution', 'Execution ID has already been used in this session.');
  if (state.usedAttemptIds.includes(String(identity.attemptId))) return rejected(state, 'stale_attempt', 'Attempt ID has already been used in this session.');
  const ordinal = (state.attemptOrdinalByStageId[stage.id] ?? 0) + 1;
  const activeExecution: JourneyLessonActiveExecution = { sessionId: state.sessionId, executionId: identity.executionId, attemptId: identity.attemptId, stageId: stage.id, scenarioRef, startedAt, ordinal };
  const scenarioHistory = state.scenarioHistoryByStageId[stage.id] ?? [];
  if (scenarioHistory.includes(scenarioRef) && stage.retry.kind === 'fresh_variant') return rejected(state, 'invalid_retry', 'Fresh-variant execution reused a prior scenario.');
  const next = { ...state, phase: 'awaiting_result' as const, activeExecution, activeAttempt: { attemptId: identity.attemptId, executionId: identity.executionId, stageId: stage.id, startedAt, hintsUsed: 0, mistakeCategoryIds: [], usedHintIds: [] }, activeScenarioRef: scenarioRef, attemptOrdinalByStageId: { ...state.attemptOrdinalByStageId, [stage.id]: ordinal }, usedExecutionIds: [...state.usedExecutionIds, identity.executionId].slice(-JOURNEY_LESSON_EXECUTION_ID_LIMIT), usedAttemptIds: [...state.usedAttemptIds, String(identity.attemptId)].slice(-JOURNEY_LESSON_ATTEMPT_ID_LIMIT), scenarioHistoryByStageId: { ...state.scenarioHistoryByStageId, [stage.id]: [...scenarioHistory, scenarioRef].filter((ref, index, refs) => refs.indexOf(ref) === index).slice(-JOURNEY_LESSON_SCENARIO_HISTORY_LIMIT) }, latestTransitionAt: startedAt };
  return accepted(next, [stageEffect(next, stage)]);
}

export function createJourneyLessonSession(definition: JourneyLessonDefinition, input: JourneyLessonSessionInput): JourneyLessonSessionState {
  const validationContext = input.validationContext ?? defaultControllerValidationContext(definition);
  const errors = validateJourneyLessonDefinitionPrimitive(definition, validationContext);
  if (errors.length > 0) throw new Error(['Invalid Journey lesson definition:', ...errors].join('\n'));
  if (!validId(input.sessionId) || !validTimestamp(input.startedAt)) throw new Error('Journey lesson session requires a stable session ID and valid start timestamp.');
  const firstStage = definition.stages[0];
  return {
    schemaVersion: JOURNEY_LESSON_SESSION_SCHEMA_VERSION,
    sessionId: input.sessionId,
    contentId: definition.id,
    nodeId: definition.nodeId,
    contentVersion: definition.contentVersion,
    skillId: definition.skillId,
    definitionId: definition.id,
    status: 'ready',
    phase: 'ready',
    currentStageId: firstStage.id,
    currentStageIndex: 0,
    completedStageIds: [],
    activeExecution: null,
    activeAttempt: null,
    activeScenarioRef: null,
    stageOutcomes: [],
    feedback: null,
    pendingRetry: null,
    pendingScorecardRequestId: null,
    pendingScorecardRequestAt: null,
    usedExecutionIds: [],
    usedAttemptIds: [],
    emittedAttemptIds: [],
    attemptOrdinalByStageId: {},
    scenarioHistoryByStageId: {},
    outcomeHistory: [],
    lessonStartedEmitted: false,
    startedAt: input.startedAt,
    latestTransitionAt: input.startedAt,
    completion: null,
    endedReason: null,
  };
}

export function transitionJourneyLessonSession(state: JourneyLessonSessionState, command: JourneyLessonCommand, definition: JourneyLessonDefinition): JourneyLessonTransitionResult {
  const current = cloneState(state);
  const definitionError = definitionIdentityError(current, definition);
  if (definitionError) return rejected(current, 'definition_mismatch', definitionError);
  const commandTimestamp = command.kind === 'start' || command.kind === 'continue_stage' || command.kind === 'scorecard_evaluation_result' || command.kind === 'abandon'
    ? command.timestamp
    : command.kind === 'begin_execution' || command.kind === 'retry_stage' || command.kind === 'resolve_controller_retry'
      ? command.startedAt
      : command.kind === 'submit_result' ? command.completedAt : command.timestamp;
  const timestampError = guardTimestamp(current, commandTimestamp);
  if (timestampError) return rejected(current, timestampError.code, timestampError.message);
  const stage = stageAt(definition, current);
  if (!stage && !['completed', 'ended', 'abandoned'].includes(current.status)) return rejected(current, 'illegal_transition', 'Current stage is missing from the lesson definition.');
  switch (command.kind) {
    case 'start': {
      if (current.status !== 'ready' || current.phase !== 'ready') return rejected(current, 'illegal_transition', 'Lesson session has already started.');
      if (command.sessionId !== current.sessionId) return rejected(current, 'invalid_command', 'Session ID does not match.');
      const next = { ...current, status: 'active' as const, phase: 'presenting' as const, startedAt: command.timestamp, latestTransitionAt: command.timestamp, lessonStartedEmitted: true };
      const event = lessonStartEvent(next);
      const errors = validateJourneyEvidenceEvent(event);
      if (errors.length > 0) return rejected(current, 'invalid_result', errors.join('\n'));
      return accepted(next, [{ kind: 'emit_evidence', event }, stageEffect(next, stage!) ]);
    }
    case 'continue_stage': {
      if (current.phase !== 'presenting' || !stage || isInteractive(stage) || command.stageId !== stage.id) return rejected(current, 'illegal_transition', 'Only the current non-interactive stage can be continued.');
      const next = { ...current, completedStageIds: current.completedStageIds.includes(stage.id) ? current.completedStageIds : [...current.completedStageIds, stage.id] };
      return finishOrAdvance(definition, next, command.timestamp);
    }
    case 'begin_execution': {
      if (current.phase !== 'presenting' || !stage || !isInteractive(stage) || command.identity.stageId !== stage.id) return rejected(current, 'illegal_transition', 'Stage is not ready for execution.');
      return startExecution(current, stage, command.identity, command.startedAt, command.scenarioRef ?? stage.scenarioRef);
    }
    case 'record_hint': {
      const correlation = identityMatches(current, command.identity, current.activeExecution);
      if (current.phase !== 'awaiting_result' || !current.activeExecution || correlation || !current.activeAttempt || !validId(command.hintId)) return rejected(current, correlation ?? 'stale_execution', 'Hint does not belong to the active execution.');
      if (Date.parse(command.timestamp) < Date.parse(current.activeExecution.startedAt)) return rejected(current, 'stale_timestamp', 'Hint timestamp precedes execution start.');
      if (current.activeAttempt.usedHintIds.includes(command.hintId)) return accepted(current, []);
      const usedHintIds = [...current.activeAttempt.usedHintIds, command.hintId].slice(-JOURNEY_LESSON_HINT_ID_LIMIT);
      return accepted({ ...current, activeAttempt: { ...current.activeAttempt, hintsUsed: current.activeAttempt.hintsUsed + 1, usedHintIds }, latestTransitionAt: command.timestamp }, []);
    }
    case 'submit_result': {
      const correlation = identityMatches(current, command.identity, current.activeExecution);
      if (current.phase !== 'awaiting_result' || !stage || !isInteractive(stage) || !current.activeExecution || correlation) return rejected(current, correlation ?? 'stale_execution', 'Result does not belong to the active execution.');
      if (!validId(command.feedbackOutcomeKey)) return rejected(current, 'invalid_result', 'Result outcome or feedback key is invalid.');
      if (command.outcome !== 'abandoned' && Date.parse(command.completedAt) < Date.parse(current.activeExecution.startedAt)) return rejected(current, 'invalid_result', 'Completion cannot precede execution start.');
      if (!Number.isInteger(command.decisionSummary.total) || command.decisionSummary.total < 0 || !Number.isInteger(command.decisionSummary.correct) || command.decisionSummary.correct < 0 || !Number.isInteger(command.decisionSummary.incorrect) || command.decisionSummary.incorrect < 0 || command.decisionSummary.correct + command.decisionSummary.incorrect > command.decisionSummary.total) return rejected(current, 'invalid_result', 'Decision summary is invalid.');
      if (command.mistakeCategoryIds.some((id) => !validId(id))) return rejected(current, 'invalid_result', 'Mistake category IDs must be non-empty.');
      if (stage.evidenceRole === 'review' && (!Array.isArray(command.reviewReasonIds) || command.reviewReasonIds.length === 0 || command.reviewReasonIds.some((id) => !validId(id)))) return rejected(current, 'invalid_result', 'Review evidence requires relevant review reason IDs.');
      if (stage.evidenceRole !== 'review' && command.reviewReasonIds && command.reviewReasonIds.length > 0) return rejected(current, 'invalid_result', 'Only review stages may carry review reason IDs.');
      const evidence = emitAttempt(current, stage, command, current.activeExecution);
      if (evidence) {
        const evidenceErrors = validateJourneyEvidenceEvent(evidence);
        if (evidenceErrors.length > 0) return rejected(current, 'invalid_result', evidenceErrors.join('\n'));
      }
      const summary: JourneyStageOutcomeSummary = { sessionId: current.sessionId, stageId: stage.id, executionId: current.activeExecution.executionId, attemptId: current.activeExecution.attemptId, scenarioRef: current.activeExecution.scenarioRef, startedAt: current.activeExecution.startedAt, attemptOrdinal: current.activeExecution.ordinal, outcome: command.outcome, accepted: isAcceptedOutcome(stage, command.outcome), feedbackOutcomeKey: command.feedbackOutcomeKey, decisionSummary: { ...command.decisionSummary }, hintsUsed: current.activeAttempt?.hintsUsed ?? 0, mistakeCategoryIds: [...command.mistakeCategoryIds], score: command.score ? { ...command.score } : null, completedAt: command.completedAt };
      const next = { ...current, phase: 'feedback' as const, feedback: { executionId: current.activeExecution.executionId, attemptId: current.activeExecution.attemptId, stageId: stage.id, outcome: command.outcome, outcomeKey: command.feedbackOutcomeKey, feedbackRef: { ...stage.feedbackRef } }, stageOutcomes: [...current.stageOutcomes.filter((entry) => entry.stageId !== stage.id), summary], outcomeHistory: [...current.outcomeHistory, summary].slice(-JOURNEY_LESSON_OUTCOME_HISTORY_LIMIT), emittedAttemptIds: evidence ? [...current.emittedAttemptIds, String(current.activeExecution.attemptId)].filter((id, index, ids) => ids.indexOf(id) === index).slice(-JOURNEY_LESSON_EMITTED_ATTEMPT_ID_LIMIT) : current.emittedAttemptIds, latestTransitionAt: command.completedAt };
      return accepted(next, evidence ? [{ kind: 'emit_evidence', event: evidence }, { kind: 'present_feedback', sessionId: current.sessionId, stageId: stage.id, executionId: current.activeExecution.executionId, feedbackRef: stage.feedbackRef, outcomeKey: command.feedbackOutcomeKey, outcome: command.outcome }] : [{ kind: 'present_feedback', sessionId: current.sessionId, stageId: stage.id, executionId: current.activeExecution.executionId, feedbackRef: stage.feedbackRef, outcomeKey: command.feedbackOutcomeKey, outcome: command.outcome }]);
    }
    case 'acknowledge_feedback': {
      const feedbackIdentity = current.feedback ? { sessionId: current.sessionId, stageId: current.feedback.stageId, executionId: current.feedback.executionId, attemptId: current.feedback.attemptId } : null;
      const feedbackCorrelation = identityMatches(current, command.identity, feedbackIdentity);
      if (current.phase !== 'feedback' || !current.feedback || feedbackCorrelation || !stage || !isInteractive(stage)) return rejected(current, feedbackCorrelation ?? 'stale_execution', 'Feedback acknowledgement does not belong to the active result.');
      const failed = !isAcceptedOutcome(stage, current.feedback.outcome);
      if (failed && stage.failurePolicy === 'retry_required') return prepareRetry(current, definition, stage, command.timestamp);
      if (failed && stage.failurePolicy === 'finish_attempt') return accepted({ ...current, status: 'ended', phase: 'ended', activeExecution: null, activeAttempt: null, feedback: null, latestTransitionAt: command.timestamp, endedReason: 'Stage attempt finished without an accepted outcome.' }, [{ kind: 'lesson_ended', sessionId: current.sessionId, reason: 'Stage attempt finished without an accepted outcome.' }]);
      const completedStageIds = current.feedback && isAcceptedOutcome(stage, current.feedback.outcome) && !current.completedStageIds.includes(stage.id) ? [...current.completedStageIds, stage.id] : current.completedStageIds;
      const next = { ...current, completedStageIds, feedback: null };
      return finishOrAdvance(definition, next, command.timestamp, command.scorecardRequestId);
    }
    case 'retry_stage': {
      if (current.phase !== 'awaiting_retry' || !current.pendingRetry || current.pendingRetry.stageId !== command.identity.stageId || !stage || !isInteractive(stage)) return rejected(current, 'invalid_retry', 'Retry does not match the pending stage.');
      if (current.pendingRetry.policy.kind === 'controller_defined') return rejected(current, 'invalid_retry', 'Controller-defined retry requires an explicit resolution command.');
      const scenario = command.scenarioRef;
      if (!validId(scenario) || (current.pendingRetry.policy.kind === 'same_scenario' && scenario !== current.pendingRetry.priorScenarioRefs[current.pendingRetry.priorScenarioRefs.length - 1]) || (current.pendingRetry.policy.kind === 'fresh_variant' && current.pendingRetry.priorScenarioRefs.includes(scenario))) return rejected(current, 'invalid_retry', 'Resolved retry scenario does not satisfy the declared retry policy.');
      return startExecution({ ...current, pendingRetry: null, phase: 'presenting' }, stage, command.identity, command.startedAt, scenario);
    }
    case 'resolve_controller_retry': {
      if (current.phase !== 'awaiting_controller_retry' || !current.pendingRetry || current.pendingRetry.policy.kind !== 'controller_defined' || current.pendingRetry.stageId !== command.identity.stageId || !stage || !isInteractive(stage) || !validId(command.scenarioRef)) return rejected(current, 'invalid_retry', 'Controller retry resolution does not match the pending request.');
      return startExecution({ ...current, pendingRetry: null, phase: 'presenting' }, stage, command.identity, command.startedAt, command.scenarioRef);
    }
    case 'scorecard_evaluation_result': {
      if (current.phase !== 'awaiting_scorecard' || !current.pendingScorecardRequestId || command.requestId !== current.pendingScorecardRequestId) return rejected(current, 'stale_evaluation', 'Scorecard result does not match the active evaluation request.');
      if (!current.pendingScorecardRequestAt || Date.parse(command.timestamp) < Date.parse(current.pendingScorecardRequestAt)) return rejected(current, 'stale_timestamp', 'Scorecard result precedes the evaluation request.');
      if (command.passed) {
        const completed = completeSession({ ...current, pendingScorecardRequestId: null }, command.timestamp, 'scorecard');
        return accepted(completed.state, completed.effects);
      }
      if (definition.completion.kind !== 'scorecard') return rejected(current, 'illegal_transition', 'Scorecard result is not valid for this lesson.');
      if (definition.completion.failurePolicy.kind === 'end_session') return accepted({ ...current, status: 'ended', phase: 'ended', pendingScorecardRequestId: null, pendingScorecardRequestAt: null, completion: null, endedReason: 'Scorecard evaluation was not passed.', latestTransitionAt: command.timestamp }, [{ kind: 'lesson_ended', sessionId: current.sessionId, reason: 'Scorecard evaluation was not passed.' }]);
      return prepareRetryForStage({ ...current, pendingScorecardRequestId: null, pendingScorecardRequestAt: null }, definition, definition.completion.failurePolicy.stageId, command.timestamp);
    }
    case 'abandon': {
      if (current.status === 'completed' || current.status === 'abandoned') return rejected(current, 'illegal_transition', 'Lesson session is already terminal.');
      if (current.phase === 'awaiting_result' && stage?.evidenceRole === 'review' && (!Array.isArray(command.reviewReasonIds) || command.reviewReasonIds.length === 0 || command.reviewReasonIds.some((id) => !validId(id)))) return rejected(current, 'invalid_result', 'Review abandonment requires relevant review reason IDs.');
      const evidence = current.phase === 'awaiting_result' && current.activeExecution && !current.emittedAttemptIds.includes(String(current.activeExecution.attemptId)) && stage && isInteractive(stage) && stage.evidenceRole !== 'none' ? emitAttempt(current, stage, { kind: 'submit_result', identity: { sessionId: current.sessionId, stageId: current.activeExecution.stageId, executionId: current.activeExecution.executionId, attemptId: current.activeExecution.attemptId }, completedAt: command.timestamp, outcome: 'abandoned', feedbackOutcomeKey: 'abandoned', decisionSummary: { total: 0, correct: 0, incorrect: 0 }, mistakeCategoryIds: [], score: null, reviewReasonIds: command.reviewReasonIds ?? [] }, current.activeExecution) : null;
      const next = { ...current, status: 'abandoned' as const, phase: 'abandoned' as const, activeExecution: null, activeAttempt: null, feedback: null, latestTransitionAt: command.timestamp, endedReason: command.reason, emittedAttemptIds: evidence && current.activeExecution && !current.emittedAttemptIds.includes(String(current.activeExecution.attemptId)) ? [...current.emittedAttemptIds, String(current.activeExecution.attemptId)].slice(-JOURNEY_LESSON_EMITTED_ATTEMPT_ID_LIMIT) : current.emittedAttemptIds };
      if (evidence) {
        const errors = validateJourneyEvidenceEvent(evidence);
        if (errors.length > 0) return rejected(current, 'invalid_result', errors.join('\n'));
      }
      return accepted(next, [...(evidence ? [{ kind: 'emit_evidence', event: evidence } as JourneyLessonEffect] : []), { kind: 'lesson_ended', sessionId: current.sessionId, reason: command.reason }]);
    }
    default: return assertNever(command);
  }
}

function prepareRetryForStage(state: JourneyLessonSessionState, definition: JourneyLessonDefinition, stageId: string, timestamp: string): JourneyLessonTransitionResult {
  const targetIndex = definition.stages.findIndex((candidate) => candidate.id === stageId);
  const stage = definition.stages[targetIndex];
  if (targetIndex < 0 || !stage || !isInteractive(stage)) return rejected(state, 'invalid_retry', 'Retry target is not an interactive stage in the lesson definition.');
  const prior = state.scenarioHistoryByStageId[stage.id] ?? [];
  const pendingRetry: JourneyLessonRetryState = { stageId: stage.id, policy: stage.retry, priorScenarioRefs: [...prior], ordinal: (state.attemptOrdinalByStageId[stage.id] ?? 0) + 1 };
  const next = { ...state, currentStageIndex: targetIndex, currentStageId: stage.id, phase: stage.retry.kind === 'controller_defined' ? 'awaiting_controller_retry' as const : 'awaiting_retry' as const, pendingRetry, activeExecution: null, activeAttempt: null, activeScenarioRef: prior[prior.length - 1] ?? null, feedback: null, latestTransitionAt: timestamp };
  if (stage.retry.kind === 'fresh_variant') return accepted(next, [{ kind: 'request_fresh_variant', sessionId: state.sessionId, stageId: stage.id, variantSetId: stage.retry.variantSetId, priorScenarioRefs: prior, attemptOrdinal: pendingRetry.ordinal }]);
  if (stage.retry.kind === 'controller_defined') return accepted(next, [{ kind: 'request_controller_retry', sessionId: state.sessionId, stageId: stage.id, priorScenarioRefs: prior, attemptOrdinal: pendingRetry.ordinal }]);
  return accepted(next, [{ kind: 'retry_available', sessionId: state.sessionId, stageId: stage.id, policy: stage.retry }]);
}

function prepareRetry(state: JourneyLessonSessionState, definition: JourneyLessonDefinition, stage: Exclude<JourneyLessonStage, { kind: 'frame' | 'board_demo' }>, timestamp: string): JourneyLessonTransitionResult {
  return prepareRetryForStage(state, definition, stage.id, timestamp);
}

function finishOrAdvance(definition: JourneyLessonDefinition, state: JourneyLessonSessionState, timestamp: string, scorecardRequestId?: string): JourneyLessonTransitionResult {
  if (state.currentStageIndex < definition.stages.length - 1) {
    const advanced = advanceAfterStage(definition, state, timestamp);
    return accepted(advanced.state, advanced.effects);
  }
  const required = definition.completion.kind === 'required_stages' ? definition.completion.stageIds : definition.completion.requiredStageIds;
  if (!required.every((stageId) => state.completedStageIds.includes(stageId))) return accepted({ ...state, status: 'ended', phase: 'ended', latestTransitionAt: timestamp, endedReason: 'Required stages were not completed.' }, [{ kind: 'lesson_ended', sessionId: state.sessionId, reason: 'Required stages were not completed.' }]);
  if (definition.completion.kind === 'scorecard') {
    if (!validId(scorecardRequestId ?? '')) return rejected(state, 'invalid_command', 'A scorecard evaluation request ID is required before completion can be evaluated.');
    return accepted({ ...state, phase: 'awaiting_scorecard', pendingScorecardRequestId: scorecardRequestId!, pendingScorecardRequestAt: timestamp, activeExecution: null, activeAttempt: null, latestTransitionAt: timestamp }, [{ kind: 'request_scorecard_evaluation', sessionId: state.sessionId, requestId: scorecardRequestId!, requestedAt: timestamp, thresholdRef: definition.completion.aggregateThresholdRef, outcomes: state.outcomeHistory.map((outcome) => ({ ...outcome, decisionSummary: { ...outcome.decisionSummary }, score: outcome.score ? { ...outcome.score } : null, mistakeCategoryIds: [...outcome.mistakeCategoryIds] })) }]);
  }
  const completed = completeSession(state, timestamp, 'required_stages');
  return accepted(completed.state, completed.effects);
}

export type JourneyLessonSessionSnapshotResult =
  | { kind: 'valid'; state: JourneyLessonSessionState }
  | { kind: 'invalid'; errors: string[] };

export function parseJourneyLessonSessionSnapshot(value: unknown, definition: JourneyLessonDefinition): JourneyLessonSessionSnapshotResult {
  const errors = validateJourneyLessonDefinitionPrimitive(definition, defaultControllerValidationContext(definition));
  if (errors.length > 0) return { kind: 'invalid', errors: ['definition is invalid', ...errors] };
  if (!value || typeof value !== 'object') return { kind: 'invalid', errors: ['lesson session snapshot must be an object'] };
  const snapshot = value as Partial<JourneyLessonSessionState>;
  const out: string[] = [];
  if (snapshot.schemaVersion !== JOURNEY_LESSON_SESSION_SCHEMA_VERSION) out.push('unsupported session snapshot schema version');
  for (const key of ['sessionId', 'contentId', 'nodeId', 'skillId', 'definitionId'] as const) if (!validId(String(snapshot[key] ?? ''))) out.push(`missing ${key}`);
  if (snapshot.contentId !== definition.id || snapshot.definitionId !== definition.id) out.push('content/definition ID mismatch');
  if (snapshot.nodeId !== definition.nodeId) out.push('node ID mismatch');
  if (snapshot.contentVersion !== definition.contentVersion) out.push('content version mismatch');
  if (!['ready', 'active', 'completed', 'ended', 'abandoned'].includes(String(snapshot.status))) out.push('unknown session status');
  if (!['ready', 'presenting', 'awaiting_result', 'feedback', 'awaiting_retry', 'awaiting_controller_retry', 'awaiting_scorecard', 'completed', 'ended', 'abandoned'].includes(String(snapshot.phase))) out.push('unknown session phase');
  const phaseCompatibility: Record<string, string[]> = {
    ready: ['ready'], active: ['presenting', 'awaiting_result', 'feedback', 'awaiting_retry', 'awaiting_controller_retry', 'awaiting_scorecard'], completed: ['completed'], ended: ['ended'], abandoned: ['abandoned'],
  };
  if (snapshot.status && snapshot.phase && !phaseCompatibility[String(snapshot.status)]?.includes(String(snapshot.phase))) out.push('session status and phase are incompatible');
  if (!Number.isInteger(snapshot.currentStageIndex) || snapshot.currentStageIndex! < 0 || snapshot.currentStageIndex! >= definition.stages.length) out.push('invalid current stage index');
  if (Number.isInteger(snapshot.currentStageIndex) && snapshot.currentStageIndex! >= 0 && snapshot.currentStageIndex! < definition.stages.length && snapshot.currentStageId !== definition.stages[snapshot.currentStageIndex!].id) out.push('current stage ID does not match index');
  if (!Array.isArray(snapshot.completedStageIds) || new Set(snapshot.completedStageIds).size !== snapshot.completedStageIds.length || snapshot.completedStageIds.some((id) => !definition.stages.some((stage) => stage.id === id))) out.push('invalid completed stage IDs');
  if (!validTimestamp(String(snapshot.startedAt ?? '')) || !validTimestamp(String(snapshot.latestTransitionAt ?? ''))) out.push('invalid session timestamps');
  if (validTimestamp(String(snapshot.startedAt ?? '')) && validTimestamp(String(snapshot.latestTransitionAt ?? '')) && Date.parse(String(snapshot.latestTransitionAt)) < Date.parse(String(snapshot.startedAt))) out.push('latest transition precedes session start');
  if (!Array.isArray(snapshot.emittedAttemptIds) || snapshot.emittedAttemptIds.length > JOURNEY_LESSON_EMITTED_ATTEMPT_ID_LIMIT || new Set(snapshot.emittedAttemptIds).size !== snapshot.emittedAttemptIds.length || snapshot.emittedAttemptIds.some((id) => !validId(id))) out.push('invalid emitted attempt IDs');
  if (!Array.isArray(snapshot.usedExecutionIds) || snapshot.usedExecutionIds.length > JOURNEY_LESSON_EXECUTION_ID_LIMIT || new Set(snapshot.usedExecutionIds).size !== snapshot.usedExecutionIds.length || snapshot.usedExecutionIds.some((id) => !validId(id))) out.push('invalid execution ID history');
  if (!Array.isArray(snapshot.usedAttemptIds) || snapshot.usedAttemptIds.length > JOURNEY_LESSON_ATTEMPT_ID_LIMIT || new Set(snapshot.usedAttemptIds).size !== snapshot.usedAttemptIds.length || snapshot.usedAttemptIds.some((id) => !validId(id))) out.push('invalid attempt ID history');
  if (!snapshot.attemptOrdinalByStageId || typeof snapshot.attemptOrdinalByStageId !== 'object' || Object.entries(snapshot.attemptOrdinalByStageId).some(([stageId, ordinal]) => !definition.stages.some((stage) => stage.id === stageId) || !Number.isInteger(ordinal) || ordinal < 0)) out.push('invalid stage attempt ordinals');
  if (!snapshot.scenarioHistoryByStageId || typeof snapshot.scenarioHistoryByStageId !== 'object') out.push('scenario history is required');
  else for (const [stageId, refs] of Object.entries(snapshot.scenarioHistoryByStageId)) {
    if (!definition.stages.some((stage) => stage.id === stageId) || !Array.isArray(refs) || refs.length > JOURNEY_LESSON_SCENARIO_HISTORY_LIMIT || new Set(refs).size !== refs.length || refs.some((ref) => !validId(ref))) out.push(`invalid scenario history for stage ${stageId}`);
  }
  if (snapshot.currentStageId !== null && !definition.stages.some((stage) => stage.id === snapshot.currentStageId)) out.push('unknown current stage ID');
  if (snapshot.status === 'completed') {
    const required = definition.completion.kind === 'required_stages' ? definition.completion.stageIds : definition.completion.requiredStageIds;
    if (!required.every((stageId) => snapshot.completedStageIds?.includes(stageId))) out.push('completed snapshot does not satisfy completion rule');
  }
  if (snapshot.phase === 'feedback' && !snapshot.feedback) out.push('feedback phase requires feedback state');
  if (snapshot.phase === 'awaiting_result' && !snapshot.activeExecution) out.push('awaiting result requires active execution');
  if (snapshot.activeExecution) {
    const execution = snapshot.activeExecution;
    const executionStage = definition.stages.find((stage) => stage.id === execution.stageId);
    if (execution.sessionId !== snapshot.sessionId || !validId(execution.executionId) || !validId(String(execution.attemptId)) || !validId(execution.scenarioRef) || !validTimestamp(execution.startedAt)) out.push('invalid active execution');
    if (!executionStage || !isInteractive(executionStage)) out.push('active execution points to a non-interactive or unknown stage');
    if (!snapshot.activeAttempt || execution.stageId !== snapshot.activeAttempt.stageId || execution.executionId !== snapshot.activeAttempt.executionId || execution.attemptId !== snapshot.activeAttempt.attemptId) out.push('active execution and attempt identities do not match');
    if (snapshot.activeScenarioRef !== execution.scenarioRef) out.push('active scenario does not match execution');
    if (snapshot.attemptOrdinalByStageId?.[execution.stageId] !== execution.ordinal) out.push('active execution ordinal does not match stage ordinal');
    if (!snapshot.usedExecutionIds?.includes(execution.executionId)) out.push('active execution is missing from execution history');
    if (!snapshot.usedAttemptIds?.includes(String(execution.attemptId))) out.push('active attempt is missing from attempt history');
  }
  if (snapshot.activeAttempt && (!validId(String(snapshot.activeAttempt.attemptId)) || !validId(snapshot.activeAttempt.executionId) || !validId(snapshot.activeAttempt.stageId) || !validTimestamp(snapshot.activeAttempt.startedAt) || !Number.isInteger(snapshot.activeAttempt.hintsUsed) || snapshot.activeAttempt.hintsUsed < 0 || !Array.isArray(snapshot.activeAttempt.mistakeCategoryIds) || snapshot.activeAttempt.mistakeCategoryIds.some((id) => !validId(id)) || !Array.isArray(snapshot.activeAttempt.usedHintIds) || snapshot.activeAttempt.usedHintIds.length > JOURNEY_LESSON_HINT_ID_LIMIT || new Set(snapshot.activeAttempt.usedHintIds).size !== snapshot.activeAttempt.usedHintIds.length || snapshot.activeAttempt.usedHintIds.some((id) => !validId(id)))) out.push('invalid active attempt');
  if (Array.isArray(snapshot.stageOutcomes)) {
    const outcomeStageIds = new Set<string>();
    for (const outcome of snapshot.stageOutcomes) {
      if (!outcome || typeof outcome !== 'object' || !validId(outcome.stageId) || outcomeStageIds.has(outcome.stageId) || !definition.stages.some((stage) => stage.id === outcome.stageId) || !validId(outcome.executionId) || !validId(String(outcome.attemptId)) || !validTimestamp(outcome.completedAt) || !validId(outcome.feedbackOutcomeKey)) out.push('invalid stage outcome summary');
      outcomeStageIds.add(String(outcome?.stageId));
    }
  } else out.push('stage outcomes must be an array');
  if (!Array.isArray(snapshot.outcomeHistory) || snapshot.outcomeHistory.length > JOURNEY_LESSON_OUTCOME_HISTORY_LIMIT) out.push('invalid bounded outcome history');
  else {
    const outcomeIds = new Set<string>();
    let previousTime = -Infinity;
    for (const outcome of snapshot.outcomeHistory) {
      const stageDefinition = definition.stages.find((candidate) => candidate.id === outcome.stageId);
      const outcomeId = outcome.executionId;
      if (!stageDefinition || outcome.sessionId !== snapshot.sessionId || outcomeIds.has(outcomeId) || !validId(outcome.scenarioRef) || !validTimestamp(outcome.startedAt) || !validTimestamp(outcome.completedAt) || Date.parse(outcome.completedAt) < Date.parse(outcome.startedAt) || !['completed', 'passed', 'failed', 'abandoned'].includes(outcome.outcome) || outcome.accepted !== isAcceptedOutcome(stageDefinition, outcome.outcome) || !Number.isInteger(outcome.attemptOrdinal) || outcome.attemptOrdinal < 1 || !Number.isInteger(outcome.hintsUsed) || outcome.hintsUsed < 0 || !Array.isArray(outcome.mistakeCategoryIds) || outcome.mistakeCategoryIds.some((id) => !validId(id))) out.push('invalid outcome history entry');
      if (validTimestamp(outcome.completedAt) && Date.parse(outcome.completedAt) < previousTime) out.push('outcome history is not chronological');
      if (validTimestamp(outcome.completedAt)) previousTime = Date.parse(outcome.completedAt);
      outcomeIds.add(outcomeId);
    }
  }
  if (snapshot.feedback) {
    const feedbackStage = definition.stages.find((stage) => stage.id === snapshot.feedback?.stageId);
    if (!feedbackStage || !isInteractive(feedbackStage) || snapshot.feedback.executionId !== snapshot.activeExecution?.executionId || snapshot.feedback.attemptId !== snapshot.activeExecution?.attemptId || !validId(snapshot.feedback.outcomeKey)) out.push('invalid feedback state');
  } else if (snapshot.phase === 'feedback') out.push('feedback phase requires feedback state');
  if (snapshot.feedback && snapshot.phase !== 'feedback') out.push('feedback state exists outside feedback phase');
  if (snapshot.activeExecution && snapshot.phase !== 'awaiting_result' && snapshot.phase !== 'feedback') out.push('active execution exists outside execution or feedback phase');
  if (snapshot.phase === 'awaiting_retry' || snapshot.phase === 'awaiting_controller_retry') {
    if (!snapshot.pendingRetry) out.push('retry phase requires retry state');
    else {
      const retryStage = definition.stages.find((candidate) => candidate.id === snapshot.pendingRetry?.stageId);
      const history = snapshot.scenarioHistoryByStageId?.[snapshot.pendingRetry.stageId] ?? [];
      if (snapshot.pendingRetry.stageId !== snapshot.currentStageId || !retryStage || !isInteractive(retryStage) || JSON.stringify(retryStage.retry) !== JSON.stringify(snapshot.pendingRetry.policy) || (snapshot.pendingRetry.policy.kind === 'controller_defined' && snapshot.phase !== 'awaiting_controller_retry') || (snapshot.pendingRetry.policy.kind !== 'controller_defined' && snapshot.phase !== 'awaiting_retry') || !Array.isArray(snapshot.pendingRetry.priorScenarioRefs) || snapshot.pendingRetry.priorScenarioRefs.some((ref) => !validId(ref)) || new Set(snapshot.pendingRetry.priorScenarioRefs).size !== snapshot.pendingRetry.priorScenarioRefs.length || JSON.stringify(snapshot.pendingRetry.priorScenarioRefs) !== JSON.stringify(history) || !Number.isInteger(snapshot.pendingRetry.ordinal) || snapshot.pendingRetry.ordinal < 1) out.push('retry state is incompatible with stage policy');
    }
  }
  if (snapshot.phase === 'awaiting_scorecard') {
    if (definition.completion.kind !== 'scorecard') out.push('scorecard phase requires scorecard completion');
    if (!validId(snapshot.pendingScorecardRequestId ?? '') || !validTimestamp(snapshot.pendingScorecardRequestAt ?? '')) out.push('scorecard phase requires evaluation request ID and timestamp');
    const required = definition.completion.kind === 'scorecard' ? definition.completion.requiredStageIds : [];
    if (!required.every((stageId) => snapshot.completedStageIds?.includes(stageId))) out.push('scorecard evaluation requires completed required stages');
  }
  if (snapshot.phase !== 'awaiting_scorecard' && (snapshot.pendingScorecardRequestId !== null || snapshot.pendingScorecardRequestAt !== null)) out.push('scorecard request exists outside evaluation phase');
  if (snapshot.status === 'ready' && snapshot.lessonStartedEmitted) out.push('ready session cannot have emitted lesson start evidence');
  if (snapshot.status !== 'ready' && !snapshot.lessonStartedEmitted) out.push('started session must have emitted lesson start evidence');
  if (snapshot.status === 'completed' && (!snapshot.completion || !validTimestamp(snapshot.completion.completedAt))) out.push('completed session requires completion data');
  if (snapshot.status !== 'completed' && snapshot.completion) out.push('non-completed session cannot contain completion data');
  if ((snapshot.status === 'ended' || snapshot.status === 'abandoned') && !validId(snapshot.endedReason ?? '')) out.push('terminal ended/abandoned session requires a reason');
  if (snapshot.status === 'abandoned' && (snapshot.activeExecution || snapshot.feedback)) out.push('abandoned session cannot retain active execution or feedback');
  return out.length > 0 ? { kind: 'invalid', errors: out } : { kind: 'valid', state: JSON.parse(JSON.stringify(snapshot)) as JourneyLessonSessionState };
}
