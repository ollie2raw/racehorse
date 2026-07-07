import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Tile } from '../../types.ts';
import {
  type GhostCompletionResult,
  type GhostMoveLogEntry,
} from './ghostContracts.ts';
import { resolveGhostMove } from './ghostMoveLogic.ts';
import { getGhostResultMessage } from './ghostMatchHelpers.ts';
import { useGhostMatchCompletion, useGhostMatchSessionStart } from './index.ts';
import type { BotMatchScreenProps } from '../match/types.ts';
import type { UseBotMatchBootstrapResult } from '../match/hooks/useBotMatchBootstrap.ts';
import { createLocalMatchId } from '../match/hooks/useBotMatchBootstrap.ts';
import type { UseBotMatchRefsResult } from '../match/hooks/useBotMatchRefs.ts';
import type { UseMatchPresentationResult } from '../match/hooks/useMatchPresentation.ts';
import type { UseGuidedLessonBootResult } from '../guided/index.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';

export type UseGhostRuntimeArgs = {
  props: BotMatchScreenProps;
  bootstrap: UseBotMatchBootstrapResult;
  guidedBoot: UseGuidedLessonBootResult;
  refs: UseBotMatchRefsResult;
  presentation: UseMatchPresentationResult;
  moveLog: readonly MoveEntry[];
};

export function useGhostRuntime({
  props,
  bootstrap,
  guidedBoot,
  refs,
  presentation,
  moveLog,
}: UseGhostRuntimeArgs) {
  const {
    userId = null,
    username = null,
    opponentName = 'Fritz',
    opponentUserId = null,
    currentGlickoRating = null,
    ghostProfile = null,
    onGhostProfileChange = null,
    onProfilePatch = null,
    onProfileRefresh = null,
    dailyFritzPackage = null,
  } = props;

  const {
    match,
    mode,
    isGhostMode,
    isDailyFritzMode,
    isStandaloneFritzMatch,
    fritzConfig,
  } = bootstrap;

  const { isGuidedMode, isAuthoringMode } = guidedBoot;

  const { userPlayMoves } = presentation;
  const {
    accessTokenRef,
    localPendingResolvedRef,
  } = refs;

  const [ghostMoveLog, setGhostMoveLog] = useState<GhostMoveLogEntry[]>([]);
  const [ghostAgreementType, setGhostAgreementType] = useState<'agrees' | 'heuristic' | null>(null);
  const [ghostBoardPulse, setGhostBoardPulse] = useState(false);
  const [ghostPlayedTile, setGhostPlayedTile] = useState<Tile | null>(null);
  const [ghostResult, setGhostResult] = useState<GhostCompletionResult | null>(null);
  const [ghostResultLoading, setGhostResultLoading] = useState(false);
  const [ghostResultError, setGhostResultError] = useState<string | null>(null);
  const [matchStartGlickoRating, setMatchStartGlickoRating] = useState<number | null>(
    currentGlickoRating != null
      ? Number(currentGlickoRating)
      : null,
  );
  const [activeLocalMatchId, setActiveLocalMatchId] = useState<string>(
    () =>
      (mode === 'daily-fritz' && dailyFritzPackage
        ? `daily-fritz:${dailyFritzPackage.run_date}:${dailyFritzPackage.attempt_id}`
        : createLocalMatchId()),
  );
  const [verifiedMatchId, setVerifiedMatchId] = useState<string | null>(
    dailyFritzPackage?.verified_match_id ?? null,
  );

  const ghostSubLabel = isGhostMode
    ? (opponentName && opponentName.toLowerCase() !== 'your ghost' ? opponentName : (username || 'Your Ghost'))
    : null;

  const appendGhostMove = useCallback((entry: GhostMoveLogEntry) => {
    setGhostMoveLog((prev) => [...prev, entry]);
  }, []);

  const ghostSuggestedPlayerMove = useMemo(
    () =>
      isGhostMode
        ? resolveGhostMove({
            state: match,
            player: 'you',
            legalMoves: userPlayMoves,
            profile: ghostProfile,
          })
        : null,
    [ghostProfile, isGhostMode, match, userPlayMoves],
  );

  useEffect(() => {
    if (match.gameOver) return;
    if (currentGlickoRating == null) return;
    if (matchStartGlickoRating != null) return;
    setMatchStartGlickoRating(Number(currentGlickoRating));
  }, [currentGlickoRating, match.gameOver, matchStartGlickoRating]);

  useGhostMatchSessionStart({
    userId,
    isGhostMode,
    isDailyPuzzleRun: bootstrap.isDailyPuzzleRun,
    matchGameOver: match.gameOver,
    verifiedMatchId,
    activeLocalMatchId,
    opponentUserId,
    setVerifiedMatchId,
  });

  useGhostMatchCompletion({
    userId,
    isDailyFritzMode,
    isGhostMode,
    isStandaloneFritzMatch,
    isGuidedMode,
    isAuthoringMode,
    match,
    moveLog,
    ghostMoveLog,
    verifiedMatchId,
    activeLocalMatchId,
    opponentUserId,
    fritzOpponentId: fritzConfig.id,
    accessTokenRef,
    localPendingResolvedRef,
    ghostProfile,
    onGhostProfileChange,
    onProfilePatch,
    onProfileRefresh,
    setGhostResult,
    setGhostResultLoading,
    setGhostResultError,
  });

  useEffect(() => {
    if (!ghostPlayedTile) return;
    const timer = window.setTimeout(() => setGhostPlayedTile(null), 900);
    return () => window.clearTimeout(timer);
  }, [ghostPlayedTile]);

  const ghostResultMessage = getGhostResultMessage(match.players.you.score, match.players.bot.score);
  const ghostRatingDeltaLabel = ghostResult
    ? `${ghostResult.ratingDelta >= 0 ? '+' : ''}${ghostResult.ratingDelta}`
    : null;

  return {
    ghostMoveLog,
    setGhostMoveLog,
    ghostAgreementType,
    setGhostAgreementType,
    ghostBoardPulse,
    setGhostBoardPulse,
    ghostPlayedTile,
    setGhostPlayedTile,
    ghostResult,
    setGhostResult,
    ghostResultLoading,
    setGhostResultLoading,
    ghostResultError,
    setGhostResultError,
    matchStartGlickoRating,
    setMatchStartGlickoRating,
    activeLocalMatchId,
    setActiveLocalMatchId,
    verifiedMatchId,
    setVerifiedMatchId,
    appendGhostMove,
    ghostSuggestedPlayerMove,
    ghostSubLabel,
    ghostResultMessage,
    ghostRatingDeltaLabel,
    accessTokenRef,
    localPendingRegisteredRef: refs.localPendingRegisteredRef,
    localPendingResolvedRef,
  };
}

export type UseGhostRuntimeResult = ReturnType<typeof useGhostRuntime>;