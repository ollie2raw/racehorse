import type { BoardState, Tile } from '../../../types.ts';
import type { JourneyAuthoredMoveAction, JourneyAuthoredScenario } from '../../journeyAuthoredLessonBundle.ts';
import { getCoreJourneyTileSet, getUnseenTileCountForPip } from '../../journeyCounting.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { READING_THE_BONEYARD_PRACTICE_VARIANT_SET_ID, READING_THE_BONEYARD_PROOF_VARIANT_SET_ID } from './readingTheBoneyardLesson.ts';

export type ReadingTheBoneyardScenario = JourneyAuthoredScenario & {
  denialFacts: { acceptedUnseenCount: number; temptingUnseenCount: number };
};

const tile = (low: number, high: number): Tile => ({ low, high });
const core = { kind: 'core_journey' as const, id: CORE_JOURNEY_RULESET_ID };

function singleTileBoard(a: number, b: number): BoardState {
  return { mainLine: [{ tile: tile(a, b), orientation: 'horizontal-normal' }], leftEnd: a, rightEnd: b, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] };
}

function actionKey(action: JourneyAuthoredMoveAction): string {
  return `${action.tile.low}-${action.tile.high}@${action.position}`;
}

function otherPip(t: Tile, matched: number): number {
  return t.low === matched ? t.high : t.low;
}

function unseenForPip(board: BoardState, hand: Tile[], pip: number): number {
  return getUnseenTileCountForPip({ tileSet: getCoreJourneyTileSet(), board, playerHand: hand, pip });
}

function optionsAround(expected: number): number[] {
  return [expected - 1, expected, expected + 1].filter((n) => n >= 0 && n <= 7);
}

function countingScenario(id: string, kind: 'demo' | 'guided', board: BoardState, hand: Tile[], targetPip: number, prompt: string): ReadingTheBoneyardScenario {
  const expected = unseenForPip(board, hand, targetPip);
  return {
    id, variantSetId: null, kind, ruleset: core, board, playerHand: hand,
    interaction: { kind: 'pip_count', targetPip, prompt, options: optionsAround(expected) },
    acceptedActions: [], temptingActions: [], feedbackByAction: {},
    denialFacts: { acceptedUnseenCount: 0, temptingUnseenCount: 0 },
  };
}

function moveScenario(
  id: string,
  kind: 'independent' | 'proof',
  variantSetId: string,
  board: BoardState,
  hand: Tile[],
  accepted: JourneyAuthoredMoveAction,
  tempting: JourneyAuthoredMoveAction,
  prompt: string,
  acceptedFeedback: string,
  temptingFeedback: string,
): ReadingTheBoneyardScenario {
  const acceptedPip = otherPip(accepted.tile, accepted.position === 'left' ? board.leftEnd : board.rightEnd);
  const temptingPip = otherPip(tempting.tile, tempting.position === 'left' ? board.leftEnd : board.rightEnd);
  const acceptedUnseenCount = unseenForPip(board, hand, acceptedPip);
  const temptingUnseenCount = unseenForPip(board, hand, temptingPip);
  if (acceptedUnseenCount >= temptingUnseenCount) {
    throw new Error(`${id}: accepted action must expose a pip with a strictly lower unseen count than the tempting one (${acceptedUnseenCount} vs ${temptingUnseenCount})`);
  }
  const targetPip = acceptedPip;
  const expected = unseenForPip(board, hand, targetPip);
  return {
    id, variantSetId, kind, ruleset: core, board, playerHand: hand,
    interaction: { kind: 'pip_count_then_move', targetPip, prompt, options: optionsAround(expected) },
    acceptedActions: [accepted], temptingActions: [tempting],
    feedbackByAction: { [actionKey(accepted)]: acceptedFeedback, [actionKey(tempting)]: temptingFeedback },
    denialFacts: { acceptedUnseenCount, temptingUnseenCount },
  };
}

const demoBoard = singleTileBoard(2, 4);
const demoHand = [tile(2, 6), tile(4, 1), tile(1, 3)];

export const READING_THE_BONEYARD_SCENARIOS: ReadingTheBoneyardScenario[] = [
  countingScenario('scenario:boneyard-demo', 'demo', demoBoard, demoHand, 6, 'How many 6-tiles remain unseen — waiting in the boneyard or Fritz’s hand?'),
  countingScenario('scenario:boneyard-guided', 'guided', demoBoard, demoHand, 1, 'How many 1-tiles remain unseen?'),
  moveScenario(
    'scenario:boneyard-practice-1', 'independent', READING_THE_BONEYARD_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(1, 5), [tile(1, 4), tile(5, 3), tile(4, 0)],
    { tile: tile(1, 4), position: 'left' }, { tile: tile(5, 3), position: 'right' },
    'Count the unseen tiles for the end you are about to expose, then play toward the safer one.',
    'used_count_with_denial', 'correct_count_exposed_end',
  ),
  moveScenario(
    'scenario:boneyard-practice-2', 'independent', READING_THE_BONEYARD_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(0, 6), [tile(0, 2), tile(6, 4), tile(2, 5)],
    { tile: tile(0, 2), position: 'left' }, { tile: tile(6, 4), position: 'right' },
    'Count the unseen tiles for the end you are about to expose, then play toward the safer one.',
    'used_count_with_denial', 'correct_count_exposed_end',
  ),
  moveScenario(
    'scenario:boneyard-practice-3', 'independent', READING_THE_BONEYARD_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(3, 6), [tile(3, 0), tile(6, 5), tile(0, 2)],
    { tile: tile(3, 0), position: 'left' }, { tile: tile(6, 5), position: 'right' },
    'Count the unseen tiles for the end you are about to expose, then play toward the safer one.',
    'used_count_with_denial', 'correct_count_exposed_end',
  ),
  moveScenario(
    'scenario:boneyard-proof-1', 'proof', READING_THE_BONEYARD_PROOF_VARIANT_SET_ID,
    singleTileBoard(3, 1), [tile(3, 2), tile(1, 6), tile(2, 4)],
    { tile: tile(3, 2), position: 'left' }, { tile: tile(1, 6), position: 'right' },
    'The pool is thinning out. Count the unseen tiles for the end you are about to expose, then play toward the safer one.',
    'recognized_proof_exception', 'correct_count_exposed_end',
  ),
  moveScenario(
    'scenario:boneyard-proof-2', 'proof', READING_THE_BONEYARD_PROOF_VARIANT_SET_ID,
    singleTileBoard(6, 2), [tile(6, 5), tile(2, 0), tile(5, 3)],
    { tile: tile(6, 5), position: 'left' }, { tile: tile(2, 0), position: 'right' },
    'The pool is thinning out. Count the unseen tiles for the end you are about to expose, then play toward the safer one.',
    'recognized_proof_exception', 'correct_count_exposed_end',
  ),
];
