import { previewPlayMove, getLegalMoves, getMatchableOpenEnds } from '../../../modules/match/runtime/botEngine.ts';
import type { PlacementPosition } from '../../../types.ts';
import { createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import {
  GREEDY_HANDS_CONTENT_ID,
  GREEDY_HANDS_LESSON_DEFINITION,
  GREEDY_HANDS_NODE_ID,
  GREEDY_HANDS_PRACTICE_COST_VARIANT_SET_ID,
  GREEDY_HANDS_PRACTICE_TAKE_VARIANT_SET_ID,
  GREEDY_HANDS_PROOF_VARIANT_SET_ID,
} from './greedyHandsLesson.ts';
import { actionKey, analyzeGreedyLine, boardTiles, legalFirstActions, tileLabel, type GreedyLineFacts } from './greedyHandsFacts.ts';
import { describeLedger } from './greedyHandsFeedback.ts';
import { GREEDY_HANDS_GENERATED_FEEDBACK, GREEDY_HANDS_REPEAT_SCENARIOS, GREEDY_HANDS_RETRY_CYCLES, GREEDY_HANDS_SCENARIOS, type GreedyHandsScenario } from './greedyHandsScenarios.ts';

/**
 * Re-derives every claim a Greedy Hands position makes — legality, scoring, how the turn plays out, what the
 * unseen tiles could score back, which play is best — from the engine, and compares it with what the scenario
 * stored. Nothing the scenario says about itself is trusted. Runs when the content registry is built, so a
 * position that stops being what it claims fails loudly instead of teaching something false.
 */

const sameSet = (a: string[], b: string[]): number => a.filter((entry) => b.includes(entry)).length;

function recompute(scenario: GreedyHandsScenario): Record<string, GreedyLineFacts> | string {
  const lines: Record<string, GreedyLineFacts> = {};
  for (const action of legalFirstActions(scenario)) {
    const result = analyzeGreedyLine(scenario, action);
    if (result.kind !== 'line') return `${actionKey(action)} cannot be played out (${result.reason})`;
    lines[actionKey(action)] = result.facts;
  }
  return lines;
}

const sameFacts = (a: GreedyLineFacts, b: GreedyLineFacts): boolean =>
  a.turnPoints === b.turnPoints && a.net === b.net && a.finalEnds[0] === b.finalEnds[0] && a.finalEnds[1] === b.finalEnds[1]
  && a.finalEndTotal === b.finalEndTotal && a.reply.bestPoints === b.reply.bestPoints && a.reply.scoringTileCount === b.reply.scoringTileCount
  && a.reply.unseenCount === b.reply.unseenCount && a.steps.length === b.steps.length;

function validateScenario(scenario: GreedyHandsScenario, errors: string[]): void {
  const where = scenario.id;
  if (getMatchableOpenEnds(scenario.board).length !== 2) errors.push(`${where}: the starting board must have exactly two open ends`);
  const onBoard = boardTiles(scenario.board).map(tileLabel);
  const rack = scenario.playerHand.map(tileLabel);
  if (rack.length < 4 || rack.length > 5 || new Set(rack).size !== rack.length) errors.push(`${where}: the rack must hold 4-5 distinct tiles`);
  if (rack.some((tile) => onBoard.includes(tile))) errors.push(`${where}: a rack tile is also on the board`);

  const lines = recompute(scenario);
  if (typeof lines === 'string') {
    errors.push(`${where}: ${lines}`);
    return;
  }
  const keys = Object.keys(lines);
  if (keys.length < 2 || keys.length > 4) errors.push(`${where}: expected 2-4 legal first plays, found ${keys.length}`);

  const stored = Object.keys(scenario.greedy.lines);
  if (stored.length !== keys.length || stored.some((key) => !lines[key] || !sameFacts(lines[key], scenario.greedy.lines[key]))) errors.push(`${where}: stored facts disagree with the engine`);

  // the scoring rule, checked at every step against the engine's own preview
  for (const [key, line] of Object.entries(lines)) {
    if (line.steps.length > 2) errors.push(`${where}: ${key} takes ${line.steps.length} plays; keep the turn to two`);
    if (getMatchableOpenEnds(line.finalBoard).length !== 2) errors.push(`${where}: ${key} leaves more than two open ends`);
    line.steps.forEach((step, index) => {
      const scores = step.endTotal % 5 === 0;
      if (step.points !== (scores ? step.endTotal / 5 : 0)) errors.push(`${where}: ${key} step ${index + 1} scores ${step.points} for an end total of ${step.endTotal}`);
    });
    const feedback = GREEDY_HANDS_GENERATED_FEEDBACK[scenario.feedbackByAction[key] ?? ''];
    if (!feedback) errors.push(`${where}: no feedback for ${key}`);
    else if (!feedback.explanation.includes(describeLedger(line))) errors.push(`${where}: feedback for ${key} does not state this line's ledger`);
  }

  const accepted = lines[scenario.greedy.acceptedKey];
  const tempting = lines[scenario.greedy.temptingKey];
  if (!accepted || !tempting) {
    errors.push(`${where}: the authored answer or tempting play is not a legal first play`);
    return;
  }
  const others = (line: GreedyLineFacts) => Object.values(lines).filter((candidate) => candidate !== line);
  const bestNetAlone = others(accepted).every((candidate) => candidate.net < accepted.net);
  if (!bestNetAlone) errors.push(`${where}: the intended answer is not the single best play by points taken minus the best reply`);

  if (scenario.greedy.type === 'cost') {
    const topScorerAlone = others(tempting).every((candidate) => candidate.turnPoints < tempting.turnPoints);
    if (!topScorerAlone || tempting.turnPoints < 1) errors.push(`${where}: the tempting play must be the single highest-scoring play, and must score`);
    if (tempting.turnPoints <= accepted.turnPoints) errors.push(`${where}: the tempting play must take more than the intended answer`);
    if (tempting.reply.bestPoints <= accepted.reply.bestPoints) errors.push(`${where}: the tempting play must leave a bigger reply than the intended answer`);
    if (tempting.net > -1 || accepted.net < 0) errors.push(`${where}: a "cost" position needs the tempting play behind and the intended answer at least level`);
  } else {
    const topScorerAlone = others(accepted).every((candidate) => candidate.turnPoints < accepted.turnPoints);
    if (!topScorerAlone || accepted.turnPoints < 2) errors.push(`${where}: in a "take it" position the intended answer must be the single highest-scoring play and take at least 2`);
    if (accepted.net < 1) errors.push(`${where}: in a "take it" position the points must come out ahead of the best reply`);
    if (tempting.reply.bestPoints >= accepted.reply.bestPoints || tempting.net >= accepted.net || tempting.turnPoints >= accepted.turnPoints) {
      errors.push(`${where}: the tempting play must look safer (smaller reply) yet end behind`);
    }
    const safest = others(accepted).sort((a, b) => a.reply.bestPoints - b.reply.bestPoints || b.net - a.net)[0];
    if (safest !== tempting) errors.push(`${where}: the tempting play must be the safest-looking alternative`);
  }

  // every authored action is legal under the engine, independently of the facts module
  const state = createJourneyScenarioState(scenario);
  const legal = getLegalMoves(state, 'you').filter((move) => move.type === 'play');
  for (const action of [...scenario.acceptedActions, ...scenario.temptingActions]) {
    const isLegal = legal.some((move) => move.tile && move.position === action.position && tileLabel(move.tile) === tileLabel(action.tile));
    if (!isLegal) errors.push(`${where}: illegal authored action ${actionKey(action)}`);
  }

  // the walk-through: each previewed play is legal where it is shown, and the board shown is the engine's
  if (scenario.kind === 'demo') {
    const steps = scenario.demonstrationSteps ?? [];
    if (steps.length < 4) errors.push(`${where}: the walk-through needs at least four steps`);
    for (const step of steps) {
      if (!step.caption.trim() || !step.boardDescription.trim()) errors.push(`${where}: walk-through copy is empty (${step.id})`);
      if (step.kind !== 'preview_move') continue;
      // the same play can appear in several lines (a tile that is forced in one line is a first play in another),
      // so the shown board must match the engine's board for at least one place that play occurs
      const samePlay = (played: { tile: { low: number; high: number }; position: string }) =>
        played.tile.low === step.action.tile.low && played.tile.high === step.action.tile.high && played.position === step.action.position;
      const matchesEngine = Object.values(lines).some((candidate) => candidate.steps.some((played, index) =>
        samePlay(played) && candidate.stepBoards[index].leftEnd === step.board.leftEnd && candidate.stepBoards[index].rightEnd === step.board.rightEnd
        && candidate.stepBoards[index].mainLine.length === step.board.mainLine.length));
      if (!matchesEngine) errors.push(`${where}: preview ${step.id} does not match the engine's board`);
      const isFirstPlay = Object.values(lines).some((candidate) => samePlay(candidate.steps[0]));
      if (isFirstPlay && !previewPlayMove(state, 'you', { type: 'play', tile: step.action.tile, position: step.action.position as PlacementPosition })) errors.push(`${where}: illegal walk-through play ${step.id}`);
    }
  }
}

/**
 * The order in which a stage's pool is served, replicating the host's rule (the first UNUSED id in `localeCompare`
 * order — `resolveJourneyAuthoredVariant`; a test pins this copy to the real function). Returns the positions served
 * when the stage opens on `openerId` and every answer is wrong, until nothing is left.
 */
export function servingOrder(scenarios: ReadonlyArray<GreedyHandsScenario>, variantSetId: string, openerId: string): string[] {
  const pool = scenarios.filter((scenario) => scenario.variantSetId === variantSetId).sort((a, b) => a.id.localeCompare(b.id));
  const served = [openerId];
  for (;;) {
    const next = pool.find((scenario) => !served.includes(scenario.id));
    if (!next) return served;
    served.push(next.id);
  }
}

/** Repeats are explicit, faithful copies served in a deterministic order with no immediate cosmetic repeat. */
function validateRepeatPolicy(errors: string[]): void {
  const everything = [...GREEDY_HANDS_SCENARIOS, ...GREEDY_HANDS_REPEAT_SCENARIOS];
  const ids = new Set<string>();
  for (const scenario of everything) {
    if (ids.has(scenario.id)) errors.push(`repeat policy: duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
  }
  const authoredById = new Map(GREEDY_HANDS_SCENARIOS.map((scenario) => [scenario.id, scenario]));
  for (const repeat of GREEDY_HANDS_REPEAT_SCENARIOS) {
    const source = repeat.repeat ? authoredById.get(repeat.repeat.ofId) : undefined;
    if (!source) {
      errors.push(`${repeat.id}: a repeat must name the authored position it repeats`);
      continue;
    }
    const faithful = repeat.board === source.board && repeat.playerHand === source.playerHand && repeat.greedy === source.greedy
      && repeat.variantSetId === source.variantSetId && repeat.kind === source.kind && repeat.feedbackByAction === source.feedbackByAction
      && repeat.acceptedActions === source.acceptedActions && repeat.temptingActions === source.temptingActions;
    if (!faithful) errors.push(`${repeat.id}: a repeat must be exactly the position it repeats (same board, rack, answer, facts and feedback)`);
  }

  for (const stage of GREEDY_HANDS_LESSON_DEFINITION.stages) {
    if (stage.kind === 'frame' || stage.kind === 'board_demo') continue;
    const retry = stage.retry;
    if (retry.kind !== 'fresh_variant') continue;
    const authored = GREEDY_HANDS_SCENARIOS.filter((scenario) => scenario.variantSetId === retry.variantSetId);
    const order = servingOrder(everything, retry.variantSetId, stage.scenarioRef);
    const expected = authored.length * GREEDY_HANDS_RETRY_CYCLES;
    if (order.length !== expected) errors.push(`stage ${stage.id}: serves ${order.length} positions, expected ${expected} (${GREEDY_HANDS_RETRY_CYCLES} cycles of ${authored.length})`);
    const bases = order.map((id) => everything.find((scenario) => scenario.id === id)?.repeat?.ofId ?? id);
    for (let index = 1; index < bases.length; index += 1) {
      if (authored.length > 1 && bases[index] === bases[index - 1]) errors.push(`stage ${stage.id}: ${order[index]} immediately repeats the position before it`);
    }
    for (const scenario of authored) {
      const seen = bases.filter((id) => id === scenario.id).length;
      if (seen !== GREEDY_HANDS_RETRY_CYCLES) errors.push(`stage ${stage.id}: ${scenario.id} is served ${seen} times, expected ${GREEDY_HANDS_RETRY_CYCLES}`);
    }
    if (order[0] !== stage.scenarioRef || bases[0] !== stage.scenarioRef) errors.push(`stage ${stage.id}: the first position served must be the stage opener`);
  }
}

export function validateGreedyHandsContent(definition: { id: string; nodeId: string }): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scenario of GREEDY_HANDS_SCENARIOS) {
    if (ids.has(scenario.id)) errors.push(`duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
    validateScenario(scenario, errors);
  }

  const inSet = (setId: string) => GREEDY_HANDS_SCENARIOS.filter((scenario) => scenario.variantSetId === setId);
  const cost = inSet(GREEDY_HANDS_PRACTICE_COST_VARIANT_SET_ID);
  const take = inSet(GREEDY_HANDS_PRACTICE_TAKE_VARIANT_SET_ID);
  const proof = inSet(GREEDY_HANDS_PROOF_VARIANT_SET_ID);
  if (cost.length < 3) errors.push('greedy-hands cost practice needs at least three positions');
  if (take.length < 3) errors.push('greedy-hands take-it practice needs at least three positions');
  if (proof.length < 4) errors.push('greedy-hands proof needs at least four positions');
  if (cost.some((s) => s.greedy.type !== 'cost')) errors.push('the cost practice pool contains a position of the wrong kind');
  if (take.some((s) => s.greedy.type !== 'take')) errors.push('the take-it practice pool contains a position of the wrong kind');
  if (proof.filter((s) => s.greedy.type === 'cost').length < 2 || proof.filter((s) => s.greedy.type === 'take').length < 2) errors.push('the proof pool must hold at least two positions of each kind');

  // the stage-opening position of each stage is the one a clean run sees, so its kind matters
  const opener = (stageId: string) => {
    const stage = GREEDY_HANDS_LESSON_DEFINITION.stages.find((candidate) => candidate.id === stageId);
    return stage && 'scenarioRef' in stage ? GREEDY_HANDS_SCENARIOS.find((scenario) => scenario.id === stage.scenarioRef) : undefined;
  };
  if (opener('guided-decision')?.greedy.type !== 'cost') errors.push('the guided position must be a "cost" position');
  if (opener('independent-practice')?.greedy.type !== 'cost') errors.push('the cost practice stage must open on a "cost" position');
  if (opener('practice-take')?.greedy.type !== 'take') errors.push('the take-it practice stage must open on a "take it" position');
  if (opener('proof')?.greedy.type !== 'cost') errors.push('the proof must open on a "cost" position, straight after the take-it practice');
  for (const stage of GREEDY_HANDS_LESSON_DEFINITION.stages) {
    if ('scenarioRef' in stage && !GREEDY_HANDS_SCENARIOS.some((scenario) => scenario.id === stage.scenarioRef)) errors.push(`stage ${stage.id} references a missing scenario ${stage.scenarioRef}`);
  }

  // no cosmetic duplicates: positions differ in their ends and answer, and share at most three rack tiles
  const signatures = new Set<string>();
  for (const scenario of GREEDY_HANDS_SCENARIOS) {
    const signature = `${[scenario.board.leftEnd, scenario.board.rightEnd].sort().join('|')}|${scenario.greedy.acceptedKey}`;
    if (signatures.has(signature)) errors.push(`${scenario.id}: duplicates another position's ends and answer`);
    signatures.add(signature);
  }
  for (let i = 0; i < GREEDY_HANDS_SCENARIOS.length; i += 1) {
    for (let j = i + 1; j < GREEDY_HANDS_SCENARIOS.length; j += 1) {
      const a = GREEDY_HANDS_SCENARIOS[i];
      const b = GREEDY_HANDS_SCENARIOS[j];
      if (sameSet(a.playerHand.map(tileLabel), b.playerHand.map(tileLabel)) > 3) errors.push(`${a.id} and ${b.id} share more than three rack tiles`);
    }
  }
  const punishers = new Set(GREEDY_HANDS_SCENARIOS.filter((s) => s.greedy.type === 'cost').map((s) => {
    const tempting = s.greedy.lines[s.greedy.temptingKey];
    return tempting.reply.bestTile ? tileLabel(tempting.reply.bestTile.tile) : 'none';
  }));
  if (punishers.size < 3) errors.push('the "cost" positions should be punished by at least three different replies');

  validateRepeatPolicy(errors);

  if (definition.id !== GREEDY_HANDS_CONTENT_ID || definition.nodeId !== GREEDY_HANDS_NODE_ID) errors.push('greedy-hands definition identity mismatch');
  return errors.sort();
}
