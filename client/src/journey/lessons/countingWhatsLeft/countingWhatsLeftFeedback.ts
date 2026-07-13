import type { JourneyFeedbackId } from '../../journeyContentContract.ts';
import type { JourneyFeedbackAsset } from '../../journeyAuthoredLessonBundle.ts';

export const COUNTING_WHATS_LEFT_FEEDBACK_ID = 'journey:feedback:counting-whats-left' as JourneyFeedbackId;
export const COUNTING_WHATS_LEFT_FEEDBACK: Record<string, JourneyFeedbackAsset> = {
  correct_accounting: { key: 'correct_accounting', heading: 'That count is accounted for.', explanation: 'Count the tiles already visible on the board and in your hand. The remainder is unseen, not automatically in Fritz’s hand.', fritzRemark: null, retryExpected: false },
  counted_double_twice: { key: 'counted_double_twice', heading: 'The double is one tile.', explanation: 'A double contains the pip, but it is one physical tile. Count tile identities, not two copies of the same double.', fritzRemark: 'Count tiles, not pips on a single tile.', retryExpected: true },
  missed_known_tile: { key: 'missed_known_tile', heading: 'One known tile was left out.', explanation: 'Board tiles and your hand are already accounted for. Everything else is unseen and may be with Fritz or in the boneyard.', fritzRemark: null, retryExpected: true },
  correct_count_weak_move: { key: 'correct_count_weak_move', heading: 'The count was right; the continuation was not.', explanation: 'Use the count as evidence, then preserve your own next play. A low unseen count is not enough by itself.', fritzRemark: 'The whole position still matters.', retryExpected: true },
  wrong_count_defensible_move: { key: 'wrong_count_defensible_move', heading: 'The move works, but the count does not.', explanation: 'The move is legal, yet the accounting missed known information. Unseen tiles may still be with Fritz or in the boneyard.', fritzRemark: null, retryExpected: true },
  both_wrong: { key: 'both_wrong', heading: 'Count first, then judge the move.', explanation: 'The count omitted known tiles and the move did not preserve a useful continuation.', fritzRemark: 'Guessing at Fritz’s hand is not counting.', retryExpected: true },
  used_count_with_continuation: { key: 'used_count_with_continuation', heading: 'You used the count without stranding yourself.', explanation: 'The unseen count narrows possibilities. It does not name Fritz’s tiles, so you still kept your own continuation alive.', fritzRemark: null, retryExpected: false },
  recognized_proof_exception: { key: 'recognized_proof_exception', heading: 'You counted, then judged.', explanation: 'That end has fewer unseen tiles, but blindly chasing it would strand your hand. The accepted move uses the count as evidence, not a rule.', fritzRemark: 'You counted the possibilities, then read the position. That’s stronger than guessing.', retryExpected: false },
  illegal_action: { key: 'illegal_action', heading: 'That placement is not legal.', explanation: 'Choose a tile and live end that match the current board.', fritzRemark: null, retryExpected: true },
};
