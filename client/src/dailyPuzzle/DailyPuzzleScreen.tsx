import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import '../match/match-live.css';
import {
  applyPlayMove,
  getLegalMoves,
  type BotMatchState,
} from '../bot/botEngine';
import type { Move, Tile } from '../types';
import { tileEquals } from '../game/tileUtils';
import {
  getDailyPuzzleByDateSeed,
  getDailyPuzzleForDate,
  getLocalDateKey,
  getTodayDailyPuzzleLadder,
  type DailyPuzzleLeaderboardEntry,
} from './api';
import {
  DAILY_PUZZLE_SLOT_COUNT,
  LEGACY_DAILY_PUZZLE_SLOT_COUNT,
  type CuratedDailyPuzzle,
  type DailyPuzzleTodayResponse,
  type PuzzleValidationResult,
} from './types';
import { getDisplayStreak } from './streakStorage';
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
import type { DailyPuzzleScreenProps, PlayStatus } from './dailyPuzzleScreenTypes';
import { DailyPuzzleLoadingScreen } from './DailyPuzzleLoadingScreen';
import { createPuzzleMatchState } from './validator';
import LayoutScreen from '../ui/LayoutScreen';
import LeaderboardPageShell from '../ui/LeaderboardPageShell';
import {
  ClaudePrimaryAction,
  ClaudeSecondaryAction,
  ClaudeSectionLabel,
  ClaudeStatLine,
} from '../ui/claudeMode';
import { useResponsiveHandTileSize } from './useResponsiveHandTileSize';
import { useDailyPuzzleValidatorWorker } from './useDailyPuzzleValidatorWorker';
import { useDailyPuzzleArchiveLeaderboard } from './useDailyPuzzleArchiveLeaderboard';
import { normalizeDateInputToLocalKey as normalizeArchiveDateInput } from './date';
import {
  evaluateOneTurnHighScoreMoveOutcome,
  evaluateTargetScoreMoveOutcome,
  isDominoDouble,
  shouldAutoFailOneTurnHighScoreWithNoLegalMoves,
} from './dailyPuzzlePlayMoveCompletion';
import { useDailyPuzzleLegacyGameplay } from './useDailyPuzzleLegacyGameplay';
import { resolveLegacyFinalizeSolvedMoves } from './dailyPuzzleLegacyResultSubmission';
import { DailyPuzzleLegacyInPlayView } from './DailyPuzzleLegacyInPlayView';
import './dailyPuzzle.css';

const LazyDailyPuzzleLadderScreen = lazy(() => import('./DailyPuzzleLadderScreen'));

export default function DailyPuzzleScreen({
  user,
  profile,
  initialView = 'hub',
  onLeaderboardClose,
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
  const [puzzle, setPuzzle] = useState<CuratedDailyPuzzle | null>(null);
  const [ladderToday, setLadderToday] = useState<DailyPuzzleTodayResponse | null>(null);
  const [ladderFetchNonce, setLadderFetchNonce] = useState(0);
  const [ladderStatusError, setLadderStatusError] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<
    'checking' | 'legacy' | 'ladder' | 'ladderPending' | 'ladderCheckError'
  >('checking');
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
  const [streakDays, setStreakDays] = useState(0);
  const [bestPossibleScore, setBestPossibleScore] = useState(0);
  const [runtimeState, setRuntimeState] = useState<BotMatchState | null>(null);
  const { handTileSize, handCompactStacked } = useResponsiveHandTileSize(runtimeState?.players.you.hand.length);
  const [runtimeInitError, setRuntimeInitError] = useState<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const solvedConfettiFiredRef = useRef(false);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const loadIdRef = useRef(0);
  const loadInFlightKeyRef = useRef<string | null>(null);
  const currentPuzzleDateRef = useRef<string | null>(null);
  const { requestValidationFromWorker, requestBestScoreFromWorker } = useDailyPuzzleValidatorWorker();
  const {
    selectedDateSeed,
    archiveDateInput,
    setArchiveDateInput,
    archivePickerOpen,
    setArchivePickerOpen,
    isArchiveMode,
    archiveInputHasCompleteDate,
    archiveDateDirty,
    archiveTargetIsToday,
    displayDateSeed,
    selectedPuzzleReady,
    applyArchiveDate,
    resetArchiveToToday,
    commitArchiveDateSelection,
    closeArchiveLeaderboardUi,
    dailyLeaderboardOpen,
    setDailyLeaderboardOpen,
    leaderboard,
    setLeaderboard,
    leaderboardLoading,
    refreshLeaderboard,
    leaderboardSummaryCards,
    modalLeaderboardPreview,
  } = useDailyPuzzleArchiveLeaderboard({
    localDateKey,
    userId: user?.id ?? null,
    puzzleDate: puzzle?.puzzleDate,
    showLobby,
    initialLeaderboardOpen: initialView === 'leaderboard',
  });
  const { resetSubmissionGuard, finalizeResult } = useDailyPuzzleLegacyGameplay({
    puzzle,
    isArchiveMode,
    user,
    profile,
    movesUsed,
    bestPossibleScore,
    streakDays,
    setStreakDays,
    startTimeRef,
    requestBestScoreFromWorker,
    refreshLeaderboard,
  });
  const lastPlayedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStartDateRef = useRef<string | null>(null);
  const formattedDisplayDate = formatPuzzleDateLabel(displayDateSeed);

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
        const publishedCount = todayResponse.slots.length;
        if (
          !todayResponse.legacySinglePuzzleDay
          && (publishedCount === DAILY_PUZZLE_SLOT_COUNT || publishedCount === LEGACY_DAILY_PUZZLE_SLOT_COUNT)
        ) {
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
    closeArchiveLeaderboardUi();
    setShowLobby(true);
    onBack();
  }, [closeArchiveLeaderboardUi, onBack]);

  useEffect(() => {
    currentPuzzleDateRef.current = puzzle?.puzzleDate ?? null;
  }, [puzzle]);

  useEffect(() => {
    if (entryMode === 'checking') return;
    if (entryMode === 'ladderPending' || entryMode === 'ladderCheckError') return;
    if (entryMode === 'ladder' && selectedDateSeed === localDateKey) {
      setLoading(false);
      return;
    }
    const loadKey = selectedDateSeed;
    if (loadInFlightKeyRef.current === loadKey) {
      return;
    }
    loadInFlightKeyRef.current = loadKey;
    const loadId = ++loadIdRef.current;
    let cancelled = false;

    const load = async () => {
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
        if (!hasCachedFallback) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load daily puzzle.');
        }
      } finally {
        // Always clear loading for the active request so overlay/click lock cannot stick.
        if (!cancelled && loadId === loadIdRef.current) {
          setLoading(false);
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

  const completedScoreForSummary = useMemo(() => {
    const isOneTurnHighScore = puzzle?.puzzleType === 'one_turn_high_score';
    const currentScore = runtimeState?.players.you.score ?? 0;
    return isOneTurnHighScore ? (finalScore ?? currentScore) : currentScore;
  }, [puzzle?.puzzleType, finalScore, runtimeState?.players.you.score]);

  const completionSummary = useMemo(() => {
    const completionRatio = bestPossibleScore > 0 ? completedScoreForSummary / bestPossibleScore : 1;
    const completionMessage =
      completedScoreForSummary >= bestPossibleScore
        ? { text: '🏆 Perfect!', color: 'var(--tier-elite)' }
        : completionRatio >= 0.8
          ? { text: '⭐ Great solve!', color: 'rgba(125, 241, 197, 0.95)' }
          : { text: 'Keep practicing!', color: 'rgba(232,245,240,0.85)' };
    return {
      completionMessage,
      modalLeaderboard: modalLeaderboardPreview,
    };
  }, [bestPossibleScore, completedScoreForSummary, modalLeaderboardPreview]);

  const resetAttempt = () => {
    if (!puzzle) return;
    const start = createPuzzleMatchState(puzzle);
    setRuntimeState(start);
    setStatus('IN_PROGRESS');
    setSelectedTile(null);
    setMovesUsed(0);
    setFinalScore(null);
    runningScoreRef.current = 0;
    resetSubmissionGuard();
    solvedConfettiFiredRef.current = false;
    startTimeRef.current = Date.now();

    if (!isArchiveMode) {
      const progress = readProgress(puzzle.puzzleDate, puzzle.puzzleType);
      const nextAttempts = progress.attempts + 1;
      writeProgress(puzzle.puzzleDate, puzzle.puzzleType, { ...progress, attempts: nextAttempts });
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
      const outcome = evaluateOneTurnHighScoreMoveOutcome({
        pointsAwarded,
        isDouble: isDominoDouble(move.tile!),
        priorRunningScore: runningScoreRef.current,
        nextCurrentPlayer: nextState.currentPlayer,
        upcomingPlayMovesCount: upcomingPlayMoves.length,
      });
      if (outcome.type === 'terminal') {
        runningScoreRef.current = outcome.runningScore;
        setFinalScore(outcome.runningScore);
        setStatus(outcome.status);
        finalizeResult(outcome.status, nextMoves, outcome.runningScore);
      } else {
        runningScoreRef.current = outcome.runningScore;
      }
      return;
    }

    const targetOutcome = evaluateTargetScoreMoveOutcome({
      totalScore,
      nextMoves,
      targetScore: puzzle.targetScore,
      maxMoves: puzzle.maxMoves,
      currentPlayer: nextState.currentPlayer,
      upcomingPlayMovesCount: upcomingPlayMoves.length,
    });
    if (targetOutcome.type === 'terminal') {
      setStatus(targetOutcome.status);
      finalizeResult(
        targetOutcome.status,
        resolveLegacyFinalizeSolvedMoves(targetOutcome.status, targetOutcome.nextMoves),
        targetOutcome.totalScore,
      );
    }
  };

  useEffect(() => {
    if (!puzzle || status !== 'IN_PROGRESS' || puzzle.puzzleType !== 'one_turn_high_score') return;
    if (showLobby) return;
    if (!shouldAutoFailOneTurnHighScoreWithNoLegalMoves(legalMoves.length)) return;
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
      colors: ['#2ecc8e', '#95f0ca', 'var(--tier-elite)', '#ffffff'],
    });
  }, [status, puzzle?.puzzleType, finalScore, runtimeState, bestPossibleScore]);

  const currentUserId = user?.id ?? null;

  if (entryMode === 'checking' && selectedDateSeed === localDateKey) {
    return <DailyPuzzleLoadingScreen onBack={handleBackHome} />;
  }

  if (entryMode === 'ladderCheckError' && selectedDateSeed === localDateKey) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen daily-puzzle-root"
        title={stableDailyTitle}
        subtitle="Could not confirm today’s ladder."
        contentClassName="screen-shell"
      >
        <p className="auth-inline-error" role="alert">{ladderStatusError ?? 'Unknown error.'}</p>
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
        className="screen lobby-screen mode-home-screen daily-puzzle-root"
        title="Today’s Puzzle Ladder is being prepared"
        subtitle="Three puzzles. Same boards for everyone."
        contentClassName="screen-shell"
      >
        <p style={{ color: 'rgba(232,245,240,0.88)', lineHeight: 1.5 }} role="alert">
          We couldn’t publish today’s full three-puzzle ladder yet. Please check back soon, or refresh in a few
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
          initialLeaderboardOpen={initialView === 'leaderboard'}
          onLeaderboardClose={onLeaderboardClose}
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
        className="screen lobby-screen mode-home-screen daily-puzzle-root"
        title={stableDailyTitle}
        subtitle={isArchiveMode ? 'Unable to load archived puzzle.' : "Unable to load today's puzzle."}
        contentClassName="screen-shell"
      >
        <p className="auth-inline-error" role="alert">{loadError}</p>
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
        className="screen lobby-screen mode-home-screen daily-puzzle-root"
        title={stableDailyTitle}
        subtitle={isArchiveMode ? 'No puzzle exists for that date.' : "Today's puzzle is not posted yet."}
        contentClassName="screen-shell"
      >
        <p className="lobby-server" role="alert">Local date key: {localDateKey}</p>
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
        onClose={() => {
          if (onLeaderboardClose) onLeaderboardClose();
          else setDailyLeaderboardOpen(false);
        }}
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
          <div className="daily-dash" style={{ ['--dash-accent' as string]: 'var(--tier-elite)' }}>

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
                    <ClaudeSectionLabel color="var(--tier-elite)">
                      {isArchiveMode ? 'Archive Details' : "Today’s Board"}
                    </ClaudeSectionLabel>
                    <ClaudeStatLine label="Date" value={formattedDisplayDate} />
                    <ClaudeStatLine label="Mode" value={isArchiveMode ? 'Archive' : 'Daily'} />
                    <ClaudeStatLine label="Format" value="One-turn high score" />
                    <ClaudeStatLine
                      label="Streak"
                      value={isArchiveMode ? 'Off' : `${streakDays} day${streakDays === 1 ? '' : 's'}`}
                      accent={isArchiveMode ? undefined : 'var(--tier-elite)'}
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
                    accent="var(--tier-elite)"
                    disabled={loading || (!archiveDateDirty && !selectedPuzzleReady)}
                    title={archiveTargetIsToday ? 'Start Daily Puzzle' : 'Play Archived Puzzle'}
                    meta={
                      archiveTargetIsToday
                        ? "Play today’s one-turn puzzle"
                        : 'Load and play this archived puzzle'
                    }
                    onClick={() => {
                      const nextDate = archiveInputHasCompleteDate
                        ? normalizeArchiveDateInput(archiveDateInput)
                        : selectedDateSeed;
                      if (nextDate !== selectedDateSeed) {
                        pendingStartDateRef.current = nextDate;
                        commitArchiveDateSelection(nextDate);
                        setLoadError(null);
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
                      onClick={() => {
                        if (onNavigate) onNavigate('dailyPuzzleLeaderboard');
                        else setDailyLeaderboardOpen(true);
                      }}
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
                      setLoadError(null);
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
                      setLoadError(null);
                      setArchivePickerOpen(false);
                    }}
                  >
                    Load Date
                  </button>
                  <button
                    type="button"
                    className="daily-archive-button daily-archive-button-secondary"
                    onClick={() => {
                      resetArchiveToToday();
                      setLoadError(null);
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

  if (!runtimeState) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen daily-puzzle-root"
        title={stableDailyTitle}
        subtitle="Preparing puzzle board..."
        contentClassName="screen-shell"
      />
    );
  }

  return (
    <DailyPuzzleLegacyInPlayView
      confettiCanvasRef={confettiCanvasRef}
      viewModel={{
        status,
        isArchiveMode,
        formattedPuzzleDate: formatPuzzleDateLabel(puzzle.puzzleDate),
        runtimeState,
        legalMoves,
        selectedTile,
        lastPlayedTile,
        handTileSize,
        handCompactStacked,
        playableTileKeys,
        solvableWarning: Boolean(validation && !validation.solvable),
        validation,
        completedScore: completedScoreForSummary,
        completionSummary,
        bestPossibleScore,
        movesUsed,
        streakDays,
        currentUserId,
      }}
      actions={{
        onPositionClick,
        onSelectTile: setSelectedTile,
        onResetAttempt: resetAttempt,
        onBack,
      }}
    />
  );
}
