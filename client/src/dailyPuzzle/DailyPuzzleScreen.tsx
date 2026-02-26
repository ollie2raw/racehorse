import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import { Board, DominoTile } from '../components';
import { applyPlayMove, getDisplayOpenEnds, getLegalMoves } from '../bot/botEngine';
import type { Move, Tile } from '../types';
import {
  fetchDailyPuzzleLeaderboard,
  getDailyPuzzleForDate,
  getLocalDateKey,
  type DailyPuzzleLeaderboardEntry,
  upsertDailyPuzzleCompletion,
  upsertDailyPuzzleBestScore,
} from './api';
import { computeBestPossiblePuzzleScore, createPuzzleMatchState, validatePuzzle } from './validator';
import type { CuratedDailyPuzzle, PuzzleValidationResult } from './types';
import LayoutScreen from '../ui/LayoutScreen';
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

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function progressKey(dateSeed: string): string {
  return `dailyPuzzle:${dateSeed}`;
}

function readProgress(dateSeed: string): DailyProgress {
  if (typeof window === 'undefined') {
    return { attempts: 0, bestMoves: null, lastResult: null };
  }
  try {
    const raw = window.localStorage.getItem(progressKey(dateSeed));
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

function writeProgress(dateSeed: string, progress: DailyProgress): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(progressKey(dateSeed), JSON.stringify(progress));
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
  if (!streak.lastCompletedDate || streak.currentStreak <= 0) return 1;
  const dayDiff = diffLocalCalendarDays(streak.lastCompletedDate, todayDateKey);
  if (dayDiff === null) return Math.max(1, streak.currentStreak);
  if (dayDiff <= 1) return Math.max(1, streak.currentStreak);
  return 1;
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

export default function DailyPuzzleScreen({
  user,
  profile,
  onBack,
}: DailyPuzzleScreenProps) {
  const localDateKey = useMemo(() => getLocalDateKey(), []);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [puzzle, setPuzzle] = useState<CuratedDailyPuzzle | null>(null);
  const [validation, setValidation] = useState<PuzzleValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<PlayStatus>('IN_PROGRESS');
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [movesUsed, setMovesUsed] = useState(0);
  const [_lastMovePoints, setLastMovePoints] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const runningScoreRef = useRef(0);
  const [_statusMessage, setStatusMessage] = useState('');
  const [_attempts, setAttempts] = useState(0);
  const [_bestMoves, setBestMoves] = useState<number | null>(null);
  const [showLobby, setShowLobby] = useState(true);
  const [dailyLeaderboardOpen, setDailyLeaderboardOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<DailyPuzzleLeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [handTileSize, setHandTileSize] = useState(56);
  const [handCompactStacked, setHandCompactStacked] = useState(false);
  const [streakDays, setStreakDays] = useState(1);
  const startTimeRef = useRef<number>(0);
  const submittedRef = useRef(false);
  const solvedConfettiFiredRef = useRef(false);

  const refreshLeaderboard = useCallback(async (puzzleDate: string) => {
    setLeaderboardLoading(true);
    try {
      const rows = await fetchDailyPuzzleLeaderboard(puzzleDate, 20);
      setLeaderboard(rows);
    } catch {
      setLeaderboard([]);
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  const { match, matchError } = useMemo(() => {
    if (!puzzle) return { match: null, matchError: null as string | null };
    try {
      return { match: createPuzzleMatchState(puzzle), matchError: null as string | null };
    } catch (err) {
      return {
        match: null,
        matchError: err instanceof Error ? err.message : 'Invalid puzzle board configuration.',
      };
    }
  }, [puzzle]);
  const [runtimeState, setRuntimeState] = useState(match);
  const bestPossibleScore = useMemo(() => {
    if (!puzzle) return 0;
    return computeBestPossiblePuzzleScore(puzzle);
  }, [puzzle]);

  useEffect(() => {
    setRuntimeState(match);
  }, [match]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setShowLobby(true);
      try {
        // eslint-disable-next-line no-console
        console.log('[DailyPuzzle] loading', { localDateKey, timezone });
        const today = await getDailyPuzzleForDate(new Date());
        if (!active) return;
        if (!today) {
          setPuzzle(null);
          setValidation(null);
          setLoading(false);
          return;
        }

        const check = today.puzzleType === 'reach_target' ? validatePuzzle(today) : null;
        setPuzzle(today);
        setValidation(check);
        setStatus('IN_PROGRESS');
        setSelectedTile(null);
        setMovesUsed(0);
        setLastMovePoints(0);
        setFinalScore(null);
        runningScoreRef.current = 0;
        setStatusMessage(
          today.puzzleType === 'one_turn_high_score'
            ? 'Running score: 0 — keep playing'
            : `Score Attack — Reach ${today.targetScore} in ${today.maxMoves} moves.`,
        );

        const progress = readProgress(today.puzzleDate);
        const nextAttempts = progress.attempts + 1;
        writeProgress(today.puzzleDate, { ...progress, attempts: nextAttempts });
        setAttempts(nextAttempts);
        setBestMoves(progress.bestMoves);

        if (active) {
          void refreshLeaderboard(today.puzzleDate);
        }
        setStreakDays(getDisplayStreak(today.puzzleDate));
      } catch (err) {
        if (!active) return;
        // eslint-disable-next-line no-console
        console.error('[DailyPuzzle] load error', { localDateKey, timezone, err });
        setLoadError(err instanceof Error ? err.message : 'Failed to load daily puzzle.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [localDateKey, timezone, refreshLeaderboard]);

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

    const progress = readProgress(puzzle.puzzleDate);
    const nextAttempts = progress.attempts + 1;
    writeProgress(puzzle.puzzleDate, { ...progress, attempts: nextAttempts });
    setAttempts(nextAttempts);
  };

  const finalizeResult = (
    nextStatus: PlayStatus,
    solvedMoves: number | null,
    finalScoreValue: number,
  ) => {
    if (!puzzle) return;
    const progress = readProgress(puzzle.puzzleDate);
    let resolvedStreak = streakDays;

    if (nextStatus === 'SOLVED' && solvedMoves !== null) {
      const nextStreak = recordSolvedStreak(puzzle.puzzleDate);
      setStreakDays(nextStreak);
      resolvedStreak = nextStreak;
      const nextBest =
        progress.bestMoves === null ? solvedMoves : Math.min(progress.bestMoves, solvedMoves);
      writeProgress(puzzle.puzzleDate, {
        ...progress,
        bestMoves: nextBest,
        lastResult: nextStatus,
      });
      setBestMoves(nextBest);
    } else {
      writeProgress(puzzle.puzzleDate, { ...progress, lastResult: nextStatus });
    }

    if (user && !submittedRef.current) {
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
          ? upsertDailyPuzzleCompletion({
              puzzleDate: puzzle.puzzleDate,
              userId: user.id,
              username: profile?.username ?? user.email?.split('@')[0] ?? 'Player',
              score: finalScoreValue,
              bestPossibleScore,
              perfect: finalScoreValue >= bestPossibleScore,
              currentStreak: resolvedStreak,
            }).catch((err) => {
              // eslint-disable-next-line no-console
              console.warn('[DailyPuzzle] completion upsert failed', err);
            })
          : Promise.resolve();

      void Promise.allSettled([bestScorePromise, completionPromise]).finally(() => {
        void refreshLeaderboard(puzzle.puzzleDate);
      });
    } else {
      void refreshLeaderboard(puzzle.puzzleDate);
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
    solvedConfettiFiredRef.current = true;
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.55 },
      colors: ['#2ecc8e', '#95f0ca', '#d8b56f', '#ffffff'],
    });
  }, [status]);

  if (loading) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        badge="Daily Puzzle"
        title="Today's Challenge"
        subtitle="Loading today's curated puzzle..."
        contentClassName="screen-shell"
      />
    );
  }

  if (loadError) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        badge="Daily Puzzle"
        title="Today's Challenge"
        subtitle="Unable to load today's puzzle."
        contentClassName="screen-shell"
      >
        <p className="auth-inline-error">{loadError}</p>
        <p className="lobby-server">Local date key: {localDateKey}</p>
        <p className="lobby-server">Timezone: {timezone}</p>
        <button className="mode-inline-btn" onClick={onBack}>
          Back to Home
        </button>
      </LayoutScreen>
    );
  }

  if (matchError) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        badge="Daily Puzzle"
        title="Today's Challenge"
        subtitle="Puzzle configuration issue."
        contentClassName="screen-shell"
      >
        <p className="auth-inline-error">{matchError}</p>
        <p className="lobby-server">Local date key: {localDateKey}</p>
        <p className="lobby-server">Timezone: {timezone}</p>
        <button className="mode-inline-btn" onClick={onBack}>
          Back to Home
        </button>
      </LayoutScreen>
    );
  }

  if (!puzzle || !runtimeState) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        badge="Daily Puzzle"
        title="Today's Challenge"
        subtitle="Today's puzzle is not posted yet."
        contentClassName="screen-shell"
      >
        <p className="lobby-server">Local date key: {localDateKey}</p>
        <p className="lobby-server">Timezone: {timezone}</p>
        <button className="mode-inline-btn" onClick={onBack}>
          Back to Home
        </button>
      </LayoutScreen>
    );
  }

  const solvableWarning = Boolean(validation && !validation.solvable);
  const isOneTurnHighScore = puzzle.puzzleType === 'one_turn_high_score';
  const formattedPuzzleDate = formatPuzzleDateLabel(puzzle.puzzleDate);
  const completedScore = isOneTurnHighScore
    ? (finalScore ?? runtimeState.players.you.score)
    : runtimeState.players.you.score;
  const completionRatio = bestPossibleScore > 0 ? completedScore / bestPossibleScore : 1;
  const completionMessage =
    completedScore >= bestPossibleScore
      ? { text: '🏆 Perfect!', color: '#d8b56f' }
      : completionRatio >= 0.8
        ? { text: '⭐ Great solve!', color: 'rgba(125, 241, 197, 0.95)' }
        : { text: 'Keep practicing!', color: 'rgba(232,245,240,0.85)' };
  const modalLeaderboard = leaderboard.slice(0, 20);
  const currentUserId = user?.id ?? null;
  const renderLeaderboardRows = (rows: DailyPuzzleLeaderboardEntry[]) => (
    <div className="daily-leaderboard-list">
      {rows.map((row, idx) => {
        const isCurrentUser = Boolean(currentUserId) && row.userId === currentUserId;
        const rankLabel = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        return (
          <div
            className={`daily-leaderboard-row ${isCurrentUser ? 'is-current-user' : ''}`}
            key={`${row.userId}-${idx}`}
          >
            <span className="daily-leaderboard-rank">{rankLabel}</span>
            <span className="daily-leaderboard-name">
              @{getDisplayName(row.username)}
              {isCurrentUser ? (
                <span className="daily-you-pill"> ← You</span>
              ) : null}
            </span>
            <span className="daily-leaderboard-stat">{row.bestScore}</span>
            <span className="daily-leaderboard-stat">{row.bestMovesUsed}</span>
          </div>
        );
      })}
    </div>
  );

  if (showLobby) {
    return (
      <>
        <LayoutScreen
          className="screen mode-home-screen mode-subpage-screen mode-accent-daily daily-entry-screen"
          badge="Daily Puzzle"
          title="Today&apos;s Challenge"
          subtitle="Score the most points you can in one turn."
          contentClassName="screen-shell"
        >
            <div className="daily-entry-meta-row">
              <p className="lobby-server mode-subtitle daily-entry-date">{formattedPuzzleDate}</p>
              <div className="daily-entry-streak-badge">
                🔥 {streakDays} day{streakDays === 1 ? '' : 's'} streak
              </div>
            </div>
            <div className="daily-entry-panel">
              <div className="mode-actions daily-entry-actions">
                <button
                  className="mode-option mode-option-primary mode-accent-daily daily-start-hero"
                  onClick={() => {
                    startTimeRef.current = Date.now();
                    setDailyLeaderboardOpen(false);
                    setShowLobby(false);
                  }}
                >
                  <span className="mode-option-title">▶ Start Today&apos;s Puzzle</span>
                </button>
                <button
                  className="mode-option mode-option-secondary daily-leaderboard-cta"
                  onClick={() => setDailyLeaderboardOpen(true)}
                >
                  <span className="mode-option-title">🏆 Leaderboard</span>
                  <span className="mode-option-meta">See today&apos;s top scores</span>
                </button>
                <button className="mode-option mode-option-secondary daily-entry-back-link" onClick={onBack}>
                  <span className="mode-option-title">← Back to Home</span>
                </button>
              </div>
            </div>
        </LayoutScreen>
        {dailyLeaderboardOpen && (
          <div
            className="daily-puzzle-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Today's leaderboard"
            onClick={() => setDailyLeaderboardOpen(false)}
          >
            <div className="daily-puzzle-modal daily-leaderboard-modal" onClick={(e) => e.stopPropagation()}>
              <div className="daily-leaderboard-modal-head">
                <div style={{ display: 'grid', gap: 4 }}>
                  <h3>Today&apos;s Leaderboard</h3>
                  <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>
                    {formattedPuzzleDate} · Best score then fewest moves
                  </p>
                </div>
                <button className="mode-inline-btn" onClick={() => setDailyLeaderboardOpen(false)}>
                  Close
                </button>
              </div>
              <div className="daily-leaderboard-panel daily-leaderboard-panel-modal daily-leaderboard-modal-body">
                <div className="daily-leaderboard-head" aria-hidden="true">
                  <span>Rank</span>
                  <span>Player</span>
                  <span>Points</span>
                  <span>Tiles Used</span>
                </div>
                {leaderboardLoading && (
                  <p className="daily-leaderboard-loading">
                    <span className="daily-inline-spinner" aria-hidden="true" />
                    Loading leaderboard...
                  </p>
                )}
                {!leaderboardLoading && leaderboard.length === 0 && (
                  <p className="daily-leaderboard-empty">🏆 No scores yet today — be the first!</p>
                )}
                {!leaderboardLoading && leaderboard.length > 0 && renderLeaderboardRows(leaderboard)}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="screen game-screen walnut-live theme-green daily-puzzle-screen">
      <div className="wl-top-rail daily-top-rail" data-ui="hud">
        <div className="wl-player-pill is-active daily-hud-pill">
          <span className="wl-player-label">Daily Puzzle</span>
          <span className="wl-player-score">{runtimeState.players.you.score}</span>
        </div>
        <div className="daily-center-zone">
          <div className="wl-center-status">
            <span className="wl-turn-label your-turn">DAILY PUZZLE</span>
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
