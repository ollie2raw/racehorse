// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyJourneyEvidence,
} from './journeyEvidenceReducer.ts';
import {
  createJourneyLessonSession,
  parseJourneyLessonSessionSnapshot,
  transitionJourneyLessonSession,
  type JourneyLessonCommand,
  type JourneyLessonEffect,
  type JourneyLessonSessionState,
} from './journeyLessonController.ts';
import type {
  JourneyContentId,
  JourneyFeedbackId,
  JourneyLessonDefinition,
  JourneyNodeId,
  JourneySkillId,
} from './journeyContentContract.ts';
import type { JourneyLessonExecutionIdentity } from './journeyLessonController.ts';

const contentId = (value: string) => value as JourneyContentId;
const nodeId = (value: string) => value as JourneyNodeId;
const skillId = (value: string) => value as JourneySkillId;
const feedbackId = (value: string) => value as JourneyFeedbackId;
const feedback = { kind: 'outcome_bundle' as const, id: feedbackId('feedback:tempo') };
const t = (minutes: number) => `2026-07-11T10:${String(minutes).padStart(2, '0')}:00.000Z`;
const identity = (sessionId: string, stageId: string, executionId: string, attemptId: string): JourneyLessonExecutionIdentity => ({ sessionId, stageId, executionId, attemptId: attemptId as never });

function definition(overrides: Partial<JourneyLessonDefinition> = {}): JourneyLessonDefinition {
  return {
    id: contentId('premium:controller-test'),
    nodeId: nodeId('ch1-n02'),
    chapterId: 'ch1-fritz-trail',
    skillId: skillId('skill:tempo'),
    contentVersion: 1,
    ruleset: { kind: 'core_journey', id: 'racehorse-core-journey' },
    prerequisites: [],
    stages: [
      { id: 'frame', kind: 'frame', copyRef: 'copy:frame', evidenceRole: 'none' },
      { id: 'demo', kind: 'board_demo', scenarioRef: 'scenario:demo', evidenceRole: 'none' },
      { id: 'guided', kind: 'guided_practice', scenarioRef: 'scenario:guided', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'allow_continue' },
      { id: 'practice', kind: 'independent_practice', scenarioRef: 'scenario:practice', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: 'variants:practice' }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
      { id: 'mastery', kind: 'mastery', scenarioRef: 'scenario:mastery', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: 'variants:mastery' }, evidenceRole: 'proof', failurePolicy: 'retry_required' },
    ],
    completion: { kind: 'required_stages', stageIds: ['practice', 'mastery'], owner: 'journey_lesson_controller' },
    ...overrides,
  };
}

function send(state: JourneyLessonSessionState, command: JourneyLessonCommand, lesson = definition()): { state: JourneyLessonSessionState; effects: JourneyLessonEffect[] } {
  const result = transitionJourneyLessonSession(state, command, lesson);
  expect(result.kind).toBe('accepted');
  if (result.kind === 'rejected') throw new Error(result.error.message);
  return result;
}

function execute(state: JourneyLessonSessionState, stageId: string, executionId: string, attemptId: string, scenarioRef: string, outcome: 'completed' | 'passed' | 'failed', timestamp: string, lesson = definition()) {
  const next = send(state, { kind: 'begin_execution', identity: identity(state.sessionId, stageId, executionId, attemptId), startedAt: timestamp, scenarioRef }, lesson).state;
  return send(next, { kind: 'submit_result', identity: identity(state.sessionId, stageId, executionId, attemptId), completedAt: timestamp, outcome, feedbackOutcomeKey: outcome, decisionSummary: { total: 1, correct: outcome === 'failed' ? 0 : 1, incorrect: outcome === 'failed' ? 1 : 0 }, mistakeCategoryIds: outcome === 'failed' ? ['mistake:open-end'] : [], score: null }, lesson);
}

describe('Journey lesson session controller', () => {
  it('runs the ordered flow, gates feedback, and emits honest evidence', () => {
    const lesson = definition();
    let state = createJourneyLessonSession(lesson, { sessionId: 'session-1', startedAt: t(0) });
    let result = send(state, { kind: 'start', sessionId: 'session-1', timestamp: t(0) }, lesson);
    state = result.state;
    expect(result.effects.map((effect) => effect.kind)).toEqual(['emit_evidence', 'present_stage']);
    result = send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, lesson); state = result.state;
    result = send(state, { kind: 'continue_stage', stageId: 'demo', timestamp: t(2) }, lesson); state = result.state;
    expect(result.effects[0].kind).toBe('stage_ready');
    result = execute(state, 'guided', 'exec-guided', 'attempt-guided', 'scenario:guided', 'completed', t(3), lesson); state = result.state;
    expect(state.phase).toBe('feedback');
    expect(() => transitionJourneyLessonSession(state, { kind: 'continue_stage', stageId: 'guided', timestamp: t(4) }, lesson)).not.toThrow();
    state = send(state, { kind: 'acknowledge_feedback', identity: identity(state.sessionId, 'guided', 'exec-guided', 'attempt-guided'), timestamp: t(4) }, lesson).state;
    result = execute(state, 'practice', 'exec-practice', 'attempt-practice', 'scenario:practice', 'completed', t(5), lesson); state = result.state;
    const practiceEvidence = result.effects.find((effect) => effect.kind === 'emit_evidence');
    expect(practiceEvidence?.kind).toBe('emit_evidence');
    state = send(state, { kind: 'acknowledge_feedback', identity: identity(state.sessionId, 'practice', 'exec-practice', 'attempt-practice'), timestamp: t(6) }, lesson).state;
    result = execute(state, 'mastery', 'exec-mastery', 'attempt-mastery', 'scenario:mastery', 'failed', t(7), lesson); state = result.state;
    expect(result.effects.some((effect) => effect.kind === 'emit_evidence')).toBe(true);
    state = send(state, { kind: 'acknowledge_feedback', identity: identity(state.sessionId, 'mastery', 'exec-mastery', 'attempt-mastery'), timestamp: t(8) }, lesson).state;
    expect(state.phase).toBe('awaiting_retry');
    state = send(state, { kind: 'retry_stage', identity: identity(state.sessionId, 'mastery', 'exec-mastery-2', 'attempt-mastery-2'), startedAt: t(9), scenarioRef: 'scenario:mastery-variant' }, lesson).state;
    result = send(state, { kind: 'submit_result', identity: identity(state.sessionId, 'mastery', 'exec-mastery-2', 'attempt-mastery-2'), completedAt: t(10), outcome: 'passed', feedbackOutcomeKey: 'passed', decisionSummary: { total: 1, correct: 1, incorrect: 0 }, mistakeCategoryIds: [], score: null }, lesson);
    state = send(result.state, { kind: 'acknowledge_feedback', identity: identity(state.sessionId, 'mastery', 'exec-mastery-2', 'attempt-mastery-2'), timestamp: t(11) }, lesson).state;
    expect(state.status).toBe('completed');

    let evidence = applyJourneyEvidence(null, (send(createJourneyLessonSession(lesson, { sessionId: 'evidence', startedAt: t(0) }), { kind: 'start', sessionId: 'evidence', timestamp: t(0) }, lesson).effects[0] as Extract<JourneyLessonEffect, { kind: 'emit_evidence' }>).event);
    for (const effect of [...result.effects, ...([] as JourneyLessonEffect[])]) if (effect.kind === 'emit_evidence') evidence = applyJourneyEvidence(evidence, effect.event);
    expect(evidence.learningLevel).toBe('proven');
  });

  it('rejects stale execution results and hints', () => {
    const lesson = definition();
    let state = createJourneyLessonSession(lesson, { sessionId: 'session-stale', startedAt: t(0) });
    state = send(state, { kind: 'start', sessionId: 'session-stale', timestamp: t(0) }, lesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, lesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'demo', timestamp: t(2) }, lesson).state;
    state = send(state, { kind: 'begin_execution', identity: identity(state.sessionId, 'guided', 'exec-1', 'attempt-1'), startedAt: t(3), scenarioRef: 'scenario:guided' }, lesson).state;
    const stale = transitionJourneyLessonSession(state, { kind: 'record_hint', identity: identity(state.sessionId, 'guided', 'old-exec', 'attempt-1'), hintId: 'hint', timestamp: t(4) }, lesson);
    expect(stale.kind).toBe('rejected');
    const duplicate = transitionJourneyLessonSession(send(state, { kind: 'submit_result', identity: identity(state.sessionId, 'guided', 'exec-1', 'attempt-1'), completedAt: t(4), outcome: 'failed', feedbackOutcomeKey: 'mistake', decisionSummary: { total: 1, correct: 0, incorrect: 1 }, mistakeCategoryIds: [], score: null }, lesson).state, { kind: 'submit_result', identity: identity(state.sessionId, 'guided', 'exec-1', 'attempt-1'), completedAt: t(5), outcome: 'failed', feedbackOutcomeKey: 'mistake', decisionSummary: { total: 1, correct: 0, incorrect: 1 }, mistakeCategoryIds: [], score: null }, lesson);
    expect(duplicate.kind).toBe('rejected');
  });

  it('supports fresh variants, controller-defined retries, and finish-attempt failures', () => {
    const controllerLesson = definition({ stages: [definition().stages[0], { id: 'controller', kind: 'authored_scenario', scenarioRef: 'scenario:controller', feedbackRef: feedback, retry: { kind: 'controller_defined' }, evidenceRole: 'practice', failurePolicy: 'retry_required' }], completion: { kind: 'required_stages', stageIds: ['controller'], owner: 'journey_lesson_controller' } });
    let state = createJourneyLessonSession(controllerLesson, { sessionId: 'controller', startedAt: t(0) });
    state = send(state, { kind: 'start', sessionId: 'controller', timestamp: t(0) }, controllerLesson).state;
    let result = execute(send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, controllerLesson).state, 'controller', 'exec-1', 'attempt-1', 'scenario:controller', 'failed', t(2), controllerLesson);
    state = send(result.state, { kind: 'acknowledge_feedback', identity: identity(state.sessionId, 'controller', 'exec-1', 'attempt-1'), timestamp: t(3) }, controllerLesson).state;
    expect(state.phase).toBe('awaiting_controller_retry');
    state = send(state, { kind: 'resolve_controller_retry', identity: identity(state.sessionId, 'controller', 'exec-2', 'attempt-2'), startedAt: t(4), scenarioRef: 'scenario:controller-2' }, controllerLesson).state;
    expect(state.phase).toBe('awaiting_result');
    const finishLesson = definition({ stages: [definition().stages[0], { id: 'finish', kind: 'authored_scenario', scenarioRef: 'scenario:finish', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'practice', failurePolicy: 'finish_attempt' }], completion: { kind: 'required_stages', stageIds: ['finish'], owner: 'journey_lesson_controller' } });
    state = createJourneyLessonSession(finishLesson, { sessionId: 'finish', startedAt: t(0) });
    state = send(state, { kind: 'start', sessionId: 'finish', timestamp: t(0) }, finishLesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, finishLesson).state;
    result = execute(state, 'finish', 'exec-finish', 'attempt-finish', 'scenario:finish', 'failed', t(2), finishLesson);
    state = send(result.state, { kind: 'acknowledge_feedback', identity: identity(state.sessionId, 'finish', 'exec-finish', 'attempt-finish'), timestamp: t(3) }, finishLesson).state;
    expect(state.status).toBe('ended');
  });

  it('uses scorecard evaluation and strictly restores snapshots', () => {
    const lesson = definition({ completion: { kind: 'scorecard', requiredStageIds: ['practice', 'mastery'], keyDecisionIds: ['practice'], aggregateThresholdRef: 'threshold:test', failurePolicy: { kind: 'end_session' }, owner: 'journey_lesson_controller' } });
    let state = createJourneyLessonSession(lesson, { sessionId: 'snapshot', startedAt: t(0) });
    state = send(state, { kind: 'start', sessionId: 'snapshot', timestamp: t(0) }, lesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, lesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'demo', timestamp: t(2) }, lesson).state;
    const roundTrip = parseJourneyLessonSessionSnapshot(JSON.parse(JSON.stringify(state)), lesson);
    expect(roundTrip.kind).toBe('valid');
    expect(parseJourneyLessonSessionSnapshot({ ...state, contentVersion: 2 }, lesson)).toMatchObject({ kind: 'invalid' });
    state = send(state, { kind: 'begin_execution', identity: identity(state.sessionId, 'guided', 'exec-g', 'attempt-g'), startedAt: t(3), scenarioRef: 'scenario:guided' }, lesson).state;
    state = send(state, { kind: 'submit_result', identity: identity(state.sessionId, 'guided', 'exec-g', 'attempt-g'), completedAt: t(4), outcome: 'completed', feedbackOutcomeKey: 'ok', decisionSummary: { total: 1, correct: 1, incorrect: 0 }, mistakeCategoryIds: [], score: null }, lesson).state;
    expect(parseJourneyLessonSessionSnapshot(JSON.parse(JSON.stringify(state)), lesson)).toMatchObject({ kind: 'valid' });
  });

  it('uses the authored scorecard retry target instead of retrying the final stage', () => {
    const base = definition();
    const lesson = definition({
      stages: [base.stages[0], base.stages[2], base.stages[4]],
      completion: { kind: 'scorecard', requiredStageIds: ['guided', 'mastery'], keyDecisionIds: ['guided'], aggregateThresholdRef: 'threshold:test', failurePolicy: { kind: 'retry_stage', stageId: 'guided' }, owner: 'journey_lesson_controller' },
    });
    let state = createJourneyLessonSession(lesson, { sessionId: 'scorecard-retry', startedAt: t(0) });
    state = send(state, { kind: 'start', sessionId: 'scorecard-retry', timestamp: t(0) }, lesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, lesson).state;
    let result = execute(state, 'guided', 'decision-1', 'attempt-1', 'scenario:guided', 'passed', t(2), lesson);
    state = send(result.state, { kind: 'acknowledge_feedback', identity: identity(state.sessionId, 'guided', 'decision-1', 'attempt-1'), timestamp: t(3) }, lesson).state;
    result = execute(state, 'mastery', 'mastery-1', 'attempt-2', 'scenario:mastery', 'passed', t(4), lesson);
    state = send(result.state, { kind: 'acknowledge_feedback', identity: identity(state.sessionId, 'mastery', 'mastery-1', 'attempt-2'), timestamp: t(5), scorecardRequestId: 'evaluation-1' }, lesson).state;
    expect(state.phase).toBe('awaiting_scorecard');
    state = send(state, { kind: 'scorecard_evaluation_result', sessionId: 'scorecard-retry', requestId: 'evaluation-1', passed: false, timestamp: t(6) }, lesson).state;
    expect(state.currentStageId).toBe('guided');
    expect(state.pendingRetry?.stageId).toBe('guided');
    expect(state.phase).toBe('awaiting_retry');
  });

  it('abandons without evidence before execution and emits one abandoned attempt during execution', () => {
    const lesson = definition({ stages: [definition().stages[0], { id: 'practice', kind: 'independent_practice', scenarioRef: 'scenario:practice', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'practice', failurePolicy: 'finish_attempt' }], completion: { kind: 'required_stages', stageIds: ['practice'], owner: 'journey_lesson_controller' } });
    let state = createJourneyLessonSession(lesson, { sessionId: 'abandon', startedAt: t(0) });
    state = send(state, { kind: 'start', sessionId: 'abandon', timestamp: t(0) }, lesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, lesson).state;
    let result = transitionJourneyLessonSession(state, { kind: 'abandon', timestamp: t(2), reason: 'left' }, lesson);
    expect(result.kind).toBe('accepted');
    if (result.kind === 'accepted') expect(result.effects.some((effect) => effect.kind === 'emit_evidence')).toBe(false);
    state = send(createJourneyLessonSession(lesson, { sessionId: 'abandon-active', startedAt: t(0) }), { kind: 'start', sessionId: 'abandon-active', timestamp: t(0) }, lesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, lesson).state;
    state = send(state, { kind: 'begin_execution', identity: identity(state.sessionId, 'practice', 'exec', 'attempt'), startedAt: t(2), scenarioRef: 'scenario:practice' }, lesson).state;
    result = transitionJourneyLessonSession(state, { kind: 'abandon', timestamp: t(3), reason: 'quit' }, lesson);
    expect(result.kind).toBe('accepted');
    if (result.kind === 'accepted') {
      expect(result.effects.filter((effect) => effect.kind === 'emit_evidence')).toHaveLength(1);
      const repeated = transitionJourneyLessonSession(result.state, { kind: 'abandon', timestamp: t(4), reason: 'again' }, lesson);
      expect(repeated.kind).toBe('rejected');
    }
  });

  it('does not accept generic completion for proof stages', () => {
    const lesson = definition({ stages: [definition().stages[0], definition().stages[4]], completion: { kind: 'required_stages', stageIds: ['mastery'], owner: 'journey_lesson_controller' } });
    let state = createJourneyLessonSession(lesson, { sessionId: 'proof', startedAt: t(0) });
    state = send(state, { kind: 'start', sessionId: 'proof', timestamp: t(0) }, lesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, lesson).state;
    const result = execute(state, 'mastery', 'proof-exec', 'proof-attempt', 'scenario:mastery', 'completed', t(2), lesson);
    expect(result.state.completedStageIds).not.toContain('mastery');
    const evidence = result.effects.find((effect) => effect.kind === 'emit_evidence');
    expect(evidence?.kind).toBe('emit_evidence');
    if (evidence?.kind === 'emit_evidence' && evidence.event.kind === 'attempt_recorded') expect(evidence.event.attempt.result).toBe('completed');
    state = send(result.state, { kind: 'acknowledge_feedback', identity: identity('proof', 'mastery', 'proof-exec', 'proof-attempt'), timestamp: t(3) }, lesson).state;
    expect(state.status).not.toBe('completed');
  });

  it('rejects definition and execution identity drift', () => {
    const lesson = definition();
    let state = createJourneyLessonSession(lesson, { sessionId: 'identity', startedAt: t(0) });
    state = send(state, { kind: 'start', sessionId: 'identity', timestamp: t(0) }, lesson).state;
    const wrongDefinition = definition({ id: contentId('premium:other') });
    expect(transitionJourneyLessonSession(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, wrongDefinition)).toMatchObject({ kind: 'rejected', error: { code: 'definition_mismatch' } });
    state = send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, lesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'demo', timestamp: t(2) }, lesson).state;
    state = send(state, { kind: 'begin_execution', identity: identity('identity', 'guided', 'exec', 'attempt'), startedAt: t(3), scenarioRef: 'scenario:guided' }, lesson).state;
    expect(transitionJourneyLessonSession(state, { kind: 'record_hint', identity: identity('other-session', 'guided', 'exec', 'attempt'), hintId: 'hint', timestamp: t(4) }, lesson)).toMatchObject({ kind: 'rejected', error: { code: 'stale_session' } });
    expect(transitionJourneyLessonSession(state, { kind: 'submit_result', identity: identity('identity', 'guided', 'exec', 'other-attempt'), completedAt: t(4), outcome: 'completed', feedbackOutcomeKey: 'ok', decisionSummary: { total: 1, correct: 1, incorrect: 0 }, mistakeCategoryIds: [], score: null }, lesson)).toMatchObject({ kind: 'rejected', error: { code: 'stale_attempt' } });
  });

  it('deduplicates hints and preserves stage-specific retry history', () => {
    const lesson = definition({ stages: [definition().stages[0], definition().stages[3]], completion: { kind: 'required_stages', stageIds: ['practice'], owner: 'journey_lesson_controller' } });
    let state = createJourneyLessonSession(lesson, { sessionId: 'history', startedAt: t(0) });
    state = send(state, { kind: 'start', sessionId: 'history', timestamp: t(0) }, lesson).state;
    state = send(state, { kind: 'continue_stage', stageId: 'frame', timestamp: t(1) }, lesson).state;
    state = send(state, { kind: 'begin_execution', identity: identity('history', 'practice', 'exec-1', 'attempt-1'), startedAt: t(2), scenarioRef: 'scenario-1' }, lesson).state;
    state = send(state, { kind: 'record_hint', identity: identity('history', 'practice', 'exec-1', 'attempt-1'), hintId: 'hint-1', timestamp: t(3) }, lesson).state;
    state = send(state, { kind: 'record_hint', identity: identity('history', 'practice', 'exec-1', 'attempt-1'), hintId: 'hint-1', timestamp: t(4) }, lesson).state;
    expect(state.activeAttempt?.hintsUsed).toBe(1);
    let result = send(state, { kind: 'submit_result', identity: identity('history', 'practice', 'exec-1', 'attempt-1'), completedAt: t(5), outcome: 'failed', feedbackOutcomeKey: 'failed', decisionSummary: { total: 1, correct: 0, incorrect: 1 }, mistakeCategoryIds: ['mistake:one'], score: null }, lesson);
    state = send(result.state, { kind: 'acknowledge_feedback', identity: identity('history', 'practice', 'exec-1', 'attempt-1'), timestamp: t(6) }, lesson).state;
    expect(state.pendingRetry?.priorScenarioRefs).toEqual(['scenario-1']);
    state = send(state, { kind: 'retry_stage', identity: identity('history', 'practice', 'exec-2', 'attempt-2'), startedAt: t(7), scenarioRef: 'scenario-2' }, lesson).state;
    expect(state.activeExecution?.ordinal).toBe(2);
    result = send(state, { kind: 'submit_result', identity: identity('history', 'practice', 'exec-2', 'attempt-2'), completedAt: t(8), outcome: 'failed', feedbackOutcomeKey: 'failed', decisionSummary: { total: 1, correct: 0, incorrect: 1 }, mistakeCategoryIds: ['mistake:one'], score: null }, lesson);
    state = send(result.state, { kind: 'acknowledge_feedback', identity: identity('history', 'practice', 'exec-2', 'attempt-2'), timestamp: t(9) }, lesson).state;
    expect(state.pendingRetry?.priorScenarioRefs).toEqual(['scenario-1', 'scenario-2']);
    expect(state.outcomeHistory.map((outcome) => outcome.outcome)).toEqual(['failed', 'failed']);
    expect(state.attemptOrdinalByStageId.practice).toBe(2);
    expect(transitionJourneyLessonSession(state, { kind: 'retry_stage', identity: identity('history', 'practice', 'exec-3', 'attempt-3'), startedAt: t(10), scenarioRef: 'scenario-1' }, lesson)).toMatchObject({ kind: 'rejected', error: { code: 'invalid_retry' } });
  });
});
