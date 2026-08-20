import { useEffect, useMemo } from 'react';
import { predictFritzGlickoUpdate } from '../../ranking/predictFritzGlickoUpdate.ts';
import { useStandaloneFritzRatingSession } from '../match/hooks/useStandaloneFritzRatingSession.ts';
import type { BotMatchScreenProps } from '../match/types.ts';
import type { UseBotMatchBootstrapResult } from '../match/hooks/useBotMatchBootstrap.ts';
import type { UseGhostRuntimeResult } from '../ghost/useGhostRuntime.ts';
import type { UseGuidedLessonBootResult } from '../guided/index.ts';
import {
  deriveFritzRatingDisplayState,
  resolveFritzProfilePatchRating,
} from './fritzRatingDisplayState.ts';

export type UseFritzRatingDisplayArgs = {
  props: BotMatchScreenProps;
  bootstrap: UseBotMatchBootstrapResult;
  guidedBoot: UseGuidedLessonBootResult;
  ghost: UseGhostRuntimeResult;
};

export function useFritzRatingDisplay({
  props,
  bootstrap,
  guidedBoot,
  ghost,
}: UseFritzRatingDisplayArgs) {
  const {
    userId = null,
    currentGlickoRating = null,
    currentGlickoRd = null,
    currentGlickoVol = null,
    rankedGamesPlayed = null,
    onProfilePatch = null,
    fritzTier = 'elite',
  } = props;

  const {
    match,
    isGhostMode,
    isDailyFritzMode,
    isStandaloneFritzMatch,
    preGameDrawActive,
    fritzConfig,
    matchRef,
    setMatch,
    winningScore,
    dealSize,
  } = bootstrap;

  const { isGuidedMode, isAuthoringMode } = guidedBoot;

  const {
    ghostResult,
    ghostResultLoading,
    matchStartGlickoRating,
    activeLocalMatchId,
    accessTokenRef,
    localPendingRegisteredRef,
    localPendingResolvedRef,
    setVerifiedMatchId,
    setGhostResultLoading,
    setGhostResultError,
  } = ghost;

  const { abandonStandaloneFritzMatch } = useStandaloneFritzRatingSession({
    enabled: isStandaloneFritzMatch,
    userId,
    preGameDrawActive,
    matchGameOver: match.gameOver,
    isGuidedMode,
    isAuthoringMode,
    fritzTier,
    winningScore,
    dealSize,
    activeLocalMatchId,
    accessTokenRef,
    localPendingRegisteredRef,
    localPendingResolvedRef,
    matchRef,
    setMatch,
    setVerifiedMatchId,
    setResultLoading: setGhostResultLoading,
    setResultError: setGhostResultError,
  });

  const predictedFritzGlicko = useMemo(() => {
    if (!isStandaloneFritzMatch || isGhostMode || isDailyFritzMode || !match.gameOver) return null;
    return predictFritzGlickoUpdate({
      fritzId: fritzConfig.id,
      playerScore: match.players.you.score,
      opponentScore: match.players.bot.score,
      glickoRating: matchStartGlickoRating ?? currentGlickoRating,
      glickoRd: currentGlickoRd,
      glickoVol: currentGlickoVol,
      rankedGamesPlayed,
    });
  }, [
    currentGlickoRating,
    currentGlickoRd,
    currentGlickoVol,
    fritzConfig.id,
    isDailyFritzMode,
    isGhostMode,
    isStandaloneFritzMatch,
    match.gameOver,
    match.players.bot.score,
    match.players.you.score,
    matchStartGlickoRating,
    rankedGamesPlayed,
  ]);

  // Profile patch only after server ghostResult — never from client prediction.
  useEffect(() => {
    if (isGhostMode || !onProfilePatch) return;
    const rating = resolveFritzProfilePatchRating(ghostResult);
    if (rating == null) return;
    onProfilePatch({ glicko_rating: rating });
  }, [ghostResult, isGhostMode, onProfilePatch]);

  const {
    fritzGlickoDelta,
    fritzNewGlickoRating,
    hasConfirmedFritzRatingUpdate,
    showFritzRatingSyncing,
  } = deriveFritzRatingDisplayState({
    isGhostMode,
    ghostResult,
    predictedFritzGlicko,
    ghostResultLoading,
    matchStartGlickoRating,
  });

  return {
    predictedFritzGlicko,
    fritzGlickoDelta,
    fritzNewGlickoRating,
    hasConfirmedFritzRatingUpdate,
    showFritzRatingSyncing,
    abandonStandaloneFritzMatch,
  };
}

export type UseFritzRatingDisplayResult = ReturnType<typeof useFritzRatingDisplay>;
