import type { JourneyFeedbackId } from '../../journeyContentContract.ts';
import type { JourneyFeedbackAsset } from '../../journeyAuthoredLessonBundle.ts';

export const DEFENSIVE_HOLDING_FEEDBACK_ID = 'journey:feedback:defensive-holding' as JourneyFeedbackId;
export const DEFENSIVE_HOLDING_FEEDBACK: Record<string, JourneyFeedbackAsset> = {
  exposed_the_safer_end: { key: 'exposed_the_safer_end', heading: 'You exposed the safer end.', explanation: 'Fewer tiles carrying that pip are still unseen. Fritz is less likely to hold a matching reply.', fritzRemark: 'Denial starts with what you leave open, not just what you play.', retryExpected: false },
  exposed_the_dangerous_end: { key: 'exposed_the_dangerous_end', heading: 'That end was still crowded.', explanation: 'This play was legal, but it left an end value with more unseen tiles. Fritz has better odds of holding a reply there than at the alternative.', fritzRemark: null, retryExpected: true },
  read_the_denial: { key: 'read_the_denial', heading: 'You read the denial.', explanation: 'You checked which of your legal plays left the harder end for Fritz to answer, not just which one felt natural.', fritzRemark: null, retryExpected: false },
  ignored_the_count: { key: 'ignored_the_count', heading: 'You skipped the count.', explanation: 'One of your legal plays left a genuinely safer end. This one did not.', fritzRemark: null, retryExpected: true },
  valid_alternative: { key: 'valid_alternative', heading: 'That line is defensible.', explanation: 'More than one legal move can leave a similarly guarded position.', fritzRemark: null, retryExpected: false },
  illegal_action: { key: 'illegal_action', heading: 'That placement is not legal.', explanation: 'Choose a tile and open end that match the board.', fritzRemark: null, retryExpected: true },
};
