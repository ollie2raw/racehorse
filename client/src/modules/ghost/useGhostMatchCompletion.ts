import React, { useEffect, useRef } from 'react';
import type { MoveEntry } from '../../game/moveLogger';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { completeGhostGame, type GhostCompletionResult, type GhostMoveLogEntry, type GhostProfileSummary } from './ghostContracts.ts';
import { moveEntriesToGhostMoveLog } from './ghostMatchHelpers.ts';
import { botMatchDebugLog } from '../match/runtime/botMatchDebug.ts';
import { logger } from '../../utils/logger';

type UseGhostMatchCompletionArgs = {
  userId: string | null | undefined;
  isDailyFritzMode: boolean;
  isGhostMode: boolean;
  isStandaloneFritzMatch: boolean;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  match: BotMatchState;
  moveLog: readonly MoveEntry[];
  ghostMoveLog: GhostMoveLogEntry[];
  verifiedMatchId: string | null;
  activeLocalMatchId: string;
  opponentUserId: string | null | undefined;
  fritzOpponentId: string;
  accessTokenRef: React.MutableRefObject<string | null>;
  localPendingResolvedRef: React.MutableRefObject<boolean>;
  ghostProfile: GhostProfileSummary | null | undefined;
  onGhostProfileChange: ((profile: GhostProfileSummary | null) => void) | null | undefined;
  onProfilePatch: ((patch: { glicko_rating?: number | null }) => void) | null | undefined;
  onProfileRefresh: (() => Promise<void> | void) | null | undefined;
  setGhostResult: (result: GhostCompletionResult | null) => void;
  setGhostResultLoading: (loading: boolean) => void;
  setGhostResultError: (error: string | null) => void;
};

export function useGhostMatchCompletion({
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
  fritzOpponentId,
  accessTokenRef,
  localPendingResolvedRef,
  ghostProfile,
  onGhostProfileChange,
  onProfilePatch,
  onProfileRefresh,
  setGhostResult,
  setGhostResultLoading,
  setGhostResultError,
}: UseGhostMatchCompletionArgs): void {
  const completeKeyRef = useRef('');

  useEffect(() => {
    if (!userId) return;
    if (isDailyFritzMode) return;
    if (!match.gameOver) {
      completeKeyRef.current = '';
      setGhostResult(null);
      setGhostResultLoading(false);
      setGhostResultError(null);
      return;
    }
    if (!verifiedMatchId) {
      setGhostResultLoading(false);
      if (isStandaloneFritzMatch) {
        setGhostResultError('Rating session was not verified. Match result saved locally.');
      } else if (isGhostMode) {
        setGhostResultError('Could not start rating session.');
      }
      return;
    }
    const key = `${verifiedMatchId}:${userId}:${match.handNumber}:${match.players.you.score}:${match.players.bot.score}`;
    if (completeKeyRef.current === key) return;
    completeKeyRef.current = key;
    setGhostResultLoading(true);
    setGhostResultError(null);

    const effectiveOpponentUserId = isGhostMode ? opponentUserId : (opponentUserId || fritzOpponentId);

    botMatchDebugLog('[Fritz Rating] calling completeGhostGame', {
      userId,
      effectiveOpponentUserId,
      finalScore: match.players.you.score,
      opponentScore: match.players.bot.score,
    });
    const genericGhostCompatibleMoveLog = moveEntriesToGhostMoveLog([...moveLog]);
    const fritzPlayerMoveLog = !isGhostMode
      ? genericGhostCompatibleMoveLog.filter((entry) => entry.actor === 'you')
      : undefined;
    const effectiveGhostMoveLog =
      ghostMoveLog.length > 0 ? ghostMoveLog : genericGhostCompatibleMoveLog;

    if (isGuidedMode || isAuthoringMode) {
      setGhostResultLoading(false);
      return;
    }

    void completeGhostGame({
      matchId: verifiedMatchId,
      userId,
      opponentUserId: effectiveOpponentUserId,
      localMatchId: activeLocalMatchId,
      finalScore: match.players.you.score,
      opponentScore: match.players.bot.score,
      moveLog: isGhostMode ? effectiveGhostMoveLog : genericGhostCompatibleMoveLog,
      playerMoveLog: fritzPlayerMoveLog,
      accessToken: accessTokenRef.current,
    })
      .then((result) => {
        botMatchDebugLog('[Fritz Rating] success:', result);
        setGhostResult(result);
        setGhostResultLoading(false);
        if (!isGhostMode) {
          localPendingResolvedRef.current = true;
        }
        if (result.glickoRating != null && onProfilePatch) {
          onProfilePatch({ glicko_rating: Number(result.glickoRating) });
        }
        if (onProfileRefresh) {
          void Promise.resolve(onProfileRefresh()).catch((err) => {
            console.warn('[Fritz Rating] profile refresh failed:', err);
          });
          window.setTimeout(() => {
            void Promise.resolve(onProfileRefresh()).catch(() => {});
          }, 1200);
        }
        if (!onGhostProfileChange) return;

        onGhostProfileChange(
          ghostProfile
            ? {
                ...ghostProfile,
                ghostRating: result.newRating,
                gamesPlayed: (ghostProfile.gamesPlayed ?? 0) + 1,
                recentScores: [...ghostProfile.recentScores, match.players.you.score].slice(-5),
                avgScore:
                  Math.round(
                    ([...ghostProfile.recentScores, match.players.you.score].slice(-5).reduce(
                      (sum, score) => sum + score,
                      0,
                    ) /
                      Math.max(1, [...ghostProfile.recentScores, match.players.you.score].slice(-5).length)) *
                      10,
                  ) / 10,
                paddingGames: Math.max(0, 5 - ((ghostProfile.gamesPlayed ?? 0) + 1)),
                compositeLog: result.compositeLog,
                styleProfile: result.styleProfile,
              }
            : null,
        );
      })
      .catch((err) => {
        logger.error('useGhostMatchCompletion', err, { message: '[Fritz Rating] failed' });
        completeKeyRef.current = '';
        setGhostResultLoading(false);
        setGhostResultError(err instanceof Error ? err.message : 'Rating update failed.');
        if (onProfileRefresh) {
          void Promise.resolve(onProfileRefresh()).catch((refreshErr) => {
            console.warn('[Fritz Rating] profile refresh after error failed:', refreshErr);
          });
        }
      });
  }, [
    accessTokenRef,
    activeLocalMatchId,
    fritzOpponentId,
    ghostMoveLog,
    ghostProfile,
    isAuthoringMode,
    isDailyFritzMode,
    isGhostMode,
    isGuidedMode,
    isStandaloneFritzMatch,
    localPendingResolvedRef,
    match.gameOver,
    match.handNumber,
    match.players.bot.score,
    match.players.you.score,
    moveLog,
    onGhostProfileChange,
    onProfilePatch,
    onProfileRefresh,
    opponentUserId,
    setGhostResult,
    setGhostResultError,
    setGhostResultLoading,
    userId,
    verifiedMatchId,
  ]);
}