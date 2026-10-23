import { describe, expect, it } from 'vitest';
import type { PlacementPosition, Tile } from '../../../types.ts';
import { applyPlayMove, getLegalMoves } from '../../../modules/match/runtime/botEngine.ts';
import { analyzeJourneyAuthoredMove, createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { getJourneyAuthoredLessonBundle, resolveJourneyAuthoredVariant } from '../../journeyAuthoredLessonRegistry.ts';
import { getJourneyContentDescriptor, getJourneyLessonDefinition, resolveJourneyContent } from '../../journeyContentResolver.ts';
import { getJourneyPremiumHostKind } from '../../journeyPremiumRuntimeRegistry.ts';
import { GREEDY_HANDS_CONTENT_ID, GREEDY_HANDS_LESSON_DEFINITION, GREEDY_HANDS_NODE_ID } from './greedyHandsLesson.ts';
import { GREEDY_HANDS_BUNDLE } from './greedyHandsBundle.ts';
import { GREEDY_HANDS_GENERATED_FEEDBACK, GREEDY_HANDS_REPEAT_SCENARIOS, GREEDY_HANDS_RETRY_CYCLES, GREEDY_HANDS_SCENARIOS, type GreedyHandsScenario } from './greedyHandsScenarios.ts';
import { servingOrder, validateGreedyHandsContent } from './greedyHandsValidation.ts';
import { GREEDY_HANDS_POSITION_SPECS } from './greedyHandsPositions.ts';

/** What the engine reports as scored by an applied play (a number, or `{ player, points }`). */
const scoredBy = (result: { scored?: number | { points: number } }): number => (typeof result.scored === 'object' ? result.scored.points : result.scored ?? 0);
const label = (tile: Tile) => `${Math.min(tile.low, tile.high)}-${Math.max(tile.low, tile.high)}`;
const ALL: Tile[] = [];
for (let low = 0; low <= 6; low += 1) for (let high = low; high <= 6; high += 1) ALL.push({ low, high });

/**
 * An INDEPENDENT derivation of a line's facts: only `getLegalMoves` and `applyPlayMove` (and the points the engine
 * reports for an applied play), none of the module's own helpers and not `previewPlayMove`. If the lesson's
 * facts module and this agree, they agree because the engine says so.
 */
function independentLine(scenario: GreedyHandsScenario, first: { tile: Tile; position: PlacementPosition }) {
  let state = createJourneyScenarioState(scenario);
  let move = { type: 'play' as const, tile: first.tile, position: first.position };
  let points = 0;
  const played: string[] = [];
  for (let step = 0; step < 6; step += 1) {
    const result = applyPlayMove(state, 'you', move);
    expect(result.error, `${scenario.id} ${label(move.tile)}@${move.position}`).toBeUndefined();
    points += scoredBy(result);
    played.push(`${label(move.tile)}@${move.position}`);
    state = result.state;
    if (state.currentPlayer !== 'you') break;
    const plays = getLegalMoves(state, 'you').filter((m) => m.type === 'play');
    expect(plays, `${scenario.id}: the rest of the turn must be forced`).toHaveLength(1);
    move = { type: 'play', tile: plays[0].tile!, position: plays[0].position as PlacementPosition };
  }
  expect(state.currentPlayer).toBe('bot');
  const board = state.board!;
  const known = [...board.mainLine.map((entry) => entry.tile), ...scenario.playerHand].map(label);
  const unseen = ALL.filter((tile) => !known.includes(label(tile)));
  let bestReply = 0;
  for (const tile of unseen) {
    const probe = JSON.parse(JSON.stringify(state)) as typeof state;
    probe.currentPlayer = 'bot';
    probe.players.bot.hand = [{ ...tile }];
    for (const reply of getLegalMoves(probe, 'bot').filter((m) => m.type === 'play')) {
      bestReply = Math.max(bestReply, scoredBy(applyPlayMove(probe, 'bot', reply)));
    }
  }
  return { points, played, ends: [board.leftEnd, board.rightEnd], unseen: unseen.length, bestReply, net: points - bestReply };
}

const actionOf = (key: string) => {
  const [, low, high, position] = /^(\d)-(\d)@(left|right)$/.exec(key)!;
  return { tile: { low: Number(low), high: Number(high) }, position: position as PlacementPosition };
};
const legalKeys = (scenario: GreedyHandsScenario) => Object.keys(scenario.greedy.lines);

describe('Greedy Hands is registered through the production lookup path', () => {
  it('resolves ch1-n11 to an available premium lesson, not the old placeholder', () => {
    const descriptor = getJourneyContentDescriptor('ch1-n11');
    expect(descriptor).toMatchObject({
      migrationClass: 'premium', contentId: GREEDY_HANDS_CONTENT_ID, nodeId: 'ch1-n11', supportStatus: 'supported', runtimeAvailability: 'available',
      runtime: { kind: 'lesson_sequence', lessonId: GREEDY_HANDS_CONTENT_ID },
    });
    expect(resolveJourneyContent('ch1-n11').kind).toBe('found');
  });

  it('is reachable as a definition, an authored bundle and an authored-board-lesson host', () => {
    expect(getJourneyLessonDefinition(String(GREEDY_HANDS_CONTENT_ID))).toBe(GREEDY_HANDS_LESSON_DEFINITION);
    expect(getJourneyAuthoredLessonBundle(String(GREEDY_HANDS_CONTENT_ID))).toBe(GREEDY_HANDS_BUNDLE);
    expect(getJourneyPremiumHostKind(String(GREEDY_HANDS_CONTENT_ID))).toBe('authored_board_lesson');
    expect(GREEDY_HANDS_LESSON_DEFINITION.nodeId).toBe(GREEDY_HANDS_NODE_ID);
  });

  it('keeps the stable stage IDs and requires the three decision stages', () => {
    expect(GREEDY_HANDS_LESSON_DEFINITION.stages.map((stage) => stage.id)).toEqual(['welcome', 'turn-demo', 'guided-decision', 'independent-practice', 'practice-take', 'proof']);
    expect(GREEDY_HANDS_LESSON_DEFINITION.completion).toMatchObject({ kind: 'required_stages', stageIds: ['independent-practice', 'practice-take', 'proof'] });
  });
});

describe('every authored position passes the real validator and the engine', () => {
  it('the content validator reports no errors', () => {
    expect(validateGreedyHandsContent(GREEDY_HANDS_LESSON_DEFINITION)).toEqual([]);
  });

  it('has the promised shape: 12 distinct positions, in the pools the stages draw from', () => {
    expect(GREEDY_HANDS_SCENARIOS).toHaveLength(GREEDY_HANDS_POSITION_SPECS.length);
    const inSet = (setId: string) => GREEDY_HANDS_SCENARIOS.filter((s) => s.variantSetId === setId).map((s) => s.id);
    expect(inSet('variants:greedy-hands-practice-cost')).toHaveLength(3);
    expect(inSet('variants:greedy-hands-practice-take')).toHaveLength(3);
    expect(inSet('variants:greedy-hands-proof')).toHaveLength(4);
    expect(GREEDY_HANDS_SCENARIOS.filter((s) => s.kind === 'demo' || s.kind === 'guided')).toHaveLength(2);
  });

  it.each(GREEDY_HANDS_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))('%s: stored facts equal an independent engine derivation', (_id, scenario) => {
    for (const key of legalKeys(scenario)) {
      const stored = scenario.greedy.lines[key];
      const independent = independentLine(scenario, actionOf(key));
      expect(stored.turnPoints, `${key} points`).toBe(independent.points);
      expect(stored.steps.map((s) => `${label(s.tile)}@${s.position}`), `${key} turn`).toEqual(independent.played);
      expect([...stored.finalEnds], `${key} ends`).toEqual(independent.ends);
      expect(stored.reply.unseenCount, `${key} unseen`).toBe(independent.unseen);
      expect(stored.reply.bestPoints, `${key} best reply`).toBe(independent.bestReply);
      expect(stored.net, `${key} net`).toBe(independent.net);
    }
  });

  it.each(GREEDY_HANDS_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))('%s: the intended answer is the single best play under the independent derivation', (_id, scenario) => {
    const nets = legalKeys(scenario).map((key) => ({ key, ...independentLine(scenario, actionOf(key)) }));
    const best = [...nets].sort((a, b) => b.net - a.net);
    expect(best[0].key).toBe(scenario.greedy.acceptedKey);
    expect(best[0].net).toBeGreaterThan(best[1].net); // strictly: no tie, no second defensible answer
  });
});

describe('the lesson separates immediate points from the reply they expose', () => {
  const byType = (type: 'cost' | 'take') => GREEDY_HANDS_SCENARIOS.filter((s) => s.greedy.type === type);

  it('has a position where taking the immediate points is correct, and it is the highest-scoring play', () => {
    const takes = byType('take');
    expect(takes.length).toBeGreaterThanOrEqual(5);
    for (const scenario of takes) {
      const lines = Object.values(scenario.greedy.lines);
      const accepted = scenario.greedy.lines[scenario.greedy.acceptedKey];
      expect(accepted.turnPoints).toBe(Math.max(...lines.map((line) => line.turnPoints)));
      expect(accepted.turnPoints).toBeGreaterThanOrEqual(2);
      expect(accepted.net).toBeGreaterThanOrEqual(1);
      // the quieter play looks safer (a smaller reply) and still loses
      const quiet = scenario.greedy.lines[scenario.greedy.temptingKey];
      expect(quiet.reply.bestPoints).toBeLessThan(accepted.reply.bestPoints);
      expect(quiet.net).toBeLessThan(accepted.net);
    }
  });

  it('has positions where the highest-scoring play is wrong because of the reply it leaves', () => {
    const costs = byType('cost');
    expect(costs.length).toBeGreaterThanOrEqual(7);
    for (const scenario of costs) {
      const accepted = scenario.greedy.lines[scenario.greedy.acceptedKey];
      const greedy = scenario.greedy.lines[scenario.greedy.temptingKey];
      expect(greedy.turnPoints).toBe(Math.max(...Object.values(scenario.greedy.lines).map((line) => line.turnPoints)));
      expect(greedy.turnPoints).toBeGreaterThan(accepted.turnPoints);
      expect(greedy.reply.bestPoints).toBeGreaterThan(accepted.reply.bestPoints);
      expect(greedy.net).toBeLessThan(accepted.net);
    }
  });

  it('teaches both a quiet play winning and a SMALLER score winning (not one trick)', () => {
    const costs = byType('cost');
    expect(costs.some((s) => s.greedy.lines[s.greedy.acceptedKey].turnPoints === 0)).toBe(true);
    expect(costs.some((s) => s.greedy.lines[s.greedy.acceptedKey].turnPoints > 0)).toBe(true);
  });

  it('is not the Tempo vs Safety lesson: that lesson\'s metric (legal plays your rack keeps) would often give the WRONG answer here', () => {
    // Tempo vs Safety prefers the play that leaves you more remaining legal actions. Measured with that lesson's own
    // analysis, count the positions where doing so would pick the tempting play instead of the intended answer.
    let tempoWouldBeWrong = 0;
    for (const scenario of GREEDY_HANDS_SCENARIOS.filter((s) => s.kind !== 'demo')) {
      const accepted = analyzeJourneyAuthoredMove(scenario, actionOf(scenario.greedy.acceptedKey));
      const tempting = analyzeJourneyAuthoredMove(scenario, actionOf(scenario.greedy.temptingKey));
      if (tempting.remainingLegalActionCount > accepted.remainingLegalActionCount) tempoWouldBeWrong += 1;
    }
    expect(tempoWouldBeWrong).toBeGreaterThanOrEqual(3);
  });

  it('plays out the whole turn: a scoring play is followed by the forced play, and the turn never ends on a draw', () => {
    for (const scenario of GREEDY_HANDS_SCENARIOS) {
      for (const line of Object.values(scenario.greedy.lines)) {
        const last = line.steps[line.steps.length - 1];
        expect(last.turnGoesOn, `${scenario.id}: the turn must end on a play that neither scores nor is a double`).toBe(false);
        line.steps.slice(0, -1).forEach((step) => expect(step.turnGoesOn).toBe(true));
        expect(line.steps.length).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('each answer is graded correctly, with an explanation that states the position\'s own numbers', () => {
  it.each(GREEDY_HANDS_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))('%s: accepted passes, every other legal play fails, with matching feedback', (_id, scenario) => {
    for (const key of legalKeys(scenario)) {
      const evaluation = GREEDY_HANDS_BUNDLE.evaluateResponse(scenario, { kind: 'move', action: actionOf(key) });
      expect(evaluation.kind).toBe('evaluated');
      const line = scenario.greedy.lines[key];
      const feedback = GREEDY_HANDS_BUNDLE.feedback[evaluation.feedbackOutcomeKey];
      expect(feedback, `${scenario.id} ${key} feedback`).toBeDefined();
      if (key === scenario.greedy.acceptedKey) {
        expect(evaluation.result).toBe(scenario.kind === 'proof' ? 'passed' : 'completed');
        expect(evaluation.decisionSummary).toEqual({ total: 1, correct: 1, incorrect: 0 });
        expect(feedback.retryExpected).toBe(false);
      } else {
        expect(evaluation.result).toBe('failed');
        expect(evaluation.mistakeCategoryIds).toHaveLength(1);
        expect(feedback.retryExpected).toBe(true);
      }
      // the board the player is shown is the one the opponent faces, i.e. after the WHOLE turn
      expect(evaluation.openEndsAfter).toEqual([...line.finalEnds]);
      expect(feedback.explanation).toContain(`You took ${line.turnPoints}; the best single reply could take ${line.reply.bestPoints}.`);
    }
  });

  it('refuses a play that is not legal, and never invents a verdict for it', () => {
    const scenario = GREEDY_HANDS_SCENARIOS[0];
    const notInRack = ALL.find((tile) => !scenario.playerHand.some((own) => label(own) === label(tile)) && !scenario.board.mainLine.some((entry) => label(entry.tile) === label(tile)))!;
    const evaluation = GREEDY_HANDS_BUNDLE.evaluateResponse(scenario, { kind: 'move', action: { tile: notInRack, position: 'left' } });
    expect(evaluation.kind).toBe('illegal');
    expect(evaluation.feedbackOutcomeKey).toBe('illegal_action');
    expect(GREEDY_HANDS_BUNDLE.feedback.illegal_action).toBeDefined();
  });

  it('keeps its claims honest: it says "could", never what an opponent will do, and names no bot personality', () => {
    for (const asset of Object.values(GREEDY_HANDS_GENERATED_FEEDBACK)) {
      const text = `${asset.heading} ${asset.explanation}`;
      expect(text).not.toMatch(/\b(Fritz|Dot|Marlow)\b/);
      expect(text).not.toMatch(/\bwill (score|play|take|hold)\b/i);
      expect(text).not.toMatch(/\balways\b|\bnever\b/i);
    }
    for (const scenario of GREEDY_HANDS_SCENARIOS) {
      for (const step of scenario.demonstrationSteps ?? []) expect(`${step.caption} ${step.boardDescription}`).not.toMatch(/\b(Fritz|Dot|Marlow)\b|\bwill (score|play|take|hold)\b/i);
    }
    expect(GREEDY_HANDS_BUNDLE.presentation.framingLine + GREEDY_HANDS_BUNDLE.presentation.completionLine).not.toMatch(/mastery|rating|skill level/i);
  });

  it('states the scoring rule and the "could, not will" caveat in the walk-through', () => {
    const demo = GREEDY_HANDS_SCENARIOS.find((s) => s.kind === 'demo')!;
    const text = (demo.demonstrationSteps ?? []).map((step) => step.boardDescription).join(' ');
    expect(text).toMatch(/multiple of 5/);
    expect(text).toMatch(/counts both halves/);
    expect(text).toMatch(/floor, not a forecast/);
    expect(demo.demonstrationSteps?.map((step) => step.caption)).toContain('A score keeps your turn going.');
  });
});

describe('a position that cannot be described honestly is rejected, not approximated', () => {
  it('flags a stored fact that disagrees with the engine', () => {
    const scenario = GREEDY_HANDS_SCENARIOS.find((s) => s.greedy.type === 'cost' && s.kind === 'independent')!;
    const key = scenario.greedy.temptingKey;
    const original = scenario.greedy.lines[key];
    scenario.greedy.lines[key] = { ...original, reply: { ...original.reply, bestPoints: original.reply.bestPoints + 1 } };
    try {
      expect(validateGreedyHandsContent(GREEDY_HANDS_LESSON_DEFINITION).join('\n')).toMatch(/stored facts disagree with the engine/);
    } finally {
      scenario.greedy.lines[key] = original;
    }
    expect(validateGreedyHandsContent(GREEDY_HANDS_LESSON_DEFINITION)).toEqual([]);
  });

  it('flags a wrong intended answer', () => {
    const scenario = GREEDY_HANDS_SCENARIOS.find((s) => s.greedy.type === 'take' && s.kind === 'independent')!;
    const original = scenario.greedy.acceptedKey;
    scenario.greedy.acceptedKey = scenario.greedy.temptingKey;
    try {
      expect(validateGreedyHandsContent(GREEDY_HANDS_LESSON_DEFINITION).join('\n')).toMatch(/single best play/);
    } finally {
      scenario.greedy.acceptedKey = original;
    }
    expect(validateGreedyHandsContent(GREEDY_HANDS_LESSON_DEFINITION)).toEqual([]);
  });

  it('flags a duplicate position and an identity mismatch', () => {
    expect(validateGreedyHandsContent({ id: 'journey:ch1:other', nodeId: 'ch1-n11' }).join('\n')).toMatch(/identity mismatch/);
    expect(validateGreedyHandsContent({ id: String(GREEDY_HANDS_CONTENT_ID), nodeId: 'ch1-n12' }).join('\n')).toMatch(/identity mismatch/);
  });
});

describe('a pool that runs out is served again as explicit repeats (retry policy)', () => {
  const bundle = GREEDY_HANDS_BUNDLE;
  const everything = [...GREEDY_HANDS_SCENARIOS, ...GREEDY_HANDS_REPEAT_SCENARIOS];
  const fresh = GREEDY_HANDS_LESSON_DEFINITION.stages.flatMap((stage) =>
    (stage.kind === 'frame' || stage.kind === 'board_demo' || stage.retry.kind !== 'fresh_variant') ? [] : [{ stage, setId: stage.retry.variantSetId }]);
  const baseOf = (id: string) => (bundle.scenarios[id] as GreedyHandsScenario).repeat?.ofId ?? id;

  /** What the real host does: the first unused position, via the real `resolveJourneyAuthoredVariant`. */
  function hostOrder(setId: string, openerId: string): string[] {
    const used = [openerId];
    for (;;) {
      const next = resolveJourneyAuthoredVariant(bundle, setId, used);
      if (next.kind !== 'resolved') return used;
      used.push(next.scenario.id);
    }
  }

  it('the validator\'s serving order is exactly the real host function\'s, for every retrying stage', () => {
    expect(fresh.map((entry) => entry.stage.id)).toEqual(['independent-practice', 'practice-take', 'proof']);
    for (const { stage, setId } of fresh) {
      expect(servingOrder(everything, setId, stage.scenarioRef), stage.id).toEqual(hostOrder(setId, stage.scenarioRef));
    }
  });

  it('serves every authored position once per cycle, for the configured number of cycles, then (and only then) runs out', () => {
    expect(GREEDY_HANDS_RETRY_CYCLES).toBeGreaterThanOrEqual(5);
    for (const { stage, setId } of fresh) {
      const authored = GREEDY_HANDS_SCENARIOS.filter((scenario) => scenario.variantSetId === setId);
      const order = hostOrder(setId, stage.scenarioRef);
      expect(order, stage.id).toHaveLength(authored.length * GREEDY_HANDS_RETRY_CYCLES);
      for (const position of authored) expect(order.filter((id) => baseOf(id) === position.id), `${stage.id} ${position.id}`).toHaveLength(GREEDY_HANDS_RETRY_CYCLES);
      expect(new Set(order).size, `${stage.id} ids are all distinct (the controller forbids reusing one)`).toBe(order.length);
    }
  });

  it('never serves the same position twice in a row, including across a cycle boundary, and opens on the stage opener', () => {
    for (const { stage, setId } of fresh) {
      const order = hostOrder(setId, stage.scenarioRef);
      expect(order[0]).toBe(stage.scenarioRef);
      const bases = order.map(baseOf);
      bases.slice(1).forEach((base, index) => expect(base, `${stage.id} step ${index + 2}`).not.toBe(bases[index]));
    }
  });

  it('is deterministic: the same pool gives the same order every time, and cycles are rotated, not shuffled', () => {
    const cost = fresh[0];
    const first = hostOrder(cost.setId, cost.stage.scenarioRef);
    expect(hostOrder(cost.setId, cost.stage.scenarioRef)).toEqual(first);
    expect(first.slice(0, 8).map((id) => baseOf(id).replace('scenario:greedy-practice-cost-', ''))).toEqual(['1', '2', '3', '2', '3', '1', '3', '1']);
    expect(first.slice(0, 5)).toEqual([
      'scenario:greedy-practice-cost-1', 'scenario:greedy-practice-cost-2', 'scenario:greedy-practice-cost-3',
      'scenario:greedy-practice-cost-r02-1', 'scenario:greedy-practice-cost-r02-2',
    ]);
  });

  it('a repeat IS the position it repeats: same board, rack, answer, facts and feedback, graded identically', () => {
    expect(GREEDY_HANDS_REPEAT_SCENARIOS.length).toBe((3 + 3 + 4) * (GREEDY_HANDS_RETRY_CYCLES - 1));
    for (const repeat of GREEDY_HANDS_REPEAT_SCENARIOS as GreedyHandsScenario[]) {
      const source = GREEDY_HANDS_SCENARIOS.find((scenario) => scenario.id === repeat.repeat!.ofId)!;
      expect(repeat.id).not.toBe(source.id);
      expect(repeat.board).toBe(source.board);
      expect(repeat.greedy).toBe(source.greedy);
      for (const key of Object.keys(source.greedy.lines)) {
        const a = GREEDY_HANDS_BUNDLE.evaluateResponse(source, { kind: 'move', action: actionOf(key) });
        const b = GREEDY_HANDS_BUNDLE.evaluateResponse(repeat, { kind: 'move', action: actionOf(key) });
        expect(b.result).toBe(a.result);
        expect(b.feedbackOutcomeKey).toBe(a.feedbackOutcomeKey);
        expect(b.openEndsAfter).toEqual(a.openEndsAfter);
      }
    }
  });

  it('keeps the guided stage on a single position: it is not a retry pool and has no repeats', () => {
    const guided = GREEDY_HANDS_LESSON_DEFINITION.stages.find((stage) => stage.id === 'guided-decision')!;
    expect('retry' in guided && guided.retry.kind).toBe('same_scenario');
    expect(GREEDY_HANDS_REPEAT_SCENARIOS.some((scenario) => scenario.id.includes('guided') || scenario.id.includes('demo'))).toBe(false);
  });

  it('the validator rejects a broken repeat policy instead of letting the lesson ship it', () => {
    const repeat = GREEDY_HANDS_REPEAT_SCENARIOS[0] as GreedyHandsScenario;
    const originalBoard = repeat.board;
    repeat.board = { ...originalBoard };
    try {
      expect(validateGreedyHandsContent(GREEDY_HANDS_LESSON_DEFINITION).join('\n')).toMatch(/a repeat must be exactly the position it repeats/);
    } finally {
      repeat.board = originalBoard;
    }
    const removed = GREEDY_HANDS_REPEAT_SCENARIOS.pop()!;
    try {
      expect(validateGreedyHandsContent(GREEDY_HANDS_LESSON_DEFINITION).join('\n')).toMatch(/serves \d+ positions, expected/);
    } finally {
      GREEDY_HANDS_REPEAT_SCENARIOS.push(removed);
    }
    expect(validateGreedyHandsContent(GREEDY_HANDS_LESSON_DEFINITION)).toEqual([]);
  });
});
