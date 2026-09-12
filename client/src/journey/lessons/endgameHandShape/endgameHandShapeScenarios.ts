import type { BoardState, Tile } from '../../../types.ts';
import type { JourneyAuthoredMoveAction, JourneyAuthoredScenario, JourneyBoardDemonstrationStep } from '../../journeyAuthoredLessonBundle.ts';
import { analyzeJourneyAuthoredMove, createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { previewPlayMove } from '../../../modules/match/runtime/botEngine.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { ENDGAME_HAND_SHAPE_PRACTICE_VARIANT_SET_ID, ENDGAME_HAND_SHAPE_PROOF_VARIANT_SET_ID } from './endgameHandShapeLesson.ts';

export type EndgameHandShapeScenario = JourneyAuthoredScenario & {
  shapeFacts: { acceptedRemainingLegal: number; temptingRemainingLegal: number };
};

const tile = (low: number, high: number): Tile => ({ low, high });
const core = { kind: 'core_journey' as const, id: CORE_JOURNEY_RULESET_ID };

function singleTileBoard(a: number, b: number): BoardState {
  return { mainLine: [{ tile: tile(a, b), orientation: 'horizontal-normal' }], leftEnd: a, rightEnd: b, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] };
}

function actionKey(action: JourneyAuthoredMoveAction): string {
  return `${action.tile.low}-${action.tile.high}@${action.position}`;
}

function baseScenario(board: BoardState, hand: Tile[]): JourneyAuthoredScenario {
  return { id: 'tmp', variantSetId: null, kind: 'demo', ruleset: core, board, playerHand: hand, interaction: { kind: 'move' }, acceptedActions: [], temptingActions: [], feedbackByAction: {} };
}

function scenario(
  id: string,
  kind: EndgameHandShapeScenario['kind'],
  variantSetId: string | null,
  board: BoardState,
  hand: Tile[],
  accepted: JourneyAuthoredMoveAction,
  tempting: JourneyAuthoredMoveAction,
  acceptedFeedback: string,
  temptingFeedback: string,
): EndgameHandShapeScenario {
  const base = baseScenario(board, hand);
  const acceptedRemainingLegal = analyzeJourneyAuthoredMove(base, accepted).remainingLegalActionCount;
  const temptingRemainingLegal = analyzeJourneyAuthoredMove(base, tempting).remainingLegalActionCount;
  if (acceptedRemainingLegal <= temptingRemainingLegal) {
    throw new Error(`${id}: accepted action must leave strictly more remaining legal actions than the tempting one (${acceptedRemainingLegal} vs ${temptingRemainingLegal})`);
  }
  return {
    id, variantSetId, kind, ruleset: core, board, playerHand: hand, interaction: { kind: 'move' },
    acceptedActions: [accepted], temptingActions: [tempting],
    feedbackByAction: { [actionKey(accepted)]: acceptedFeedback, [actionKey(tempting)]: temptingFeedback },
    shapeFacts: { acceptedRemainingLegal, temptingRemainingLegal },
  };
}

const demoBoard = singleTileBoard(2, 4);
const demoHand = [tile(2, 6), tile(4, 1), tile(6, 3)];
const demoAccepted = { tile: tile(2, 6), position: 'left' as const };
const demoTempting = { tile: tile(4, 1), position: 'right' as const };
const demoBase = baseScenario(demoBoard, demoHand);

const demoSteps: JourneyBoardDemonstrationStep[] = [
  { id: 'shape-demo-position', kind: 'position', caption: 'Three tiles, two ends.', boardDescription: 'You hold 2-6, 4-1, and 6-3. The 2 and the 4 ends are both live right now.', board: demoBoard, highlightedEnds: [2, 4] },
  { id: 'shape-demo-tempting', kind: 'preview_move', caption: 'Play the 4-end tile.', boardDescription: 'Playing 4-1 turns the right end to 1. Your 6-3 no longer matches either end — it goes dead in your hand.', board: previewPlayMove(createJourneyScenarioState(demoBase), 'you', { type: 'play', tile: demoTempting.tile, position: demoTempting.position })!.nextBoard, action: demoTempting, highlightedEnds: [2, 4] },
  { id: 'shape-demo-accepted', kind: 'preview_move', caption: 'Compare playing 2-6 instead.', boardDescription: 'This turns the left end to 6, and the right end stays 4. Both 4-1 and 6-3 still have a legal reply — your whole hand stays live.', board: previewPlayMove(createJourneyScenarioState(demoBase), 'you', { type: 'play', tile: demoAccepted.tile, position: demoAccepted.position })!.nextBoard, action: demoAccepted, highlightedEnds: [2, 4] },
];

export const ENDGAME_HAND_SHAPE_SCENARIOS: EndgameHandShapeScenario[] = [
  { ...scenario('scenario:shape-demo', 'demo', null, demoBoard, demoHand, demoAccepted, demoTempting, 'kept_hand_alive', 'stranded_a_tile'), demonstrationSteps: demoSteps },
  scenario('scenario:shape-guided', 'guided', null, demoBoard, demoHand, demoAccepted, demoTempting, 'kept_hand_alive', 'stranded_a_tile'),
  scenario(
    'scenario:shape-practice-1', 'independent', ENDGAME_HAND_SHAPE_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(1, 5), [tile(1, 4), tile(5, 3), tile(4, 0)],
    { tile: tile(1, 4), position: 'left' }, { tile: tile(5, 3), position: 'right' },
    'recognized_shape_math', 'ignored_shape_math',
  ),
  scenario(
    'scenario:shape-practice-2', 'independent', ENDGAME_HAND_SHAPE_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(0, 6), [tile(0, 2), tile(6, 4), tile(2, 5)],
    { tile: tile(0, 2), position: 'left' }, { tile: tile(6, 4), position: 'right' },
    'recognized_shape_math', 'ignored_shape_math',
  ),
  scenario(
    'scenario:shape-practice-3', 'independent', ENDGAME_HAND_SHAPE_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(4, 6), [tile(4, 1), tile(6, 5), tile(1, 3)],
    { tile: tile(4, 1), position: 'left' }, { tile: tile(6, 5), position: 'right' },
    'recognized_shape_math', 'ignored_shape_math',
  ),
  scenario(
    'scenario:shape-proof-1', 'proof', ENDGAME_HAND_SHAPE_PROOF_VARIANT_SET_ID,
    singleTileBoard(3, 1), [tile(3, 5), tile(1, 2), tile(5, 6)],
    { tile: tile(3, 5), position: 'left' }, { tile: tile(1, 2), position: 'right' },
    'recognized_shape_math', 'ignored_shape_math',
  ),
  scenario(
    'scenario:shape-proof-2', 'proof', ENDGAME_HAND_SHAPE_PROOF_VARIANT_SET_ID,
    singleTileBoard(6, 2), [tile(6, 0), tile(2, 4), tile(0, 1)],
    { tile: tile(6, 0), position: 'left' }, { tile: tile(2, 4), position: 'right' },
    'recognized_shape_math', 'ignored_shape_math',
  ),
];
