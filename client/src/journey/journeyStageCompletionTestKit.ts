import { expect, vi } from 'vitest';
/**
 * The durable lesson / sprint completion contract (Stage 2, phases 1–2).
 *
 * WHAT IS REAL: the lesson controller (`transitionJourneyLessonSession`) drives every lesson here — a completed
 * session, a half-played one, an abandoned one are all produced by the controller, never hand-built; the
 * production lesson definitions and sprint puzzle sets; the attempt log; the pending-completion records; and
 * the recovery entry point the trail uses (mounting `useJourneyProgress`).
 * WHAT IS SIMULATED: a crash is "the page stops after step N of register → settle → apply → clear", then a
 * fresh module instance over the same `localStorage` (`vi.resetModules()`); a lost progress write is a
 * `localStorage` wrapper that swallows the write. Forged records are written straight into storage, because
 * forging one means bypassing the write path.
 */

export const LESSON_NODE = 'ch1-n07'; // Read the Gate — open-end-discipline, the first, always-unlocked stage
export const SECOND_LESSON_NODE = 'ch1-n08'; // Count the Yard — counting-whats-left, needs earlier stages complete
export const SPRINT_NODE = 'ch1-n05'; // Quick Reads
export const PRIOR_OF_SPRINT = ['ch1-n07', 'ch1-n02', 'ch1-n11', 'ch1-n08', 'ch1-n04'];
export const PRIOR_OF_SECOND_LESSON = ['ch1-n07', 'ch1-n02', 'ch1-n11'];

export async function openTab() {
  vi.resetModules();
  const attempts = await import('./journeyAttempts');
  const outcome = await import('./journeyMatchOutcome');
  const recovery = await import('./journeyCompletionRecovery');
  const storage = await import('./journeyStorage');
  const pending = await import('./journeyPendingCompletions');
  const stage = await import('./journeyStageCompletion');
  const controller = await import('./journeyLessonController');
  const resolver = await import('./journeyContentResolver');
  const sprints = await import('./journeyPuzzleSprints');
  const scope = await import('./journeyStorageScope');
  const rtl = await import('@testing-library/react');
  const hook = await import('./useJourneyProgress');
  scope.setJourneyStorageUser(null);
  const mountTrail = () => rtl.renderHook(() => hook.useJourneyProgress()).result.current;
  return { attempts, outcome, recovery, storage, pending, stage, controller, resolver, sprints, scope, mountTrail };
}
export type Tab = Awaited<ReturnType<typeof openTab>>;

export const completedIds = (tab: Tab) => tab.storage.loadJourneyProgress().chapters['ch1-fritz-trail']?.completedNodeIds ?? [];
export const pendingFor = (tab: Tab) => tab.pending.listPendingCompletions();
export const attemptOf = (tab: Tab, id: string) => tab.attempts.loadJourneyAttempts().find((attempt) => attempt.attemptId === id);
export const complete = (tab: Tab, ids: string[]) => ids.forEach((id) => tab.storage.markJourneyNodeCompleted(id));

export function definitionFor(tab: Tab, nodeId: string) {
  const descriptor = tab.resolver.getJourneyContentDescriptor(nodeId)!;
  return tab.resolver.getJourneyLessonDefinition(String((descriptor as { contentId: string }).contentId))!;
}

// ---------------------------------------------------------------- real lesson play, via the controller

export type Script = {
  /** Outcome for the n-th execution (1-based) of a stage. Defaults to passing every position first time. */
  outcome?: (stageId: string, ordinal: number) => 'passed' | 'failed';
  /** Stop (leave the session active) when this stage becomes the current one. */
  stopAtStageId?: string;
  /** Stop in the middle of a stage: after its first execution begins, before a result is submitted. */
  stopMidExecutionOf?: string;
  /** Abandon through the controller after this many steps. */
  abandonAfterSteps?: number;
  /** Session id (default `session:test`). */
  sessionId?: string;
  /** When the session begins, ms since epoch. Default: shortly AFTER now, i.e. after any attempt started so far. */
  startMs?: number;
};

export function playLesson(tab: Tab, definition: ReturnType<typeof definitionFor>, script: Script = {}) {
  const ctl = tab.controller;
  let clock = 0;
  const base = script.startMs ?? Date.now() + 60_000;
  const at = () => new Date(base + 1000 * clock++).toISOString();
  let ids = 0;
  const nextIds = () => { ids += 1; return { executionId: `exec:${ids}`, attemptId: `att:${ids}` as never }; };
  const send = (state: ReturnType<typeof ctl.createJourneyLessonSession>, command: Parameters<typeof ctl.transitionJourneyLessonSession>[1]) => {
    const result = ctl.transitionJourneyLessonSession(state, command, definition);
    if (result.kind === 'rejected') throw new Error(`controller rejected ${command.kind}: ${result.error.message}`);
    return result.state;
  };
  let state = ctl.createJourneyLessonSession(definition, { sessionId: script.sessionId ?? 'session:test', startedAt: at() });
  state = send(state, { kind: 'start', sessionId: state.sessionId, timestamp: at() });
  for (let step = 0; step < 400 && state.status === 'active'; step += 1) {
    if (script.abandonAfterSteps === step) return send(state, { kind: 'abandon', timestamp: at(), reason: 'player left' });
    const stage = definition.stages[state.currentStageIndex];
    if (script.stopAtStageId && stage.id === script.stopAtStageId && state.phase === 'presenting') return state;
    if (state.phase === 'presenting') {
      if (stage.kind === 'frame' || stage.kind === 'board_demo') {
        state = send(state, { kind: 'continue_stage', stageId: stage.id, timestamp: at() });
      } else {
        const { executionId, attemptId } = nextIds();
        state = send(state, { kind: 'begin_execution', identity: { sessionId: state.sessionId, stageId: stage.id, executionId, attemptId }, startedAt: at(), scenarioRef: `scn:${stage.id}:${ids}` });
        if (script.stopMidExecutionOf === stage.id) return state;
      }
    } else if (state.phase === 'awaiting_result') {
      const execution = state.activeExecution!;
      const outcome = script.outcome?.(execution.stageId, execution.ordinal) ?? 'passed';
      state = send(state, {
        kind: 'submit_result',
        identity: { sessionId: state.sessionId, stageId: execution.stageId, executionId: execution.executionId, attemptId: execution.attemptId },
        completedAt: at(), outcome, feedbackOutcomeKey: `feedback:${outcome}`,
        decisionSummary: outcome === 'passed' ? { total: 1, correct: 1, incorrect: 0 } : { total: 1, correct: 0, incorrect: 1 },
        mistakeCategoryIds: [], score: null,
      });
    } else if (state.phase === 'feedback') {
      const feedback = state.feedback!;
      state = send(state, { kind: 'acknowledge_feedback', identity: { sessionId: state.sessionId, stageId: feedback.stageId, executionId: feedback.executionId, attemptId: feedback.attemptId }, timestamp: at() });
    } else if (state.phase === 'awaiting_retry') {
      const retry = state.pendingRetry!;
      const { executionId, attemptId } = nextIds();
      const scenarioRef = retry.policy.kind === 'same_scenario' ? retry.priorScenarioRefs[retry.priorScenarioRefs.length - 1] : `scn:${retry.stageId}:retry:${ids}`;
      state = send(state, { kind: 'retry_stage', identity: { sessionId: state.sessionId, stageId: retry.stageId, executionId, attemptId }, startedAt: at(), scenarioRef });
    } else {
      throw new Error(`driver cannot continue from phase ${state.phase}`);
    }
  }
  return state;
}

/** What the screen does when a lesson starts: an attempt carrying the identity stamps, owned by this page. */
export function startLessonAttempt(tab: Tab, nodeId = LESSON_NODE) {
  const definition = definitionFor(tab, nodeId);
  return tab.attempts.startJourneyAttempt({
    nodeId, kind: 'lesson',
    detail: tab.stage.journeyStageAttemptDetail(nodeId, { contentId: String(definition.id), replay: false }),
  }).attemptId;
}
export function startSprintAttempt(tab: Tab, nodeId = SPRINT_NODE) {
  return tab.attempts.startJourneyAttempt({ nodeId, kind: 'sprint', detail: tab.stage.journeyStageAttemptDetail(nodeId) }).attemptId;
}

/** A lesson win whose completion was never applied: steps 1–2 happened, the page died before step 3. */
export function owedLessonWin(tab: Tab, nodeId = LESSON_NODE) {
  const definition = definitionFor(tab, nodeId);
  const attemptId = startLessonAttempt(tab, nodeId);
  const proof = tab.stage.buildJourneyLessonCompletionProof(playLesson(tab, definition), definition)!;
  expect(tab.pending.registerPendingCompletion(attemptId, nodeId)).toBe(true);
  expect(tab.attempts.settleJourneyAttempt(attemptId, 'won', { completionProof: JSON.stringify(proof), retries: proof.retries, sessionId: proof.sessionId }).changed).toBe(true);
  return attemptId;
}
export function owedSprintWin(tab: Tab, nodeId = SPRINT_NODE) {
  const attemptId = startSprintAttempt(tab, nodeId);
  const total = tab.sprints.getJourneyPuzzleSprint(nodeId)!.length;
  expect(tab.pending.registerPendingCompletion(attemptId, nodeId)).toBe(true);
  expect(tab.attempts.settleJourneyAttempt(attemptId, 'won', { correct: total, total }).changed).toBe(true);
  return attemptId;
}

export function hookStorageWrites(onWrite: (key: string, value: string, write: () => void) => void): () => void {
  const real = window.localStorage;
  const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const wrapper = {
    get length() { return real.length; },
    key: (index: number) => real.key(index),
    getItem: (key: string) => real.getItem(key),
    removeItem: (key: string) => real.removeItem(key),
    clear: () => real.clear(),
    setItem: (key: string, value: string) => onWrite(key, value, () => real.setItem(key, value)),
  } as unknown as Storage;
  Object.defineProperty(window, 'localStorage', { configurable: true, value: wrapper });
  return () => {
    if (own) Object.defineProperty(window, 'localStorage', own);
    else delete (window as unknown as Record<string, unknown>).localStorage;
  };
}
/** Swallows the next `count` progress writes — a progress write that lost a race, or failed. */
export function dropProgressWrites(count: number) {
  let left = count;
  return hookStorageWrites((key, _value, write) => {
    if (key.startsWith('rh_journey_progress_v1') && left > 0) { left -= 1; return; }
    write();
  });
}

export function seedAttempt(tab: Tab, record: Record<string, unknown>) {
  window.localStorage.setItem(tab.attempts.getJourneyAttemptStorageKey(String(record.attemptId)), JSON.stringify(record));
}
export function forgedLessonAttempt(tab: Tab, over: Record<string, unknown> = {}, detail: Record<string, unknown> = {}, nodeId = LESSON_NODE) {
  const definition = definitionFor(tab, nodeId);
  const proof = tab.stage.buildJourneyLessonCompletionProof(playLesson(tab, definition), definition)!;
  return {
    attemptId: 'jat_forged', nodeId, kind: 'lesson', outcome: 'won',
    startedAt: '2026-03-01T12:00:00.000Z', endedAt: '2026-03-01T12:10:00.000Z', ownerId: null, heartbeatAt: null,
    detail: { stage: titleOf(nodeId), contentId: String(definition.id), chapterLayout: 2, completionProof: JSON.stringify(proof), sessionId: proof.sessionId, ...detail },
    ...over,
  };
}
export function titleOf(nodeId: string) {
  return { 'ch1-n07': 'Read the Gate', 'ch1-n08': 'Count the Yard', 'ch1-n05': 'Quick Reads' }[nodeId] as string;
}
export function seedForgedWin(tab: Tab, record: Record<string, unknown>, nodeId = LESSON_NODE) {
  seedAttempt(tab, record);
  expect(tab.pending.registerPendingCompletion(String(record.attemptId), nodeId)).toBe(true);
}
