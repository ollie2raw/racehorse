import { useCallback } from 'react';
import { createBotMatch } from '../runtime/botEngine.ts';
import { createPreGameDrawShellMatch } from '../../../match/preGameDraw/preGameDrawEligibility.ts';
import type { BotMatchScreenProps } from '../types.ts';
import type { UseBotMatchBootstrapResult } from './useBotMatchBootstrap.ts';
import type { UseBotMatchRefsResult } from './useBotMatchRefs.ts';
import type { UseMatchPresentationResult } from './useMatchPresentation.ts';
import type { UseGhostRuntimeResult } from '../../ghost/useGhostRuntime.ts';
import type { UseReviewRuntimeResult } from '../../review/useReviewRuntime.ts';
import type { UseDailyFritzRuntimeResult } from '../../daily/useDailyFritzRuntime.ts';
import type { ReplayRecorder } from '../../replay/index.ts';

export type UseMatchNavigationArgs = {
  props: BotMatchScreenProps;
  bootstrap: UseBotMatchBootstrapResult;
  refs: UseBotMatchRefsResult;
  presentation: UseMatchPresentationResult;
  ghost: UseGhostRuntimeResult;
  review: UseReviewRuntimeResult;
  dailyFritz: UseDailyFritzRuntimeResult;
  replayRecorder: ReplayRecorder;
  setGuidedMatchCandidateSaveStatus: (status: string | null) => void;
  isGuidedV2Mode: boolean;
  invalidateLocalRuns: () => void;
  clearHandReveal: () => void;
  setLastBotChoice: (choice: import('../../fritz/botHeuristics.ts').BotChoice | null) => void;
};

export function useMatchNavigation({
  props,
  bootstrap,
  refs,
  presentation,
  ghost,
  review,
  dailyFritz,
  replayRecorder,
  setGuidedMatchCandidateSaveStatus,
  isGuidedV2Mode,
  invalidateLocalRuns,
  clearHandReveal,
  setLastBotChoice,
}: UseMatchNavigationArgs) {
  const { onBack, onNavigate, journeyTrial, onJourneyTrialComplete, onDailyFritzComplete, currentGlickoRating } = props;
  const {
    match,
    setMatch,
    winningScore,
    dealSize,
    preGameDrawEligible,
    setPreGameDrawCompleted,
    isDailyFritzMode,
    setSelectedTile,
    setMovesUsed,
    createLocalMatchId,
  } = bootstrap;
  const { flashLastPlayed } = presentation;
  const {
    dailyResultSyncKeyRef,
    gameWinConfettiKeyRef,
    moveCounterRef,
    localPendingRegisteredRef,
    localPendingResolvedRef,
  } = refs;
  const {
    setGhostPlayedTile,
    setGhostAgreementType,
    setGhostBoardPulse,
    setGhostResult,
    setGhostResultLoading,
    setGhostResultError,
    setGhostMoveLog,
    setMatchStartGlickoRating,
    setVerifiedMatchId,
    ghostResult,
    matchStartGlickoRating,
  } = ghost;
  const {
    setCurrentAnalysis,
    setAnalyzerOpen,
    setPostGameReviewDismissed,
    setPivotalReviewOpen,
    setPivotalReviewSummary,
  } = review;
  const { setDailyLeaderboard, setDailyLeaderboardError, setDailyLeaderboardLoading } = dailyFritz;

  const exitMatch = useCallback(() => {
    invalidateLocalRuns();
    onBack();
  }, [invalidateLocalRuns, onBack]);

  const exitJourneyTrial = useCallback(
    (markCompleteOnWin: boolean) => {
      if (!journeyTrial || !onJourneyTrialComplete) {
        exitMatch();
        return;
      }
      invalidateLocalRuns();
      const won = match.winnerId === 'you';
      onJourneyTrialComplete({
        won: markCompleteOnWin && won,
        nodeId: journeyTrial.nodeId,
      });
    },
    [exitMatch, invalidateLocalRuns, journeyTrial, match.winnerId, onJourneyTrialComplete],
  );

  const startFreshMatch = useCallback(() => {
    if (isGuidedV2Mode) {
      return;
    }
    if (isDailyFritzMode) {
      onDailyFritzComplete?.();
      exitMatch();
      return;
    }
    invalidateLocalRuns();
    localPendingRegisteredRef.current = false;
    localPendingResolvedRef.current = false;
    setSelectedTile(null);
    flashLastPlayed(null);
    setLastBotChoice(null);
    clearHandReveal();
    setGhostPlayedTile(null);
    setGhostAgreementType(null);
    setGhostBoardPulse(false);
    setGhostResult(null);
    setGhostResultLoading(false);
    setGhostResultError(null);
    setGuidedMatchCandidateSaveStatus(null);
    setMovesUsed(0);
    setDailyLeaderboard([]);
    setDailyLeaderboardError(null);
    setDailyLeaderboardLoading(false);
    replayRecorder.replaceLog([]);
    setGhostMoveLog([]);
    moveCounterRef.current = 1;
    setCurrentAnalysis(null);
    setAnalyzerOpen(false);
    setPostGameReviewDismissed(false);
    setPivotalReviewOpen(false);
    setPivotalReviewSummary(null);
    dailyResultSyncKeyRef.current = '';
    gameWinConfettiKeyRef.current = '';
    setMatchStartGlickoRating(
      currentGlickoRating != null
        ? Number(currentGlickoRating)
        : ghostResult?.glickoRating != null
          ? Number(ghostResult.glickoRating)
          : matchStartGlickoRating,
    );
    setVerifiedMatchId(null);
    ghost.setActiveLocalMatchId(createLocalMatchId());
    if (preGameDrawEligible) {
      setPreGameDrawCompleted(false);
      setMatch(createPreGameDrawShellMatch(winningScore, dealSize));
    } else {
      setPreGameDrawCompleted(true);
      setMatch(createBotMatch(winningScore, dealSize));
    }
  }, [
    isGuidedV2Mode,
    isDailyFritzMode,
    onDailyFritzComplete,
    exitMatch,
    invalidateLocalRuns,
    localPendingRegisteredRef,
    localPendingResolvedRef,
    setSelectedTile,
    flashLastPlayed,
    setLastBotChoice,
    clearHandReveal,
    setGhostPlayedTile,
    setGhostAgreementType,
    setGhostBoardPulse,
    setGhostResult,
    setGhostResultLoading,
    setGhostResultError,
    setGuidedMatchCandidateSaveStatus,
    setMovesUsed,
    setDailyLeaderboard,
    setDailyLeaderboardError,
    setDailyLeaderboardLoading,
    replayRecorder,
    setGhostMoveLog,
    moveCounterRef,
    setCurrentAnalysis,
    setAnalyzerOpen,
    setPostGameReviewDismissed,
    setPivotalReviewOpen,
    setPivotalReviewSummary,
    dailyResultSyncKeyRef,
    gameWinConfettiKeyRef,
    setMatchStartGlickoRating,
    currentGlickoRating,
    ghostResult?.glickoRating,
    matchStartGlickoRating,
    setVerifiedMatchId,
    ghost,
    createLocalMatchId,
    preGameDrawEligible,
    setPreGameDrawCompleted,
    setMatch,
    winningScore,
    dealSize,
  ]);

  const goHome = useCallback(() => {
    invalidateLocalRuns();
    onNavigate?.('home');
  }, [invalidateLocalRuns, onNavigate]);

  const returnToFritzSetup = useCallback(() => {
    invalidateLocalRuns();
    if (onNavigate) {
      onNavigate('botSetup');
      return;
    }
    onBack();
  }, [invalidateLocalRuns, onNavigate, onBack]);

  const returnToLearn = useCallback(() => {
    invalidateLocalRuns();
    onNavigate?.('learn');
  }, [invalidateLocalRuns, onNavigate]);

  return {
    exitMatch,
    exitJourneyTrial,
    startFreshMatch,
    goHome,
    returnToFritzSetup,
    returnToLearn,
  };
}

export type UseMatchNavigationResult = ReturnType<typeof useMatchNavigation>;