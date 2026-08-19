import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  buildDailyFritzCompletionHash,
  completeDailyFritz,
  DAILY_FRITZ_INIT_TIMEOUT_MS,
  DAILY_FRITZ_RECORD_GAME_TIMEOUT_MS,
  DailyFritzAuthorityRecoveryError,
  recordDailyFritzGame,
  recordDailyFritzTelemetry,
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
  resolveStartNextAction,
  resolveTodayNextAction,
  normalizeStartResponse,
  resolveDailyFritzCurrentGameNumber,
} from './dailyFritzScreenHelpers';
import type {
  DailyFritzGameCompletionPayload,
  DailyFritzOverlayState,
} from './dailyFritzScreenTypes';
import { buildDailyFritzTranscript } from './dailyFritzTranscript';
import { reportDailyFritzOperationalAlert } from './dailyFritzObservability';
import { createDailyFritzChallengeIdentity } from './dailyFritzChallengeIdentity';
import type { MoveEntry } from '../game/moveLogger';
import { dailyFritzTelemetryEventId, getDailyFritzTelemetrySession } from './telemetry';
import {
  buildDailyFritzStorageKey,
  discardDailyFritzSnapshot,
} from '../modules/daily/dailyFritzSessionStorage';

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
  retryFinalSubmission: () => Promise<void>;
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
  const pendingRecordGameRef = useRef<{
    game: DailyFritzGameCompletionPayload;
    gameNumber: DailyFritzSetGameNumber;
    fallbackCompletedGame: DailyFritzSetGameResult;
  } | null>(null);
  const startActionInFlightRef = useRef(false);
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
        const sessionId = getDailyFritzTelemetrySession(run.run_date);
        void recordDailyFritzTelemetry({
          eventId: dailyFritzTelemetryEventId(run.attempt_id, 'recovery_started', 'complete-modal-error'),
          eventType: 'recovery_started',
          attemptId: run.attempt_id,
          runDate: run.run_date,
          challengeId: run.challenge_id ?? null,
          sessionId,
          failureCode: err instanceof Error ? err.name : 'complete_failed',
          payload: {
            transitionPhase: 'complete',
            endpoint: '/api/daily-fritz/complete',
            clientCursor: {
              gameNumber: run.current_game_number ?? 1,
              handIndex: currentHandIndex,
              authorityRevision: run.authority_revision ?? null,
            },
            serverResponse: message,
            recoveryDecision: 'show_final_error_modal',
          },
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
    if (resolveStartNextAction(normalized) === 'finalize_set' && normalized.set_result?.setWinner) {
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
      openEmbeddedRun(normalized);
      try {
        await submitSetCompletion({
          run: normalized,
          setResult: normalized.set_result,
          completedGame,
          currentHandIndex: normalized.current_hand_index,
          boardContext: true,
        });
      } catch {
        // no-op
      }
      return;
    }
    openEmbeddedRun(normalized);
  }, [buildCompletedGame, openEmbeddedRun, submitSetCompletion]);

  const beginRun = useCallback(async () => {
    if (startActionInFlightRef.current) return;
    startActionInFlightRef.current = true;
    setStartActionPending(true);
    setHubError(null);
    setSetOverlay(null);
    if (today?.run_date) {
      const sessionId = getDailyFritzTelemetrySession(today.run_date);
      void recordDailyFritzTelemetry({
        eventId: dailyFritzTelemetryEventId(sessionId, 'start_requested'),
        eventType: 'start_requested',
        runDate: today.run_date,
        challengeId: today.challenge_id ?? null,
        sessionId,
      });
    }
    try {
      const started = await startDailyFritz({ timeoutMs: DAILY_FRITZ_INIT_TIMEOUT_MS });
      await handleStartResponse(started, normalizeSetResult(today?.set_result ?? today?.result));
    } catch (err) {
      setHubError(friendlyDailyFritzInitError(err));
    } finally {
      startActionInFlightRef.current = false;
      setStartActionPending(false);
    }
  }, [handleStartResponse, setHubError, today]);

  const continueSet = useCallback(async () => {
    if (startActionInFlightRef.current) return;
    startActionInFlightRef.current = true;
    setStartActionPending(true);
    setHubError(null);
    const fallbackSetResult =
      setOverlay != null && 'setResult' in setOverlay
        ? setOverlay.setResult
        : normalizeSetResult(today?.set_result ?? today?.result);
    if (today?.run_date) {
      const sessionId = getDailyFritzTelemetrySession(today.run_date);
      void recordDailyFritzTelemetry({
        eventId: dailyFritzTelemetryEventId(sessionId, 'start_requested', 'resume'),
        eventType: 'start_requested',
        runDate: today.run_date,
        challengeId: today.challenge_id ?? null,
        sessionId,
        payload: { resume: true },
      });
    }
    try {
      const started = await startDailyFritz({ timeoutMs: DAILY_FRITZ_INIT_TIMEOUT_MS });
      setSetOverlay(null);
      await handleStartResponse(started, fallbackSetResult);
    } catch (err) {
      setHubError(friendlyDailyFritzInitError(err));
    } finally {
      startActionInFlightRef.current = false;
      setStartActionPending(false);
    }
  }, [handleStartResponse, setOverlay, setHubError, today]);

  useEffect(() => {
    if (resolveTodayNextAction(today) !== 'finalize_set' || activeRun) return;
    if (!normalizeSetResult(today?.set_result ?? today?.result)?.setWinner) return;
    void continueSet();
  }, [activeRun, continueSet, today]);

  const submitCompletedGame = useCallback(async (game: DailyFritzGameCompletionPayload) => {
    const run = activeRunRef.current;
    if (!run) return;
    const priorSet = normalizeSetResult(run.set_result);
    if (priorSet?.setWinner) return;
    if (recordGameInFlightRef.current) return;
    recordGameInFlightRef.current = true;
    const gameNumber = getNextGameNumberFromSetResult(priorSet);
    const fallbackCompletedGame = buildCompletedGame(run, game, gameNumber);
    pendingRecordGameRef.current = { game, gameNumber, fallbackCompletedGame };
    setHubError(null);
    setSetOverlay({
      kind: 'saving',
      completedGame: fallbackCompletedGame,
      message: `Saving Game ${gameNumber}…`,
    });

    try {
      let transcript: import('@racehorse/game-core').DailyFritzTranscript | null = null;
      try {
        transcript = buildDailyFritzTranscript({
          challengeId: run.challenge_id
            ?? createDailyFritzChallengeIdentity(run.run_date).challengeId,
          attemptId: run.attempt_id,
          gameNumber,
          handIndex: game.currentHandIndex,
          handNumber: game.handsPlayed,
          moveLog: game.moveLog as MoveEntry[],
          journal: game.journal ?? null,
          fritzPolicyVersion: run.fritz_policy_version,
          attemptPredatesJournalRollout:
            run.verification_status === 'legacy_unverified'
            || Number(run.verification_protocol_version ?? 0) <= 1,
        });
      } catch (transcriptError) {
        // Competitive attempts must not silently drop evidence and finish unranked.
        const competitive =
          run.verification_status != null
          && run.verification_status !== 'legacy_unverified'
          && Number(run.verification_protocol_version) > 0;
        if (competitive) {
          reportDailyFritzOperationalAlert(
            'transcript_build_failed',
            'Daily Fritz record-game transcript build failed',
            {
              attemptId: run.attempt_id,
              gameNumber,
              handIndex: game.currentHandIndex,
              hasJournal: Boolean(game.journal?.actions?.length),
              error: transcriptError instanceof Error ? transcriptError.message : String(transcriptError),
            },
          );
          throw transcriptError instanceof Error
            ? transcriptError
            : new Error('Failed to build Daily Fritz verification transcript.');
        }
        // Pre-verifier / legacy sessions may still finalize unranked.
      }
      const recorded = await recordDailyFritzGame({
        attemptId: run.attempt_id,
        verifiedMatchId: run.verified_match_id,
        runDate: run.run_date,
        gameNumber,
        transcript,
        playerScore: game.yourScore,
        fritzScore: game.botScore,
        movesUsed: game.movesUsed,
        handsPlayed: game.handsPlayed,
      });

      const setResult = normalizeSetResult(recorded.set_result) ?? recorded.set_result;
      const recordedRun = {
        ...run,
        authority_revision: recorded.authority_revision ?? run.authority_revision,
      };
      const completedGame =
        setResult.games.find((entry) => entry.gameNumber === gameNumber) ?? fallbackCompletedGame;

      if (setResult.setWinner) {
        setActiveRun((current) =>
          current
            ? {
              ...current,
              set_result: setResult,
              authority_revision: recordedRun.authority_revision,
              }
            : current,
        );
        try {
          await submitSetCompletion({
            run: recordedRun,
            setResult,
            completedGame,
            currentHandIndex: game.currentHandIndex,
            boardContext: true,
          });
        } catch (completeErr) {
          const completeMessage = completeErr instanceof Error
            ? completeErr.message
            : 'Failed to complete Daily Fritz attempt.';
          reportDailyFritzOperationalAlert(
            'complete_failed',
            'Daily Fritz complete failed',
            {
              attemptId: run.attempt_id,
              gameNumber,
              error: completeMessage,
            },
          );
          return;
        }
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
      if (err instanceof DailyFritzAuthorityRecoveryError) {
        const sessionId = getDailyFritzTelemetrySession(run.run_date);
        const recoveryScope = `${run.attempt_id}:${gameNumber}:${game.currentHandIndex}`;
        void recordDailyFritzTelemetry({
          eventId: dailyFritzTelemetryEventId(recoveryScope, 'recovery_started'),
          eventType: 'recovery_started',
          attemptId: run.attempt_id,
          runDate: run.run_date,
          challengeId: run.challenge_id ?? null,
          sessionId,
          failureCode: err.verifierCode,
          payload: {
            transitionPhase: 'record-game',
            endpoint: '/api/daily-fritz/record-game',
            clientCursor: {
              gameNumber,
              handIndex: game.currentHandIndex,
              authorityRevision: run.authority_revision ?? null,
            },
            serverCursor: {
              authorityRevision: err.authorityRevision,
              authoritativeState: err.authoritativeState,
            },
            status: err.status,
            recoveryDecision: 'discard_checkpoint_and_reload_authority',
          },
        });
        discardDailyFritzSnapshot(buildDailyFritzStorageKey(run.attempt_id, gameNumber));
        setSetOverlay(null);
        closeEmbeddedRun();
        setHubError('Daily Fritz restored the last verified hand. Your verified progress is safe.');
        try {
          await loadToday();
          void recordDailyFritzTelemetry({
            eventId: dailyFritzTelemetryEventId(recoveryScope, 'recovery_succeeded'),
            eventType: 'recovery_succeeded',
            attemptId: run.attempt_id,
            runDate: run.run_date,
            challengeId: run.challenge_id ?? null,
            sessionId,
            failureCode: err.verifierCode,
          });
        } catch (recoveryError) {
          void recordDailyFritzTelemetry({
            eventId: dailyFritzTelemetryEventId(recoveryScope, 'recovery_failed'),
            eventType: 'recovery_failed',
            attemptId: run.attempt_id,
            runDate: run.run_date,
            challengeId: run.challenge_id ?? null,
            sessionId,
            failureCode: recoveryError instanceof Error ? recoveryError.name : 'reload_failed',
          });
          // The hub keeps the recovery message and its normal retry affordance.
        }
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to save Daily Fritz set progress.';
      reportDailyFritzOperationalAlert(
        'record_game_failed',
        'Daily Fritz record-game failed',
        {
          attemptId: run.attempt_id,
          gameNumber,
          error: message,
        },
      );
      setSetOverlay({
        kind: 'record-error',
        completedGame: fallbackCompletedGame,
        message: `Game ${gameNumber} is finished, but the result has not been saved yet.`,
        error: message,
        game,
      });
      const sessionId = getDailyFritzTelemetrySession(run.run_date);
      void recordDailyFritzTelemetry({
        eventId: dailyFritzTelemetryEventId(
          run.attempt_id,
          'recovery_started',
          `record-game-modal-error:${gameNumber}:${game.currentHandIndex}`,
        ),
        eventType: 'recovery_started',
        attemptId: run.attempt_id,
        runDate: run.run_date,
        challengeId: run.challenge_id ?? null,
        sessionId,
        failureCode: err instanceof Error ? err.name : 'record_game_failed',
        payload: {
          transitionPhase: 'record-game',
          endpoint: '/api/daily-fritz/record-game',
          clientCursor: {
            gameNumber,
            handIndex: game.currentHandIndex,
            authorityRevision: run.authority_revision ?? null,
          },
          serverResponse: message,
          recoveryDecision: 'show_record_error_modal',
        },
      });
      throw err instanceof Error ? err : new Error(message);
    } finally {
      pendingRecordGameRef.current = null;
      recordGameInFlightRef.current = false;
    }
  }, [buildCompletedGame, closeEmbeddedRun, loadToday, setHubError, submitSetCompletion]);

  useEffect(() => {
    if (setOverlay?.kind !== 'saving') return;
    const watchdogMs = DAILY_FRITZ_RECORD_GAME_TIMEOUT_MS + 5_000;
    const timer = window.setTimeout(() => {
      setSetOverlay((current) => {
        if (current?.kind !== 'saving') return current;
        const pending = pendingRecordGameRef.current;
        if (!pending) {
          return {
            kind: 'record-error',
            completedGame: current.completedGame,
            message: 'Saving timed out.',
            error: 'The save request took too long. Check your connection and try again.',
            game: {
              winner: null,
              yourScore: current.completedGame.playerScore,
              botScore: current.completedGame.fritzScore,
              movesUsed: 0,
              handsPlayed: 0,
              currentHandIndex: 0,
              moveLog: [],
            },
          };
        }
        return {
          kind: 'record-error',
          completedGame: pending.fallbackCompletedGame,
          message: `Game ${pending.gameNumber} is finished, but the result has not been saved yet.`,
          error: 'The save request took too long. Check your connection and try again.',
          game: pending.game,
        };
      });
      recordGameInFlightRef.current = false;
      const pendingSnapshot = pendingRecordGameRef.current;
      const runSnapshot = activeRunRef.current;
      reportDailyFritzOperationalAlert(
        'saving_timeout',
        'Daily Fritz record-game saving overlay timed out',
        {
          attemptId: runSnapshot?.attempt_id,
          gameNumber: pendingSnapshot?.gameNumber,
        },
      );
    }, watchdogMs);
    return () => window.clearTimeout(timer);
  }, [setOverlay]);

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
  const retryFinalSubmission = useCallback(async () => {
    const run = activeRunRef.current;
    if (!run || setOverlay?.kind !== 'final-error') return;
    await submitSetCompletion({ run, setResult:setOverlay.setResult, completedGame:setOverlay.completedGame, currentHandIndex:setOverlay.currentHandIndex, boardContext:true });
  }, [setOverlay, submitSetCompletion]);

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
    retryFinalSubmission,
    hasEmbeddedMatch,
  };
}
