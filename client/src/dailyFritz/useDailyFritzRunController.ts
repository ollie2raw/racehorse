import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  buildDailyFritzCompletionHash,
  completeDailyFritz,
  DAILY_FRITZ_INIT_TIMEOUT_MS,
  recordDailyFritzGame,
  startDailyFritz,
  type DailyFritzSetGameNumber,
  type DailyFritzSetGameResult,
  type DailyFritzSetResult,
  type DailyFritzStartResponse,
  type DailyFritzTodayResponse,
} from './api';
import {
  friendlyDailyFritzInitError,
  getDailyFritzGameSeed,
  getNextGameNumberFromSetResult,
  normalizeGameNumber,
  normalizeSetResult,
  normalizeStartResponse,
  resolveDailyFritzCurrentGameNumber,
} from './dailyFritzScreenHelpers';
import type {
  DailyFritzGameCompletionPayload,
  DailyFritzOverlayState,
} from './dailyFritzScreenTypes';

export type UseDailyFritzRunControllerParams = {
  today: DailyFritzTodayResponse | null;
  hubError: string | null;
  setHubError: Dispatch<SetStateAction<string | null>>;
  refreshToday: () => Promise<void>;
};

export type UseDailyFritzRunControllerResult = {
  activeRun: DailyFritzStartResponse | null;
  embeddedMatchKey: string | null;
  setOverlay: DailyFritzOverlayState | null;
  startActionPending: boolean;
  dailyFritzPackageForMatch: DailyFritzStartResponse | null;
  beginRun: () => Promise<void>;
  continueSet: () => Promise<void>;
  closeEmbeddedRun: () => void;
  finishEmbeddedRun: () => Promise<void>;
  handleDailyFritzGameComplete: (game: DailyFritzGameCompletionPayload) => Promise<void>;
  clearSetOverlay: () => void;
  hasEmbeddedMatch: boolean;
};

export function useDailyFritzRunController({
  today,
  hubError: _hubError,
  setHubError,
  refreshToday,
}: UseDailyFritzRunControllerParams): UseDailyFritzRunControllerResult {
  const [activeRun, setActiveRun] = useState<DailyFritzStartResponse | null>(null);
  const [embeddedMatchKey, setEmbeddedMatchKey] = useState<string | null>(null);
  const [setOverlay, setSetOverlay] = useState<DailyFritzOverlayState | null>(null);
  const [startActionPending, setStartActionPending] = useState(false);

  const activeRunRef = useRef<DailyFritzStartResponse | null>(activeRun);
  const recordGameInFlightRef = useRef(false);
  const completedAttemptIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeRunRef.current = activeRun;
  }, [activeRun]);

  const loadToday = refreshToday;

  const closeEmbeddedRun = useCallback(() => {
    setEmbeddedMatchKey(null);
    setActiveRun(null);
  }, []);

  const openEmbeddedRun = useCallback((normalized: DailyFritzStartResponse) => {
    const gameSlot = normalized.current_game_number ?? 1;
    setEmbeddedMatchKey(`${normalized.attempt_id}:${gameSlot}`);
    setActiveRun(normalized);
  }, []);

  const buildCompletedGame = useCallback((
    run: DailyFritzStartResponse,
    game: DailyFritzGameCompletionPayload,
    gameNumber: DailyFritzSetGameNumber,
  ): DailyFritzSetGameResult => {
    const playerScore = Number(game.yourScore);
    const fritzScore = Number(game.botScore);
    const playerWon = playerScore > fritzScore;
    return {
      gameNumber,
      seed: getDailyFritzGameSeed(run.run_date, gameNumber),
      playerWon,
      playerScore: game.yourScore,
      fritzScore: game.botScore,
      pointDiff: game.yourScore - game.botScore,
      movesUsed: game.movesUsed,
      handsPlayed: game.handsPlayed,
      completedAt: new Date().toISOString(),
    };
  }, []);

  const submitSetCompletion = useCallback(async ({
    run,
    setResult,
    completedGame,
    currentHandIndex,
    boardContext,
  }: {
    run: DailyFritzStartResponse;
    setResult: DailyFritzSetResult;
    completedGame: DailyFritzSetGameResult;
    currentHandIndex: number;
    boardContext: boolean;
  }) => {
    if (completedAttemptIdRef.current === run.attempt_id) {
      return;
    }
    const totalMoves = setResult.games.reduce((sum, entry) => sum + Number(entry.movesUsed ?? 0), 0);
    const totalHands = setResult.games.reduce((sum, entry) => sum + Number(entry.handsPlayed ?? 0), 0);

    if (boardContext) {
      setSetOverlay({
        kind: 'finalizing',
        completedGame,
        setResult,
        message: 'Posting your completed set…',
        currentHandIndex,
      });
    }

    try {
      const completionHash = await buildDailyFritzCompletionHash({
        runDate: run.run_date,
        attemptId: run.attempt_id,
        verifiedMatchId: run.verified_match_id,
        currentHandIndex,
        finalScore: setResult.playerGamesWon,
        opponentScore: setResult.fritzGamesWon,
        won: setResult.setWinner === 'player',
        movesUsed: totalMoves,
        handsPlayed: totalHands,
        moveLog: setResult,
      });
      const completion = await completeDailyFritz({
        attemptId: run.attempt_id,
        verifiedMatchId: run.verified_match_id,
        runDate: run.run_date,
        completionHash,
        finalScore: setResult.playerGamesWon,
        opponentScore: setResult.fritzGamesWon,
        won: setResult.setWinner === 'player',
        movesUsed: totalMoves,
        handsPlayed: totalHands,
        moveLog: setResult,
        setResult,
      });
      completedAttemptIdRef.current = run.attempt_id;

      if (boardContext) {
        setSetOverlay({
          kind: 'final',
          completedGame,
          setResult,
          rank: completion.rank ?? null,
          canViewLeaderboard: completion.leaderboard_preview.length > 0,
        });
      } else {
        setSetOverlay(null);
        await loadToday();
      }
      setActiveRun((current) =>
        current
          ? {
              ...current,
              set_result: setResult,
            }
          : current,
      );
      setHubError(null);
      return completion;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to finalize Daily Fritz set.';
      if (boardContext) {
        setSetOverlay({
          kind: 'final-error',
          completedGame,
          setResult,
          error: message,
          currentHandIndex,
        });
      }
      throw err;
    }
  }, [loadToday, setHubError]);

  const finishEmbeddedRun = useCallback(async () => {
    closeEmbeddedRun();
    await loadToday();
  }, [closeEmbeddedRun, loadToday]);

  const handleStartResponse = useCallback(async (
    started: DailyFritzStartResponse,
    fallbackSetResult: DailyFritzSetResult | null,
  ) => {
    const normalized = normalizeStartResponse(started, fallbackSetResult);
    if (normalized.needs_completion && normalized.set_result?.setWinner) {
      const completedGame =
        normalized.set_result.games[normalized.set_result.games.length - 1] ??
        buildCompletedGame(normalized, {
          winner: normalized.set_result.setWinner === 'player' ? 'you' : 'bot',
          yourScore: normalized.set_result.playerGamesWon,
          botScore: normalized.set_result.fritzGamesWon,
          movesUsed: Number(normalized.set_result.moves_used ?? 0),
          handsPlayed: Number(normalized.set_result.hands_played ?? 0),
          currentHandIndex: normalized.current_hand_index,
          moveLog: normalized.set_result,
        }, 1);
      try {
        await submitSetCompletion({
          run: normalized,
          setResult: normalized.set_result,
          completedGame,
          currentHandIndex: normalized.current_hand_index,
          boardContext: false,
        });
      } catch {
        // no-op
      }
      return;
    }
    openEmbeddedRun(normalized);
  }, [buildCompletedGame, openEmbeddedRun, submitSetCompletion]);

  const beginRun = useCallback(async () => {
    if (startActionPending) return;
    setStartActionPending(true);
    setHubError(null);
    setSetOverlay(null);
    try {
      const started = await startDailyFritz({ timeoutMs: DAILY_FRITZ_INIT_TIMEOUT_MS });
      await handleStartResponse(started, normalizeSetResult(today?.set_result ?? today?.result));
    } catch (err) {
      setHubError(friendlyDailyFritzInitError(err));
    } finally {
      setStartActionPending(false);
    }
  }, [handleStartResponse, startActionPending, setHubError, today]);

  const continueSet = useCallback(async () => {
    if (startActionPending) return;
    setStartActionPending(true);
    setHubError(null);
    const fallbackSetResult =
      setOverlay != null && 'setResult' in setOverlay
        ? setOverlay.setResult
        : normalizeSetResult(today?.set_result ?? today?.result);
    try {
      const started = await startDailyFritz({ timeoutMs: DAILY_FRITZ_INIT_TIMEOUT_MS });
      setSetOverlay(null);
      await handleStartResponse(started, fallbackSetResult);
    } catch (err) {
      setHubError(friendlyDailyFritzInitError(err));
    } finally {
      setStartActionPending(false);
    }
  }, [handleStartResponse, setOverlay, startActionPending, setHubError, today]);

  const submitCompletedGame = useCallback(async (game: DailyFritzGameCompletionPayload) => {
    const run = activeRunRef.current;
    if (!run) return;
    const priorSet = normalizeSetResult(run.set_result);
    if (priorSet?.setWinner) return;
    if (recordGameInFlightRef.current) return;
    recordGameInFlightRef.current = true;
    const gameNumber = getNextGameNumberFromSetResult(priorSet);
    const fallbackCompletedGame = buildCompletedGame(run, game, gameNumber);
    setHubError(null);
    setSetOverlay({
      kind: 'saving',
      completedGame: fallbackCompletedGame,
      message: `Saving Game ${gameNumber}…`,
    });

    try {
      const recorded = await recordDailyFritzGame({
        attemptId: run.attempt_id,
        verifiedMatchId: run.verified_match_id,
        runDate: run.run_date,
        gameNumber,
        playerScore: game.yourScore,
        fritzScore: game.botScore,
        movesUsed: game.movesUsed,
        handsPlayed: game.handsPlayed,
      });

      const setResult = normalizeSetResult(recorded.set_result) ?? recorded.set_result;
      const completedGame =
        setResult.games.find((entry) => entry.gameNumber === gameNumber) ?? fallbackCompletedGame;

      if (setResult.setWinner) {
        setActiveRun((current) =>
          current
            ? {
                ...current,
                set_result: setResult,
              }
            : current,
        );
        await submitSetCompletion({
          run,
          setResult,
          completedGame,
          currentHandIndex: game.currentHandIndex,
          boardContext: true,
        });
        return;
      }

      const nextGameNumber = recorded.next_game_number;
      if (nextGameNumber != null) {
        setSetOverlay({
          kind: 'between',
          completedGame,
          setResult,
          nextGameNumber: normalizeGameNumber(nextGameNumber, 2),
        });
        return;
      }
      if (!setResult.setWinner) {
        setSetOverlay({
          kind: 'record-error',
          completedGame,
          message: 'Game saved, but the next match could not be determined.',
          error: 'The server did not return a next game number. You can try saving again.',
          game,
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save Daily Fritz set progress.';
      setSetOverlay({
        kind: 'record-error',
        completedGame: fallbackCompletedGame,
        message: `Game ${gameNumber} is finished, but the result has not been saved yet.`,
        error: message,
        game,
      });
    } finally {
      recordGameInFlightRef.current = false;
    }
  }, [buildCompletedGame, setHubError, submitSetCompletion]);

  const handleDailyFritzGameComplete = useCallback(async (game: DailyFritzGameCompletionPayload) => {
    await submitCompletedGame(game);
  }, [submitCompletedGame]);

  const activeSetResult = useMemo(
    () => normalizeSetResult(activeRun?.set_result ?? null),
    [activeRun?.set_result],
  );
  const activeGameNumber = resolveDailyFritzCurrentGameNumber(activeSetResult, activeRun?.current_game_number);

  const dailyFritzPackageForMatch = useMemo((): DailyFritzStartResponse | null => {
    if (!activeRun) return null;
    return {
      ...activeRun,
      current_game_number: activeGameNumber,
      set_result: activeSetResult,
    };
  }, [activeRun, activeGameNumber, activeSetResult]);

  useEffect(() => {
    if (!activeRun || !embeddedMatchKey) return;
    const inferredKey = `${activeRun.attempt_id}:${activeGameNumber}`;
    if (inferredKey !== embeddedMatchKey) {
      console.warn('[df-scripted-draw] embedded key drift (stable key held)', {
        embeddedMatchKey,
        inferredKey,
        activeGameNumber,
        storedGameNumber: activeRun.current_game_number ?? null,
      });
    }
  }, [activeRun, activeGameNumber, embeddedMatchKey]);

  const clearSetOverlay = useCallback(() => {
    setSetOverlay(null);
  }, []);

  const hasEmbeddedMatch = Boolean(activeRun && embeddedMatchKey);

  return {
    activeRun,
    embeddedMatchKey,
    setOverlay,
    startActionPending,
    dailyFritzPackageForMatch,
    beginRun,
    continueSet,
    closeEmbeddedRun,
    finishEmbeddedRun,
    handleDailyFritzGameComplete,
    clearSetOverlay,
    hasEmbeddedMatch,
  };
}