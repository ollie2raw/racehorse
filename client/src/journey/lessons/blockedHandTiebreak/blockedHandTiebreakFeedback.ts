import type { JourneyFeedbackId } from '../../journeyContentContract.ts';
import type { JourneyFeedbackAsset } from '../../journeyAuthoredLessonBundle.ts';

export const BLOCKED_HAND_TIEBREAK_FEEDBACK_ID = 'journey:feedback:blocked-hand-tiebreak' as JourneyFeedbackId;
export const BLOCKED_HAND_TIEBREAK_FEEDBACK: Record<string, JourneyFeedbackAsset> = {
  kept_hand_light: { key: 'kept_hand_light', heading: 'You kept your hand light.', explanation: 'When blockedHandRule pays the lowest pip total, the tile you play matters less than the tiles you keep. This line left you carrying fewer pips.', fritzRemark: 'If the hand blocks, that total is the whole game.', retryExpected: false },
  loaded_up_on_pips: { key: 'loaded_up_on_pips', heading: 'That line left you heavy.', explanation: 'Both tiles were legal, but this one left more pips sitting in your hand. If the hand blocks before you go out, that total decides the winner.', fritzRemark: null, retryExpected: true },
  recognized_tiebreak_math: { key: 'recognized_tiebreak_math', heading: 'You read the tiebreak.', explanation: 'You compared what each legal play left behind, not just what it scored. That is the actual skill here.', fritzRemark: 'The board rarely tells you a block is coming until it already has.', retryExpected: false },
  ignored_pip_math: { key: 'ignored_pip_math', heading: 'The pip math went the other way.', explanation: 'This play was legal, but the alternative left a lower total. In a race decided by a block, that gap is the whole margin.', fritzRemark: null, retryExpected: true },
  valid_alternative: { key: 'valid_alternative', heading: 'That line is defensible.', explanation: 'More than one legal move can protect your pip total about equally well.', fritzRemark: null, retryExpected: false },
  illegal_action: { key: 'illegal_action', heading: 'That placement is not legal.', explanation: 'Choose a tile and open end that match the board.', fritzRemark: null, retryExpected: true },
};
