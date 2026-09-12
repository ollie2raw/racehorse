import type { JourneyFeedbackId } from '../../journeyContentContract.ts';
import type { JourneyFeedbackAsset } from '../../journeyAuthoredLessonBundle.ts';

export const TEMPO_VS_SAFETY_FEEDBACK_ID = 'journey:feedback:tempo-vs-safety' as JourneyFeedbackId;
export const TEMPO_VS_SAFETY_FEEDBACK: Record<string, JourneyFeedbackAsset> = {
  banked_the_safer_position: { key: 'banked_the_safer_position', heading: 'You banked the safer position.', explanation: 'This play scored less right now, but it kept both of your remaining tiles live. The flashier play would have scored more and then stranded you.', fritzRemark: 'A small score with a real follow-up beats a big score with none.', retryExpected: false },
  chased_the_score: { key: 'chased_the_score', heading: 'That score cost you your follow-up.', explanation: 'This play scored more immediately, but it left one of your remaining tiles with no legal reply. The quieter play kept your whole hand working.', fritzRemark: null, retryExpected: true },
  read_the_trade_off: { key: 'read_the_trade_off', heading: 'You read the trade-off.', explanation: 'You weighed what a play scored against what it left you able to do next — not just which number was bigger.', fritzRemark: null, retryExpected: false },
  ignored_the_follow_up: { key: 'ignored_the_follow_up', heading: 'The bigger score wasn’t the better line.', explanation: 'This play scored more, but the alternative kept more of your hand alive. Tempo you can’t use isn’t worth much.', fritzRemark: null, retryExpected: true },
  valid_alternative: { key: 'valid_alternative', heading: 'That line is defensible.', explanation: 'More than one legal move can strike a similar balance between scoring and safety.', fritzRemark: null, retryExpected: false },
  illegal_action: { key: 'illegal_action', heading: 'That placement is not legal.', explanation: 'Choose a tile and open end that match the board.', fritzRemark: null, retryExpected: true },
};
