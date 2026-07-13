import {
  computeOpenEndsSum,
  getLegalMoves,
  getMatchableOpenEnds,
  previewPlayMove,
  type BotMatchState,
} from '../../../modules/match/runtime/botEngine.ts';
import type { BoardState, Move, PlacementPosition, Tile } from '../../../types.ts';
import type { JourneyRulesetRef } from '../../journeyContentContract.ts';
import type { JourneyAuthoredMoveAction, JourneyAuthoredScenario } from '../../journeyAuthoredLessonBundle.ts';

export type OpenEndDisciplineScenarioKind = 'demo' | 'guided' | 'independent' | 'proof';

export type OpenEndDisciplineAction = JourneyAuthoredMoveAction;

export type OpenEndDisciplineScenario = JourneyAuthoredScenario & { kind: OpenEndDisciplineScenarioKind; interaction: { kind: 'move' } };

const coreRuleset: JourneyRulesetRef = { kind: 'core_journey', id: 'racehorse-core-journey' };

function tile(low: number, high: number): Tile {
  return { low, high };
}

function board(mainLine: Array<{ tile: Tile; orientation: 'horizontal-normal' | 'horizontal-flipped' }>, leftEnd: number, rightEnd: number): BoardState {
  return {
    mainLine,
    leftEnd,
    rightEnd,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
    hubDoubles: [],
  };
}

const guidedBoard = board([
  { tile: tile(1, 2), orientation: 'horizontal-normal' },
  { tile: tile(2, 5), orientation: 'horizontal-normal' },
  { tile: tile(3, 5), orientation: 'horizontal-flipped' },
], 1, 3);

const proofBoard = board([
  { tile: tile(2, 6), orientation: 'horizontal-normal' },
  { tile: tile(4, 6), orientation: 'horizontal-flipped' },
], 2, 4);

export const OPEN_END_DISCIPLINE_SCENARIOS: OpenEndDisciplineScenario[] = [
  {
    id: 'scenario:open-end-demo',
    variantSetId: null,
    kind: 'demo',
    ruleset: coreRuleset,
    board: guidedBoard,
    playerHand: [],
    interaction: { kind: 'move' },
    acceptedActions: [],
    temptingActions: [],
    feedbackByAction: {},
  },
  {
    id: 'scenario:open-end-guided',
    variantSetId: null,
    kind: 'guided',
    ruleset: coreRuleset,
    board: guidedBoard,
    playerHand: [tile(1, 4), tile(3, 6), tile(1, 3)],
    interaction: { kind: 'move' },
    acceptedActions: [{ tile: tile(1, 4), position: 'left' }],
    temptingActions: [{ tile: tile(3, 6), position: 'right' }],
    feedbackByAction: {
      '1-4@left': 'controlled_one_end',
      '3-6@right': 'gave_opponent_flexible_reply',
    },
  },
  {
    id: 'scenario:open-end-practice-1',
    variantSetId: 'variants:open-end-practice',
    kind: 'independent',
    ruleset: coreRuleset,
    board: board([
      { tile: tile(1, 2), orientation: 'horizontal-normal' },
      { tile: tile(2, 5), orientation: 'horizontal-normal' },
      { tile: tile(3, 5), orientation: 'horizontal-flipped' },
    ], 1, 3),
    playerHand: [tile(1, 5), tile(3, 4)],
    interaction: { kind: 'move' },
    acceptedActions: [{ tile: tile(1, 5), position: 'left' }],
    temptingActions: [{ tile: tile(3, 4), position: 'right' }],
    feedbackByAction: {
      '1-5@left': 'preserved_pressure',
      '3-4@right': 'opened_both_ends_without_compensation',
    },
  },
  {
    id: 'scenario:open-end-practice-2',
    variantSetId: 'variants:open-end-practice',
    kind: 'independent',
    ruleset: coreRuleset,
    board: board([
      { tile: tile(2, 3), orientation: 'horizontal-normal' },
      { tile: tile(3, 6), orientation: 'horizontal-normal' },
      { tile: tile(4, 6), orientation: 'horizontal-flipped' },
    ], 2, 4),
    playerHand: [tile(2, 5), tile(4, 1)],
    interaction: { kind: 'move' },
    acceptedActions: [{ tile: tile(2, 5), position: 'left' }],
    temptingActions: [{ tile: tile(4, 1), position: 'right' }],
    feedbackByAction: {
      '2-5@left': 'controlled_one_end',
      '4-1@right': 'gave_opponent_flexible_reply',
    },
  },
  {
    id: 'scenario:open-end-practice-3',
    variantSetId: 'variants:open-end-practice',
    kind: 'independent',
    ruleset: coreRuleset,
    board: board([
      { tile: tile(0, 4), orientation: 'horizontal-normal' },
      { tile: tile(4, 5), orientation: 'horizontal-normal' },
      { tile: tile(3, 5), orientation: 'horizontal-flipped' },
    ], 0, 3),
    playerHand: [tile(0, 6), tile(3, 2)],
    interaction: { kind: 'move' },
    acceptedActions: [{ tile: tile(0, 6), position: 'left' }],
    temptingActions: [{ tile: tile(3, 2), position: 'right' }],
    feedbackByAction: {
      '0-6@left': 'preserved_pressure',
      '3-2@right': 'opened_both_ends_without_compensation',
    },
  },
  {
    id: 'scenario:open-end-proof',
    variantSetId: null,
    kind: 'proof',
    ruleset: coreRuleset,
    board: proofBoard,
    playerHand: [tile(2, 2), tile(4, 1)],
    interaction: { kind: 'move' },
    acceptedActions: [{ tile: tile(2, 2), position: 'left' }],
    temptingActions: [{ tile: tile(4, 1), position: 'right' }],
    feedbackByAction: {
      '2-2@left': 'recognized_exception',
      '4-1@right': 'opened_both_ends_without_compensation',
    },
  },
];

export const OPEN_END_DISCIPLINE_VARIANT_SET_ID = 'variants:open-end-practice';

export function actionKey(action: OpenEndDisciplineAction): string {
  return `${action.tile.low}-${action.tile.high}@${action.position}`;
}

export function scenarioState(scenario: OpenEndDisciplineScenario): BotMatchState {
  return {
    players: { you: { hand: scenario.playerHand.map((entry) => ({ ...entry })), score: 0 }, bot: { hand: [], score: 0 } },
    board: JSON.parse(JSON.stringify(scenario.board)) as BoardState,
    boneyard: [],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
  };
}

export function getScenarioLegalActions(scenario: OpenEndDisciplineScenario): OpenEndDisciplineAction[] {
  return getLegalMoves(scenarioState(scenario), 'you')
    .filter((move): move is Move & { type: 'play'; tile: Tile; position: PlacementPosition } => move.type === 'play' && Boolean(move.tile && move.position))
    .map((move) => ({ tile: { ...move.tile }, position: move.position }));
}

export function scenarioOpenEnds(scenario: OpenEndDisciplineScenario): number[] {
  return getMatchableOpenEnds(scenarioState(scenario).board).map((end) => end.matchValue);
}

export function previewScenarioAction(scenario: OpenEndDisciplineScenario, action: OpenEndDisciplineAction) {
  return previewPlayMove(scenarioState(scenario), 'you', { type: 'play', tile: action.tile, position: action.position });
}

export function scenarioOpenEndSum(scenario: OpenEndDisciplineScenario, action: OpenEndDisciplineAction): number | null {
  const preview = previewScenarioAction(scenario, action);
  return preview ? computeOpenEndsSum(preview.nextBoard) : null;
}
