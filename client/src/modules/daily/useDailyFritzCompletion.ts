import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MoveEntry } from '../../game/moveLogger';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import {
  buildDailyFritzCompletionHash,
  completeDailyFritz,
  type DailyFritzLeaderboardRow,
  type DailyFritzStartResponse,
} from './dailyFritzContracts.ts';
import { dailyFritzDebugLog } from './dailyFritzMatchDiagnostics.ts';

type DailyFritzGameCompleteResult = {
  winner: 'you' | 'bot' | null;
  yourScore: number;
  botScore: number;
  movesUsed: number;
  handsPlayed: number;
  currentHandIndex: number;
  moveLog: MoveEntry[];
};

type UseDailyFritzCompletionArgs = {
  enabled: boolean;
  dailyFritzPackage: DailyFritzStartResponse | null | undefined;
  dailyFritzHandIndex: number;
  match: BotMatchState;
  moveLog: readonly MoveEntry[];
  movesUsed: number;
  userId: string | null | undefined;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  onDailyFritzGameComplete: ((result: DailyFritzGameCompleteResult) => void) | null | undefined;
  setResultLoading: (loading: boolean) => void;
  setResultError: (error: string | null) => void;
  resultLoading: boolean;
  resultError: string | null;
};

type UseDailyFritzCompletionResult = {
  dailyFritzLeaderboard: DailyFritzLeaderboardRow[];
  dailyFritzRank: number | null;
  retryDailyFritzCompletion: () => void;
  /** Dev debug overlay reads `.current` without re-rendering. */
  submitSucceededRef: React.MutableRefObject<boolean>;
};

export function useDailyFritzCompletion({
  enabled,
  dailyFritzPackage,
  dailyFritzHandIndex,
  match,
  moveLog,
  movesUsed,
  userId,
  isGuidedMode,
  isAuthoringMode,
  onDailyFritzGameComplete,
  setResultLoading,
  setResultError,
  resultLoading,
  resultError,
}: UseDailyFritzCompletionArgs): UseDailyFritzCompletionResult {
  const [dailyFritzLeaderboard, setDailyFritzLeaderboard] = useState<DailyFritzLeaderboardRow[]>([]);
  const [dailyFritzRank, setDailyFritzRank] = useState<number | null>(null);

  const completeKeyRef = useRef('');
  const gameCompleteKeyRef = useRef('');
  const submitSucceededRef = useRef(false);
  const autoSubmitBlockedRef = useRef(false);
  const [submitRetryNonce, setSubmitRetryNonce] = useState(0);

  useEffect(() => {
    if (!enabled || !onDailyFritzGameComplete) return;
    if (!match.gameOver) {
      gameCompleteKeyRef.current = '';
      return;
    }
    const key = [
      dailyFritzPackage?.attempt_id ?? 'daily',
      dailyFritzPackage?.current_game_number ?? 1,
      match.handNumber,
      match.winnerId,
      match.players.you.score,
      match.players.bot.score,
      movesUsed,
    ].join(':');
    if (gameCompleteKeyRef.current === key) return;
    gameCompleteKeyRef.current = key;
    onDailyFritzGameComplete({
      winner: match.winnerId,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
      movesUsed,
      handsPlayed: match.handNumber,
      currentHandIndex: dailyFritzHandIndex,
      moveLog: JSON.parse(JSON.stringify(moveLog)),
    });
  }, [
    dailyFritzHandIndex,
    dailyFritzPackage?.attempt_id,
    dailyFritzPackage?.current_game_number,
    enabled,
    match.gameOver,
    match.handNumber,
    match.players.bot.score,
    match.players.you.score,
    match.winnerId,
    moveLog,
    movesUsed,
    onDailyFritzGameComplete,
  ]);

  const submitDailyFritzCompletion = useCallback(() => {
    if (!enabled || onDailyFritzGameComplete || !dailyFritzPackage || !userId || !match.gameOver) return;
    if (submitSucceededRef.current || autoSubmitBlockedRef.current) return;

    dailyFritzDebugLog('[daily-complete] game over reached');

    const completionKey = [
      dailyFritzPackage.attempt_id,
      match.handNumber,
      match.players.you.score,
      match.players.bot.score,
      movesUsed,
    ].join(':');

    if (completeKeyRef.current === completionKey) {
      dailyFritzDebugLog('[daily-complete] modal state = dedup-skipped key=' + completionKey);
      return;
    }
    completeKeyRef.current = completionKey;

    dailyFritzDebugLog('[daily-complete] submit start key=' + completionKey);
    dailyFritzDebugLog('[daily-flow] submit start', {
      key: completionKey,
      handNumber: match.handNumber,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
    });
    setResultLoading(true);
    setResultError(null);

    const capturedMoveLog = JSON.parse(JSON.stringify(moveLog));

    void (async () => {
      if (isGuidedMode || isAuthoringMode) {
        setResultLoading(false);
        return;
      }
      try {
        const completionHash = await buildDailyFritzCompletionHash({
          runDate: dailyFritzPackage.run_date,
          attemptId: dailyFritzPackage.attempt_id,
          verifiedMatchId: dailyFritzPackage.verified_match_id,
          currentHandIndex: dailyFritzHandIndex,
          finalScore: match.players.you.score,
          opponentScore: match.players.bot.score,
          won: match.winnerId === 'you',
          movesUsed,
          handsPlayed: match.handNumber,
          moveLog: capturedMoveLog,
        });

        const response = await completeDailyFritz({
          attemptId: dailyFritzPackage.attempt_id,
          verifiedMatchId: dailyFritzPackage.verified_match_id,
          runDate: dailyFritzPackage.run_date,
          completionHash,
          finalScore: match.players.you.score,
          opponentScore: match.players.bot.score,
          won: match.winnerId === 'you',
          movesUsed,
          handsPlayed: match.handNumber,
          moveLog: capturedMoveLog,
        });
        submitSucceededRef.current = true;
        autoSubmitBlockedRef.current = false;
        dailyFritzDebugLog('[daily-complete] submit success');
        dailyFritzDebugLog('[daily-flow] submit success', {
          key: completionKey,
          rank: response.rank ?? null,
        });
        setDailyFritzLeaderboard(response.leaderboard_preview);
        setDailyFritzRank(response.rank ?? null);
        setResultLoading(false);
        dailyFritzDebugLog('[daily-complete] modal state = complete');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Daily Fritz submission failed.';
        autoSubmitBlockedRef.current = true;
        completeKeyRef.current = '';
        dailyFritzDebugLog('[daily-complete] submit error', errMsg);
        dailyFritzDebugLog('[daily-flow] submit error', { key: completionKey, error: errMsg });
        setResultLoading(false);
        setResultError(errMsg);
        dailyFritzDebugLog('[daily-complete] modal state = error');
      }
    })();
  }, [
    dailyFritzHandIndex,
    dailyFritzPackage,
    enabled,
    isAuthoringMode,
    isGuidedMode,
    match.gameOver,
    match.handNumber,
    match.players.bot.score,
    match.players.you.score,
    match.winnerId,
    moveLog,
    movesUsed,
    onDailyFritzGameComplete,
    setResultError,
    setResultLoading,
    userId,
  ]);

  const retryDailyFritzCompletion = useCallback(() => {
    if (!resultError || resultLoading || submitSucceededRef.current) return;
    autoSubmitBlockedRef.current = false;
    setResultError(null);
    setSubmitRetryNonce((prev) => prev + 1);
  }, [resultError, resultLoading, setResultError]);

  useEffect(() => {
    if (!enabled || onDailyFritzGameComplete || !dailyFritzPackage || !userId) return;

    if (!match.gameOver) {
      dailyFritzDebugLog('[daily-complete] modal state = not-game-over');
      if (!submitSucceededRef.current) {
        completeKeyRef.current = '';
        autoSubmitBlockedRef.current = false;
        setResultLoading(false);
        setResultError(null);
      }
      return;
    }

    if (submitSucceededRef.current) {
      dailyFritzDebugLog('[daily-complete] modal state = already-succeeded (permanent guard)');
      return;
    }

    if (autoSubmitBlockedRef.current) {
      dailyFritzDebugLog('[daily-complete] modal state = waiting-for-manual-retry');
      return;
    }

    submitDailyFritzCompletion();
  }, [
    dailyFritzPackage,
    enabled,
    match.gameOver,
    onDailyFritzGameComplete,
    setResultError,
    setResultLoading,
    submitDailyFritzCompletion,
    submitRetryNonce,
    userId,
  ]);

  return {
    dailyFritzLeaderboard,
    dailyFritzRank,
    retryDailyFritzCompletion,
    submitSucceededRef: submitSucceededRef,
  };
}