import type { BoardState, Tile } from '../../../types.ts';
import type { JourneyAuthoredScenario } from '../../journeyAuthoredLessonBundle.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';

const tile = (low: number, high: number): Tile => ({ low, high });
const board = (mainLine: BoardState['mainLine'], leftEnd: number, rightEnd: number): BoardState => ({ mainLine, leftEnd, rightEnd, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] });
const core = { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID } as const;

const fourBoard = board([
  { tile: tile(1, 4), orientation: 'horizontal-normal' },
  { tile: tile(4, 4), orientation: 'horizontal-normal' },
  { tile: tile(2, 4), orientation: 'horizontal-flipped' },
], 1, 2);

export const COUNTING_WHATS_LEFT_SCENARIOS: JourneyAuthoredScenario[] = [
  { id: 'scenario:counting-demo', variantSetId: null, kind: 'demo', ruleset: core, board: fourBoard, playerHand: [tile(4, 6), tile(1, 5)], interaction: { kind: 'pip_count', targetPip: 4, prompt: 'How many 4-tiles remain unseen?', options: [2, 3, 4] }, acceptedActions: [], temptingActions: [], feedbackByAction: {} },
  { id: 'scenario:counting-guided', variantSetId: null, kind: 'guided', ruleset: core, board: fourBoard, playerHand: [tile(4, 6), tile(1, 5)], interaction: { kind: 'pip_count', targetPip: 4, prompt: 'How many tiles containing 4 remain unseen?', options: [2, 3, 4] }, acceptedActions: [], temptingActions: [], feedbackByAction: {} },
  { id: 'scenario:counting-practice-1', variantSetId: 'variants:counting-practice', kind: 'independent', ruleset: core, board: fourBoard, playerHand: [tile(1, 6), tile(2, 5), tile(4, 6)], interaction: { kind: 'pip_count_then_move', targetPip: 4, prompt: 'Count the unseen 4-tiles, then choose the move that preserves your next play.', options: [2, 3, 4] }, acceptedActions: [{ tile: tile(1, 6), position: 'left' }], temptingActions: [{ tile: tile(2, 5), position: 'right' }], feedbackByAction: { '1-6@left': 'used_count_with_continuation', '2-5@right': 'correct_count_weak_move' } },
  { id: 'scenario:counting-practice-2', variantSetId: 'variants:counting-practice', kind: 'independent', ruleset: core, board: board([{ tile: tile(0, 3), orientation: 'horizontal-normal' }, { tile: tile(3, 5), orientation: 'horizontal-normal' }, { tile: tile(2, 5), orientation: 'horizontal-flipped' }], 0, 2), playerHand: [tile(0, 6), tile(2, 4), tile(3, 3)], interaction: { kind: 'pip_count_then_move', targetPip: 3, prompt: 'Count the unseen 3-tiles, then keep a useful follow-up.', options: [2, 3, 4] }, acceptedActions: [{ tile: tile(0, 6), position: 'left' }], temptingActions: [{ tile: tile(2, 4), position: 'right' }], feedbackByAction: { '0-6@left': 'used_count_with_continuation', '2-4@right': 'correct_count_weak_move' } },
  { id: 'scenario:counting-practice-3', variantSetId: 'variants:counting-practice', kind: 'independent', ruleset: core, board: board([{ tile: tile(1, 6), orientation: 'horizontal-normal' }, { tile: tile(4, 6), orientation: 'horizontal-normal' }, { tile: tile(2, 4), orientation: 'horizontal-flipped' }], 1, 2), playerHand: [tile(1, 5), tile(2, 3), tile(4, 5)], interaction: { kind: 'pip_count_then_move', targetPip: 4, prompt: 'Count the unseen 4-tiles, then avoid stranding your own next play.', options: [2, 3, 4] }, acceptedActions: [{ tile: tile(1, 5), position: 'left' }], temptingActions: [{ tile: tile(2, 3), position: 'right' }], feedbackByAction: { '1-5@left': 'used_count_with_continuation', '2-3@right': 'correct_count_weak_move' } },
  { id: 'scenario:counting-proof-1', variantSetId: 'variants:counting-proof', kind: 'proof', ruleset: core, board: fourBoard, playerHand: [tile(1, 6), tile(2, 5), tile(4, 6)], interaction: { kind: 'pip_count_then_move', targetPip: 4, prompt: 'The 4 count is low. Which move still leaves you a real continuation?', options: [2, 3, 4] }, acceptedActions: [{ tile: tile(1, 6), position: 'left' }], temptingActions: [{ tile: tile(2, 5), position: 'right' }], feedbackByAction: { '1-6@left': 'recognized_proof_exception', '2-5@right': 'correct_count_weak_move' } },
  { id: 'scenario:counting-proof-2', variantSetId: 'variants:counting-proof', kind: 'proof', ruleset: core, board: board([{ tile: tile(0, 5), orientation: 'horizontal-normal' }, { tile: tile(5, 6), orientation: 'horizontal-normal' }, { tile: tile(2, 6), orientation: 'horizontal-flipped' }], 0, 2), playerHand: [tile(0, 4), tile(2, 3), tile(6, 6)], interaction: { kind: 'pip_count_then_move', targetPip: 6, prompt: 'Count the unseen 6-tiles, then choose the line that does not strand your hand.', options: [3, 4, 5] }, acceptedActions: [{ tile: tile(0, 4), position: 'left' }], temptingActions: [{ tile: tile(2, 3), position: 'right' }], feedbackByAction: { '0-4@left': 'recognized_proof_exception', '2-3@right': 'correct_count_weak_move' } },
];

export const COUNTING_PRACTICE_VARIANT_SET_ID = 'variants:counting-practice';
export const COUNTING_PROOF_VARIANT_SET_ID = 'variants:counting-proof';
