import type { BotMatchScreenViewProps } from './botMatchScreenViewTypes';
import type { BotMatchScreenProps } from './botMatchScreenTypes';
import { useMatchUiChrome } from './useMatchUiChrome';
import { useBotMatchWindowEvents } from './useBotMatchWindowEvents';
import { createBotMatchViewModel } from './createBotMatchViewModel';
import { useAuthoringCapture, useGuidedLessonBoot } from '../modules/guided/index.ts';
import { useBotMatchBootstrap } from '../modules/match/hooks/useBotMatchBootstrap.ts';
import { useBotMatchRefs } from '../modules/match/hooks/useBotMatchRefs.ts';
import { useMatchPresentation } from '../modules/match/hooks/useMatchPresentation.ts';
import { useMatchNavigation } from '../modules/match/hooks/useMatchNavigation.ts';
import { useMatchTurnStack } from '../modules/match/hooks/useMatchTurnStack.ts';
import { useGhostRuntime } from '../modules/ghost/useGhostRuntime.ts';
import { useDailyFritzRuntime } from '../modules/daily/useDailyFritzRuntime.ts';
import { useReviewRuntime } from '../modules/review/useReviewRuntime.ts';
import { useFritzRatingDisplay } from '../modules/fritz/useFritzRatingDisplay.ts';
import { useDailyPuzzleLeaderboardSync } from '../modules/daily-puzzle/useDailyPuzzleLeaderboardSync.ts';
import { useReplayRecorder } from '../modules/replay/index.ts';
import { useLocalRunSession } from '../modules/bot-turn/index.ts';

export function useBotMatchScreenController(props: BotMatchScreenProps): BotMatchScreenViewProps {
  const {
    mode = 'bot',
    isGuidedMode: isGuidedModeProp = false,
    isAuthoringMode: isAuthoringModeProp = false,
    isAuthoringV2Mode: isAuthoringV2ModeProp = false,
    isGuidedV2Mode: isGuidedV2ModeProp = false,
    ghostProfile = null,
  } = props;

  const guidedBoot = useGuidedLessonBoot({
    mode,
    isGuidedModeProp,
    isAuthoringModeProp,
    isAuthoringV2ModeProp,
    isGuidedV2ModeProp,
  });

  const bootstrap = useBotMatchBootstrap({ props, guidedBoot });

  const refs = useBotMatchRefs({
    initialMoveLog: bootstrap.resumablePersistedDailyFritzMatch?.moveLog,
  });

  const chrome = useMatchUiChrome({
    rootRef: refs.rootRef,
    boardStageRef: refs.boardStageRef,
    handAreaRef: refs.handAreaRef,
  });

  const replay = useReplayRecorder(
    bootstrap.resumablePersistedDailyFritzMatch?.moveLog ?? [],
  );

  const localRun = useLocalRunSession(refs.setDrawSequenceActiveBoth);

  const authoring = useAuthoringCapture({
    isAuthoringMode: guidedBoot.isAuthoringMode,
    isAuthoringV2Mode: guidedBoot.isAuthoringV2Mode,
    match: bootstrap.match,
    matchRef: bootstrap.matchRef,
    fritzSessionReplyRef: refs.fritzSessionReplyRef,
  });

  const presentation = useMatchPresentation({
    bootstrap,
    refs,
    guidedBoot,
    chrome,
    invalidateLocalRuns: localRun.invalidateLocalRuns,
  });

  const ghost = useGhostRuntime({
    props,
    bootstrap,
    guidedBoot,
    refs,
    presentation,
    moveLog: replay.moveLog,
  });

  const dailyFritz = useDailyFritzRuntime({
    props,
    bootstrap,
    guidedBoot,
    moveLog: replay.moveLog,
    ghostResultLoading: ghost.ghostResultLoading,
    ghostResultError: ghost.ghostResultError,
    setGhostResultLoading: ghost.setGhostResultLoading,
    setGhostResultError: ghost.setGhostResultError,
  });

  const review = useReviewRuntime({
    props,
    bootstrap,
    guidedBoot,
    moveLog: replay.moveLog,
  });

  const turns = useMatchTurnStack({
    bootstrap,
    refs,
    guidedBoot,
    presentation,
    ghost,
    dailyFritz,
    authoring,
    replayRecorder: replay.recorder,
    moveLog: replay.moveLog,
    localRun,
    ghostProfile,
    chrome: {
      isMuted: chrome.isMuted,
      setShowFullCoachTip: chrome.setShowFullCoachTip,
    },
  });

  const rating = useFritzRatingDisplay({
    props,
    bootstrap,
    guidedBoot,
    ghost,
  });

  const puzzle = useDailyPuzzleLeaderboardSync({
    props,
    bootstrap,
    refs,
    guidedBoot,
    dailyFritz,
  });

  const navigation = useMatchNavigation({
    props,
    bootstrap,
    refs,
    presentation,
    ghost,
    review,
    dailyFritz,
    replayRecorder: replay.recorder,
    setGuidedMatchCandidateSaveStatus: turns.setGuidedMatchCandidateSaveStatus,
    isGuidedV2Mode: guidedBoot.isGuidedV2Mode,
    invalidateLocalRuns: localRun.invalidateLocalRuns,
    clearHandReveal: turns.clearHandReveal,
    setLastBotChoice: turns.setLastBotChoice,
  });

  useBotMatchWindowEvents({
    isDailyFritzMode: bootstrap.isDailyFritzMode,
    showFullCoachTip: chrome.showFullCoachTip,
    setShowFullCoachTip: chrome.setShowFullCoachTip,
  });

  return createBotMatchViewModel({
    props,
    guidedBoot,
    bootstrap,
    refs,
    chrome,
    authoring,
    presentation,
    ghost,
    dailyFritz,
    review,
    turns,
    rating,
    puzzle,
    navigation,
  });
}