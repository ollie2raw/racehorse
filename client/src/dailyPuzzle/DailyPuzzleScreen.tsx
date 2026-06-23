import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Board, BoneyardCountPill, DominoTile, RotateOverlay } from '../components';
import { MatchLiveLayout } from '../match/board';
import '../match/match-live.css';
import {
  applyPlayMove,
  getLegalMoves,
  type BotMatchState,
} from '../bot/botEngine';
import type { Move, Tile } from '../types';
import { tileEquals } from '../game/tileUtils';
import {
  fetchDailyPuzzleLeaderboard,
  getDailyPuzzleByDateSeed,
  getDailyPuzzleForDate,
  getLocalDateKey,
  getTodayDailyPuzzleLadder,
  normalizeDateInputToLocalKey,
  type DailyPuzzleLeaderboardEntry,
  upsertDailyPuzzleCompletion,
  upsertDailyPuzzleBestScore,
} from './api';
import type { CuratedDailyPuzzle, DailyPuzzleTodayResponse, PuzzleValidationResult } from './types';
import { getDisplayStreak, recordSolvedStreak } from './streakStorage';
import {
  formatPuzzleDateLabel,
  formatPuzzleElapsed,
  formatPuzzleLeaderboardDate,
  getDisplayName,
  readCachedPuzzle,
  readProgress,
  tileKey,
  writeCachedPuzzle,
  writeProgress,
} from './dailyPuzzleScreenHelpers';
import type {
  DailyPuzzleScreenProps,
  PendingWorkerJob,
  PlayStatus,
  ValidatorWorkerRequest,
  ValidatorWorkerResponse,
} from './dailyPuzzleScreenTypes';
import { DailyPuzzleLoadingScreen } from './DailyPuzzleLoadingScreen';
import { createPuzzleMatchState } from './validator';
import LayoutScreen from '../ui/LayoutScreen';
import LeaderboardPageShell, { type LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';
import {
  ClaudePrimaryAction,
  ClaudeSecondaryAction,
  ClaudeSectionLabel,
  ClaudeStatLine,
} from '../ui/claudeMode';
import './dailyPuzzle.css';

const LazyDailyPuzzleLadderScreen = lazy(() => import('./DailyPuzzleLadderScreen'));

export default function DailyPuzzleScreen({
  user,
  profile,
  onBack,
  onNavigate,
  onOpenAuth,
  onOpenAccount,
}: DailyPuzzleScreenProps) {
  const stableDailyTitle = (
    <span style={{ color: 'rgba(243, 250, 247, 0.97)', opacity: 1 }}>Today&apos;s Challenge</span>
  );
  const localDateKey = useMemo(() => getLocalDateKey(), []);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [selectedDateSeed, setSelectedDateSeed] = useState(localDateKey);
  const [archiveDateInput, setArchiveDateInput] = useState(localDateKey);
  const [puzzle, setPuzzle] = useState<CuratedDailyPuzzle | null>(null);
  const [ladderToday, setLadderToday] = useState<DailyPuzzleTodayResponse | null>(null);
  const [ladderFetchNonce, setLadderFetchNonce] = useState(0);
  const [ladderStatusError, setLadderStatusError] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<
    'checking' | 'legacy' | 'ladder' | 'ladderPending' | 'ladderCheckError'
  >(selectedDateSeed === localDateKey ? 'checking' : 'legacy');
  const [validation, setValidation] = useState<PuzzleValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<PlayStatus>('IN_PROGRESS');
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [movesUsed, setMovesUsed] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const runningScoreRef = useRef(0);
  const [showLobby, setShowLobby] = useState(true);
  const [dailyLeaderboardOpen, setDailyLeaderboardOpen] = useState(false);
  const [archivePickerOpen, setArchivePickerOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<DailyPuzzleLeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [handTileSize, setHandTileSize] = useState(56);
  const [handCompactStacked, setHandCompactStacked] = useState(false);
  const [streakDays, setStreakDays] = useState(0);
  const [bestPossibleScore, setBestPossibleScore] = useState(0);
  const [runtimeState, setRuntimeState] = useState<BotMatchState | null>(null);
  const [runtimeInitError, setRuntimeInitError] = useState<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const submittedRef = useRef(false);
  const solvedConfettiFiredRef = useRef(false);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const loadIdRef = useRef(0);
  const loadInFlightKeyRef = useRef<string | null>(null);
  const currentPuzzleDateRef = useRef<string | null>(null);
  const leaderboardLoadIdRef = useRef(0);
  const leaderboardInFlightDateRef = useRef<string | null>(null);
  const devLoggedTitleMountRef = useRef(false);
  const devLoggedTitleAfterComputeRef = useRef(false);
  const validatorWorkerRef = useRef<Worker | null>(null);
  const validatorRequestIdRef = useRef(0);
  const validatorPendingRef = useRef<Map<number, PendingWorkerJob<unknown>>>(new Map());
  const lastPlayedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStartDateRef = useRef<string | null>(null);
  const isArchiveMode = selectedDateSeed !== localDateKey;
  const archiveInputHasCompleteDate = /^\d{4}-\d{2}-\d{2}$/.test(archiveDateInput);
  const archiveDateDirty = archiveDateInput !== selectedDateSeed;
  const archiveTargetDate = archiveInputHasCompleteDate
    ? normalizeDateInputToLocalKey(archiveDateInput)
    : selectedDateSeed;
  const archiveTargetIsToday = archiveTargetDate === localDateKey;
  const displayDateSeed = puzzle?.puzzleDate ?? (showLobby ? archiveTargetDate : selectedDateSeed);
  const formattedDisplayDate = formatPuzzleDateLabel(displayDateSeed);
  const selectedPuzzleReady = puzzle?.puzzleDate === selectedDateSeed;

  useEffect(() => {
    if (selectedDateSeed !== localDateKey) {
      setEntryMode('legacy');
      setLadderToday(null);
      return;
    }
    let cancelled = false;
    setEntryMode('checking');
    void (async () => {
      try {
        const todayResponse = await getTodayDailyPuzzleLadder();
        if (cancelled) return;
        setLadderStatusError(null);
        if (!todayResponse.legacySinglePuzzleDay && todayResponse.slots.length === 3) {
          setLadderToday(todayResponse);
          setEntryMode('ladder');
          return;
        }
        setLadderToday(todayResponse);
        setEntryMode('ladderPending');
      } catch (err) {
        if (!cancelled) {
          setLadderToday(null);
          setLadderStatusError(err instanceof Error ? err.message : 'Unable to load today’s Daily Puzzle ladder.');
          setEntryMode('ladderCheckError');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localDateKey, selectedDateSeed, ladderFetchNonce]);

  const flashLastPlayed = useCallback((tile: Tile | null) => {
    if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    setLastPlayedTile(tile);
    if (tile) {
      lastPlayedTileTimerRef.current = setTimeout(() => {
        setLastPlayedTile(null);
        lastPlayedTileTimerRef.current = null;
      }, 2400);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    };
  }, []);
  const handleBackHome = useCallback(() => {
    setDailyLeaderboardOpen(false);
    setArchivePickerOpen(false);
    setShowLobby(true);
    onBack();
  }, [onBack]);

  const applyArchiveDate = useCallback(() => {
    if (!archiveInputHasCompleteDate) return;
    const nextDate = normalizeDateInputToLocalKey(archiveDateInput);
    setArchiveDateInput(nextDate);
    setSelectedDateSeed(nextDate);
    setLoadError(null);
    setDailyLeaderboardOpen(false);
  }, [archiveDateInput, archiveInputHasCompleteDate]);

  const getValidatorWorker = useCallback((): Worker => {
    if (!validatorWorkerRef.current) {
      const worker = new Worker(new URL('./validator.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ValidatorWorkerResponse>) => {
        const data = event.data;
        const pending = validatorPendingRef.current.get(data.requestId);
        if (!pending) return;
        validatorPendingRef.current.delete(data.requestId);
        if (data.type === 'error') {
          pending.reject(new Error(data.error));
          return;
        }
        if (data.puzzleDate !== pending.puzzleDate) {
          pending.reject(new Error('Stale validator response.'));
          return;
        }
        if (data.type !== pending.expected) {
          pending.reject(new Error('Unexpected validator response type.'));
          return;
        }
        if (data.type === 'validateResult') {
          pending.resolve(data.result);
          return;
        }
        pending.resolve(data.score);
      };
      worker.onerror = (err) => {
        for (const [, pending] of validatorPendingRef.current) {
          pending.reject(err.error ?? new Error('Validator worker failed.'));
        }
        validatorPendingRef.current.clear();
      };
      validatorWorkerRef.current = worker;
    }
    return validatorWorkerRef.current;
  }, []);

  const requestValidationFromWorker = useCallback(
    (activePuzzle: CuratedDailyPuzzle) =>
      new Promise<PuzzleValidationResult>((resolve, reject) => {
        const worker = getValidatorWorker();
        const requestId = ++validatorRequestIdRef.current;
        validatorPendingRef.current.set(requestId, {
          expected: 'validateResult',
          puzzleDate: activePuzzle.puzzleDate,
          resolve: (value) => resolve(value as PuzzleValidationResult),
          reject,
        });
        const payload: ValidatorWorkerRequest = {
          requestId,
          type: 'validate',
          puzzleDate: activePuzzle.puzzleDate,
          puzzle: activePuzzle,
        };
        worker.postMessage(payload);
      }),
    [getValidatorWorker],
  );

  const requestBestScoreFromWorker = useCallback(
    (activePuzzle: CuratedDailyPuzzle) =>
      new Promise<number>((resolve, reject) => {
        const worker = getValidatorWorker();
        const requestId = ++validatorRequestIdRef.current;
        validatorPendingRef.current.set(requestId, {
          expected: 'bestScoreResult',
          puzzleDate: activePuzzle.puzzleDate,
          resolve: (value) => resolve(value as number),
          reject,
        });
        const payload: ValidatorWorkerRequest = {
          requestId,
          type: 'bestScore',
          puzzleDate: activePuzzle.puzzleDate,
          puzzle: activePuzzle,
        };
        worker.postMessage(payload);
      }),
    [getValidatorWorker],
  );

  useEffect(() => {
    currentPuzzleDateRef.current = puzzle?.puzzleDate ?? null;
  }, [puzzle]);

  useEffect(() => {
    if (!import.meta.env.DEV || !showLobby || devLoggedTitleMountRef.current) return;
    devLoggedTitleMountRef.current = true;
    window.requestAnimationFrame(() => {
      const titleEl = document.querySelector(
        '.daily-entry-screen .layout-screen-title',
      ) as HTMLElement | null;
      if (!titleEl) return;
      const style = window.getComputedStyle(titleEl);
      console.debug('[DailyPuzzle] title style on mount', {
        color: style.color,
        opacity: style.opacity,
        filter: style.filter,
      });
    });
  }, [showLobby]);

  useEffect(() => {
    if (!import.meta.env.DEV || !showLobby || devLoggedTitleAfterComputeRef.current) return;
    if (!validation && bestPossibleScore <= 0) return;
    devLoggedTitleAfterComputeRef.current = true;
    const titleEl = document.querySelector(
      '.daily-entry-screen .layout-screen-title',
    ) as HTMLElement | null;
    if (!titleEl) return;
    const style = window.getComputedStyle(titleEl);
    console.debug('[DailyPuzzle] title style after compute', {
      color: style.color,
      opacity: style.opacity,
      filter: style.filter,
      bestPossibleScore,
      hasValidation: Boolean(validation),
    });
  }, [showLobby, validation, bestPossibleScore]);

  useEffect(() => {
    return () => {
      for (const [, pending] of validatorPendingRef.current) {
        pending.reject(new Error('Validator worker terminated.'));
      }
      validatorPendingRef.current.clear();
      validatorWorkerRef.current?.terminate();
      validatorWorkerRef.current = null;
    };
  }, []);

  const refreshLeaderboard = useCallback(async (puzzleDate: string) => {
    if (leaderboardInFlightDateRef.current === puzzleDate) {
      if (import.meta.env.DEV) {
        console.debug('[DailyPuzzle] skip duplicate leaderboard fetch', { puzzleDate });
      }
      return;
    }

    const requestId = ++leaderboardLoadIdRef.current;
    leaderboardInFlightDateRef.current = puzzleDate;
    setLeaderboardLoading(true);
    try {
      const rows = await fetchDailyPuzzleLeaderboard(puzzleDate, 20);
      if (requestId !== leaderboardLoadIdRef.current) return;
      setLeaderboard(rows);
    } catch {
      if (requestId !== leaderboardLoadIdRef.current) return;
      setLeaderboard([]);
    } finally {
      if (requestId === leaderboardLoadIdRef.current) {
        setLeaderboardLoading(false);
      }
      if (leaderboardInFlightDateRef.current === puzzleDate) {
        leaderboardInFlightDateRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (entryMode === 'checking') return;
    if (entryMode === 'ladderPending' || entryMode === 'ladderCheckError') return;
    if (entryMode === 'ladder' && selectedDateSeed === localDateKey) {
      setLoading(false);
      return;
    }
    const loadKey = selectedDateSeed;
    if (loadInFlightKeyRef.current === loadKey) {
      if (import.meta.env.DEV) {
        console.debug('[DailyPuzzle] skip duplicate load', { loadKey });
      }
      return;
    }
    loadInFlightKeyRef.current = loadKey;
    const loadId = ++loadIdRef.current;
    let cancelled = false;

    const load = async () => {
      if (import.meta.env.DEV) {
        console.debug('[DailyPuzzle] load start', { loadId, loadKey, timezone });
      }
      setLoading(true);
      setLoadError(null);
      setShowLobby(true);
      const cached = readCachedPuzzle(loadKey, 'one_turn_high_score');
      let hasCachedFallback = false;
      if (cached) {
        if (cancelled || loadId !== loadIdRef.current) return;
        hasCachedFallback = true;
        setPuzzle(cached);
        setRuntimeState(null);
        setRuntimeInitError(null);
        setValidation(null);
        setBestPossibleScore(0);
        setStatus('IN_PROGRESS');
        setSelectedTile(null);
        setMovesUsed(0);
        setFinalScore(null);
        runningScoreRef.current = 0;
        setStreakDays(getDisplayStreak(cached.puzzleDate));
        setLoading(false); // cached fast path keeps UI interactive immediately
        if (!isArchiveMode) {
          void refreshLeaderboard(cached.puzzleDate);
        } else {
          setLeaderboard([]);
        }
      }
      try {
        const nextPuzzle =
          loadKey === localDateKey
            ? await getDailyPuzzleForDate(new Date(), 'one_turn_high_score')
            : await getDailyPuzzleByDateSeed(loadKey, 'one_turn_high_score');
        if (cancelled || loadId !== loadIdRef.current) return;
        if (!nextPuzzle) {
          setPuzzle(null);
          setValidation(null);
          return;
        }

        const check = null;
        setPuzzle(nextPuzzle);
        setRuntimeState(null);
        setRuntimeInitError(null);
        writeCachedPuzzle(nextPuzzle);
        setValidation(check);
        setBestPossibleScore(0);
        setStatus('IN_PROGRESS');
        setSelectedTile(null);
        setMovesUsed(0);
        setFinalScore(null);
        runningScoreRef.current = 0;

        const progress = readProgress(nextPuzzle.puzzleDate, nextPuzzle.puzzleType);
        if (loadKey === localDateKey) {
          const nextAttempts = progress.attempts + 1;
          writeProgress(nextPuzzle.puzzleDate, nextPuzzle.puzzleType, {
            ...progress,
            attempts: nextAttempts,
          });
          void refreshLeaderboard(nextPuzzle.puzzleDate);
          setStreakDays(getDisplayStreak(nextPuzzle.puzzleDate));
        } else {
          setLeaderboard([]);
          setStreakDays(0);
        }
      } catch (err) {
        if (cancelled || loadId !== loadIdRef.current) return;
        if (import.meta.env.DEV) {
          console.debug('[DailyPuzzle] load error', { loadId, loadKey, err });
        }
        if (!hasCachedFallback) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load daily puzzle.');
        }
      } finally {
        // Always clear loading for the active request so overlay/click lock cannot stick.
        if (!cancelled && loadId === loadIdRef.current) {
          setLoading(false);
          if (import.meta.env.DEV) {
            console.debug('[DailyPuzzle] load end', { loadId, loadKey });
          }
        }
        if (loadInFlightKeyRef.current === loadKey) {
          loadInFlightKeyRef.current = null;
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (loadInFlightKeyRef.current === loadKey) {
        loadInFlightKeyRef.current = null;
      }
    };
  }, [entryMode, selectedDateSeed, localDateKey, timezone, refreshLeaderboard, isArchiveMode]);

  useEffect(() => {
    if (!puzzle) return;
    let cancelled = false;
    const activePuzzleDate = puzzle.puzzleDate;
    setBestPossibleScore(0);
    if (puzzle.puzzleType !== 'reach_target') {
      setValidation(null);
    }

    const computeAsync = async () => {
      if (puzzle.puzzleType === 'reach_target') {
        try {
          const check = await requestValidationFromWorker(puzzle);
          if (!cancelled && currentPuzzleDateRef.current === activePuzzleDate) {
            setValidation(check);
          }
        } catch (err) {
          if (!cancelled) {
            setValidation({
              solvable: false,
              bestScore: 0,
              hasScoringMove: false,
              exploredStates: 0,
              reason: err instanceof Error ? err.message : 'Validation failed.',
            });
          }
        }
      }

      try {
        const computed = await requestBestScoreFromWorker(puzzle);
        if (!cancelled && currentPuzzleDateRef.current === activePuzzleDate) {
          setBestPossibleScore(computed);
        }
      } catch {
        if (!cancelled) setBestPossibleScore(0);
      }
    };

    void computeAsync();
    return () => {
      cancelled = true;
    };
  }, [puzzle, requestBestScoreFromWorker, requestValidationFromWorker]);

  const startDailyPuzzle = useCallback(async () => {
    if (!puzzle) return;
    setRuntimeInitError(null);
    try {
      const initialState = createPuzzleMatchState(puzzle);
      setRuntimeState(initialState);
      startTimeRef.current = Date.now();
      setDailyLeaderboardOpen(false);
      setShowLobby(false);
    } catch (err) {
      setRuntimeInitError(
        err instanceof Error ? err.message : 'Invalid puzzle board configuration.',
      );
    }
  }, [puzzle]);

  useEffect(() => {
    const pendingStartDate = pendingStartDateRef.current;
    if (!pendingStartDate) return;
    if (loading || showLobby === false) return;

    if (loadError || !puzzle) {
      pendingStartDateRef.current = null;
      return;
    }

    if (puzzle.puzzleDate !== pendingStartDate) return;
    pendingStartDateRef.current = null;
    void startDailyPuzzle();
  }, [loading, loadError, puzzle, showLobby, startDailyPuzzle]);

  const legalMoves = useMemo(() => {
    if (!runtimeState || status !== 'IN_PROGRESS') return [] as Move[];
    return getLegalMoves(runtimeState, 'you').filter((move) => move.type === 'play');
  }, [runtimeState, status]);
  const playableTileKeys = useMemo(() => {
    return new Set(
      legalMoves
        .map((move) => (move.tile ? tileKey(move.tile) : null))
        .filter((value): value is string => value !== null),
    );
  }, [legalMoves]);

  useEffect(() => {
    if (!runtimeState) return;
    const updateHandTileSize = () => {
      const tileCount = Math.max(1, runtimeState.players.you.hand.length);
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileWidth = window.innerWidth <= 900;
      
      const forceTwoRows = !isLandscape && isMobileWidth && tileCount > 7;
      
      const maxTileSize = 56;
      let tileWidth = maxTileSize;
      
      const containerWidth = window.innerWidth - 40;
      const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
      
      tileWidth = Math.min(maxTileSize, Math.floor((containerWidth - 20) / effectiveLen));

      setHandTileSize(tileWidth);
      setHandCompactStacked(forceTwoRows);
    };

    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [runtimeState?.players.you.hand.length]);

  const completedScoreForSummary = useMemo(() => {
    const isOneTurnHighScore = puzzle?.puzzleType === 'one_turn_high_score';
    const currentScore = runtimeState?.players.you.score ?? 0;
    return isOneTurnHighScore ? (finalScore ?? currentScore) : currentScore;
  }, [puzzle?.puzzleType, finalScore, runtimeState?.players.you.score]);

  const completionSummary = useMemo(() => {
    const completionRatio = bestPossibleScore > 0 ? completedScoreForSummary / bestPossibleScore : 1;
    const completionMessage =
      completedScoreForSummary >= bestPossibleScore
        ? { text: '🏆 Perfect!', color: '#d8b56f' }
        : completionRatio >= 0.8
          ? { text: '⭐ Great solve!', color: 'rgba(125, 241, 197, 0.95)' }
          : { text: 'Keep practicing!', color: 'rgba(232,245,240,0.85)' };
    return {
      completionMessage,
      modalLeaderboard: leaderboard.slice(0, 20),
    };
  }, [bestPossibleScore, completedScoreForSummary, leaderboard]);

  const resetAttempt = () => {
    if (!puzzle) return;
    const start = createPuzzleMatchState(puzzle);
    setRuntimeState(start);
    setStatus('IN_PROGRESS');
    setSelectedTile(null);
    setMovesUsed(0);
    setFinalScore(null);
    runningScoreRef.current = 0;
    submittedRef.current = false;
    solvedConfettiFiredRef.current = false;
    startTimeRef.current = Date.now();

    if (!isArchiveMode) {
      const progress = readProgress(puzzle.puzzleDate, puzzle.puzzleType);
      const nextAttempts = progress.attempts + 1;
      writeProgress(puzzle.puzzleDate, puzzle.puzzleType, { ...progress, attempts: nextAttempts });
    }
  };

  const finalizeResult = (
    nextStatus: PlayStatus,
    solvedMoves: number | null,
    finalScoreValue: number,
  ) => {
    if (!puzzle) return;
    const progress = readProgress(puzzle.puzzleDate, puzzle.puzzleType);
    let resolvedStreak = streakDays;

    if (!isArchiveMode && nextStatus === 'SOLVED' && solvedMoves !== null) {
      const nextStreak = recordSolvedStreak(puzzle.puzzleDate);
      setStreakDays(nextStreak);
      resolvedStreak = nextStreak;
      const nextBest =
        progress.bestMoves === null ? solvedMoves : Math.min(progress.bestMoves, solvedMoves);
      writeProgress(puzzle.puzzleDate, puzzle.puzzleType, {
        ...progress,
        bestMoves: nextBest,
        lastResult: nextStatus,
      });
    } else if (!isArchiveMode) {
      writeProgress(puzzle.puzzleDate, puzzle.puzzleType, { ...progress, lastResult: nextStatus });
    }

    if (!isArchiveMode && user && !submittedRef.current) {
      submittedRef.current = true;
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));
      const bestScorePromise = upsertDailyPuzzleBestScore({
        puzzleDate: puzzle.puzzleDate,
        userId: user.id,
        username: profile?.username ?? user.email?.split('@')[0] ?? 'Player',
        score: finalScoreValue,
        movesUsed: solvedMoves ?? movesUsed,
        seconds: elapsedSeconds,
      }).catch((err) => {
         
        console.warn('[DailyPuzzle] best score upsert failed', err);
      });

      const completionPromise =
        nextStatus === 'SOLVED'
          ? (async () => {
              const resolvedBestPossibleScore =
                bestPossibleScore > 0
                  ? bestPossibleScore
                  : await requestBestScoreFromWorker(puzzle);
              await upsertDailyPuzzleCompletion({
                puzzleDate: puzzle.puzzleDate,
                userId: user.id,
                username: profile?.username ?? user.email?.split('@')[0] ?? 'Player',
                score: finalScoreValue,
                bestPossibleScore: resolvedBestPossibleScore,
                perfect: finalScoreValue >= resolvedBestPossibleScore,
                currentStreak: resolvedStreak,
              });
            })().catch((err) => {
               
              console.warn('[DailyPuzzle] completion upsert failed', err);
            })
          : Promise.resolve();

      void Promise.allSettled([bestScorePromise, completionPromise]).finally(() => {
        void refreshLeaderboard(puzzle.puzzleDate);
      });
    } else {
      if (!isArchiveMode) {
        void refreshLeaderboard(puzzle.puzzleDate);
      }
    }
  };

  const onPositionClick = (position: Move['position']) => {
    if (!runtimeState || !puzzle || !selectedTile || status !== 'IN_PROGRESS') return;

    const move = legalMoves.find(
      (candidate) =>
        candidate.tile &&
        candidate.position === position &&
        tileEquals(candidate.tile, selectedTile),
    );
    if (!move) return;

    const result = applyPlayMove(runtimeState, 'you', move);
    const nextState = result.state;
    const pointsAwarded = result.scored?.points ?? 0;
    const nextMoves = movesUsed + 1;
    const totalScore = nextState.players.you.score;
    const upcomingPlayMoves = getLegalMoves(nextState, 'you').filter(
      (candidate) => candidate.type === 'play',
    );

    setRuntimeState(nextState);
    setSelectedTile(null);
    setMovesUsed(nextMoves);
    flashLastPlayed(move.tile ?? null);

    if (puzzle.puzzleType === 'one_turn_high_score') {
      const isDouble = move.tile!.low === move.tile!.high;
      const newRunningScore = runningScoreRef.current + pointsAwarded;

      if ((pointsAwarded === 0 && !isDouble) || upcomingPlayMoves.length === 0) {
        runningScoreRef.current = newRunningScore;
        setFinalScore(newRunningScore);
        setStatus('SOLVED');
        finalizeResult('SOLVED', nextMoves, newRunningScore);
      } else {
        runningScoreRef.current = newRunningScore;
      }
      return;
    }

    if (totalScore >= puzzle.targetScore && nextMoves <= puzzle.maxMoves) {
      setStatus('SOLVED');
      finalizeResult('SOLVED', nextMoves, totalScore);
      return;
    }

    if (nextMoves >= puzzle.maxMoves && totalScore < puzzle.targetScore) {
      setStatus('FAILED');
      finalizeResult('FAILED', null, totalScore);
      return;
    }

    if (nextState.currentPlayer !== 'you') {
      setStatus('FAILED');
      finalizeResult('FAILED', null, totalScore);
      return;
    }

    if (upcomingPlayMoves.length === 0) {
      setStatus('FAILED');
      finalizeResult('FAILED', null, totalScore);
      return;
    }
  };

  useEffect(() => {
    if (!puzzle || status !== 'IN_PROGRESS' || puzzle.puzzleType !== 'one_turn_high_score') return;
    if (showLobby) return;
    if (legalMoves.length > 0) return;
    setFinalScore(0);
    setStatus('FAILED');
    finalizeResult('FAILED', null, 0);
  }, [puzzle, status, legalMoves.length]);

  useEffect(() => {
    if (status !== 'SOLVED') {
      solvedConfettiFiredRef.current = false;
      return;
    }
    if (solvedConfettiFiredRef.current) return;
    const completedScore =
      puzzle?.puzzleType === 'one_turn_high_score'
        ? (finalScore ?? runtimeState?.players.you.score ?? 0)
        : (runtimeState?.players.you.score ?? 0);
    const completionRatio =
      bestPossibleScore > 0 ? completedScore / bestPossibleScore : 0;
    if (completionRatio < 0.8) return;
    solvedConfettiFiredRef.current = true;
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;
    const myConfetti = confetti.create(canvas, { resize: true, useWorker: true });
    myConfetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.55 },
      colors: ['#2ecc8e', '#95f0ca', '#d8b56f', '#ffffff'],
    });
  }, [status, puzzle?.puzzleType, finalScore, runtimeState, bestPossibleScore]);

  const currentUserId = user?.id ?? null;
  const currentLeaderboardIndex = useMemo(() => {
    if (!currentUserId) return -1;
    return leaderboard.findIndex((row) => row.userId === currentUserId);
  }, [currentUserId, leaderboard]);
  const currentLeaderboardRow =
    currentLeaderboardIndex >= 0 ? leaderboard[currentLeaderboardIndex] ?? null : null;
  const leaderboardSummaryCards = useMemo<LeaderboardSummaryCard[]>(() => {
    return [
      {
        label: 'Your Rank',
        value: currentLeaderboardIndex >= 0 ? `#${currentLeaderboardIndex + 1}` : '—',
        sublabel: 'Today’s placement',
        tone: 'accent',
      },
      {
        label: 'Score',
        value: currentLeaderboardRow ? `${currentLeaderboardRow.bestScore}` : '—',
        sublabel: currentLeaderboardRow ? 'Best submitted run' : 'No submitted score yet',
        tone: 'neutral',
      },
      {
        label: 'Moves',
        value: currentLeaderboardRow ? `${currentLeaderboardRow.bestMovesUsed}` : '—',
        sublabel: 'Tiles used',
        tone: 'neutral',
      },
      {
        label: 'Time',
        value: currentLeaderboardRow ? formatPuzzleElapsed(currentLeaderboardRow.bestSeconds) : '—',
        sublabel: 'Best finish time',
        tone: 'neutral',
      },
    ];
  }, [currentLeaderboardIndex, currentLeaderboardRow]);

  if (entryMode === 'checking' && selectedDateSeed === localDateKey) {
    return <DailyPuzzleLoadingScreen onBack={handleBackHome} />;
  }

  if (entryMode === 'ladderCheckError' && selectedDateSeed === localDateKey) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        title={stableDailyTitle}
        subtitle="Could not confirm today’s ladder."
        contentClassName="screen-shell"
      >
        <p className="auth-inline-error">{ladderStatusError ?? 'Unknown error.'}</p>
        <p className="lobby-server">Run calendar uses Pacific time (same as the daily reset).</p>
        <button
          type="button"
          className="mode-inline-btn rh-back-button"
          onClick={() => {
            setLadderStatusError(null);
            setEntryMode('checking');
            setLadderFetchNonce((n) => n + 1);
          }}
        >
          Retry
        </button>
        <button type="button" className="mode-inline-btn rh-back-button" onClick={handleBackHome}>
          ← Back to Home
        </button>
      </LayoutScreen>
    );
  }

  if (entryMode === 'ladderPending' && ladderToday && selectedDateSeed === localDateKey) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        title="Today’s Puzzle Ladder is being prepared"
        subtitle="Three fixed puzzles. Same ladder for everyone."
        contentClassName="screen-shell"
      >
        <p style={{ color: 'rgba(232,245,240,0.88)', lineHeight: 1.5 }}>
          We couldn’t publish today’s full three-step ladder yet. Please check back soon, or refresh in a few
          minutes.
        </p>
        <button
          type="button"
          className="mode-inline-btn rh-back-button"
          onClick={() => {
            setEntryMode('checking');
            setLadderFetchNonce((n) => n + 1);
          }}
        >
          Refresh
        </button>
        <button
          type="button"
          className="mode-inline-btn rh-back-button"
          onClick={() => {
            if (onNavigate) {
              onNavigate('learn');
              return;
            }
            handleBackHome();
          }}
        >
          ← Back to Learn
        </button>
        {import.meta.env.DEV ? (
          <p className="lobby-server" style={{ marginTop: '1rem', maxWidth: '42rem' }}>
            Local dev: ensure API is running on port 3001 (Vite proxies <code>/api</code> there), with{' '}
            <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_KEY</code> in the server env, then seed three slots:{' '}
            <code>
              {`npm run build --prefix server && node server/dist/seedDailyPuzzleLadder.js --date ${ladderToday.runDate} --force`}
            </code>
          </p>
        ) : null}
      </LayoutScreen>
    );
  }

  if (entryMode === 'ladder' && ladderToday && selectedDateSeed === localDateKey) {
    return (
      <Suspense fallback={<DailyPuzzleLoadingScreen onBack={handleBackHome} />}>
        <LazyDailyPuzzleLadderScreen
          user={user}
          profile={profile}
          initialToday={ladderToday}
          onBack={onBack}
          onNavigate={onNavigate}
          onOpenAuth={onOpenAuth}
          onOpenAccount={onOpenAccount}
        />
      </Suspense>
    );
  }

  if (loading) {
    return <DailyPuzzleLoadingScreen onBack={handleBackHome} />;
  }

  if (loadError && !showLobby) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        title={stableDailyTitle}
        subtitle={isArchiveMode ? 'Unable to load archived puzzle.' : "Unable to load today's puzzle."}
        contentClassName="screen-shell"
      >
        <p className="auth-inline-error">{loadError}</p>
        <p className="lobby-server">Local date key: {localDateKey}</p>
        <p className="lobby-server">Timezone: {timezone}</p>
        <button type="button" className="mode-inline-btn rh-back-button" onClick={handleBackHome}>
          ← Back to Home
        </button>
      </LayoutScreen>
    );
  }

  if (!puzzle && !showLobby) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        title={stableDailyTitle}
        subtitle={isArchiveMode ? 'No puzzle exists for that date.' : "Today's puzzle is not posted yet."}
        contentClassName="screen-shell"
      >
        <p className="lobby-server">Local date key: {localDateKey}</p>
        <p className="lobby-server">Timezone: {timezone}</p>
        <button type="button" className="mode-inline-btn rh-back-button" onClick={handleBackHome}>
          ← Back to Home
        </button>
      </LayoutScreen>
    );
  }

  const renderLeaderboardRows = (
    rows: DailyPuzzleLeaderboardEntry[],
    variant: 'compact' | 'page' = 'compact',
  ) => (
    <div className="daily-leaderboard-list">
      {rows.map((row, idx) => {
        const isCurrentUser = Boolean(currentUserId) && row.userId === currentUserId;
        const rankLabel = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const initials = getDisplayName(row.username).replace(/^@/, '').slice(0, 2).toUpperCase() || 'P';
        return (
          <div
            className={`daily-leaderboard-row ${variant === 'page' ? 'is-page' : ''} ${isCurrentUser ? 'is-current-user' : ''}`}
            key={`${row.userId}-${idx}`}
          >
            {variant === 'page' && idx < 3 ? <span className={`daily-leaderboard-top-accent rank-${idx + 1}`} aria-hidden="true" /> : null}
            <span className="daily-leaderboard-rank">
              {variant === 'page' ? (
                <>
                  <span className={`daily-leaderboard-rank-dot rank-${idx < 3 ? idx + 1 : 0}`} aria-hidden="true" />
                  <span className={`daily-leaderboard-rank-value rank-${idx < 3 ? idx + 1 : 0}`}>{idx + 1}</span>
                </>
              ) : (
                rankLabel
              )}
            </span>
            <span className="daily-leaderboard-name">
              {variant === 'page' ? (
                <>
                  <span className={`daily-leaderboard-avatar ${isCurrentUser ? 'is-current-user' : ''}`} aria-hidden="true">
                    {initials}
                  </span>
                  <span className="daily-leaderboard-name-text">
                    @{getDisplayName(row.username)}
                    {isCurrentUser ? <span className="daily-you-pill">YOU</span> : null}
                  </span>
                </>
              ) : (
                <>
                  @{getDisplayName(row.username)}
                  {isCurrentUser ? (
                    <span className="daily-you-pill"> ← You</span>
                  ) : null}
                </>
              )}
            </span>
            {variant === 'page' ? (
              <>
                <span className="daily-leaderboard-metric daily-leaderboard-score">
                  <span className="daily-leaderboard-metric-label">Score</span>
                  <span className="daily-leaderboard-metric-value">{row.bestScore}</span>
                </span>
                <span className="daily-leaderboard-metric daily-leaderboard-moves">
                  <span className="daily-leaderboard-metric-label">Moves</span>
                  <span className="daily-leaderboard-metric-value">{row.bestMovesUsed}</span>
                </span>
                <span className="daily-leaderboard-metric daily-leaderboard-time">
                  <span className="daily-leaderboard-metric-label">Time</span>
                  <span className="daily-leaderboard-metric-value">{formatPuzzleElapsed(row.bestSeconds)}</span>
                </span>
              </>
            ) : (
              <>
                <span className="daily-leaderboard-stat daily-leaderboard-score">{row.bestScore}</span>
                <span className="daily-leaderboard-stat daily-leaderboard-moves">{row.bestMovesUsed}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  if (showLobby && dailyLeaderboardOpen) {
    return (
      <LeaderboardPageShell
        mode="puzzle"
        className="mode-subpage-screen mode-accent-daily"
        label="Daily Puzzle"
        title="Leaderboard"
        subtitle={`${formatPuzzleLeaderboardDate(displayDateSeed)} · Global ranking`}
        backLabel="Back to Daily Puzzle"
        summaryCards={leaderboardSummaryCards}
        resultsLabel={`Global Results · ${leaderboard.length} ${leaderboard.length === 1 ? 'player' : 'players'}`}
        onClose={() => setDailyLeaderboardOpen(false)}
      >
        <div className="daily-leaderboard-panel daily-leaderboard-page-panel">
          {leaderboardLoading && (
            <p className="daily-leaderboard-loading">
              <span className="daily-inline-spinner" aria-hidden="true" />
              Loading leaderboard...
            </p>
          )}
          {!leaderboardLoading && leaderboard.length === 0 && (
            <p className="daily-leaderboard-empty">No scores yet today. Be the first on the board.</p>
          )}
          {!leaderboardLoading && leaderboard.length > 0 && renderLeaderboardRows(leaderboard, 'page')}
        </div>
      </LeaderboardPageShell>
    );
  }

  if (showLobby) {
    const selectedLobbyPuzzle = puzzle;
    return (
      <>
        <div className="screen mode-subpage-screen mode-accent-daily daily-entry-screen">
          <div className="daily-dash" style={{ ['--dash-accent' as string]: '#f0c040' }}>

            {/* ── Top bar ── */}
            <header className="daily-dash-topbar">
              <div className="daily-dash-brand">RACEHORSE</div>
              <button type="button" className="daily-dash-back rh-back-button" onClick={onBack}>
                <span aria-hidden="true">←</span>
                <span>Back to Home</span>
              </button>
            </header>

            {/* ── Main content ── */}
            <main className="daily-dash-main">

              {/* Header */}
              <div className="daily-dash-header">
                <p className="daily-dash-eyebrow">
                  {isArchiveMode ? 'Puzzle Archive' : 'Daily Puzzle'}
                </p>
                <h1 className="daily-dash-title">
                  {isArchiveMode ? "Puzzle Archive" : "Today’s Challenge"}
                </h1>
                <p className="daily-dash-subtitle">
                  {isArchiveMode
                    ? 'Play any past puzzle just for fun.'
                    : 'Score as many points as you can in one turn.'}
                </p>
              </div>

              <div className="daily-dash-separator" aria-hidden="true" />

              {/* Body */}
              <div className="daily-dash-body">

                {/* Left: details */}
                <div className="daily-dash-details">
                  <div className="claude-mode-info-card">
                    <ClaudeSectionLabel color="#f0c040">
                      {isArchiveMode ? 'Archive Details' : "Today’s Board"}
                    </ClaudeSectionLabel>
                    <ClaudeStatLine label="Date" value={formattedDisplayDate} />
                    <ClaudeStatLine label="Mode" value={isArchiveMode ? 'Archive' : 'Daily'} />
                    <ClaudeStatLine label="Format" value="One-turn high score" />
                    <ClaudeStatLine
                      label="Streak"
                      value={isArchiveMode ? 'Off' : `${streakDays} day${streakDays === 1 ? '' : 's'}`}
                      accent={isArchiveMode ? undefined : '#f0c040'}
                    />
                  </div>

                  {isArchiveMode && (
                    <div className="daily-entry-status-card claude-mode-card">
                      <span className="daily-entry-status-label">Archive</span>
                      <strong>Play any past puzzle.</strong>
                      <p>Archive runs do not affect streaks or the daily leaderboard.</p>
                    </div>
                  )}

                  {loadError ? <p className="auth-inline-error">{loadError}</p> : null}
                  {!loading && !loadError && !selectedLobbyPuzzle ? (
                    <p className="auth-inline-error">
                      {isArchiveMode
                        ? `No puzzle exists for ${formattedDisplayDate}.`
                        : "Today’s puzzle is not posted yet."}
                    </p>
                  ) : null}
                  {runtimeInitError ? <p className="auth-inline-error">{runtimeInitError}</p> : null}
                </div>

                {/* Right: actions */}
                <div className="daily-dash-actions">
                  <ClaudePrimaryAction
                    accent="#f0c040"
                    disabled={loading || (!archiveDateDirty && !selectedPuzzleReady)}
                    title={archiveTargetIsToday ? 'Start Daily Puzzle' : 'Play Archived Puzzle'}
                    meta={
                      archiveTargetIsToday
                        ? "Play today’s one-turn puzzle"
                        : 'Load and play this archived puzzle'
                    }
                    onClick={() => {
                      const nextDate = archiveInputHasCompleteDate
                        ? normalizeDateInputToLocalKey(archiveDateInput)
                        : selectedDateSeed;
                      if (nextDate !== selectedDateSeed) {
                        pendingStartDateRef.current = nextDate;
                        setArchiveDateInput(nextDate);
                        setSelectedDateSeed(nextDate);
                        setLoadError(null);
                        setDailyLeaderboardOpen(false);
                        return;
                      }
                      if (!puzzle || puzzle.puzzleDate !== nextDate) return;
                      void startDailyPuzzle();
                    }}
                  />
                  <ClaudeSecondaryAction
                    title="Choose Date"
                    meta={isArchiveMode ? 'Load another archived puzzle' : 'Browse archive or pick a specific day'}
                    onClick={() => setArchivePickerOpen(true)}
                  />
                  {archiveTargetIsToday && (
                    <ClaudeSecondaryAction
                      title="Leaderboard"
                      meta="See today’s top scores"
                      onClick={() => setDailyLeaderboardOpen(true)}
                    />
                  )}
                </div>

              </div>
            </main>
          </div>
        </div>
        {archivePickerOpen && (
          <div
            className="daily-puzzle-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Select puzzle date"
            onClick={() => setArchivePickerOpen(false)}
          >
            <div className="daily-puzzle-modal daily-archive-modal" onClick={(e) => e.stopPropagation()}>
              <div className="daily-leaderboard-modal-head">
                <div style={{ display: 'grid', gap: 4 }}>
                  <h3>Select Puzzle Date</h3>
                  <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>
                    Choose any past date to play an archived puzzle.
                  </p>
                </div>
                <button className="mode-inline-btn" onClick={() => setArchivePickerOpen(false)}>
                  Close
                </button>
              </div>
              <div className="daily-archive-controls daily-archive-controls-modal">
                <label className="daily-archive-label" htmlFor="daily-archive-date">Puzzle date</label>
                <input
                  id="daily-archive-date"
                  className="daily-archive-input"
                  type="date"
                  value={archiveDateInput}
                  max={localDateKey}
                  onChange={(e) => setArchiveDateInput(e.target.value || localDateKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyArchiveDate();
                      setArchivePickerOpen(false);
                    }
                  }}
                />
                <div className="daily-archive-actions">
                  <button
                    type="button"
                    className="daily-archive-button"
                    disabled={!archiveInputHasCompleteDate}
                    onClick={() => {
                      applyArchiveDate();
                      setArchivePickerOpen(false);
                    }}
                  >
                    Load Date
                  </button>
                  <button
                    type="button"
                    className="daily-archive-button daily-archive-button-secondary"
                    onClick={() => {
                      setArchiveDateInput(localDateKey);
                      setSelectedDateSeed(localDateKey);
                      setLoadError(null);
                      setDailyLeaderboardOpen(false);
                      setArchivePickerOpen(false);
                    }}
                  >
                    Today
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (!puzzle) return null;

  const solvableWarning = Boolean(validation && !validation.solvable);
  const formattedPuzzleDate = formatPuzzleDateLabel(puzzle.puzzleDate);
  const completedScore = completedScoreForSummary;

  if (!runtimeState) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        title={stableDailyTitle}
        subtitle="Preparing puzzle board..."
        contentClassName="screen-shell"
      />
    );
  }

  return (
    <>
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green daily-puzzle-screen rh-match-live rh-match-solo-hud">
      <canvas
        ref={confettiCanvasRef}
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 2100,
          display: status === 'SOLVED' ? 'block' : 'none',
        }}
      />
      <MatchLiveLayout
        hudLeft={
          <div className="wl-player-pill wl-player-pill-btn score-card is-you">
            <div className="wl-player-card-content">
              <div className="wl-player-card-text">
                <span className="wl-player-label">{isArchiveMode ? 'Puzzle Archive' : 'Daily Puzzle'}</span>
              </div>
              <span className="wl-player-score">{runtimeState.players.you.score}</span>
            </div>
          </div>
        }
        hudCenter={
          <div className="wl-center-status" data-ui="turn-status">
            <span className="wl-turn-label your-turn">{isArchiveMode ? 'ARCHIVE PUZZLE' : 'DAILY PUZZLE'}</span>
            <span className="wl-room-code">{formattedPuzzleDate}</span>
          </div>
        }
        hudRight={
          <div className="rh-match-solo-actions">
            <button type="button" className="rh-match-solo-action-btn" onClick={resetAttempt}>
              Play Again
            </button>
            <button type="button" className="rh-match-solo-action-btn rh-back-button" onClick={onBack}>
              ← Back to Home
            </button>
          </div>
        }
        boardInner={
          <>
            {!runtimeState.gameOver ? (
              <div className="rh-board-meta-bar rh-board-meta-bar--count-only" data-ui="board-meta">
                <BoneyardCountPill count={runtimeState.boneyard.length} />
              </div>
            ) : null}
            <Board
              board={runtimeState.board}
              legalMoves={legalMoves}
              selectedTile={selectedTile}
              lastPlayedTile={lastPlayedTile}
              onPositionClick={onPositionClick}
              tileSize={84}
            />
            {solvableWarning && (
              <div className="daily-puzzle-warning-banner">
                Puzzle warning: {validation?.reason} (best score {validation?.bestScore}). You can
                still play this puzzle.
              </div>
            )}
            {import.meta.env.DEV && solvableWarning && (
              <div className="daily-puzzle-dev-warning">
                Dev: puzzle invalid · solvable={String(validation?.solvable)} · bestScore=
                {validation?.bestScore} · hasScoringMove={String(validation?.hasScoringMove)} ·
                explored={validation?.exploredStates}
              </div>
            )}
          </>
        }
        handDock={
          <div className="tray-rail">
            <div className="tray-center">
              <div className={`hand-container ${handCompactStacked ? 'is-stacked has-single-row' : 'has-single-row'}`}>
                {(handCompactStacked
                  ? [
                      runtimeState.players.you.hand.slice(
                        0,
                        Math.ceil(runtimeState.players.you.hand.length / 2),
                      ),
                      runtimeState.players.you.hand.slice(
                        Math.ceil(runtimeState.players.you.hand.length / 2),
                      ),
                    ]
                  : [runtimeState.players.you.hand]
                ).map((row, rowIdx) => (
                  <div key={`daily-hand-row-${rowIdx}`} className="hand-row">
                    {row.map((tile, idx) => {
                      const playable = playableTileKeys.has(tileKey(tile));
                      const inProgress = status === 'IN_PROGRESS';
                      const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;

                      return (
                        <DominoTile
                          key={`daily-curated-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                          tile={tile}
                          size={handTileSize}
                          rotation={0}
                          selected={isSelected}
                          highlight={inProgress && playable}
                          unplayable={inProgress && !playable}
                          disabled={!inProgress}
                          onClick={() => {
                            if (!inProgress || !playable) return;
                            setSelectedTile(tile);
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        }
      />

      {status !== 'IN_PROGRESS' && (
        <div className="rh-modal-overlay" role="dialog" aria-modal="true" style={{ ['--rh-accent-rgb' as string]: '240, 192, 64' }}>
          <div className="rh-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow" style={{ color: '#f0c040' }}>PUZZLE COMPLETE</div>
              <div className="rh-result__score">
                <span>{completedScore}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback" style={{ color: completionSummary.completionMessage.color }}>
                {completionSummary.completionMessage.text}
              </div>
            </header>

            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Best Possible</span>
                <span className="rh-result__summary-value">{bestPossibleScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Moves Used</span>
                <span className="rh-result__summary-value">{movesUsed}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Current Streak</span>
                <span className="rh-result__summary-value" style={{ color: '#f0c040' }}>{streakDays} DAYS</span>
              </div>
            </div>

            <div className="rh-result__board">
              <div className="rh-result__board-head">
                <div className="claude-mode-section-label">GLOBAL LEADERBOARD</div>
                <div className="claude-mode-topbar__brand" style={{ fontSize: '10px', opacity: 0.4 }}>TODAY</div>
              </div>

              <div className="rh-result__lb">
                <div className="rh-result__lb-head">
                  <span>#</span>
                  <span>PLAYER</span>
                  <span style={{ textAlign: 'right' }}>SCORE</span>
                  <span style={{ textAlign: 'right' }}>MOVES</span>
                  <span style={{ textAlign: 'right' }}>TIME</span>
                </div>
                {completionSummary.modalLeaderboard.map((row, idx) => {
                  const isYou = Boolean(currentUserId) && row.userId === currentUserId;
                  const initials = getDisplayName(row.username).replace(/^@/, '').slice(0, 2).toUpperCase() || 'P';
                  return (
                    <div key={idx} className={`rh-result__lb-row ${isYou ? 'is-you' : ''}`}>
                      <span className={`rh-result__lb-rank ${idx < 3 ? 'is-top-3' : ''}`}>{idx + 1}</span>
                      <span className="rh-result__lb-name">
                        <div className="rh-result__avatar">{initials}</div>
                        <span>@{getDisplayName(row.username)}</span>
                        {isYou && <span className="rh-result-you-pill">YOU</span>}
                      </span>
                      <span className="rh-result__lb-num">{row.bestScore}</span>
                      <span className="rh-result__lb-num">{row.bestMovesUsed}</span>
                      <span className="rh-result__lb-num">{formatPuzzleElapsed(row.bestSeconds)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <footer className="rh-result__actions">
              <button type="button" className="rh-btn-leave" onClick={resetAttempt}>Play Again</button>
              <button
                type="button"
                className="rh-btn-cancel rh-back-button"
                onClick={onBack}
              >
                ← Back to Home
              </button>
            </footer>
          </div>
        </div>
      )}

      </div>
    </>
  );
}
