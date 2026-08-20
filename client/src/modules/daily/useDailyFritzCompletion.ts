import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MoveEntry } from '../../game/moveLogger';
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

import type { DailyFritzMatchSession } from './dailyFritzMatchSession.ts';

type UseDailyFritzCompletionArgs = {
  enabled: boolean;
  dailyFritzPackage: DailyFritzStartResponse | null | undefined;
  session: DailyFritzMatchSession;
  moveLog: readonly MoveEntry[];
  movesUsed: number;
  userId: string | null | undefined;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  onDailyFritzGameComplete:
    | ((result: DailyFritzGameCompleteResult) => void | Promise<void>)
    | null
    | undefined;
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
  session,
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
  const { match } = session;
  const dailyFritzHandIndex = session.cursor.handIndex;
  const [dailyFritzLeaderboard, setDailyFritzLeaderboard] = useState<DailyFritzLeaderboardRow[]>([]);
  const [dailyFritzRank, setDailyFritzRank] = useState<number | null>(null);

  const completeKeyRef = useRef('');
  const gameCompleteKeyRef = useRef('');
  const gameCompleteInFlightRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const submitSucceededRef = useRef(false);
  const autoSubmitBlockedRef = useRef(false);
  const [submitRetryNonce, setSubmitRetryNonce] = useState(0);

  useEffect(() => {
    if (!enabled || !onDailyFritzGameComplete) return;
    if (!match.gameOver) {
      gameCompleteKeyRef.current = '';
      return;
    }
    if (
      dailyFritzPackage?.challenge_code
      && Math.max(match.players.you.score, match.players.bot.score) < dailyFritzPackage.winning_score
    ) {
      // A challenge hand can end without ending the current game. The server
      // remains authoritative; never submit such a hand as record-game.
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
    if (gameCompleteKeyRef.current === key || gameCompleteInFlightRef.current) return;
    gameCompleteInFlightRef.current = true;
    const payload = {
      winner: match.winnerId,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
      movesUsed,
      handsPlayed: match.handNumber,
      currentHandIndex: dailyFritzHandIndex,
      moveLog: JSON.parse(JSON.stringify(moveLog)) as MoveEntry[],
      journal: match.officialJournal ?? null,
    };
    void Promise.resolve(onDailyFritzGameComplete(payload))
      .then(() => {
        gameCompleteKeyRef.current = key;
      })
      .catch(() => {
        // Leave key empty so the effect can retry after overlay/manual recovery.
      })
      .finally(() => {
        gameCompleteInFlightRef.current = false;
      });
  }, [
    dailyFritzHandIndex,
    dailyFritzPackage?.attempt_id,
    dailyFritzPackage?.current_game_number,
    dailyFritzPackage?.winning_score,
    enabled,
    match.gameOver,
    match.handNumber,
    match.officialJournal,
    match.players.bot.score,
    match.players.you.score,
    match.winnerId,
    moveLog,
    movesUsed,
    onDailyFritzGameComplete,
  ]);

  const submitDailyFritzCompletion = useCallback(() => {
    if (!enabled || onDailyFritzGameComplete || !dailyFritzPackage || !userId || !match.gameOver) return;
    if (submitSucceededRef.current || autoSubmitBlockedRef.current || submitInFlightRef.current) return;

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

    dailyFritzDebugLog('[daily-complete] submit start key=' + completionKey);
    dailyFritzDebugLog('[daily-flow] submit start', {
      key: completionKey,
      handNumber: match.handNumber,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
    });
    setResultLoading(true);
    setResultError(null);
    submitInFlightRef.current = true;

    const capturedMoveLog = JSON.parse(JSON.stringify(moveLog));

    void (async () => {
      if (isGuidedMode || isAuthoringMode) {
        setResultLoading(false);
        submitInFlightRef.current = false;
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
        completeKeyRef.current = completionKey;
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
      } finally {
        submitInFlightRef.current = false;
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
