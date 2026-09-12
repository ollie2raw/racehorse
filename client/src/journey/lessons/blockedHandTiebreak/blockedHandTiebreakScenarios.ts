import type { BoardState, Tile } from '../../../types.ts';
import type { JourneyAuthoredMoveAction, JourneyAuthoredScenario, JourneyBoardDemonstrationStep } from '../../journeyAuthoredLessonBundle.ts';
import { previewPlayMove } from '../../../modules/match/runtime/botEngine.ts';
import { createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { BLOCKED_HAND_TIEBREAK_PRACTICE_VARIANT_SET_ID, BLOCKED_HAND_TIEBREAK_PROOF_VARIANT_SET_ID } from './blockedHandTiebreakLesson.ts';

export type BlockedHandTiebreakScenario = JourneyAuthoredScenario & {
  pipTotalFacts: { acceptedRemainingPips: number; temptingRemainingPips: number };
};

const tile = (low: number, high: number): Tile => ({ low, high });
const core = { kind: 'core_journey' as const, id: CORE_JOURNEY_RULESET_ID };

function singleTileBoard(a: number, b: number): BoardState {
  return { mainLine: [{ tile: tile(a, b), orientation: 'horizontal-normal' }], leftEnd: a, rightEnd: b, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] };
}

function pipSum(hand: Tile[]): number {
  return hand.reduce((sum, t) => sum + t.low + t.high, 0);
}

function actionKey(action: JourneyAuthoredMoveAction): string {
  return `${action.tile.low}-${action.tile.high}@${action.position}`;
}

function remainingAfter(board: BoardState, hand: Tile[], action: JourneyAuthoredMoveAction): number {
  const state = createJourneyScenarioState({ id: 'tmp', variantSetId: null, kind: 'demo', ruleset: core, board, playerHand: hand, interaction: { kind: 'move' }, acceptedActions: [], temptingActions: [], feedbackByAction: {} });
  const preview = previewPlayMove(state, 'you', { type: 'play', tile: action.tile, position: action.position });
  if (!preview) throw new Error(`blocked-hand-tiebreak: ${actionKey(action)} is not a legal preview against this board`);
  return pipSum(preview.nextHand);
}

function scenario(
  id: string,
  kind: BlockedHandTiebreakScenario['kind'],
  variantSetId: string | null,
  board: BoardState,
  hand: Tile[],
  accepted: JourneyAuthoredMoveAction,
  tempting: JourneyAuthoredMoveAction,
  acceptedFeedback: string,
  temptingFeedback: string,
): BlockedHandTiebreakScenario {
  const acceptedRemainingPips = remainingAfter(board, hand, accepted);
  const temptingRemainingPips = remainingAfter(board, hand, tempting);
  if (acceptedRemainingPips >= temptingRemainingPips) {
    throw new Error(`${id}: accepted action must leave a lower remaining pip total than the tempting one (${acceptedRemainingPips} vs ${temptingRemainingPips})`);
  }
  return {
    id, variantSetId, kind, ruleset: core, board, playerHand: hand, interaction: { kind: 'move' },
    acceptedActions: [accepted], temptingActions: [tempting],
    feedbackByAction: { [actionKey(accepted)]: acceptedFeedback, [actionKey(tempting)]: temptingFeedback },
    pipTotalFacts: { acceptedRemainingPips, temptingRemainingPips },
  };
}

const demoBoard = singleTileBoard(4, 2);
const demoHand = [tile(2, 3), tile(4, 6), tile(5, 5)];
const demoAccepted = { tile: tile(4, 6), position: 'left' as const };
const demoTempting = { tile: tile(2, 3), position: 'right' as const };

const demoSteps: JourneyBoardDemonstrationStep[] = [
  { id: 'tiebreak-demo-position', kind: 'position', caption: 'Both tiles are legal here.', boardDescription: 'You hold 2-3, 4-6, and the double 5-5. Either 2-3 or 4-6 can be played right now.', board: demoBoard, highlightedEnds: [4, 2] },
  { id: 'tiebreak-demo-tempting', kind: 'preview_move', caption: 'Play the low tile first.', boardDescription: 'Playing 2-3 feels tidy, but it leaves 4-6 and the 5-5 double sitting in your hand — 20 pips of exposure if the hand blocks.', board: previewPlayMove(createJourneyScenarioState({ id: 'demo', variantSetId: null, kind: 'demo', ruleset: core, board: demoBoard, playerHand: demoHand, interaction: { kind: 'move' }, acceptedActions: [], temptingActions: [], feedbackByAction: {} }), 'you', { type: 'play', tile: demoTempting.tile, position: demoTempting.position })!.nextBoard, action: demoTempting, highlightedEnds: [4, 2] },
  { id: 'tiebreak-demo-accepted', kind: 'preview_move', caption: 'Compare playing 4-6 instead.', boardDescription: 'This leaves 2-3 and the 5-5 double — 15 pips. Same legality, five fewer pips sitting in your hand if the hand blocks.', board: previewPlayMove(createJourneyScenarioState({ id: 'demo', variantSetId: null, kind: 'demo', ruleset: core, board: demoBoard, playerHand: demoHand, interaction: { kind: 'move' }, acceptedActions: [], temptingActions: [], feedbackByAction: {} }), 'you', { type: 'play', tile: demoAccepted.tile, position: demoAccepted.position })!.nextBoard, action: demoAccepted, highlightedEnds: [4, 2] },
];

export const BLOCKED_HAND_TIEBREAK_SCENARIOS: BlockedHandTiebreakScenario[] = [
  { ...scenario('scenario:tiebreak-demo', 'demo', null, demoBoard, demoHand, demoAccepted, demoTempting, 'kept_hand_light', 'loaded_up_on_pips'), demonstrationSteps: demoSteps },
  scenario('scenario:tiebreak-guided', 'guided', null, demoBoard, demoHand, demoAccepted, demoTempting, 'kept_hand_light', 'loaded_up_on_pips'),
  scenario(
    'scenario:tiebreak-practice-1', 'independent', BLOCKED_HAND_TIEBREAK_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(6, 1), [tile(1, 4), tile(6, 3), tile(5, 5)],
    { tile: tile(6, 3), position: 'left' }, { tile: tile(1, 4), position: 'right' },
    'recognized_tiebreak_math', 'ignored_pip_math',
  ),
  scenario(
    'scenario:tiebreak-practice-2', 'independent', BLOCKED_HAND_TIEBREAK_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(3, 0), [tile(0, 5), tile(3, 1), tile(6, 6)],
    { tile: tile(0, 5), position: 'right' }, { tile: tile(3, 1), position: 'left' },
    'recognized_tiebreak_math', 'ignored_pip_math',
  ),
  scenario(
    'scenario:tiebreak-practice-3', 'independent', BLOCKED_HAND_TIEBREAK_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(2, 5), [tile(5, 1), tile(2, 6), tile(4, 4)],
    { tile: tile(2, 6), position: 'left' }, { tile: tile(5, 1), position: 'right' },
    'recognized_tiebreak_math', 'ignored_pip_math',
  ),
  scenario(
    'scenario:tiebreak-proof-1', 'proof', BLOCKED_HAND_TIEBREAK_PROOF_VARIANT_SET_ID,
    singleTileBoard(1, 3), [tile(3, 6), tile(1, 0), tile(5, 5)],
    { tile: tile(3, 6), position: 'right' }, { tile: tile(1, 0), position: 'left' },
    'recognized_tiebreak_math', 'ignored_pip_math',
  ),
  scenario(
    'scenario:tiebreak-proof-2', 'proof', BLOCKED_HAND_TIEBREAK_PROOF_VARIANT_SET_ID,
    singleTileBoard(4, 0), [tile(0, 2), tile(4, 5), tile(6, 6)],
    { tile: tile(4, 5), position: 'left' }, { tile: tile(0, 2), position: 'right' },
    'recognized_tiebreak_math', 'ignored_pip_math',
  ),
];
