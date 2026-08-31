import type { BotMatchScreenProps } from '../botMatchScreenTypes.ts';
import type { UseGuidedLessonBootResult } from '../../modules/guided/index.ts';
import type { UseBotMatchBootstrapResult } from '../../modules/match/hooks/useBotMatchBootstrap.ts';
import type { UseBotMatchRefsResult } from '../../modules/match/hooks/useBotMatchRefs.ts';
import type { UseMatchPresentationResult } from '../../modules/match/hooks/useMatchPresentation.ts';
import type { UseGhostRuntimeResult } from '../../modules/ghost/useGhostRuntime.ts';
import type { UseDailyFritzRuntimeResult } from '../../modules/daily/useDailyFritzRuntime.ts';
import type { UseReviewRuntimeResult } from '../../modules/review/useReviewRuntime.ts';
import type { UseMatchTurnStackResult } from '../../modules/match/hooks/useMatchTurnStack.ts';
import type { UseFritzRatingDisplayResult } from '../../modules/fritz/useFritzRatingDisplay.ts';
import type { UseDailyPuzzleLeaderboardSyncResult } from '../../modules/daily-puzzle/useDailyPuzzleLeaderboardSync.ts';
import type { UseMatchNavigationResult } from '../../modules/match/hooks/useMatchNavigation.ts';
import type { useAuthoringCapture } from '../../modules/guided/useAuthoringCapture.ts';
import type { useMatchUiChrome } from '../useMatchUiChrome.ts';

type UseAuthoringCaptureResult = ReturnType<typeof useAuthoringCapture>;
type UseMatchUiChromeResult = ReturnType<typeof useMatchUiChrome>;

export type CreateBotMatchViewModelArgs = {
  props: BotMatchScreenProps;
  guidedBoot: UseGuidedLessonBootResult;
  bootstrap: UseBotMatchBootstrapResult;
  refs: UseBotMatchRefsResult;
  chrome: UseMatchUiChromeResult;
  authoring: UseAuthoringCaptureResult;
  presentation: UseMatchPresentationResult;
  ghost: UseGhostRuntimeResult;
  dailyFritz: UseDailyFritzRuntimeResult;
  review: UseReviewRuntimeResult;
  turns: UseMatchTurnStackResult;
  rating: UseFritzRatingDisplayResult;
  puzzle: UseDailyPuzzleLeaderboardSyncResult;
  navigation: UseMatchNavigationResult;
};
