import type { JourneyFeedbackId } from '../../journeyContentContract.ts';
import type { JourneyFeedbackAsset } from '../../journeyAuthoredLessonBundle.ts';

export const ENDGAME_HAND_SHAPE_FEEDBACK_ID = 'journey:feedback:endgame-hand-shape' as JourneyFeedbackId;
export const ENDGAME_HAND_SHAPE_FEEDBACK: Record<string, JourneyFeedbackAsset> = {
  kept_hand_alive: { key: 'kept_hand_alive', heading: 'Your whole hand stayed live.', explanation: 'Both remaining tiles still had a legal reply after this play. Near the end of a hand, that matters more than which tile you played first.', fritzRemark: 'A dead tile in your hand is a dead turn later.', retryExpected: false },
  stranded_a_tile: { key: 'stranded_a_tile', heading: 'That line stranded a tile.', explanation: 'This play was legal, but it left one of your remaining tiles with no legal reply at all. You will be stuck holding it until the board changes.', fritzRemark: null, retryExpected: true },
  recognized_shape_math: { key: 'recognized_shape_math', heading: 'You read the shape.', explanation: 'You checked what each legal play left your hand able to do next, not just what it changed on the board.', fritzRemark: 'Endgame hands are won by which tiles still work, not which one you play first.', retryExpected: false },
  ignored_shape_math: { key: 'ignored_shape_math', heading: 'One tile went dead.', explanation: 'This play was legal, but the alternative kept both of your remaining tiles playable. This one stranded a tile instead.', fritzRemark: null, retryExpected: true },
  valid_alternative: { key: 'valid_alternative', heading: 'That line is defensible.', explanation: 'More than one legal move can keep your remaining hand equally live.', fritzRemark: null, retryExpected: false },
  illegal_action: { key: 'illegal_action', heading: 'That placement is not legal.', explanation: 'Choose a tile and open end that match the board.', fritzRemark: null, retryExpected: true },
};
