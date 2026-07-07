import { useEffect, useMemo } from 'react';
import { predictFritzGlickoUpdate } from '../../ranking/predictFritzGlickoUpdate.ts';
import { roundedRatingDelta } from '../ghost/ghostMatchHelpers.ts';
import { useStandaloneFritzRatingSession } from '../match/hooks/useStandaloneFritzRatingSession.ts';
import type { BotMatchScreenProps } from '../match/types.ts';
import type { UseBotMatchBootstrapResult } from '../match/hooks/useBotMatchBootstrap.ts';
import type { UseGhostRuntimeResult } from '../ghost/useGhostRuntime.ts';
import type { UseGuidedLessonBootResult } from '../guided/index.ts';

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
    activeLocalMatchId,
    accessTokenRef,
    localPendingRegisteredRef,
    localPendingResolvedRef,
    matchRef,
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

  useEffect(() => {
    if (!predictedFritzGlicko || !onProfilePatch) return;
    if (ghostResult?.glickoRating != null) return;
    onProfilePatch({ glicko_rating: predictedFritzGlicko.glickoRating });
  }, [ghostResult?.glickoRating, onProfilePatch, predictedFritzGlicko]);

  const fritzGlickoDelta =
    !isGhostMode && ghostResult?.glickoDelta != null
      ? roundedRatingDelta(ghostResult.glickoDelta)
      : !isGhostMode && predictedFritzGlicko != null
        ? roundedRatingDelta(predictedFritzGlicko.glickoDelta)
      : !isGhostMode && ghostResult?.glickoRating != null && matchStartGlickoRating != null
        ? roundedRatingDelta(ghostResult.glickoRating - matchStartGlickoRating)
      : null;

  const fritzNewGlickoRating =
    !isGhostMode && ghostResult?.glickoRating != null
      ? Math.round(ghostResult.glickoRating)
      : !isGhostMode && predictedFritzGlicko != null
        ? predictedFritzGlicko.glickoRating
      : null;

  const hasConfirmedFritzRatingUpdate =
    fritzGlickoDelta != null || (!isGhostMode && (ghostResult != null || predictedFritzGlicko != null));

  const showFritzRatingSyncing =
    ghostResultLoading && predictedFritzGlicko == null && ghostResult?.glickoRating == null;

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