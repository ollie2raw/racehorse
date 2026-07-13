import type { BoardState, Tile } from '../../../types.ts';
import type { JourneyAuthoredMoveAction, JourneyAuthoredScenario, JourneyBoardDemonstrationStep } from '../../journeyAuthoredLessonBundle.ts';
import { createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { previewPlayMove } from '../../../modules/match/runtime/botEngine.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { DOUBLES_PRACTICE_VARIANT_SET_ID, DOUBLES_PROOF_VARIANT_SET_ID } from './doublesArentFreeLesson.ts';

export type DoublesDecisionPrinciple = 'preserve_continuation' | 'avoid_unsupported_double' | 'take_scoring_window' | 'exit_hand' | 'play_supported_double' | 'avoid_missed_double_window';
export type DoublesScenario = JourneyAuthoredScenario & {
  doublesFacts: { principle: DoublesDecisionPrinciple; acceptedPlayedDouble: boolean; temptingPlayedDouble: boolean };
};
const tile = (low: number, high: number): Tile => ({ low, high });
const baseBoard: BoardState = { mainLine: [{ tile: tile(3, 1), orientation: 'horizontal-normal' }, { tile: tile(1, 2), orientation: 'horizontal-normal' }, { tile: tile(2, 4), orientation: 'horizontal-normal' }], leftEnd: 3, rightEnd: 4, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] };
const double = { tile: tile(4, 4), position: 'right' as const };
const nonDouble = { tile: tile(3, 6), position: 'left' as const };
const core = { kind: 'core_journey' as const, id: CORE_JOURNEY_RULESET_ID };
function actionKey(action: JourneyAuthoredMoveAction): string { return `${action.tile.low}-${action.tile.high}@${action.position}`; }
const holdHand = [tile(4, 4), tile(3, 6), tile(5, 6)];
const playHand = [tile(4, 4), tile(3, 6)];
function previewBoard(action: JourneyAuthoredMoveAction): BoardState { return previewPlayMove(createJourneyScenarioState({ id: 'demo-state', variantSetId: null, kind: 'demo', ruleset: core, board: baseBoard, playerHand: holdHand, interaction: { kind: 'move' }, acceptedActions: [], temptingActions: [], feedbackByAction: {} }), 'you', { type: 'play', tile: action.tile, position: action.position })!.nextBoard; }
function scenario(id: string, kind: DoublesScenario['kind'], variantSetId: string | null, hand: Tile[], accepted: JourneyAuthoredMoveAction, tempting: JourneyAuthoredMoveAction, principle: DoublesDecisionPrinciple, acceptedPlayedDouble: boolean, temptingPlayedDouble: boolean, acceptedFeedback: string, temptingFeedback: string): DoublesScenario {
  return { id, variantSetId, kind, ruleset: core, board: baseBoard, playerHand: hand, interaction: { kind: 'move' }, acceptedActions: [accepted], temptingActions: [tempting], feedbackByAction: { [actionKey(accepted)]: acceptedFeedback, [actionKey(tempting)]: temptingFeedback }, doublesFacts: { principle, acceptedPlayedDouble, temptingPlayedDouble } };
}
const demoSteps: JourneyBoardDemonstrationStep[] = [
  { id: 'doubles-demo-position', kind: 'position', caption: 'Start with the whole hand in view.', boardDescription: 'The 2-2 is legal on the right. The 1-6 is legal on the left. The question is what remains after either commitment.', board: baseBoard, highlightedEnds: [1, 2] },
  { id: 'doubles-demo-double', kind: 'preview_move', caption: 'Preview the tempting double.', boardDescription: 'The double changes the position, but the remaining hand is now the thing to inspect.', board: previewBoard(double), action: double, highlightedEnds: [1, 2] },
  { id: 'doubles-demo-continuation', kind: 'preview_move', caption: 'Compare the non-double continuation.', boardDescription: 'The stronger line is the one that leaves a useful next play. The double was legal. The cost was your next turn.', board: previewBoard(nonDouble), action: nonDouble, highlightedEnds: [1, 2] },
];
export const DOUBLES_ARENT_FREE_SCENARIOS: DoublesScenario[] = [
  { ...scenario('scenario:doubles-demo', 'demo', null, holdHand, nonDouble, double, 'preserve_continuation', false, true, 'preserved_continuation', 'double_stranded_follow_up'), demonstrationSteps: demoSteps },
  scenario('scenario:doubles-guided', 'guided', null, holdHand, nonDouble, double, 'avoid_unsupported_double', false, true, 'preserved_continuation', 'double_stranded_follow_up'),
  scenario('scenario:doubles-practice-hold-1', 'independent', DOUBLES_PRACTICE_VARIANT_SET_ID, holdHand, nonDouble, double, 'preserve_continuation', false, true, 'preserved_continuation', 'double_stranded_follow_up'),
  scenario('scenario:doubles-practice-hold-2', 'independent', DOUBLES_PRACTICE_VARIANT_SET_ID, holdHand, nonDouble, double, 'avoid_unsupported_double', false, true, 'recognized_commitment', 'double_committed_unsupported_pip'),
  scenario('scenario:doubles-practice-play-1', 'independent', DOUBLES_PRACTICE_VARIANT_SET_ID, playHand, double, nonDouble, 'play_supported_double', true, false, 'double_was_supported', 'missed_double_exit'),
  scenario('scenario:doubles-practice-play-2', 'independent', DOUBLES_PRACTICE_VARIANT_SET_ID, playHand, double, nonDouble, 'exit_hand', true, false, 'double_created_clean_exit', 'missed_double_exit'),
  scenario('scenario:doubles-proof-hold-1', 'proof', DOUBLES_PROOF_VARIANT_SET_ID, holdHand, nonDouble, double, 'preserve_continuation', false, true, 'recognized_commitment', 'double_stranded_follow_up'),
  scenario('scenario:doubles-proof-hold-2', 'proof', DOUBLES_PROOF_VARIANT_SET_ID, holdHand, nonDouble, double, 'avoid_unsupported_double', false, true, 'preserved_continuation', 'double_committed_unsupported_pip'),
  scenario('scenario:doubles-proof-play-1', 'proof', DOUBLES_PROOF_VARIANT_SET_ID, playHand, double, nonDouble, 'play_supported_double', true, false, 'double_was_supported', 'missed_double_exit'),
  scenario('scenario:doubles-proof-play-2', 'proof', DOUBLES_PROOF_VARIANT_SET_ID, playHand, double, nonDouble, 'exit_hand', true, false, 'double_created_clean_exit', 'missed_double_exit'),
];
