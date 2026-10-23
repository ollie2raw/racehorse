import type { PlacementPosition } from '../../../types.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import type { JourneyAuthoredMoveAction, JourneyAuthoredScenario, JourneyBoardDemonstrationStep, JourneyFeedbackAsset } from '../../journeyAuthoredLessonBundle.ts';
import { actionKey, analyzeGreedyLine, legalFirstActions, tileLabel, type GreedyLineFacts } from './greedyHandsFacts.ts';
import { buildMoveFeedback, describeLedger, describeReply } from './greedyHandsFeedback.ts';
import { GREEDY_HANDS_POSITION_SPECS, type GreedyHandsPositionSpec, type GreedyHandsPositionType } from './greedyHandsPositions.ts';
import {
  GREEDY_HANDS_PRACTICE_COST_VARIANT_SET_ID,
  GREEDY_HANDS_PRACTICE_TAKE_VARIANT_SET_ID,
  GREEDY_HANDS_PROOF_VARIANT_SET_ID,
} from './greedyHandsLesson.ts';

export type GreedyHandsScenario = JourneyAuthoredScenario & {
  greedy: {
    type: GreedyHandsPositionType;
    /** Facts for EVERY legal first play, keyed by `actionKey`. */
    lines: Record<string, GreedyLineFacts>;
    acceptedKey: string;
    temptingKey: string;
  };
  /** Present only on an explicit repeat of an authored position (see `GREEDY_HANDS_REPEAT_SCENARIOS`). */
  repeat?: { ofId: string; cycle: number };
};

const core = { kind: 'core_journey' as const, id: CORE_JOURNEY_RULESET_ID };

function parseAction(spec: GreedyHandsPositionSpec, text: string): JourneyAuthoredMoveAction {
  const match = /^(\d)-(\d)@(left|right)$/.exec(text);
  if (!match) throw new Error(`${spec.id}: malformed action ${text}`);
  return { tile: { low: Number(match[1]), high: Number(match[2]) }, position: match[3] as PlacementPosition };
}

/** Where each authored position sits in the lesson: its scenario ID, its kind, and the retry pool it belongs to. */
function placement(id: string): { scenarioId: string; kind: JourneyAuthoredScenario['kind']; variantSetId: string | null } {
  if (id === 'demo') return { scenarioId: 'scenario:greedy-demo', kind: 'demo', variantSetId: null };
  if (id === 'guided') return { scenarioId: 'scenario:greedy-guided', kind: 'guided', variantSetId: null };
  if (id.startsWith('practice-cost-')) return { scenarioId: `scenario:greedy-${id}`, kind: 'independent', variantSetId: GREEDY_HANDS_PRACTICE_COST_VARIANT_SET_ID };
  if (id.startsWith('practice-take-')) return { scenarioId: `scenario:greedy-${id}`, kind: 'independent', variantSetId: GREEDY_HANDS_PRACTICE_TAKE_VARIANT_SET_ID };
  if (id.startsWith('proof-')) return { scenarioId: `scenario:greedy-${id}`, kind: 'proof', variantSetId: GREEDY_HANDS_PROOF_VARIANT_SET_ID };
  throw new Error(`unplaced Greedy Hands position ${id}`);
}

export const GREEDY_HANDS_GENERATED_FEEDBACK: Record<string, JourneyFeedbackAsset> = {};

function demonstrationSteps(scenario: JourneyAuthoredScenario, greedyLine: GreedyLineFacts, quietLine: GreedyLineFacts): JourneyBoardDemonstrationStep[] {
  const [first, second] = greedyLine.steps;
  if (!second || quietLine.steps.length !== 1) throw new Error(`${scenario.id}: the walk-through needs a two-play greedy line and a one-play quiet line`);
  const [left, right] = greedyLine.finalEnds;
  const quiet = quietLine.steps[0];
  return [
    {
      id: 'turn-demo-position', kind: 'position',
      caption: 'Before you take the points, read the whole turn.',
      boardDescription: `The open ends are ${scenario.board.leftEnd} and ${scenario.board.rightEnd}. You hold ${scenario.playerHand.map(tileLabel).join(', ')}. Open ends that add up to a multiple of 5 score one point for every 5, and a double sitting on an end counts both halves.`,
      board: scenario.board,
      highlightedEnds: [scenario.board.leftEnd, scenario.board.rightEnd],
    },
    {
      id: 'turn-demo-score', kind: 'preview_move',
      caption: 'Take the score.',
      boardDescription: `${tileLabel(first.tile)} on the ${first.position} makes the open ends add up to ${first.endTotal}, so it scores ${first.points}.`,
      board: greedyLine.stepBoards[0],
      action: { tile: first.tile, position: first.position },
    },
    {
      id: 'turn-demo-forced', kind: 'preview_move',
      caption: 'A score keeps your turn going.',
      boardDescription: `${tileLabel(second.tile)} is the only tile you can still play, so it goes on the ${second.position}. Your turn ends with ${left} and ${right} open.`,
      board: greedyLine.stepBoards[1],
      action: { tile: second.tile, position: second.position },
      highlightedEnds: [left, right],
    },
    {
      id: 'turn-demo-reply', kind: 'position',
      caption: 'Now count what you left.',
      boardDescription: `${describeReply(greedyLine)} It is a floor, not a forecast: they may not hold that tile. ${describeLedger(greedyLine)}`,
      board: greedyLine.finalBoard,
      highlightedEnds: [left, right],
    },
    {
      id: 'turn-demo-quiet', kind: 'preview_move',
      caption: 'Or play the quiet tile.',
      boardDescription: `${tileLabel(quiet.tile)} on the ${quiet.position} scores nothing and ends your turn with ${quietLine.finalEnds[0]} and ${quietLine.finalEnds[1]} open. ${describeReply(quietLine)} ${describeLedger(quietLine)}`,
      board: quietLine.stepBoards[0],
      action: { tile: quiet.tile, position: quiet.position },
      highlightedEnds: [quietLine.finalEnds[0], quietLine.finalEnds[1]],
    },
  ];
}

function buildScenario(spec: GreedyHandsPositionSpec): GreedyHandsScenario {
  const { scenarioId, kind, variantSetId } = placement(spec.id);
  const base: JourneyAuthoredScenario = {
    id: scenarioId, variantSetId, kind, ruleset: core, board: spec.board, playerHand: spec.rack,
    interaction: { kind: 'move' }, acceptedActions: [], temptingActions: [], feedbackByAction: {},
  };
  const accepted = parseAction(spec, spec.accepted);
  const tempting = parseAction(spec, spec.tempting);
  const lines: Record<string, GreedyLineFacts> = {};
  for (const action of legalFirstActions(base)) {
    const result = analyzeGreedyLine(base, action);
    if (result.kind !== 'line') throw new Error(`${spec.id}: ${actionKey(action)} cannot be played out deterministically (${result.reason})`);
    lines[actionKey(action)] = result.facts;
  }
  const acceptedLine = lines[actionKey(accepted)];
  const temptingLine = lines[actionKey(tempting)];
  if (!acceptedLine || !temptingLine) throw new Error(`${spec.id}: the authored answer or tempting play is not a legal first play`);

  const feedbackByAction: Record<string, string> = {};
  for (const [key, chosen] of Object.entries(lines)) {
    const role = key === actionKey(accepted) ? 'accepted' : key === actionKey(tempting) ? 'tempting' : 'other';
    const feedbackKey = `greedy:${spec.id}:${key}`;
    GREEDY_HANDS_GENERATED_FEEDBACK[feedbackKey] = buildMoveFeedback({ key: feedbackKey, positionType: spec.type, role, chosen, accepted: acceptedLine, tempting: temptingLine });
    feedbackByAction[key] = feedbackKey;
  }
  return {
    ...base,
    acceptedActions: [accepted],
    temptingActions: [tempting],
    feedbackByAction,
    ...(kind === 'demo' ? { demonstrationSteps: demonstrationSteps(base, spec.type === 'cost' ? temptingLine : acceptedLine, spec.type === 'cost' ? acceptedLine : temptingLine) } : {}),
    greedy: { type: spec.type, lines, acceptedKey: actionKey(accepted), temptingKey: actionKey(tempting) },
  };
}

/** The authored positions: 12 distinct decisions. Validation, teaching claims and the stage openers are about THESE. */
export const GREEDY_HANDS_SCENARIOS: GreedyHandsScenario[] = GREEDY_HANDS_POSITION_SPECS.map(buildScenario);

/**
 * RETRY POLICY — what happens when a pool runs out.
 *
 * The lesson controller (rightly) never lets a `fresh_variant` retry reuse a scenario ID, and the host serves the next
 * UNUSED position of the stage's pool. With a pool of 3-4 positions a few misses would leave nothing to serve and
 * the stage stuck. So each pool is served in CYCLES: after the authored positions come explicit repeat copies, each
 * with its OWN scenario ID (so the controller sees a fresh variant) but the same board, rack, answer and
 * engine-derived facts as the position it repeats. Nothing about grading changes; a repeat is graded by exactly the
 * same evaluator against exactly the same facts.
 *
 * Order is deterministic and avoids an immediate cosmetic repeat: cycle 1 is the authored order; cycle `c` starts
 * `c - 1` places further along the pool (rotated), so the position that ends one cycle is never the one that
 * starts the next while the pool has more than one position. IDs sort in play order (`…-1`, `…-2`, `…-r02-1`,
 * `…-r02-2`, …) because the host picks the first unused ID in `localeCompare` order.
 *
 * It is finite by design: `GREEDY_HANDS_RETRY_CYCLES` passes through each pool (24 / 24 / 32 positions served
 * across the cost practice, take-it practice and proof stages). The controller bounds a session's recorded outcomes
 * and a stage's scenario history at 128, so "unlimited" is not available without changing the shared controller;
 * eight cycles stays inside that bound with a wide margin, and a player who misses that many times in one stage ends
 * in the same visible, never-completing stuck state as before — not a pass.
 */
export const GREEDY_HANDS_RETRY_CYCLES = 8;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** `scenario:greedy-practice-cost-1` → `scenario:greedy-practice-cost` */
const poolPrefix = (scenarioId: string): string => scenarioId.replace(/-\d+$/, '');

export function buildGreedyHandsRepeatScenarios(authored: ReadonlyArray<GreedyHandsScenario>, cycles: number): GreedyHandsScenario[] {
  const pools = new Map<string, GreedyHandsScenario[]>();
  for (const scenario of authored) {
    if (!scenario.variantSetId) continue; // the walk-through and the guided position are not retry pools (guided repeats the SAME position)
    pools.set(scenario.variantSetId, [...(pools.get(scenario.variantSetId) ?? []), scenario]);
  }
  const repeats: GreedyHandsScenario[] = [];
  for (const pool of pools.values()) {
    const ordered = [...pool].sort((a, b) => a.id.localeCompare(b.id));
    for (let cycle = 2; cycle <= cycles; cycle += 1) {
      for (let offset = 0; offset < ordered.length; offset += 1) {
        const source = ordered[(cycle - 1 + offset) % ordered.length];
        repeats.push({ ...source, id: `${poolPrefix(source.id)}-r${pad2(cycle)}-${offset + 1}`, repeat: { ofId: source.id, cycle } });
      }
    }
  }
  return repeats;
}

export const GREEDY_HANDS_REPEAT_SCENARIOS: GreedyHandsScenario[] = buildGreedyHandsRepeatScenarios(GREEDY_HANDS_SCENARIOS, GREEDY_HANDS_RETRY_CYCLES);
