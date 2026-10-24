// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlacementPosition } from '../../../types.ts';
import { resolveJourneyAuthoredVariant } from '../../journeyAuthoredLessonRegistry.ts';
import {
  createJourneyLessonSession,
  transitionJourneyLessonSession,
  type JourneyLessonCommand,
  type JourneyLessonSessionState,
} from '../../journeyLessonController.ts';
import { JourneyLessonHost } from '../../lessonHost/JourneyLessonHost.tsx';
import { buildJourneyLessonCompletionProof } from '../../journeyStageCompletion.ts';
import { classifyJourneyLessonCompletion } from '../../journeyLessonCompletionStatus.ts';
import {
  attemptOf,
  complete,
  completedIds,
  definitionFor,
  openTab,
  pendingFor,
  startLessonAttempt,
  type Tab,
} from '../../journeyStageCompletionTestKit.ts';
import { GREEDY_HANDS_BUNDLE } from './greedyHandsBundle.ts';
import { GREEDY_HANDS_LESSON_DEFINITION } from './greedyHandsLesson.ts';
import { GREEDY_HANDS_RETRY_CYCLES, type GreedyHandsScenario } from './greedyHandsScenarios.ts';

/**
 * Greedy Hands through the REAL pieces: the lesson controller, the bundle's evaluator and the host's own retry
 * resolution (`resolveJourneyAuthoredVariant`), the real host UI, and the accepted completion/recovery contract.
 */

const NODE = 'ch1-n11';
const UNLOCKED_BEFORE = ['ch1-n07', 'ch1-n02']; // Greedy Hands unlocks after Dot's Table

type Pick = 'accepted' | 'tempting' | 'other' | 'wrong';
type Visit = { stageId: string; scenarioId: string; pick: Pick; result: string };

const scenarioById = (id: string) => GREEDY_HANDS_BUNDLE.scenarios[id] as GreedyHandsScenario;
const actionOf = (key: string) => {
  const [, low, high, position] = /^(\d)-(\d)@(left|right)$/.exec(key)!;
  return { tile: { low: Number(low), high: Number(high) }, position: position as PlacementPosition };
};
function keyFor(scenario: GreedyHandsScenario, pick: Pick): string {
  if (pick === 'accepted') return scenario.greedy.acceptedKey;
  if (pick === 'tempting') return scenario.greedy.temptingKey;
  const other = Object.keys(scenario.greedy.lines).find((key) => key !== scenario.greedy.acceptedKey && key !== scenario.greedy.temptingKey);
  if (pick === 'wrong') return other ?? scenario.greedy.temptingKey; // any wrong answer: a third play if there is one
  if (!other) throw new Error(`${scenario.id} has no third legal play`);
  return other;
}

/** Plays the lesson with the controller exactly as the host does; `choose` decides each answer. */
function playGreedyHands(choose: (visit: { stageId: string; scenarioId: string; visits: number }) => Pick, startMs = Date.now() + 60_000) {
  const definition = GREEDY_HANDS_LESSON_DEFINITION;
  let clock = 0;
  const at = () => new Date(startMs + clock++ * 1000).toISOString();
  let counter = 0;
  const nextIds = () => { counter += 1; return { executionId: `exec:${counter}`, attemptId: `att:${counter}` as never }; };
  const send = (state: JourneyLessonSessionState, command: JourneyLessonCommand) => {
    const result = transitionJourneyLessonSession(state, command, definition);
    if (result.kind === 'rejected') throw new Error(`controller rejected ${command.kind}: ${result.error.message}`);
    return result.state;
  };
  let state = createJourneyLessonSession(definition, { sessionId: 'session:greedy-test', startedAt: at() });
  state = send(state, { kind: 'start', sessionId: state.sessionId, timestamp: at() });
  const visits: Visit[] = [];
  const perStage: Record<string, number> = {};
  let exhausted = false;
  for (let step = 0; step < 300 && state.status === 'active' && !exhausted; step += 1) {
    const stage = definition.stages[state.currentStageIndex];
    if (state.phase === 'presenting') {
      if (stage.kind === 'frame' || stage.kind === 'board_demo') {
        state = send(state, { kind: 'continue_stage', stageId: stage.id, timestamp: at() });
      } else {
        const { executionId, attemptId } = nextIds();
        state = send(state, { kind: 'begin_execution', identity: { sessionId: state.sessionId, stageId: stage.id, executionId, attemptId }, startedAt: at(), scenarioRef: stage.scenarioRef });
      }
    } else if (state.phase === 'awaiting_result') {
      const execution = state.activeExecution!;
      const scenario = scenarioById(execution.scenarioRef);
      perStage[execution.stageId] = (perStage[execution.stageId] ?? 0) + 1;
      const pick = choose({ stageId: execution.stageId, scenarioId: scenario.id, visits: perStage[execution.stageId] });
      const evaluation = GREEDY_HANDS_BUNDLE.evaluateResponse(scenario, { kind: 'move', action: actionOf(keyFor(scenario, pick)) });
      if (evaluation.kind !== 'evaluated' || !evaluation.result) throw new Error('evaluation failed');
      visits.push({ stageId: execution.stageId, scenarioId: scenario.id, pick, result: evaluation.result });
      state = send(state, {
        kind: 'submit_result',
        identity: { sessionId: state.sessionId, stageId: execution.stageId, executionId: execution.executionId, attemptId: execution.attemptId },
        completedAt: at(), outcome: evaluation.result, feedbackOutcomeKey: evaluation.feedbackOutcomeKey,
        decisionSummary: evaluation.decisionSummary, mistakeCategoryIds: evaluation.mistakeCategoryIds, score: null,
      });
    } else if (state.phase === 'feedback') {
      const feedback = state.feedback!;
      state = send(state, { kind: 'acknowledge_feedback', identity: { sessionId: state.sessionId, stageId: feedback.stageId, executionId: feedback.executionId, attemptId: feedback.attemptId }, timestamp: at() });
    } else if (state.phase === 'awaiting_retry') {
      const retry = state.pendingRetry!;
      const previous = retry.priorScenarioRefs;
      const resolved = retry.policy.kind === 'fresh_variant'
        ? resolveJourneyAuthoredVariant(GREEDY_HANDS_BUNDLE, retry.policy.variantSetId, previous)
        : { kind: 'resolved' as const, scenario: scenarioById(previous[previous.length - 1]) };
      if (resolved.kind !== 'resolved') { exhausted = true; break; }
      const { executionId, attemptId } = nextIds();
      state = send(state, { kind: 'retry_stage', identity: { sessionId: state.sessionId, stageId: retry.stageId, executionId, attemptId }, startedAt: at(), scenarioRef: resolved.scenario.id });
    } else {
      throw new Error(`cannot continue from phase ${state.phase}`);
    }
  }
  return { state, visits, exhausted };
}

const firstTry = (): Pick => 'accepted';
const sequence = (visits: Visit[]) => visits.map((visit) => `${visit.stageId}:${visit.scenarioId.replace('scenario:greedy-', '')}:${visit.result}`);

describe('Greedy Hands follows the lesson controller contract', () => {
  it('a clean run meets one position per decision stage, guided → cost → take-it → proof, and completes', () => {
    const { state, visits } = playGreedyHands(firstTry);
    expect(state.status).toBe('completed');
    expect(sequence(visits)).toEqual([
      'guided-decision:guided:completed',
      'independent-practice:practice-cost-1:completed',
      'practice-take:practice-take-1:completed',
      'proof:proof-1:passed',
    ]);
    const proof = buildJourneyLessonCompletionProof(state, GREEDY_HANDS_LESSON_DEFINITION)!;
    expect(proof.stages.map((stage) => stage.stageId)).toEqual(['independent-practice', 'practice-take', 'proof']);
    expect(proof.retries).toBe(0);
  });

  it('a wrong guided answer retries the SAME position and does not advance until it is answered', () => {
    const { state, visits } = playGreedyHands(({ stageId, visits: n }) => (stageId === 'guided-decision' && n < 3 ? 'tempting' : 'accepted'));
    expect(state.status).toBe('completed');
    const guided = visits.filter((visit) => visit.stageId === 'guided-decision');
    expect(guided.map((visit) => visit.scenarioId)).toEqual(['scenario:greedy-guided', 'scenario:greedy-guided', 'scenario:greedy-guided']);
    expect(guided.map((visit) => visit.result)).toEqual(['failed', 'failed', 'completed']);
    expect(buildJourneyLessonCompletionProof(state, GREEDY_HANDS_LESSON_DEFINITION)!.retries).toBe(0); // the guided stage is not a required stage
  });

  it('a wrong practice or proof answer moves to a FRESH position each time, never repeating one', () => {
    const { state, visits } = playGreedyHands(({ stageId, visits: n }) => ((stageId === 'independent-practice' && n < 3) || (stageId === 'practice-take' && n < 2) || (stageId === 'proof' && n < 4) ? 'tempting' : 'accepted'));
    expect(state.status).toBe('completed');
    for (const stageId of ['independent-practice', 'practice-take', 'proof']) {
      const ids = visits.filter((visit) => visit.stageId === stageId).map((visit) => visit.scenarioId);
      expect(new Set(ids).size, `${stageId} repeated a position`).toBe(ids.length);
    }
    expect(visits.filter((v) => v.stageId === 'independent-practice').map((v) => v.scenarioId.slice(-1))).toEqual(['1', '2', '3']);
    expect(visits.filter((v) => v.stageId === 'proof')).toHaveLength(4);
    // a pass after misses is honest: the retries are on the record, and nothing calls it mastery
    const proof = buildJourneyLessonCompletionProof(state, GREEDY_HANDS_LESSON_DEFINITION)!;
    expect(proof.retries).toBe(2 + 1 + 3);
    expect(proof.stages.find((stage) => stage.stageId === 'proof')).toMatchObject({ attempts: 4, outcome: 'passed' });
    expect(Object.keys(proof)).not.toEqual(expect.arrayContaining(['mastery', 'skill', 'rating']));
  });

  it('every kind of wrong answer fails the stage: the tempting play AND any other legal play', () => {
    const tempting = playGreedyHands(({ stageId, visits: n }) => (stageId === 'proof' && n === 1 ? 'tempting' : 'accepted'));
    const other = playGreedyHands(({ stageId, visits: n }) => (stageId === 'independent-practice' && n === 1 ? 'other' : 'accepted'));
    expect(tempting.visits.find((v) => v.stageId === 'proof')!.result).toBe('failed');
    expect(other.visits.find((v) => v.stageId === 'independent-practice')!.result).toBe('failed');
    expect(tempting.state.status).toBe('completed');
    expect(other.state.status).toBe('completed');
  });

  it('misses past the end of a pool keep the stage playable: the pool cycles in a fixed, rotated order', () => {
    const { state, visits } = playGreedyHands(({ stageId, visits: n }) => (stageId === 'independent-practice' && n < 8 ? 'tempting' : 'accepted'));
    expect(state.status).toBe('completed');
    const served = visits.filter((visit) => visit.stageId === 'independent-practice').map((visit) => visit.scenarioId.replace('scenario:greedy-practice-cost-', ''));
    expect(served).toEqual(['1', '2', '3', 'r02-1', 'r02-2', 'r02-3', 'r03-1', 'r03-2']);
    // the 4th position IS the 2nd authored one again, under a new id (cycle 1 ended on 3; cycle 2 starts on 2)
    expect(scenarioById('scenario:greedy-practice-cost-r02-1').repeat).toEqual({ ofId: 'scenario:greedy-practice-cost-2', cycle: 2 });
    const proof = buildJourneyLessonCompletionProof(state, GREEDY_HANDS_LESSON_DEFINITION)!;
    expect(proof.stages.find((stage) => stage.stageId === 'independent-practice')).toMatchObject({ attempts: 8, outcome: 'completed' });
    expect(proof.retries).toBe(7);
  });

  it('the guided stage repeats ONE position however many times it is missed', () => {
    const { state, visits } = playGreedyHands(({ stageId, visits: n }) => (stageId === 'guided-decision' && n < 15 ? 'tempting' : 'accepted'));
    expect(state.status).toBe('completed');
    const guided = visits.filter((visit) => visit.stageId === 'guided-decision');
    expect(guided).toHaveLength(15);
    expect(new Set(guided.map((visit) => visit.scenarioId))).toEqual(new Set(['scenario:greedy-guided']));
    expect(guided.slice(0, -1).every((visit) => visit.result === 'failed')).toBe(true);
    expect(guided[guided.length - 1].result).toBe('completed');
  });

  it('missing every position of a stage but the last still lets the player pass it — and the proof records every miss', () => {
    const { state, visits } = playGreedyHands(({ stageId, visits: n }) => {
      if (stageId === 'independent-practice') return n < 24 ? 'tempting' : 'accepted';
      if (stageId === 'practice-take') return n < 24 ? 'tempting' : 'accepted';
      if (stageId === 'proof') return n < 32 ? 'tempting' : 'accepted';
      return 'accepted';
    });
    expect(state.status).toBe('completed');
    expect(visits).toHaveLength(1 + 24 + 24 + 32);
    const proof = buildJourneyLessonCompletionProof(state, GREEDY_HANDS_LESSON_DEFINITION)!;
    expect(proof).not.toBeNull();
    expect(proof.retries).toBe(23 + 23 + 31);
    expect(proof.stages.map((stage) => stage.attempts)).toEqual([24, 24, 32]);
    // never repeats a position back to back anywhere in the session
    for (const stageId of ['independent-practice', 'practice-take', 'proof']) {
      const bases = visits.filter((visit) => visit.stageId === stageId).map((visit) => scenarioById(visit.scenarioId).repeat?.ofId ?? visit.scenarioId);
      bases.slice(1).forEach((base, index) => expect(base).not.toBe(bases[index]));
    }
  });

  it('only the ceiling ends a stage: after every cycle is missed it stays stuck on a retry and NEVER completes', () => {
    const cost = playGreedyHands(({ stageId }) => (stageId === 'independent-practice' ? 'tempting' : 'accepted'));
    expect(cost.exhausted).toBe(true);
    expect(cost.visits.filter((visit) => visit.stageId === 'independent-practice')).toHaveLength(3 * GREEDY_HANDS_RETRY_CYCLES);
    expect(cost.state.status).toBe('active');
    expect(cost.state.phase).toBe('awaiting_retry');
    expect(buildJourneyLessonCompletionProof(cost.state, GREEDY_HANDS_LESSON_DEFINITION)).toBeNull();
    const proof = playGreedyHands(({ stageId }) => (stageId === 'proof' ? 'tempting' : 'accepted'));
    expect(proof.exhausted).toBe(true);
    expect(proof.visits.filter((visit) => visit.stageId === 'proof')).toHaveLength(4 * GREEDY_HANDS_RETRY_CYCLES);
    expect(buildJourneyLessonCompletionProof(proof.state, GREEDY_HANDS_LESSON_DEFINITION)).toBeNull();
  });

  it('exhaustion and wrong answers can never complete a stage: every miss stays a failed result', () => {
    const { visits } = playGreedyHands(({ stageId }) => (stageId === 'proof' ? 'wrong' : 'accepted'));
    expect(visits.filter((visit) => visit.stageId === 'proof').every((visit) => visit.result === 'failed')).toBe(true);
    // an answer that is not a legal play is not graded at all, so it cannot pass or advance anything
    const scenario = scenarioById('scenario:greedy-proof-1');
    const owned = [...scenario.playerHand, ...scenario.board.mainLine.map((entry) => entry.tile)].map((tile) => `${tile.low}-${tile.high}`);
    const allTiles = Array.from({ length: 28 }, (_, index) => {
      let low = 0;
      let rest = index;
      while (rest > 6 - low) { rest -= 7 - low; low += 1; }
      return { low, high: low + rest };
    });
    const absent = allTiles.find((tile) => !owned.includes(`${tile.low}-${tile.high}`))!;
    expect(owned).not.toContain(`${absent.low}-${absent.high}`);
    const evaluation = GREEDY_HANDS_BUNDLE.evaluateResponse(scenario, { kind: 'move', action: { tile: absent, position: 'left' } });
    expect(evaluation.kind).toBe('illegal');
    expect(evaluation.result).toBeUndefined();
  });

  it('a long run of misses still credits through the real completion path, with every miss on the record', async () => {
    window.localStorage.clear();
    const tab = await openTab();
    complete(tab, UNLOCKED_BEFORE);
    const attemptId = startLessonAttempt(tab, NODE);
    const { state } = playGreedyHands(({ stageId, visits: n }) => ((stageId === 'independent-practice' && n < 10) || (stageId === 'proof' && n < 6) ? 'tempting' : 'accepted'));
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: NODE, session: state })).toEqual({ recorded: true, completedNode: true });
    expect(attemptOf(tab, attemptId)?.detail.retries).toBe(9 + 5);
    expect(completedIds(tab)).toEqual([...UNLOCKED_BEFORE, NODE]);
  });
});

describe('Greedy Hands completion goes through the accepted attempt/session binding and recovery', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function unlockedTab() {
    const tab = await openTab();
    complete(tab, UNLOCKED_BEFORE);
    return tab;
  }

  it('a genuine run, with misses on the way, credits ch1-n11 to its own attempt', async () => {
    const tab = await unlockedTab();
    const attemptId = startLessonAttempt(tab, NODE);
    const { state } = playGreedyHands(({ stageId, visits }) => (stageId === 'practice-take' && visits === 1 ? 'tempting' : 'accepted'));
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: NODE, session: state })).toEqual({ recorded: true, completedNode: true });
    expect(completedIds(tab)).toEqual([...UNLOCKED_BEFORE, NODE]);
    expect(pendingFor(tab)).toEqual([]);
    expect(attemptOf(tab, attemptId)).toMatchObject({ outcome: 'won', detail: { contentId: 'journey:ch1:greedy-hands', stage: 'Greedy Hands', sessionId: 'session:greedy-test', retries: 1 } });
  });

  it('replaying the same session against another attempt is refused (attempt/session binding)', async () => {
    const tab = await unlockedTab();
    const { state } = playGreedyHands(firstTry);
    const first = startLessonAttempt(tab, NODE);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId: first, nodeId: NODE, session: state }).recorded).toBe(true);
    tab.storage.resetJourneyProgress();
    complete(tab, UNLOCKED_BEFORE);
    const second = startLessonAttempt(tab, NODE);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId: second, nodeId: NODE, session: state })).toMatchObject({ recorded: false, refused: 'invalid_completion' });
    expect(completedIds(tab)).toEqual(UNLOCKED_BEFORE);
  });

  it('a partial or abandoned run earns nothing', async () => {
    const tab = await unlockedTab();
    const attemptId = startLessonAttempt(tab, NODE);
    const partial = playGreedyHands(({ stageId }) => (stageId === 'proof' ? 'tempting' : 'accepted')).state;
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: NODE, session: partial })).toMatchObject({ recorded: false, refused: 'invalid_completion' });
    expect(completedIds(tab)).toEqual(UNLOCKED_BEFORE);
    expect(attemptOf(tab, attemptId)?.outcome).toBe('in_progress');
  });

  it('a crash after the win was settled but before progress was applied is recovered on the next Journey load', async () => {
    const tab = await unlockedTab();
    const attemptId = startLessonAttempt(tab, NODE);
    const { state } = playGreedyHands(firstTry);
    const definition = definitionFor(tab, NODE);
    const proof = tab.stage.buildJourneyLessonCompletionProof(state, definition)!;
    expect(proof).not.toBeNull();
    expect(tab.pending.registerPendingCompletion(attemptId, NODE)).toBe(true);
    expect(tab.attempts.settleJourneyAttempt(attemptId, 'won', { completionProof: JSON.stringify(proof), retries: proof.retries, sessionId: proof.sessionId }).changed).toBe(true);
    expect(completedIds(tab)).toEqual(UNLOCKED_BEFORE);
    const reloaded = await openTab();
    expect(reloaded.recovery.recoverPendingJourneyCompletions()).toEqual({ applied: 1, cleared: 0, pending: 0 });
    expect(completedIds(reloaded)).toEqual([...UNLOCKED_BEFORE, NODE]);
  });

  it('is not creditable while Dot\'s Table is incomplete (a win never skips ahead)', async () => {
    const tab = await openTab();
    complete(tab, ['ch1-n07']);
    const attemptId = startLessonAttempt(tab, NODE);
    const { state } = playGreedyHands(firstTry);
    expect(tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: NODE, session: state })).toEqual({ recorded: true, completedNode: false });
    expect(completedIds(tab)).toEqual(['ch1-n07']);
    expect(pendingFor(tab)).toEqual([]);
  });
});

describe('Greedy Hands in the real lesson host', () => {
  async function playThroughUi(tab: Tab, strict: boolean, wrongFirstInCostPractice: boolean) {
    const attemptId = startLessonAttempt(tab, NODE);
    const completed: JourneyLessonSessionState[] = [];
    const ui = (
      <JourneyLessonHost
        definition={GREEDY_HANDS_LESSON_DEFINITION}
        onExit={vi.fn()}
        onLessonCompleted={(session) => {
          completed.push(session);
          const result = tab.stage.recordJourneyLessonCompletion({ attemptId, nodeId: NODE, session });
          return classifyJourneyLessonCompletion({ attemptId, nodeId: NODE, result });
        }}
      />
    );
    render(strict ? <StrictMode>{ui}</StrictMode> : ui);
    fireEvent.click(await screen.findByRole('button', { name: /take a seat/i }));
    for (let i = 0; i < 4; i += 1) fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: /continue to decision/i }));

    let missedOnce = false;
    for (let guard = 0; guard < 40 && !screen.queryByRole('heading', { name: 'Proof challenge passed' }); guard += 1) {
      const section = await waitFor(() => {
        const element = document.querySelector('[data-scenario-id]');
        if (!element) throw new Error('waiting for a position');
        return element;
      });
      const scenario = scenarioById(section.getAttribute('data-scenario-id')!);
      const stageId = section.getAttribute('data-stage-id');
      const wrong = wrongFirstInCostPractice && stageId === 'independent-practice' && !missedOnce;
      if (wrong) missedOnce = true;
      const action = actionOf(keyFor(scenario, wrong ? 'tempting' : 'accepted'));
      fireEvent.click(await screen.findByRole('button', { name: `Domino ${action.tile.low}-${action.tile.high}` }));
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(`play on ${action.position} end`, 'i') }));
      fireEvent.click(screen.getByRole('button', { name: /submit move/i }));
      await screen.findByText('Board consequence');
      fireEvent.click(await screen.findByRole('button', { name: /^(continue|try again|new position)$/i }));
    }
    await screen.findByRole('heading', { name: 'Proof challenge passed' });
    await waitFor(() => expect(completed).toHaveLength(1));
    return { attemptId, completed, missedOnce };
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('plays all the way through the real UI, credits the node, and reports completion exactly once under Strict Mode', async () => {
    const tab = await openTab();
    complete(tab, UNLOCKED_BEFORE);
    const { attemptId, completed } = await playThroughUi(tab, true, false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(completed).toHaveLength(1);
    expect(completedIds(tab)).toEqual([...UNLOCKED_BEFORE, NODE]);
    expect(attemptOf(tab, attemptId)?.outcome).toBe('won');
  }, 60_000);

  it('a miss in the real UI shows the position-specific consequence and moves on to a fresh position', async () => {
    const tab = await openTab();
    complete(tab, UNLOCKED_BEFORE);
    const { completed, missedOnce } = await playThroughUi(tab, false, true);
    expect(missedOnce).toBe(true);
    const proof = buildJourneyLessonCompletionProof(completed[0], GREEDY_HANDS_LESSON_DEFINITION)!;
    expect(proof.retries).toBe(1);
    expect(completedIds(tab)).toEqual([...UNLOCKED_BEFORE, NODE]);
  }, 60_000);
});
