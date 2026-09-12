import type { JourneyFeedbackId } from '../../journeyContentContract.ts';
import type { JourneyFeedbackAsset } from '../../journeyAuthoredLessonBundle.ts';

export const READING_THE_BONEYARD_FEEDBACK_ID = 'journey:feedback:reading-the-boneyard' as JourneyFeedbackId;
export const READING_THE_BONEYARD_FEEDBACK: Record<string, JourneyFeedbackAsset> = {
  correct_accounting: { key: 'correct_accounting', heading: 'You counted it right.', explanation: 'That is genuinely how many are left unseen — somewhere between the boneyard and Fritz’s hand.', fritzRemark: null, retryExpected: false },
  missed_known_tile: { key: 'missed_known_tile', heading: 'One of those tiles is already accounted for.', explanation: 'A tile you can already see — on the board or in your own hand — still counts as known. Recount before you commit.', fritzRemark: null, retryExpected: true },
  counted_double_twice: { key: 'counted_double_twice', heading: 'A double is still one tile.', explanation: 'A double shows the same pip on both halves, but it is one physical tile, not two.', fritzRemark: null, retryExpected: true },
  used_count_with_denial: { key: 'used_count_with_denial', heading: 'You counted, then denied.', explanation: 'You read how many were genuinely still hiding, then played toward the end where fewer of them could be waiting.', fritzRemark: 'The fewer tiles left unseen, the more that count actually tells you.', retryExpected: false },
  correct_count_exposed_end: { key: 'correct_count_exposed_end', heading: 'Right count, wrong end.', explanation: 'Your count was correct, but you still played toward the end with more unseen tiles behind it.', fritzRemark: null, retryExpected: true },
  wrong_count_defensible_end: { key: 'wrong_count_defensible_end', heading: 'Good end, miscounted.', explanation: 'You played toward the safer end, but the count itself was off. Recheck what is actually still unseen.', fritzRemark: null, retryExpected: true },
  both_wrong: { key: 'both_wrong', heading: 'Neither read landed.', explanation: 'The count was off, and the end you exposed was the more dangerous one.', fritzRemark: null, retryExpected: true },
  recognized_proof_exception: { key: 'recognized_proof_exception', heading: 'You read the depleted pool correctly.', explanation: 'With so little unseen left, that count was close to certain — and you played to it.', fritzRemark: null, retryExpected: false },
  illegal_action: { key: 'illegal_action', heading: 'That placement is not legal.', explanation: 'Choose a tile and open end that match the board.', fritzRemark: null, retryExpected: true },
};
