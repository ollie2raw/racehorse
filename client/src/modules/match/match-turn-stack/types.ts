import type { MoveEntry } from '../../../game/moveLogger.ts';
import type { useAuthoringCapture } from '../../guided/useAuthoringCapture.ts';
import type { ReplayRecorder } from '../../replay/index.ts';
import type { LocalRunSession } from '../../bot-turn/index.ts';
import type { UseDailyFritzRuntimeResult } from '../../daily/useDailyFritzRuntime.ts';
import type { UseGuidedLessonBootResult } from '../../guided/index.ts';
import type { UseGhostRuntimeResult } from '../../ghost/useGhostRuntime.ts';
import type { GhostProfileSummary } from '../../ghost/ghostContracts.ts';
import type { UseBotMatchBootstrapResult } from '../hooks/useBotMatchBootstrap.ts';
import type { UseBotMatchRefsResult } from '../hooks/useBotMatchRefs.ts';
import type { UseMatchPresentationResult } from '../hooks/useMatchPresentation.ts';

type UseAuthoringCaptureResult = ReturnType<typeof useAuthoringCapture>;

export type MatchTurnStackSources = {
  bootstrap: UseBotMatchBootstrapResult;
  refs: UseBotMatchRefsResult;
  guidedBoot: UseGuidedLessonBootResult;
  presentation: UseMatchPresentationResult;
  ghost: UseGhostRuntimeResult;
  dailyFritz: UseDailyFritzRuntimeResult;
  authoring: UseAuthoringCaptureResult;
  replayRecorder: ReplayRecorder;
  moveLog: readonly MoveEntry[];
  localRun: LocalRunSession;
  ghostProfile: GhostProfileSummary | null;
  chrome: {
    isMuted: boolean;
    setShowFullCoachTip: (open: boolean) => void;
  };
};

export type { UseAuthoringCaptureResult };