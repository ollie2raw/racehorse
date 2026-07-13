import type { JourneyFeedbackId } from '../../journeyContentContract.ts';
import type { JourneyFeedbackAsset } from '../../journeyAuthoredLessonBundle.ts';

export const DOUBLES_ARENT_FREE_FEEDBACK_ID = 'journey:feedback:doubles-arent-free' as JourneyFeedbackId;
export const DOUBLES_ARENT_FREE_FEEDBACK: Record<string, JourneyFeedbackAsset> = {
  double_stranded_follow_up: { key: 'double_stranded_follow_up', heading: 'The double narrowed your follow-up.', explanation: 'The double was legal, but the remaining hand had fewer useful legal replies afterward. A double is a commitment, not a prize.', fritzRemark: 'Look at what your hand can do next.', retryExpected: true },
  double_committed_unsupported_pip: { key: 'double_committed_unsupported_pip', heading: 'The pip was unsupported.', explanation: 'Playing the double committed the position without preserving a real continuation for your other tiles.', fritzRemark: null, retryExpected: true },
  preserved_continuation: { key: 'preserved_continuation', heading: 'You kept the hand moving.', explanation: 'The non-double was disciplined here because it left more useful legal follow-ups.', fritzRemark: null, retryExpected: false },
  double_was_supported: { key: 'double_was_supported', heading: 'This double had support.', explanation: 'The position paid for the commitment: your remaining hand still had a playable route.', fritzRemark: 'That double earned its place.', retryExpected: false },
  double_created_clean_exit: { key: 'double_created_clean_exit', heading: 'The double was the clean exit.', explanation: 'Holding it would waste a real opportunity. The engine-verified hand exit makes this double worth playing.', fritzRemark: null, retryExpected: false },
  missed_double_exit: { key: 'missed_double_exit', heading: 'You passed up the clean exit.', explanation: 'The non-double was legal, but the double would have left the hand immediately.', fritzRemark: 'A good rule still needs exceptions.', retryExpected: true },
  took_real_scoring_window: { key: 'took_real_scoring_window', heading: 'You took the scoring window.', explanation: 'The double created immediate value in this exact position, so refusing it was the expensive choice.', fritzRemark: null, retryExpected: false },
  missed_scoring_window: { key: 'missed_scoring_window', heading: 'You missed immediate value.', explanation: 'The double was not automatically strong; this one was strong because the resulting score and continuation were real.', fritzRemark: null, retryExpected: true },
  held_double_without_reason: { key: 'held_double_without_reason', heading: 'The double was supported here.', explanation: 'Holding a double is not disciplined when the position already pays for playing it.', fritzRemark: null, retryExpected: true },
  recognized_commitment: { key: 'recognized_commitment', heading: 'You read the commitment.', explanation: 'You checked what the double did now and what the rest of the hand could do next.', fritzRemark: 'You played the double when the position paid for it.', retryExpected: false },
  valid_alternative: { key: 'valid_alternative', heading: 'That line is defensible.', explanation: 'More than one move can work when the position preserves the same useful continuation.', fritzRemark: null, retryExpected: false },
  illegal_action: { key: 'illegal_action', heading: 'That placement is not legal.', explanation: 'Choose a tile and open end that match the board.', fritzRemark: null, retryExpected: true },
};
