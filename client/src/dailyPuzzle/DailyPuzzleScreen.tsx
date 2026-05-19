import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import { Board, BoneyardCountPill, BrandLogo, DominoTile, MatchNblBoardFrame, RotateOverlay } from '../components';
import {
  applyPlayMove,
  getDisplayOpenEnds,
  getLegalMoves,
  type BotMatchState,
} from '../bot/botEngine';
import type { AppMode, Move, Tile } from '../types';
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
import LayoutScreen from '../ui/LayoutScreen';
import LeaderboardPageShell, { type LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';
import {
  ClaudePrimaryAction,
  ClaudeSecondaryAction,
  ClaudeSectionLabel,
  ClaudeStatLine,
} from '../ui/claudeMode';
import DailyPuzzleLadderScreen from './DailyPuzzleLadderScreen';
import { getDailyPuzzleStepPresentation } from './presentation';
import './dailyPuzzle.css';

function DailyPuzzleLoadingScreen({ onBack }: { onBack: () => void }) {
  const loadingSteps = [1, 2, 3].map((slotIndex) => getDailyPuzzleStepPresentation(slotIndex));
  return (
    <div className="daily-puzzle-loading-root">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__texture" />
      </div>

      <div className="daily-puzzle-loading-shell">
        <nav className="daily-puzzle-loading-nav">
          <div className="daily-puzzle-loading-brand">
            <BrandLogo iconSize={32} showWordmark={true} />
          </div>
          <button type="button" className="loading-back-btn rh-back-button" onClick={onBack}>
            <span className="loading-back-icon">←</span>
            <span>Back to Home</span>
          </button>
        </nav>

        <main className="daily-puzzle-loading-main">
          <div className="loading-lockup">
            <div className="loading-eyebrow">
              <span className="blue-dot" />
              DAILY PUZZLE
            </div>
            <h1 className="loading-title">Preparing today’s ladder</h1>
            <p className="loading-subtitle">Three fixed puzzles. Same board for everyone.</p>

            <div className="loading-steps">
              {loadingSteps.map((step, index) => (
                <div key={step.shortLabel} style={{ display: 'contents' }}>
                  <div className="loading-step">
                    <div className={`loading-step-chip ${index === 0 ? 'is-active' : ''}`} />
                    <span className="loading-step-label">{`${step.title} · ${step.subtitle}`}</span>
                  </div>
                  {index < loadingSteps.length - 1 ? <div className="loading-step-connector" /> : null}
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

interface DailyPuzzleScreenProps {
  user: User | null;
  profile: UserProfile | null;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
}

type PlayStatus = 'IN_PROGRESS' | 'SOLVED' | 'FAILED';

interface DailyProgress {
  attempts: number;
  bestMoves: number | null;
  lastResult: PlayStatus | null;
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
      <DailyPuzzleLadderScreen
        user={user}
        profile={profile}
        initialToday={ladderToday}
        onBack={onBack}
        onNavigate={onNavigate}
        onOpenAuth={onOpenAuth}
        onOpenAccount={onOpenAccount}
      />
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
    <>
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green daily-puzzle-screen rh-standard-live-board">
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
            className="btn text compact daily-chip-control rh-back-button"
            onClick={onBack}
          >
            ← Back to Home
          </button>
        </div>
      </div>

      <div className="rh-live-studio-shell">
        <div className="rh-live-board-zone" data-ui="live-board-zone">
          <div className="wl-stage-shell">
            <MatchNblBoardFrame>
              {!runtimeState.gameOver && (
                <div className="rh-board-meta-bar rh-board-meta-bar--count-only" data-ui="board-meta">
                  <BoneyardCountPill count={runtimeState.boneyard.length} />
                </div>
              )}
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
            </MatchNblBoardFrame>
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
        </div>
      </div>

      {status !== 'IN_PROGRESS' && (
        <div className="rh-modal-overlay" role="dialog" aria-modal="true" style={{ ['--rh-accent-rgb' as string]: '240, 192, 64' }}>
          <div className="rh-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow" style={{ color: '#f0c040' }}>PUZZLE COMPLETE</div>
              <div className="rh-result__score">
                <span>{completedScore}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback" style={{ color: completionMessage.color }}>
                {completionMessage.text}
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
                {modalLeaderboard.map((row, idx) => {
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
