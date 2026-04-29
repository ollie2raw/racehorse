import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import { Board, DominoTile } from '../components';
import {
  applyPlayMove,
  getDisplayOpenEnds,
  getLegalMoves,
  type BotMatchState,
} from '../bot/botEngine';
import type { Move, Tile } from '../types';
import {
  fetchDailyPuzzleLeaderboard,
  getDailyPuzzleByDateSeed,
  getDailyPuzzleForDate,
  getLocalDateKey,
  normalizeDateInputToLocalKey,
  type DailyPuzzleLeaderboardEntry,
  upsertDailyPuzzleCompletion,
  upsertDailyPuzzleBestScore,
} from './api';
import type { CuratedDailyPuzzle, PuzzleValidationResult } from './types';
import LayoutScreen from '../ui/LayoutScreen';
import LeaderboardPageShell, { type LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';
import './dailyPuzzle.css';

interface DailyPuzzleScreenProps {
  user: User | null;
  profile: UserProfile | null;
  onBack: () => void;
}

type PlayStatus = 'IN_PROGRESS' | 'SOLVED' | 'FAILED';

interface DailyProgress {
  attempts: number;
  bestMoves: number | null;
  lastResult: PlayStatus | null;
}

interface DailyPuzzleStreak {
  lastCompletedDate: string | null;
  currentStreak: number;
}

type ValidatorWorkerRequest =
  | { requestId: number; type: 'validate'; puzzleDate: string; puzzle: CuratedDailyPuzzle }
  | { requestId: number; type: 'bestScore'; puzzleDate: string; puzzle: CuratedDailyPuzzle };

type ValidatorWorkerResponse =
  | { requestId: number; type: 'validateResult'; puzzleDate: string; result: PuzzleValidationResult }
  | { requestId: number; type: 'bestScoreResult'; puzzleDate: string; score: number }
  | { requestId: number; type: 'error'; puzzleDate: string; error: string };

interface PendingWorkerJob<T> {
  expected: 'validateResult' | 'bestScoreResult';
  puzzleDate: string;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function puzzleInstanceKey(dateSeed: string, puzzleType: CuratedDailyPuzzle['puzzleType']): string {
  return `${dateSeed}:${puzzleType}`;
}

function puzzleCacheKey(dateSeed: string, puzzleType: CuratedDailyPuzzle['puzzleType']): string {
  return `dailyPuzzle:cached:v3:${puzzleInstanceKey(dateSeed, puzzleType)}`;
}

function tileEquals(a: Tile, b: Tile): boolean {
  return (a.high === b.high && a.low === b.low) || (a.high === b.low && a.low === b.high);
}

function progressKey(dateSeed: string, puzzleType: CuratedDailyPuzzle['puzzleType']): string {
  return `dailyPuzzle:${puzzleInstanceKey(dateSeed, puzzleType)}`;
}

function readProgress(dateSeed: string, puzzleType: CuratedDailyPuzzle['puzzleType']): DailyProgress {
  if (typeof window === 'undefined') {
    return { attempts: 0, bestMoves: null, lastResult: null };
  }
  try {
    const raw = window.localStorage.getItem(progressKey(dateSeed, puzzleType));
    if (!raw) return { attempts: 0, bestMoves: null, lastResult: null };
    const parsed = JSON.parse(raw) as DailyProgress;
    return {
      attempts: Number.isFinite(parsed.attempts) ? parsed.attempts : 0,
      bestMoves: typeof parsed.bestMoves === 'number' ? parsed.bestMoves : null,
      lastResult: parsed.lastResult ?? null,
    };
  } catch {
    return { attempts: 0, bestMoves: null, lastResult: null };
  }
}

function writeProgress(
  dateSeed: string,
  puzzleType: CuratedDailyPuzzle['puzzleType'],
  progress: DailyProgress,
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(progressKey(dateSeed, puzzleType), JSON.stringify(progress));
}

function readCachedPuzzle(
  dateSeed: string,
  puzzleType: CuratedDailyPuzzle['puzzleType'],
): CuratedDailyPuzzle | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(puzzleCacheKey(dateSeed, puzzleType));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CuratedDailyPuzzle;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.puzzleDate !== 'string' ||
      !Array.isArray(parsed.startingHand)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedPuzzle(puzzle: CuratedDailyPuzzle): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      puzzleCacheKey(puzzle.puzzleDate, puzzle.puzzleType),
      JSON.stringify(puzzle),
    );
  } catch {
    // no-op
  }
}

function streakKey(): string {
  return 'dailyPuzzle:streak';
}

function readStreak(): DailyPuzzleStreak {
  if (typeof window === 'undefined') {
    return { lastCompletedDate: null, currentStreak: 0 };
  }
  try {
    const raw = window.localStorage.getItem(streakKey());
    if (!raw) return { lastCompletedDate: null, currentStreak: 0 };
    const parsed = JSON.parse(raw) as DailyPuzzleStreak;
    return {
      lastCompletedDate:
        typeof parsed.lastCompletedDate === 'string' ? parsed.lastCompletedDate : null,
      currentStreak: Number.isFinite(parsed.currentStreak) ? Math.max(0, parsed.currentStreak) : 0,
    };
  } catch {
    return { lastCompletedDate: null, currentStreak: 0 };
  }
}

function writeStreak(streak: DailyPuzzleStreak): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(streakKey(), JSON.stringify(streak));
}

function parseLocalDateKeyToDate(dateKey: string): Date | null {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const parsed = new Date(y, m - 1, d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function diffLocalCalendarDays(prev: string, next: string): number | null {
  const prevDate = parseLocalDateKeyToDate(prev);
  const nextDate = parseLocalDateKeyToDate(next);
  if (!prevDate || !nextDate) return null;
  const ms = nextDate.getTime() - prevDate.getTime();
  return Math.round(ms / 86400000);
}

function recordSolvedStreak(dateKey: string): number {
  const streak = readStreak();
  if (streak.lastCompletedDate === dateKey) {
    const sameDay = Math.max(1, streak.currentStreak || 1);
    writeStreak({ lastCompletedDate: dateKey, currentStreak: sameDay });
    return sameDay;
  }

  const dayDiff = streak.lastCompletedDate ? diffLocalCalendarDays(streak.lastCompletedDate, dateKey) : null;
  const nextStreak = dayDiff === 1 ? Math.max(1, streak.currentStreak + 1) : 1;
  writeStreak({ lastCompletedDate: dateKey, currentStreak: nextStreak });
  return nextStreak;
}

function getDisplayStreak(todayDateKey: string): number {
  const streak = readStreak();
  if (!streak.lastCompletedDate || streak.currentStreak <= 0) return 0;
  const dayDiff = diffLocalCalendarDays(streak.lastCompletedDate, todayDateKey);
  if (dayDiff === null) return Math.max(0, streak.currentStreak);
  if (dayDiff <= 1) return Math.max(0, streak.currentStreak);
  return 0;
}

function getDisplayName(username: string | null | undefined): string {
  const value = (username ?? '').trim();
  if (!value) return 'Player';
  if (/^user_[a-f0-9]{8}$/i.test(value)) return 'Player';
  return value;
}

function formatPuzzleDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPuzzleLeaderboardDate(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatPuzzleElapsed(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
}

function createPuzzleMatchState(puzzle: CuratedDailyPuzzle): BotMatchState {
  const normalizedDealSize = puzzle.dealSize === 14 ? 14 : 7;
  return {
    players: {
      you: { hand: [...puzzle.startingHand], score: 0 },
      bot: { hand: [], score: 0 },
    },
    board: {
      ...puzzle.startingBoard,
      mainLine: [...puzzle.startingBoard.mainLine],
      hubDoubles: [...puzzle.startingBoard.hubDoubles],
    },
    boneyard: [],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: normalizedDealSize,
  };
}

export default function DailyPuzzleScreen({
  user,
  profile,
  onBack,
}: DailyPuzzleScreenProps) {
  const stableDailyTitle = (
    <span style={{ color: 'rgba(243, 250, 247, 0.97)', opacity: 1 }}>Today&apos;s Challenge</span>
  );
  const localDateKey = useMemo(() => getLocalDateKey(), []);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [selectedDateSeed, setSelectedDateSeed] = useState(localDateKey);
  const [archiveDateInput, setArchiveDateInput] = useState(localDateKey);
  const [puzzle, setPuzzle] = useState<CuratedDailyPuzzle | null>(null);
  const [validation, setValidation] = useState<PuzzleValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<PlayStatus>('IN_PROGRESS');
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [movesUsed, setMovesUsed] = useState(0);
  const [_lastMovePoints, setLastMovePoints] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const runningScoreRef = useRef(0);
  const [_statusMessage, setStatusMessage] = useState('');
  const [_attempts, setAttempts] = useState(0);
  const [_bestMoves, setBestMoves] = useState<number | null>(null);
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
        setLastMovePoints(0);
        setFinalScore(null);
        runningScoreRef.current = 0;
        setStatusMessage(
          cached.puzzleType === 'one_turn_high_score'
            ? 'Running score: 0 — keep playing'
            : `Score Attack — Reach ${cached.targetScore} in ${cached.maxMoves} moves.`,
        );
        const cachedProgress = readProgress(cached.puzzleDate, cached.puzzleType);
        setAttempts(cachedProgress.attempts);
        setBestMoves(cachedProgress.bestMoves);
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
        setLastMovePoints(0);
        setFinalScore(null);
        runningScoreRef.current = 0;
        setStatusMessage(
          nextPuzzle.puzzleType === 'one_turn_high_score'
            ? 'Running score: 0 — keep playing'
            : 'Play a setup move first, then strike for maximum points.',
        );

        const progress = readProgress(nextPuzzle.puzzleDate, nextPuzzle.puzzleType);
        if (loadKey === localDateKey) {
          const nextAttempts = progress.attempts + 1;
          writeProgress(nextPuzzle.puzzleDate, nextPuzzle.puzzleType, {
            ...progress,
            attempts: nextAttempts,
          });
          setAttempts(nextAttempts);
          setBestMoves(progress.bestMoves);
          void refreshLeaderboard(nextPuzzle.puzzleDate);
          setStreakDays(getDisplayStreak(nextPuzzle.puzzleDate));
        } else {
          setAttempts(progress.attempts);
          setBestMoves(progress.bestMoves);
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
  }, [selectedDateSeed, localDateKey, timezone, refreshLeaderboard, isArchiveMode]);

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

  useEffect(() => {
    if (!runtimeState) return;
    const updateHandTileSize = () => {
      const tileCount = Math.max(1, runtimeState.players.you.hand.length);
      const forceTwoRows = tileCount > 9;
      const maxTileSize = 56; // 14-tile reference size cap
      let tileWidth = maxTileSize;
      if (tileCount >= 9 && tileCount <= 10) tileWidth = 64;
      else if (tileCount >= 11 && tileCount <= 14) tileWidth = 56;
      else if (tileCount >= 15) tileWidth = 48;
      tileWidth = Math.min(tileWidth, maxTileSize);
      const trayHeight = forceTwoRows ? 138 : 120;
      document.documentElement.style.setProperty('--tray-height', `${trayHeight}px`);
      setHandTileSize(tileWidth);
      setHandCompactStacked(forceTwoRows);
    };

    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [runtimeState?.players.you.hand.length]);

  const resetAttempt = () => {
    if (!puzzle) return;
    const start = createPuzzleMatchState(puzzle);
    setRuntimeState(start);
    setStatus('IN_PROGRESS');
    setSelectedTile(null);
    setMovesUsed(0);
    setLastMovePoints(0);
    setFinalScore(null);
    runningScoreRef.current = 0;
    submittedRef.current = false;
    solvedConfettiFiredRef.current = false;
    startTimeRef.current = Date.now();
    setStatusMessage(
      puzzle.puzzleType === 'one_turn_high_score'
        ? 'Running score: 0 — keep playing'
        : `Score Attack — Reach ${puzzle.targetScore} in ${puzzle.maxMoves} moves.`,
    );

    if (!isArchiveMode) {
      const progress = readProgress(puzzle.puzzleDate, puzzle.puzzleType);
      const nextAttempts = progress.attempts + 1;
      writeProgress(puzzle.puzzleDate, puzzle.puzzleType, { ...progress, attempts: nextAttempts });
      setAttempts(nextAttempts);
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
      setBestMoves(nextBest);
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
        // eslint-disable-next-line no-console
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
              // eslint-disable-next-line no-console
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

    const beforeEnds = getDisplayOpenEnds(runtimeState);
    const result = applyPlayMove(runtimeState, 'you', move);
    const nextState = result.state;
    const pointsAwarded = result.scored?.points ?? 0;
    const nextMoves = movesUsed + 1;
    const totalScore = nextState.players.you.score;

    setRuntimeState(nextState);
    setSelectedTile(null);
    setMovesUsed(nextMoves);
    setLastMovePoints(pointsAwarded);
    flashLastPlayed(move.tile ?? null);

    const afterEnds = getDisplayOpenEnds(nextState);
    // eslint-disable-next-line no-console
    console.log('[DailyPuzzle]', { beforeEnds, afterEnds, pointsAwarded, totalScore });

    if (puzzle.puzzleType === 'one_turn_high_score') {
      const isDouble = move.tile!.low === move.tile!.high;
      const newRunningScore = runningScoreRef.current + pointsAwarded;
      const upcoming = getLegalMoves(nextState, 'you').filter((c) => c.type === 'play');

      if ((pointsAwarded === 0 && !isDouble) || upcoming.length === 0) {
        runningScoreRef.current = newRunningScore;
        setFinalScore(newRunningScore);
        setStatus('SOLVED');
        setStatusMessage(`Final score: ${newRunningScore}`);
        finalizeResult('SOLVED', nextMoves, newRunningScore);
      } else {
        runningScoreRef.current = newRunningScore;
        setStatusMessage(`Running score: ${newRunningScore} — keep playing`);
      }
      return;
    }

    if (totalScore >= puzzle.targetScore && nextMoves <= puzzle.maxMoves) {
      setStatus('SOLVED');
      setStatusMessage(`Solved: ${totalScore}/${puzzle.targetScore} in ${nextMoves} moves.`);
      finalizeResult('SOLVED', nextMoves, totalScore);
      return;
    }

    if (nextMoves >= puzzle.maxMoves && totalScore < puzzle.targetScore) {
      setStatus('FAILED');
      setStatusMessage(`Failed: ${totalScore}/${puzzle.targetScore} after ${nextMoves} moves.`);
      finalizeResult('FAILED', null, totalScore);
      return;
    }

    if (nextState.currentPlayer !== 'you') {
      setStatus('FAILED');
      setStatusMessage('Failed: Turn ended before reaching target score.');
      finalizeResult('FAILED', null, totalScore);
      return;
    }

    const upcoming = getLegalMoves(nextState, 'you').filter(
      (candidate) => candidate.type === 'play',
    );
    if (upcoming.length === 0) {
      setStatus('FAILED');
      setStatusMessage('Failed: No legal moves remaining.');
      finalizeResult('FAILED', null, totalScore);
      return;
    }

    setStatusMessage(`+${pointsAwarded} this move · total ${totalScore}/${puzzle.targetScore}`);
  };

  useEffect(() => {
    if (!puzzle || status !== 'IN_PROGRESS' || puzzle.puzzleType !== 'one_turn_high_score') return;
    if (showLobby) return;
    if (legalMoves.length > 0) return;
    setFinalScore(0);
    setStatus('FAILED');
    setStatusMessage('Final score: 0');
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
  const currentLeaderboardRow = useMemo(
    () => leaderboard.find((row) => Boolean(currentUserId) && row.userId === currentUserId) ?? null,
    [currentUserId, leaderboard],
  );
  const leaderboardSummaryCards = useMemo<LeaderboardSummaryCard[]>(() => {
    return [
      {
        label: 'Your Rank',
        value: currentLeaderboardRow ? `#${leaderboard.indexOf(currentLeaderboardRow) + 1}` : '—',
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
  }, [currentLeaderboardRow, leaderboard]);

  if (loading) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        title={stableDailyTitle}
        subtitle="Loading today's curated puzzle..."
        contentClassName="screen-shell"
      />
    );
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
        <button type="button" className="mode-inline-btn" onClick={handleBackHome}>
          Back to Home
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
        <button type="button" className="mode-inline-btn" onClick={handleBackHome}>
          Back to Home
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
        <LayoutScreen
          className="screen mode-subpage-screen mode-accent-daily daily-entry-screen"
          title={isArchiveMode ? 'Puzzle Archive' : stableDailyTitle}
          subtitle={
            isArchiveMode
              ? 'Play any past puzzle just for fun.'
              : 'Score as many points as you can in one turn.'
          }
          contentClassName="multiplayer-menu-card screen-shell daily-entry-shell"
        >
            <div className="mode-entry-panel daily-entry-panel">
              <div className="daily-entry-summary-grid">
                <button
                  type="button"
                  className="daily-entry-summary-card daily-entry-summary-button"
                  onClick={() => setArchivePickerOpen(true)}
                >
                  <div className="daily-fritz-stat-layout">
                    <span>Date</span>
                    <strong>{formattedDisplayDate}</strong>
                    <span
                      className="daily-entry-calendar-button"
                      aria-hidden="true"
                      title={isArchiveMode ? 'Archive selected' : 'Open calendar'}
                    >
                      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                        <path d="M7 2v3M17 2v3M3.5 9.5h17" />
                        <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
                        <path d="M8 13h3M13 13h3M8 17h3M13 17h3" />
                      </svg>
                    </span>
                  </div>
                </button>
                <div className="daily-entry-summary-card">
                  <div className="daily-fritz-stat-layout">
                    <span>Mode</span>
                    <strong>{isArchiveMode ? 'Archive' : 'Daily'}</strong>
                  </div>
                </div>
                <div className="daily-entry-summary-card">
                  <div className="daily-fritz-stat-layout">
                    <span>Format</span>
                    <strong>One-turn high score</strong>
                  </div>
                </div>
                <div className="daily-entry-summary-card">
                  <div className="daily-fritz-stat-layout">
                    <span>Streak</span>
                    <strong className="daily-entry-streak-value">
                      {isArchiveMode ? 'Off' : `${streakDays} day${streakDays === 1 ? '' : 's'}`}
                      {!isArchiveMode && streakDays >= 2 && <span className="daily-entry-streak-icon" aria-hidden="true">🔥</span>}
                    </strong>
                  </div>
                </div>
              </div>

              {isArchiveMode && (
                <div className="daily-entry-status-card">
                  <span className="daily-entry-status-label">Archive</span>
                  <strong>Play any past puzzle.</strong>
                  <p>Archive runs do not affect streaks or the daily leaderboard.</p>
                </div>
              )}
              <div className="mode-actions daily-entry-actions">
                <button
                  className="mode-option mode-option-primary mode-accent-daily daily-start-hero"
                  disabled={loading || (!archiveDateDirty && !selectedPuzzleReady)}
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
                >
                  <span className="mode-option-title">
                    {archiveTargetIsToday
                      ? 'Start Daily Puzzle'
                      : 'Play Archived Puzzle'}
                  </span>
                  {selectedLobbyPuzzle && (
                    <span className="mode-option-meta">
                      {archiveTargetIsToday
                        ? 'Play today’s one-turn puzzle'
                        : 'Load and play this archived puzzle'}
                    </span>
                  )}
                </button>
                {archiveTargetIsToday && (
                  <button
                    className="mode-option mode-option-secondary daily-leaderboard-cta"
                    onClick={() => setDailyLeaderboardOpen(true)}
                  >
                    <span className="mode-option-title">Leaderboard</span>
                    <span className="mode-option-meta">See today&apos;s top scores</span>
                  </button>
                )}
                <button className="mode-option mode-option-secondary daily-entry-back-link" onClick={onBack}>
                  <span className="mode-option-title">Back to Home</span>
                  <span className="mode-option-meta">Return to game mode menu</span>
                </button>
              </div>
              {loadError ? <p className="auth-inline-error">{loadError}</p> : null}
              {!loading && !loadError && !selectedLobbyPuzzle ? (
                <p className="auth-inline-error">
                  {isArchiveMode
                    ? `No puzzle exists for ${formattedDisplayDate}.`
                    : "Today's puzzle is not posted yet."}
                </p>
              ) : null}
              {runtimeInitError ? <p className="auth-inline-error">{runtimeInitError}</p> : null}
            </div>
        </LayoutScreen>
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
  const isOneTurnHighScore = puzzle.puzzleType === 'one_turn_high_score';
  const formattedPuzzleDate = formatPuzzleDateLabel(puzzle.puzzleDate);
  const currentScore = runtimeState?.players.you.score ?? 0;
  const completedScore = isOneTurnHighScore
    ? (finalScore ?? currentScore)
    : currentScore;
  const completionRatio = bestPossibleScore > 0 ? completedScore / bestPossibleScore : 1;
  const completionMessage =
    completedScore >= bestPossibleScore
      ? { text: '🏆 Perfect!', color: '#d8b56f' }
      : completionRatio >= 0.8
        ? { text: '⭐ Great solve!', color: 'rgba(125, 241, 197, 0.95)' }
        : { text: 'Keep practicing!', color: 'rgba(232,245,240,0.85)' };
  const modalLeaderboard = leaderboard.slice(0, 20);

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
    <div className="screen game-screen walnut-live theme-green daily-puzzle-screen">
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
      <div className="wl-top-rail daily-top-rail" data-ui="hud">
        <div className="wl-player-pill is-active daily-hud-pill">
          <span className="wl-player-label">{isArchiveMode ? 'Puzzle Archive' : 'Daily Puzzle'}</span>
          <span className="wl-player-score">{runtimeState.players.you.score}</span>
        </div>
        <div className="daily-center-zone">
          <div className="wl-center-status">
            <span className="wl-turn-label your-turn">{isArchiveMode ? 'ARCHIVE PUZZLE' : 'DAILY PUZZLE'}</span>
            <span className="wl-room-code">{formattedPuzzleDate}</span>
          </div>
        </div>
        <div className="daily-top-actions-pill">
          <button
            className="btn text compact daily-chip-control"
            onClick={resetAttempt}
            style={{
              fontWeight: 700,
              fontSize: '0.88rem',
              color: 'rgba(236, 248, 242, 0.92)',
              letterSpacing: '0.02em',
            }}
          >
            Play Again
          </button>
          <button
            className="btn text compact daily-chip-control"
            onClick={onBack}
            style={{
              fontWeight: 700,
              fontSize: '0.88rem',
              color: 'rgba(236, 248, 242, 0.92)',
              letterSpacing: '0.02em',
            }}
          >
            Back to Home
          </button>
        </div>
      </div>

      <div className="wl-stage-shell">
        <div className="board-area wl-board-area" data-ui="board">
          <Board
            board={runtimeState.board}
            legalMoves={legalMoves}
            selectedTile={selectedTile}
            lastPlayedTile={lastPlayedTile}
            onPositionClick={onPositionClick}
            tileSize={72}
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
        </div>
      </div>

      <div className="hand-area wl-hand-area" data-ui="tray">
        <div className="tray-rail">
          <div className="tray-center">
            <div className={`hand-container ${handCompactStacked ? 'is-stacked' : ''}`}>
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
                    const playable = legalMoves.some(
                      (candidate) => candidate.tile && tileEquals(candidate.tile, tile),
                    );
                    const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;

                    return (
                      <DominoTile
                        key={`daily-curated-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                        tile={tile}
                        size={handTileSize}
                        rotation={0}
                        selected={isSelected}
                        highlight={playable && status === 'IN_PROGRESS'}
                        disabled={status !== 'IN_PROGRESS' || !playable}
                        onClick={() => {
                          if (status !== 'IN_PROGRESS' || !playable) return;
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
      </div>

      {status !== 'IN_PROGRESS' && (
        <div className="daily-puzzle-overlay" role="dialog" aria-modal="true">
          <div className="daily-puzzle-modal">
            {isOneTurnHighScore ? (
              <>
                <h3>Final score: {finalScore ?? 0}</h3>
                <p>High Score — One turn</p>
              </>
            ) : (
              <>
                <h3>
                  {status === 'SOLVED'
                    ? `Solved in ${movesUsed} moves`
                    : 'No legal moves remaining'}
                </h3>
                <p>
                  Score {runtimeState.players.you.score}/{puzzle.targetScore} · Max moves{' '}
                  {puzzle.maxMoves}
                </p>
              </>
            )}
            {status === 'SOLVED' && <p>Streak: {streakDays} days 🔥</p>}
            <div
              style={{
                borderRadius: 14,
                border: '1px solid rgba(236,252,245,0.16)',
                background: 'rgba(15, 25, 20, 0.72)',
                backdropFilter: 'blur(16px)',
                padding: '12px 14px',
                display: 'grid',
                gap: 6,
              }}
            >
              <p style={{ margin: 0, color: 'rgba(232,245,240,0.95)', fontWeight: 700 }}>
                Your score: {completedScore} pts
              </p>
              <p style={{ margin: 0, color: 'rgba(232,245,240,0.86)' }}>
                Best possible: {bestPossibleScore} pts
              </p>
              <p style={{ margin: 0, color: completionMessage.color, fontWeight: 700 }}>
                {completionMessage.text}
              </p>
            </div>
            {!user && <p className="lobby-server">Sign in to submit to leaderboard.</p>}
            <div className="daily-leaderboard-panel daily-leaderboard-panel-modal">
              <h3>Today&apos;s Top Scores</h3>
              <div className="daily-leaderboard-head" aria-hidden="true">
                <span>Rank</span>
                <span>Player</span>
                <span>Score</span>
                <span>Moves</span>
              </div>
              {leaderboardLoading && (
                <p className="daily-leaderboard-loading">
                  <span className="daily-inline-spinner" aria-hidden="true" />
                  Loading leaderboard...
                </p>
              )}
              {!leaderboardLoading && modalLeaderboard.length === 0 && (
                <p className="lobby-server">No solved submissions yet.</p>
              )}
              {!leaderboardLoading && modalLeaderboard.length > 0 && renderLeaderboardRows(modalLeaderboard)}
            </div>
            <div className="daily-puzzle-modal-actions">
              <button className="mode-inline-btn" onClick={resetAttempt}>
                Play Again
              </button>
              <button className="mode-inline-btn" onClick={onBack}>
                Back to Home
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
