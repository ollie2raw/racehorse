import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import { BoneyardStackIcon, GlobalNav } from '../components';
import { Button } from '../components/primitives';
import { useDeferredAsset } from '../ui/useDeferredAsset';
import '../screens/RacehorseHomeArt.css';

import {
  buildDailyFritzCompletionHash,
  clearDailyFritzClientStorage,
  completeDailyFritz,
  DAILY_FRITZ_INIT_TIMEOUT_MS,
  DAILY_FRITZ_TODAY_CACHE_PREFIX,
  getTodayDailyFritz,
  recordDailyFritzGame,
  startDailyFritz,
  type DailyFritzSetGameNumber,
  type DailyFritzSetGameResult,
  type DailyFritzSetResult,
  type DailyFritzStartResponse,
  type DailyFritzTodayResponse,
} from './api';
import { formatOrdinalPlace } from './format';
import { DAILY_FRITZ_CLASSIC_PRACTICE_HINT, playerLostDailyFritzGame } from './practiceHint';
import { getGameSkunkChipLabel, getSetSkunkBadge, getSkunkOverlayCopy } from './skunk';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';
import {
  DAILY_FRITZ_INIT_SLOW_MS,
  dfInitLog,
  formatCountdownHms,
  formatDateLabel,
  formatMargin,
  friendlyDailyFritzInitError,
  getDailyFritzGameSeed,
  getNextGameNumberFromSetResult,
  getSetTrackerStatus,
  normalizeGameNumber,
  normalizeSetResult,
  normalizeStartResponse,
  readTodayCache,
  resolveDailyFritzCurrentGameNumber,
  secondsUntilNextPacificMidnight,
  setResultForOverlay,
  shouldClearStaleClientState,
  tierDisplayLabel,
  titleCaseTier,
} from './dailyFritzScreenHelpers';
import type {
  DailyFritzGameCardState,
  DailyFritzGameCompletionPayload,
  DailyFritzInitPhase,
  DailyFritzOverlayState,
  DailyFritzScreenProps,
  OverlayGameItem,
  OverlayTrackerItem,
} from './dailyFritzScreenTypes';
import {
  DfIconCalendar,
  DfIconFlame,
  DfIconGlobe,
  DfIconLock,
  DfIconStar,
  DfIconSwords,
  DfIconTrophy,
  DfPvfIconCrown,
  DfPvfIconRobotNav,
} from './DailyFritzIcons';
import { DailyFritzLoadingScreen } from './DailyFritzLoadingScreen';
import './dailyFritz.css';

const LazyBotMatchScreen = lazy(() => import('../bot/BotMatchScreen'));

export default function DailyFritzScreen({
  user,
  profile,
  ghostProfile,
  onGhostProfileChange,
  onProfileRefresh,
  onProfilePatch,
  onOpenAuth,
  onOpenAccount,
  onBack,
  onNavigate,
}: DailyFritzScreenProps) {

  const [today, setToday] = useState<DailyFritzTodayResponse | null>(null);
  const [initPhase, setInitPhase] = useState<DailyFritzInitPhase>('preparing');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initRetryPending, setInitRetryPending] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<DailyFritzStartResponse | null>(null);
  /** Stable React key for embedded BotMatchScreen — set once per open, not re-derived from set_result. */
  const [embeddedMatchKey, setEmbeddedMatchKey] = useState<string | null>(null);
  const [setOverlay, setSetOverlay] = useState<DailyFritzOverlayState | null>(null);
  const [startActionPending, setStartActionPending] = useState(false);
  const [countdownTick, setCountdownTick] = useState(0);
  const loadHeroAsset = useCallback(
    () => import('../assets/dailyFritz/playvsfritzdone.webp'),
    [],
  );
  const heroSrc = useDeferredAsset('daily-fritz-hero', loadHeroAsset);

  const cacheKey = useMemo(
    () => (user?.id ? `${DAILY_FRITZ_TODAY_CACHE_PREFIX}${user.id}` : null),
    [user?.id],
  );
  const todayRef = useRef<DailyFritzTodayResponse | null>(today);
  const activeRunRef = useRef<DailyFritzStartResponse | null>(activeRun);
  const initRequestIdRef = useRef(0);
  const initInFlightRef = useRef(false);
  const initSlowTimerRef = useRef<number | null>(null);
  /** Prevents overlapping record-game API calls from rapid game-over callbacks. */
  const recordGameInFlightRef = useRef(false);
  /** Prevents duplicate complete-set posts for the same attempt. */
  const completedAttemptIdRef = useRef<string | null>(null);

  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  useEffect(() => {
    activeRunRef.current = activeRun;
  }, [activeRun]);

  // Do not tick the lobby countdown while an embedded match is open. A 1 Hz
  // parent re-render recreates inline props and was resetting Daily Fritz
  // hand-transition timers in BotMatchScreen (advanceHand identity churn).
  useEffect(() => {
    if (activeRun) return;
    const id = window.setInterval(() => setCountdownTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [activeRun]);

  const persistTodayCache = useCallback(
    (response: DailyFritzTodayResponse) => {
      if (!cacheKey || typeof window === 'undefined') return;
      try {
        window.sessionStorage.setItem(cacheKey, JSON.stringify(response));
      } catch {
        /* noop */
      }
    },
    [cacheKey],
  );

  const refreshToday = useCallback(async () => {
    if (!user?.id) return;
    try {
      const response = await getTodayDailyFritz();
      const cached = readTodayCache(cacheKey);
      if (cached && shouldClearStaleClientState(cached, response)) {
        clearDailyFritzClientStorage(user.id);
      }
      setToday(response);
      persistTodayCache(response);
      setHubError(null);
    } catch (err) {
      setHubError(friendlyDailyFritzInitError(err));
    }
  }, [cacheKey, persistTodayCache, user?.id]);

  const clearInitSlowTimer = useCallback(() => {
    if (initSlowTimerRef.current != null) {
      window.clearTimeout(initSlowTimerRef.current);
      initSlowTimerRef.current = null;
    }
  }, []);

  const runInit = useCallback(
    async (options?: { clearStale?: boolean; isRetry?: boolean }) => {
      if (!user?.id) return;
      if (initInFlightRef.current) return;

      initInFlightRef.current = true;
      const requestId = ++initRequestIdRef.current;
      const retryAttempt = options?.isRetry ? initRequestIdRef.current : null;

      setInitRetryPending(Boolean(options?.isRetry));
      setLoadError(null);
      setHubError(null);
      setInitPhase((phase) => {
        const next: DailyFritzInitPhase =
          options?.isRetry || phase === 'failed' || phase === 'still-preparing' ? 'retrying' : 'preparing';
        dfInitLog('state', { phase: next });
        return next;
      });

      if (options?.clearStale) {
        clearDailyFritzClientStorage(user.id);
      } else {
        const corruptCache = readTodayCache(cacheKey);
        if (corruptCache === null && cacheKey && typeof window !== 'undefined') {
          try {
            const raw = window.sessionStorage.getItem(cacheKey);
            if (raw) clearDailyFritzClientStorage(user.id);
          } catch {
            /* noop */
          }
        }
      }

      const runDateHint = todayRef.current?.run_date ?? readTodayCache(cacheKey)?.run_date ?? null;
      dfInitLog('start', { date: runDateHint, userId: user.id });
      if (retryAttempt != null) {
        dfInitLog('retry', { attempt: retryAttempt });
      }

      clearInitSlowTimer();
      initSlowTimerRef.current = window.setTimeout(() => {
        if (initRequestIdRef.current !== requestId) return;
        setInitPhase((phase) => {
          if (phase === 'preparing' || phase === 'retrying') {
            dfInitLog('timeout', { ms: DAILY_FRITZ_INIT_SLOW_MS });
            dfInitLog('state', { phase: 'still-preparing' });
            return 'still-preparing';
          }
          return phase;
        });
      }, DAILY_FRITZ_INIT_SLOW_MS);

      try {
        const response = await getTodayDailyFritz({ timeoutMs: DAILY_FRITZ_INIT_TIMEOUT_MS });
        if (initRequestIdRef.current !== requestId) return;

        const cached = readTodayCache(cacheKey);
        if (cached && shouldClearStaleClientState(cached, response)) {
          clearDailyFritzClientStorage(user.id);
        }

        setToday(response);
        persistTodayCache(response);
        setInitPhase('ready');
        dfInitLog('state', { phase: 'ready' });
      } catch {
        if (initRequestIdRef.current !== requestId) return;
        setLoadError('Please try again.');
        setInitPhase('failed');
        dfInitLog('state', { phase: 'failed' });
      } finally {
        if (initRequestIdRef.current === requestId) {
          initInFlightRef.current = false;
          setInitRetryPending(false);
          clearInitSlowTimer();
        }
      }
    },
    [cacheKey, clearInitSlowTimer, persistTodayCache, user?.id],
  );

  useEffect(() => {
    return () => {
      clearInitSlowTimer();
    };
  }, [clearInitSlowTimer]);

  useEffect(() => {
    if (!user) {
      setToday(null);
      setInitPhase('ready');
      setLoadError(null);
      setHubError('Sign in to play Daily Fritz.');
      return;
    }
    setHubError(null);
    void runInit();
  }, [runInit, user?.id]);

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

  const openLeaderboard = useCallback(() => {
    onNavigate?.('leaderboard');
  }, [onNavigate]);

  const openLeaderboardForRunDate = useCallback(() => {
    onNavigate?.('leaderboard');
  }, [onNavigate]);

  const buildCompletedGame = useCallback((
    run: DailyFritzStartResponse,
    game: DailyFritzGameCompletionPayload,
    gameNumber: DailyFritzSetGameNumber,
  ): DailyFritzSetGameResult => {
    const playerScore = Number(game.yourScore);
    const fritzScore = Number(game.botScore);
    // Ground truth is the race-to-N board totals (matches server record-game and botEngine).
    // Do not trust `winner` alone — some edge paths can leave winnerId out of sync with scores.
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
  }, [loadToday]);

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
  }, [handleStartResponse, startActionPending, today]);

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
  }, [handleStartResponse, setOverlay, startActionPending, today]);

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
  }, [buildCompletedGame, submitSetCompletion]);

  const handleDailyFritzGameComplete = useCallback(async (game: DailyFritzGameCompletionPayload) => {
    await submitCompletedGame(game);
  }, [submitCompletedGame]);

  const todaySetResult = useMemo(
    () => normalizeSetResult(today?.set_result ?? today?.result),
    [today],
  );

  const resetCountdownLabel = useMemo(
    () => formatCountdownHms(secondsUntilNextPacificMidnight(new Date())),
    [countdownTick],
  );

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

  const setOverlayConfig = useMemo((): DailyFritzSetOverlayViewModel | null => {
    if (!setOverlay) return null;
    
    const base = {
      kind: 'between' as const,
      eyebrow: 'Daily Fritz',
      headline: '',
      subheadline: '',
      objective: null,
      nextLabel: null,
      primaryLabel: '',
      primaryTone: 'default' as const,
      primaryDisabled: false,
      secondaryLabel: null,
      errorMessage: null,
      gameScoreLabel: '',
      gameScoreValue: '',
      setScoreValue: '',
      marginValue: '',
      marginTone: 'idle' as 'win' | 'loss' | 'idle',
      resultValue: null,
      rankValue: null,
      skunkBadge: null,
      tracker: [] as OverlayTrackerItem[],
      games: [] as OverlayGameItem[],
      onPrimary: () => {},
      onSecondary: () => {},
    };

    if (setOverlay.kind === 'saving') {
      return {
        ...base,
        kind: 'saving' as const,
        headline: 'Saving game',
        subheadline: setOverlay.message,
        primaryLabel: 'Please wait…',
        primaryDisabled: true,
        gameScoreLabel: 'This game',
        gameScoreValue: `${setOverlay.completedGame.playerScore}–${setOverlay.completedGame.fritzScore}`,
        setScoreValue: '—',
        marginValue: '—',
      };
    }

    if (setOverlay.kind === 'record-error') {
      return {
        ...base,
        kind: 'record-error' as const,
        headline: 'Couldn’t save progress',
        subheadline: 'Please try again.',
        primaryLabel: 'Retry',
        primaryTone: 'default' as const,
        onPrimary: (): void => {
          void submitCompletedGame(setOverlay.game);
        },
        secondaryLabel: 'Return to Hub',
        onSecondary: () => {
          setSetOverlay(null);
          closeEmbeddedRun();
          void loadToday();
        },
        gameScoreLabel: 'This game',
        gameScoreValue: `${setOverlay.completedGame.playerScore}–${setOverlay.completedGame.fritzScore}`,
        setScoreValue: '—',
        marginValue: '—',
        errorMessage: setOverlay.message,
      };
    }

    if (setOverlay.kind === 'finalizing') {
      const sr = setResultForOverlay(setOverlay.setResult) ?? setOverlay.setResult;
      return {
        ...base,
        kind: 'finalizing' as const,
        headline: 'Posting set',
        subheadline: setOverlay.message,
        primaryLabel: 'Please wait…',
        primaryDisabled: true,
        gameScoreLabel: 'Set score',
        gameScoreValue: `${sr.playerGamesWon}–${sr.fritzGamesWon}`,
        setScoreValue: `${setOverlay.completedGame.playerScore}–${setOverlay.completedGame.fritzScore}`,
        marginValue: formatMargin(sr.totalPointDiff),
        marginTone:
          sr.totalPointDiff > 0 ? ('win' as const) : sr.totalPointDiff < 0 ? ('loss' as const) : ('idle' as const),
      };
    }

    if (setOverlay.kind === 'final-error') {
      const sr = setResultForOverlay(setOverlay.setResult) ?? setOverlay.setResult;
      return {
        ...base,
        kind: 'final-error' as const,
        headline: 'Couldn’t finish Daily Fritz',
        subheadline: 'Please try again.',
        primaryLabel: 'Back Home',
        onPrimary: () => {
          setSetOverlay(null);
          closeEmbeddedRun();
          void loadToday();
        },
        gameScoreLabel: 'Set score',
        gameScoreValue: `${sr.playerGamesWon}–${sr.fritzGamesWon}`,
        setScoreValue: `${setOverlay.completedGame.playerScore}–${setOverlay.completedGame.fritzScore}`,
        marginValue: formatMargin(sr.totalPointDiff),
        marginTone: 'idle' as const,
      };
    }

    if (setOverlay.kind === 'between') {
      const g = setOverlay.completedGame;
      const sr = setResultForOverlay(setOverlay.setResult) ?? setOverlay.setResult;
      const margin = formatMargin(sr.totalPointDiff);
      const marginTone: 'win' | 'loss' | 'idle' =
        sr.totalPointDiff > 0 ? 'win' : sr.totalPointDiff < 0 ? 'loss' : 'idle';
      const skunkCopy = getSkunkOverlayCopy(sr, g);
      return {
        ...base,
        kind: 'between' as const,
        eyebrow: skunkCopy?.eyebrow ?? base.eyebrow,
        headline: skunkCopy?.headline ??
          (Number(g.playerScore) > Number(g.fritzScore)
            ? `You take Game ${g.gameNumber}`
            : `Fritz takes Game ${g.gameNumber}`),
        subheadline: skunkCopy?.subheadline ?? `The set is ${sr.playerGamesWon}-${sr.fritzGamesWon}`,
        skunkBadge: getSetSkunkBadge(sr),
        primaryTone: skunkCopy?.primaryTone ?? ('success' as const),
        gameScoreLabel: `Game ${g.gameNumber}`,
        gameScoreValue: `${Number.isFinite(g.playerScore) ? g.playerScore : 0}–${Number.isFinite(g.fritzScore) ? g.fritzScore : 0}`,
        setScoreValue: `${sr.playerGamesWon}–${sr.fritzGamesWon}`,
        marginValue: margin,
        marginTone,
        primaryLabel: `Start Game ${setOverlay.nextGameNumber}`,
        onPrimary: (): void => {
          void continueSet();
        },
        onSecondary: () => { setSetOverlay(null); closeEmbeddedRun(); void loadToday(); },
        secondaryLabel: 'Return to Hub',
        practiceHint: playerLostDailyFritzGame(g.playerScore, g.fritzScore)
          ? DAILY_FRITZ_CLASSIC_PRACTICE_HINT
          : null,
        tracker: [1, 2, 3].map(n => ({
          gameNumber: n as DailyFritzSetGameNumber,
          ...getSetTrackerStatus(sr, n as DailyFritzSetGameNumber, setOverlay.nextGameNumber)
        }))
      };
    }

    if (setOverlay.kind === 'final') {
      const sr = setResultForOverlay(setOverlay.setResult) ?? setOverlay.setResult;
      const g = setOverlay.completedGame;
      const margin = formatMargin(sr.totalPointDiff);
      const marginTone: 'win' | 'loss' | 'idle' =
        sr.totalPointDiff > 0 ? 'win' : sr.totalPointDiff < 0 ? 'loss' : 'idle';
      const skunkCopy = getSkunkOverlayCopy(sr, g);
      const games: OverlayGameItem[] = sr.games.map((game) => {
        const playerScore = Number.isFinite(game.playerScore) ? game.playerScore : 0;
        const fritzScore = Number.isFinite(game.fritzScore) ? game.fritzScore : 0;
        const youWon = playerScore > fritzScore;
        return {
          gameNumber: game.gameNumber,
          value: `${playerScore}–${fritzScore}`,
          tone: youWon ? ('win' as const) : ('loss' as const),
          playerScore,
          fritzScore,
          skunk: Boolean(game.skunk),
          skunkLabel: getGameSkunkChipLabel(game),
        };
      });
      const returnToHub = (): void => {
        setSetOverlay(null);
        closeEmbeddedRun();
        void loadToday();
      };
      const openLeaderboard = (): void => {
        setSetOverlay(null);
        closeEmbeddedRun();
        void loadToday();
        const rd = activeRun?.run_date ?? setOverlay.setResult.run_date ?? today?.run_date ?? '';
        if (rd) openLeaderboardForRunDate();
      };
      const setWonPlayer = sr.setWinner === 'player';
      const profileRating = profile?.glicko_rating;
      return {
        ...base,
        kind: 'final' as const,
        headline: skunkCopy?.headline ?? 'Daily Fritz Complete',
        subheadline:
          skunkCopy?.subheadline ??
          (setWonPlayer
            ? `You won the set ${sr.playerGamesWon}–${sr.fritzGamesWon}.`
            : `Fritz won the set ${sr.fritzGamesWon}–${sr.playerGamesWon}.`),
        skunkBadge: getSetSkunkBadge(sr),
        primaryTone: skunkCopy?.primaryTone ?? (setWonPlayer ? ('success' as const) : ('default' as const)),
        gameScoreLabel: 'Final game',
        gameScoreValue: `${Number.isFinite(g.playerScore) ? g.playerScore : 0}–${Number.isFinite(g.fritzScore) ? g.fritzScore : 0}`,
        setScoreValue: `${sr.playerGamesWon}–${sr.fritzGamesWon}`,
        marginValue: margin,
        marginTone,
        resultValue: setWonPlayer ? 'Victory' : 'Defeat',
        rankValue: formatOrdinalPlace(setOverlay.rank),
        shareDate: formatDateLabel(activeRun?.run_date ?? today?.run_date ?? setOverlay.setResult.run_date ?? ''),
        shareTier: titleCaseTier(activeRun?.fritz_tier ?? today?.fritz_tier ?? ''),
        shareRating: typeof profileRating === 'number' && Number.isFinite(profileRating) ? Math.round(profileRating) : undefined,
        shareStreak: today?.streak ?? 0,
        games,
        primaryLabel: setOverlay.canViewLeaderboard ? 'View Leaderboard' : 'Back Home',
        onPrimary: setOverlay.canViewLeaderboard ? openLeaderboard : returnToHub,
        onSecondary: setOverlay.canViewLeaderboard ? returnToHub : (): void => {},
        secondaryLabel: setOverlay.canViewLeaderboard ? 'Back Home' : null,
        practiceHint: !setWonPlayer ? DAILY_FRITZ_CLASSIC_PRACTICE_HINT : null,
      };
    }

    return base;
  }, [setOverlay, continueSet, loadToday, today, activeRun, profile?.glicko_rating, openLeaderboardForRunDate, submitCompletedGame, closeEmbeddedRun]);

  if (activeRun && embeddedMatchKey) {
    return (
      <Suspense fallback={<DailyFritzLoadingScreen phase="preparing" loadError={null} onBack={onBack} onRetry={() => {}} retryPending={false} />}>
        <LazyBotMatchScreen
          key={embeddedMatchKey}
          matchInstanceKey={embeddedMatchKey}
          onBack={() => { closeEmbeddedRun(); void loadToday(); }}
          mode="daily-fritz"
          userId={user?.id ?? null}
          username={profile?.username ?? null}
          dealSize={activeRun.deal_size}
          fritzTier={activeRun.fritz_tier}
          winningScore={activeRun.winning_score}
          currentGlickoRating={profile?.glicko_rating ?? null}
          ghostProfile={ghostProfile}
          onGhostProfileChange={onGhostProfileChange}
          onProfileRefresh={onProfileRefresh}
          onProfilePatch={onProfilePatch}
          dailyFritzPackage={dailyFritzPackageForMatch}
          dailyFritzSetOverlay={setOverlayConfig}
          onDailyFritzGameComplete={(result) => { void handleDailyFritzGameComplete(result); }}
          onDailyFritzComplete={() => { void finishEmbeddedRun(); }}
        />
      </Suspense>
    );
  }

  const showInitScreen = Boolean(user?.id) && initPhase !== 'ready';

  if (showInitScreen) {
    return (
      <DailyFritzLoadingScreen
        phase={initPhase as Exclude<DailyFritzInitPhase, 'ready'>}
        loadError={loadError}
        onBack={onBack}
        onRetry={() => {
          void runInit({ clearStale: true, isRetry: true });
        }}
        retryPending={initRetryPending}
      />
    );
  }

  const dateLabel = today ? formatDateLabel(today.run_date) : '—';
  const tierLabel = today ? tierDisplayLabel(today.fritz_tier) : '—';
  const formatLabel = today ? 'Best of 3' : '—';
  const streakLabel = today ? `${today.streak} day${today.streak === 1 ? '' : 's'}` : '0 days';
  const winTarget = today?.winning_score ?? 60;

  const isComplete = today?.attempt_status === 'completed';
  const isStarted = today?.attempt_status === 'started';

  const primaryCtaLabel = isComplete
    ? 'Set complete'
    : isStarted
      ? "Resume Today's Set"
      : "Play Today's Set";

  const matchClinched =
    todaySetResult != null &&
    (todaySetResult.setWinner != null ||
      todaySetResult.playerGamesWon >= 2 ||
      todaySetResult.fritzGamesWon >= 2);
  const skunkGameNumber =
    todaySetResult?.skunkGameNumber ?? todaySetResult?.games.find((game) => game.skunk)?.gameNumber ?? null;

  const games = [1, 2, 3].map((n) => {
    const res = todaySetResult?.games.find((g) => g.gameNumber === n);
    const isNext = todaySetResult ? todaySetResult.games.length + 1 === n && !todaySetResult.setWinner : n === 1;
    const skippedAfterSkunk = !res && skunkGameNumber != null && n > skunkGameNumber;
    const gameNotRequired = !res && (skippedAfterSkunk || (n === 3 && matchClinched));
    const gameState: DailyFritzGameCardState = res
      ? res.playerWon
        ? 'won'
        : 'lost'
      : gameNotRequired
        ? 'not-needed'
        : isNext
        ? 'active'
        : 'locked';
    const isDone = gameState === 'won' || gameState === 'lost';
    const isLocked = gameState === 'locked';
    const isNotNeeded = gameState === 'not-needed';
    const isActive = gameState === 'active';

    let statusSub: string;
    let unlockHint: string | null = null;
    let showPlay = false;
    if (res) {
      statusSub = res.playerWon ? 'Won' : 'Lost';
    } else if (isActive) {
      statusSub = n === 3 ? 'Decider' : 'Your move';
      showPlay = !isComplete && !startActionPending;
      unlockHint = isStarted ? 'Resume now' : `First to ${winTarget}`;
    } else if (isNotNeeded) {
      statusSub = 'Not needed';
      unlockHint = skippedAfterSkunk && skunkGameNumber != null ? `Skunk ended set in G${skunkGameNumber}` : 'Game 3 not required';
    } else {
      statusSub = n === 3 ? 'Decider' : 'Locked';
      unlockHint =
        n === 2 ? 'Defeat Fritz in Game 1 to unlock' : n === 3 ? 'Decider if needed' : null;
    }

    const scoreLine = res ? `${res.playerScore}–${res.fritzScore}` : null;

    return {
      n,
      statusSub,
      unlockHint,
      showPlay,
      scoreLine,
      gameState,
      isLocked,
      isDone,
      isActive,
      isNotNeeded,
    };
  });

  const handleSetAction = () => {
    if (isStarted) {
      void continueSet();
      return;
    }
    void beginRun();
  };

  const fritzTierShort = today ? titleCaseTier(today.fritz_tier) : 'Elite';
  const leaderboardRankLabel =
    isComplete && today?.rank != null ? formatOrdinalPlace(today.rank) : null;
  const leaderboardSupportLine = leaderboardRankLabel
    ? `${leaderboardRankLabel} today`
    : isComplete
      ? 'Leaderboard updates after your set'
      : 'Play today to appear on the leaderboard';
  const setStatusLabel = isComplete ? 'Complete' : isStarted ? 'In Progress' : 'Ready';
  const setStakesLabel = isComplete ? 'Return tomorrow for a new set' : 'Leaderboard eligible';
  const opponentBadgeLabel = isComplete ? 'Set Complete' : isStarted ? 'Resume Available' : 'Bot Opponent';

  return (
    <div className="df-page">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>

      <GlobalNav
        currentMode="dailyFritz"
        onNavigate={onNavigate}
        onOpenAuth={onOpenAuth}
        onOpenAccount={onOpenAccount}
        activeColor="var(--tier-elite)"
      />

      <div className="df-shell df-shell--daily-fritz">
        <div className="df-layout df-pvf-layout">
          <div className="df-pvf-left-col">
            <button type="button" className="df-back-btn df-pvf-back-btn rh-back-button" onClick={onBack}>
              <span aria-hidden>←</span> Back to Single Player
            </button>

            <div className="df-pvf-header">
              <div className="df-pvf-label">DAILY FRITZ</div>
              <h1 className="df-pvf-title">Daily Fritz</h1>
            </div>

            <article className="df-pvf-opponent-card" aria-label="Daily Fritz overview">
              {heroSrc ? (
                <img
                  src={heroSrc}
                  className="df-pvf-card-bg-img"
                  alt="Fritz waiting at the domino table"
                  decoding="async"
                />
              ) : null}
              <div className="df-pvf-card-overlay" aria-hidden />

              <div className="df-pvf-card-content">
                <div className="df-pvf-card-header">
                  <div className="df-pvf-card-eyebrow">TODAY&apos;S OPPONENT</div>
                  <h2 className="df-pvf-card-name">Fritz</h2>
                  <p className="df-pvf-card-description">Same set for everyone.</p>
                </div>

                <div className="df-pvf-card-badges">
                  <div className="df-pvf-card-badge">
                    <div className="df-pvf-card-badge-header">
                      <DfIconFlame color="var(--tier-elite)" />
                      <span className="df-pvf-card-badge-title">Daily Streak</span>
                    </div>
                    <div className="df-pvf-card-badge-desc">{streakLabel}</div>
                  </div>

                  <div className="df-pvf-card-badge">
                    <div className="df-pvf-card-badge-header">
                      <DfIconGlobe color="var(--tier-elite)" />
                      <span className="df-pvf-card-badge-title">Same Deal</span>
                    </div>
                    <div className="df-pvf-card-badge-desc">Every player gets the same hand.</div>
                  </div>

                  <div className="df-pvf-card-badge">
                    <div className="df-pvf-card-badge-header">
                      <DfPvfIconRobotNav color="var(--tier-elite)" />
                      <span className="df-pvf-card-badge-title">{opponentBadgeLabel}</span>
                    </div>
                    <div className="df-pvf-card-badge-desc">{isComplete ? leaderboardSupportLine : 'Fair, consistent, leaderboard eligible.'}</div>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <section className="pvf-control-panel df-pvf-control-panel" aria-label="Today's Set">
            <div className="df-pvf-section">
              <div className="fritz-section-label">1. TODAY&apos;S SET</div>
              <div className="df-pvf-overview-grid" role="list" aria-label="Set details">
                <div className="df-pvf-overview-card" role="listitem">
                  <div className="df-pvf-overview-icon" aria-hidden>
                    <DfIconCalendar />
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value">{dateLabel}</div>
                    <div className="df-pvf-overview-key">Date</div>
                  </div>
                </div>
                <div className="df-pvf-overview-card df-pvf-overview-card--active" role="listitem">
                  <div className="df-pvf-overview-icon" aria-hidden>
                    <DfPvfIconCrown color="var(--tier-elite)" />
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value">{tierLabel}</div>
                    <div className="df-pvf-overview-key">Tier</div>
                  </div>
                </div>
                <div className="df-pvf-overview-card" role="listitem">
                  <div className="df-pvf-overview-icon" aria-hidden>
                    <DfIconSwords />
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value">{formatLabel}</div>
                    <div className="df-pvf-overview-key">Format</div>
                  </div>
                </div>
                <div className="df-pvf-overview-card" role="listitem">
                  <div className="df-pvf-overview-icon" aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value">{resetCountdownLabel}</div>
                    <div className="df-pvf-overview-key">Resets In</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="df-pvf-section">
              <div className="fritz-section-label">2. BEST OF 3</div>
              <div className="df-pvf-progress-grid" role="list" aria-label="Set progress">
                {games.map((game) => {
                  return (
                    <article
                      key={game.n}
                      role="listitem"
                      className={[
                        'df-pvf-progress-card',
                        'df-game-card',
                        `df-game-card--${game.gameState}`,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className="df-pvf-progress-index" aria-hidden>{game.n}</div>
                      <div className="df-pvf-progress-body">
                        <span className="df-pvf-progress-eyebrow">{`GAME ${game.n}`}</span>
                        <h3 className="df-pvf-progress-title">{`Game ${game.n}`}</h3>
                        <p className="df-pvf-progress-status">{game.statusSub}</p>
                        <p className="df-pvf-progress-hint">
                          {game.isDone ? (game.scoreLine ?? 'Complete') : (game.unlockHint ?? `First to ${winTarget}`)}
                        </p>
                        <div className="df-pvf-progress-footer">
                          <span className="df-pvf-progress-meta">
                            {game.isLocked
                              ? 'Locked'
                              : game.isNotNeeded
                                ? 'Not needed'
                                : game.isDone
                                  ? 'Complete'
                                  : `First to ${winTarget}`}
                          </span>
                          {game.isLocked ? (
                            <span className="df-pvf-progress-lock" aria-hidden>
                              <DfIconLock />
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="df-pvf-section">
              <div className="fritz-section-label">3. SET SUMMARY</div>
              <div className="df-pvf-summary-strip">
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <DfPvfIconRobotNav color="var(--tier-elite)" />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">Fritz {fritzTierShort}</div>
                    <div className="df-pvf-summary-key">Opponent</div>
                  </div>
                </div>
                <div className="df-pvf-summary-divider" aria-hidden />
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <BoneyardStackIcon size={22} />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">First to {winTarget}</div>
                    <div className="df-pvf-summary-key">Scoring</div>
                  </div>
                </div>
                <div className="df-pvf-summary-divider" aria-hidden />
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <DfIconTrophy />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">{setStatusLabel}</div>
                    <div className="df-pvf-summary-key">Status</div>
                  </div>
                </div>
                <div className="df-pvf-summary-divider" aria-hidden />
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <DfIconStar />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">{setStakesLabel}</div>
                    <div className="df-pvf-summary-key">Stakes</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="df-pvf-actions">
              {hubError ? (
                <p className="df-hub-error" role="alert">
                  {hubError}
                </p>
              ) : null}
              <Button
                variant="tier-elite"
                size="lg"
                type="button"
                className={[
                  'df-start-match-btn',
                  'df-pvf-start-btn',
                  !isComplete && !startActionPending && !isStarted ? 'df-start-match-btn--ready-pulse' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => void handleSetAction()}
                disabled={startActionPending || isComplete}
              >
                {primaryCtaLabel}
                {!isComplete ? <span className="df-start-match-chevron" aria-hidden> ›</span> : null}
              </Button>
              <div className="df-pvf-footer">
                <Button type="button" variant="ghost" className="df-pvf-leaderboard-link" onClick={() => void openLeaderboard()}>
                  View Leaderboard →
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
