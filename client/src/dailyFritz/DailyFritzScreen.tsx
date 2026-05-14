import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { GhostProfileSummary } from '../ghost/api';
import type { AppMode } from '../types';
import BotMatchScreen from '../bot/BotMatchScreen';
import LeaderboardPageShell, { type LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';
import DailyFritzLeaderboard from './DailyFritzLeaderboard';
import { GlobalNav } from '../components';
import { Button } from '../components/primitives';
import '../screens/RacehorseHomeArt.css';

import {
  buildDailyFritzCompletionHash,
  completeDailyFritz,
  fetchDailyFritzLeaderboard,
  getTodayDailyFritz,
  recordDailyFritzGame,
  startDailyFritz,
  type DailyFritzLeaderboardRow,
  type DailyFritzSetGameNumber,
  type DailyFritzSetGameResult,
  type DailyFritzSetResult,
  type DailyFritzStartResponse,
  type DailyFritzTodayResponse,
} from './api';
import dailyFritzHeroPng from '../assets/dailyFritz/dailyfritzimage2.png';
import './dailyFritz.css';

/* Same marks as Play vs Fritz left-panel badges (compact header icons). */
const DfPvfIconLightning = ({ color = 'var(--tier-elite)' }: { color?: string }) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M13 3L5 14H12L11 21L19 10H12L13 3Z" fill={color} />
  </svg>
);

const DfPvfIconRobotNav = ({ color = 'var(--tier-elite)' }: { color?: string }) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <rect x="4" y="7.5" width="16" height="11.5" rx="2.5" stroke={color} strokeWidth="1.7" />
    <circle cx="9" cy="12.5" r="1.6" fill={color} />
    <circle cx="15" cy="12.5" r="1.6" fill={color} />
    <path d="M9.5 16h5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 7.5V5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="12" cy="4.2" r="1.2" fill={color} />
  </svg>
);

const DfPvfIconCrown = ({ color = 'var(--tier-elite)' }: { color?: string }) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"
      fill={color}
    />
  </svg>
);

interface OverlayTrackerItem {
  gameNumber: DailyFritzSetGameNumber;
  label: string;
  tone: BetweenGameTrackerTone;
}

interface OverlayGameItem {
  gameNumber: DailyFritzSetGameNumber;
  value: string;
  tone: 'win' | 'loss';
}

const DAILY_FRITZ_TODAY_CACHE_PREFIX = 'racehorse:daily-fritz:today:';
const DAILY_FRITZ_SET_VERSION = 2;

interface DailyFritzScreenProps {
  user: User | null;
  profile: UserProfile | null;
  ghostProfile: GhostProfileSummary | null;
  onGhostProfileChange: (profile: GhostProfileSummary | null) => void;
  onProfileRefresh?: () => Promise<void> | void;
  onProfilePatch?: (patch: Partial<UserProfile>) => void;
  onOpenAuth: () => void;
  onOpenAccount?: () => void;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
}

type DailyFritzOverlayState =
  | {
      kind: 'saving';
      completedGame: DailyFritzSetGameResult;
      message: string;
    }
  | {
      kind: 'record-error';
      completedGame: DailyFritzSetGameResult;
      message: string;
      error: string;
      game: DailyFritzGameCompletionPayload;
    }
  | {
      kind: 'between';
      completedGame: DailyFritzSetGameResult;
      setResult: DailyFritzSetResult;
      nextGameNumber: DailyFritzSetGameNumber;
    }
  | {
      kind: 'finalizing';
      completedGame: DailyFritzSetGameResult;
      setResult: DailyFritzSetResult;
      message: string;
      currentHandIndex: number;
    }
  | {
      kind: 'final-error';
      completedGame: DailyFritzSetGameResult;
      setResult: DailyFritzSetResult;
      error: string;
      currentHandIndex: number;
    }
  | {
      kind: 'final';
      completedGame: DailyFritzSetGameResult;
      setResult: DailyFritzSetResult;
      rank: number | null;
      canViewLeaderboard: boolean;
    };

interface DailyFritzGameCompletionPayload {
  winner: 'you' | 'bot' | null;
  yourScore: number;
  botScore: number;
  movesUsed: number;
  handsPlayed: number;
  currentHandIndex: number;
  moveLog: unknown;
}

type BetweenGameTrackerTone = 'win' | 'loss' | 'next' | 'idle';

function formatDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatLeaderboardDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function titleCaseTier(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function tierDisplayLabel(tier: string): string {
  if (tier === 'elite') return 'Elite (1800)';
  return titleCaseTier(tier);
}

function getDailyFritzGameSeed(runDate: string, gameNumber: DailyFritzSetGameNumber): string {
  return `daily-fritz-${runDate}:game:${gameNumber}`;
}

function normalizeGameNumber(value: unknown, fallback: DailyFritzSetGameNumber = 1): DailyFritzSetGameNumber {
  const parsed = Number(value);
  return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : fallback;
}

function normalizeSetResult(value: unknown): DailyFritzSetResult | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (rec.version !== DAILY_FRITZ_SET_VERSION && rec.version !== 1) {
    // allow version 1 for legacy sets if they exist, but normally we want 2
  }
  if (rec.format !== 'best_of_3' || !Array.isArray(rec.games)) {
    return null;
  }
  const games = rec.games
    .map((game): DailyFritzSetGameResult | null => {
      if (!game || typeof game !== 'object') return null;
      const g = game as Record<string, unknown>;
      const gameNumber = Number(g.gameNumber) as DailyFritzSetGameNumber;
      if (gameNumber !== 1 && gameNumber !== 2 && gameNumber !== 3) return null;
      const seed = typeof g.seed === 'string' ? g.seed : '';
      const playerScore = Number(g.playerScore);
      const fritzScore = Number(g.fritzScore);
      const pointDiff = Number(g.pointDiff);
      const completedAt = typeof g.completedAt === 'string' ? g.completedAt : '';
      if (!seed || typeof g.playerWon !== 'boolean' || !Number.isFinite(playerScore) || !Number.isFinite(fritzScore) || !completedAt) {
        return null;
      }
      const movesUsed = g.movesUsed == null ? undefined : Number(g.movesUsed);
      const handsPlayed = g.handsPlayed == null ? undefined : Number(g.handsPlayed);
      return {
        gameNumber,
        seed,
        playerWon: g.playerWon,
        playerScore,
        fritzScore,
        pointDiff: Number.isFinite(pointDiff) ? pointDiff : playerScore - fritzScore,
        ...(Number.isFinite(movesUsed) ? { movesUsed } : {}),
        ...(Number.isFinite(handsPlayed) ? { handsPlayed } : {}),
        completedAt,
      };
    })
    .filter((game): game is DailyFritzSetGameResult => Boolean(game))
    .sort((a, b) => a.gameNumber - b.gameNumber);
  const playerGamesWon = games.filter((game) => game.playerWon).length;
  const fritzGamesWon = games.length - playerGamesWon;
  const totalPointDiff = games.reduce((sum, game) => sum + game.pointDiff, 0);
  const setWinner = playerGamesWon >= 2 ? 'player' : fritzGamesWon >= 2 ? 'fritz' : undefined;
  return {
    version: 2,
    format: 'best_of_3',
    playerGamesWon,
    fritzGamesWon,
    totalPointDiff,
    games,
    ...(setWinner ? { setWinner } : {}),
    ...(typeof rec.run_date === 'string' ? { run_date: rec.run_date } : {}),
    ...(typeof rec.won === 'boolean' ? { won: rec.won } : {}),
    ...(Number.isFinite(Number(rec.final_score)) ? { final_score: Number(rec.final_score) } : {}),
    ...(Number.isFinite(Number(rec.opponent_score)) ? { opponent_score: Number(rec.opponent_score) } : {}),
    ...(Number.isFinite(Number(rec.point_diff)) ? { point_diff: Number(rec.point_diff) } : {}),
    ...(Number.isFinite(Number(rec.moves_used)) ? { moves_used: Number(rec.moves_used) } : {}),
    ...(Number.isFinite(Number(rec.hands_played)) ? { hands_played: Number(rec.hands_played) } : {}),
  };
}

function getNextGameNumberFromSetResult(setResult: DailyFritzSetResult | null): DailyFritzSetGameNumber {
  if (!setResult || setResult.setWinner) return 1;
  return normalizeGameNumber(setResult.games.length + 1, 3);
}

function normalizeStartResponse(
  response: DailyFritzStartResponse,
  fallbackSetResult: DailyFritzSetResult | null,
): DailyFritzStartResponse {
  const setResult = normalizeSetResult(response.set_result) ?? fallbackSetResult;
  const currentGameNumber =
    response.needs_completion && setResult?.setWinner
      ? null
      : normalizeGameNumber(response.current_game_number, getNextGameNumberFromSetResult(setResult));
  const normalized = {
    ...response,
    current_game_number: currentGameNumber,
    set_result: setResult,
  };
  return normalized;
}

function formatMargin(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function getSetTrackerStatus(
  setResult: DailyFritzSetResult,
  gameNumber: DailyFritzSetGameNumber,
  nextGameNumber?: DailyFritzSetGameNumber | null,
): { label: string; tone: BetweenGameTrackerTone } {
  const completedGame = setResult.games.find((game) => game.gameNumber === gameNumber);
  if (completedGame) {
    return {
      label: completedGame.playerWon ? 'You won' : 'Fritz won',
      tone: completedGame.playerWon ? 'win' : 'loss',
    };
  }
  if (nextGameNumber === gameNumber) {
    return {
      label: gameNumber === 3 ? 'Decider' : 'Up next',
      tone: 'next',
    };
  }
  return {
    label: gameNumber === 3 && !setResult.setWinner ? 'If needed' : 'Not played',
    tone: 'idle',
  };
}

const DfLockIcon = () => (
  <svg className="df-game-lock" width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M7 11V8a5 5 0 0 1 10 0v3"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="12" cy="16" r="1.2" fill="currentColor" />
  </svg>
);

function getLosAngelesHms(now: Date): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { h: num('hour'), m: num('minute'), s: num('second') };
}

function secondsUntilNextPacificMidnight(now: Date): number {
  const { h, m, s } = getLosAngelesHms(now);
  const elapsed = h * 3600 + m * 60 + s;
  return Math.max(0, 86400 - elapsed);
}

function formatCountdownHms(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function DailyFritzLoadingScreen({ onBack }: { onBack: () => void }) {
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

      <div className="df-shell df-shell--loading df-shell--daily-fritz">
        <button type="button" className="df-back-btn df-back--ghost df-back--floating rh-back-button" onClick={onBack}>
          <span aria-hidden>←</span> Back to Single Player
        </button>
        <div className="df-page-head df-page-head--loading">
          <h1 className="df-title df-title--page">Preparing...</h1>
        </div>
      </div>
    </div>
  );
}

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
  const [loading, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<DailyFritzLeaderboardRow[]>([]);
  const [activeRun, setActiveRun] = useState<DailyFritzStartResponse | null>(null);
  const [setOverlay, setSetOverlay] = useState<DailyFritzOverlayState | null>(null);
  const [, setSetSubmitError] = useState<string | null>(null);
  const [startActionPending, setStartActionPending] = useState(false);
  const [countdownTick, setCountdownTick] = useState(0);
  const [peakDailyFritzStreak, setPeakDailyFritzStreak] = useState(0);

  const cacheKey = useMemo(
    () => (user?.id ? `${DAILY_FRITZ_TODAY_CACHE_PREFIX}${user.id}` : null),
    [user?.id],
  );
  const todayRef = useRef<DailyFritzTodayResponse | null>(today);
  const activeRunRef = useRef<DailyFritzStartResponse | null>(activeRun);

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

  useEffect(() => {
    if (!user?.id || !today) return;
    const key = `racehorse:daily-fritz:peak-streak:${user.id}`;
    let stored = 0;
    try {
      stored = Math.max(0, Number(window.localStorage.getItem(key) ?? '0'));
    } catch {
      /* noop */
    }
    const next = Math.max(stored, today.streak);
    if (next !== stored) {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        /* noop */
      }
    }
    setPeakDailyFritzStreak(next);
  }, [today, user?.id]);

  const loadToday = useCallback(async () => {
    const hadCachedToday = Boolean(todayRef.current);
    setLoading((prev) => !hadCachedToday && prev !== false ? true : !hadCachedToday);
    setError(null);
    try {
      const response = await getTodayDailyFritz();
      setToday(response);
      if (cacheKey && typeof window !== 'undefined') {
        window.sessionStorage.setItem(cacheKey, JSON.stringify(response));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Daily Fritz.');
    } finally {
      setLoading(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!user) {
      setToday(null);
      setLoading(false);
      setError('Sign in to play Daily Fritz.');
      return;
    }
    void loadToday();
  }, [loadToday, user]);

  const openLeaderboard = useCallback(async () => {
    if (!today?.run_date) return;
    setLeaderboardOpen(true);
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    try {
      const rows = await fetchDailyFritzLeaderboard(today.run_date);
      setLeaderboard(rows);
    } catch (err) {
      setLeaderboardError(err instanceof Error ? err.message : 'Failed to load leaderboard.');
      setLeaderboard([]);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [today?.run_date]);

  const openLeaderboardForRunDate = useCallback(async (runDate: string) => {
    setLeaderboardOpen(true);
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    try {
      const rows = await fetchDailyFritzLeaderboard(runDate);
      setLeaderboard(rows);
    } catch (err) {
      setLeaderboardError(err instanceof Error ? err.message : 'Failed to load leaderboard.');
      setLeaderboard([]);
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  const buildCompletedGame = useCallback((
    run: DailyFritzStartResponse,
    game: DailyFritzGameCompletionPayload,
    gameNumber: DailyFritzSetGameNumber,
  ): DailyFritzSetGameResult => ({
    gameNumber,
    seed: getDailyFritzGameSeed(run.run_date, gameNumber),
    playerWon: game.yourScore > game.botScore,
    playerScore: game.yourScore,
    fritzScore: game.botScore,
    pointDiff: game.yourScore - game.botScore,
    movesUsed: game.movesUsed,
    handsPlayed: game.handsPlayed,
    completedAt: new Date().toISOString(),
  }), []);

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

      setSetSubmitError(null);
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
      setError(null);
      return completion;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to finalize Daily Fritz set.';
      setSetSubmitError(message);
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
    setActiveRun(null);
    await loadToday();
  }, [loadToday]);

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
    setActiveRun(normalized);
  }, [buildCompletedGame, submitSetCompletion]);

  const beginRun = useCallback(async () => {
    if (startActionPending) return;
    setStartActionPending(true);
    setError(null);
    setSetSubmitError(null);
    setSetOverlay(null);
    try {
      const started = await startDailyFritz();
      await handleStartResponse(started, normalizeSetResult(today?.set_result ?? today?.result));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Daily Fritz.');
    } finally {
      setStartActionPending(false);
    }
  }, [handleStartResponse, startActionPending, today]);

  const continueSet = useCallback(async () => {
    if (startActionPending) return;
    setStartActionPending(true);
    setError(null);
    setSetSubmitError(null);
    const fallbackSetResult =
      setOverlay != null && 'setResult' in setOverlay
        ? setOverlay.setResult
        : normalizeSetResult(today?.set_result ?? today?.result);
    try {
      const started = await startDailyFritz();
      setSetOverlay(null);
      await handleStartResponse(started, fallbackSetResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue Daily Fritz.');
    } finally {
      setStartActionPending(false);
    }
  }, [handleStartResponse, setOverlay, startActionPending, today]);

  const submitCompletedGame = useCallback(async (game: DailyFritzGameCompletionPayload) => {
    const run = activeRunRef.current;
    if (!run) return;
    const gameNumber = normalizeGameNumber(run.current_game_number);
    const fallbackCompletedGame = buildCompletedGame(run, game, gameNumber);
    setSetSubmitError(null);
    setError(null);
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

      setActiveRun((current) =>
        current
          ? {
              ...current,
              set_result: setResult,
            }
          : current,
      );

      if (setResult.setWinner) {
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
      setSetSubmitError(message);
      setSetOverlay({
        kind: 'record-error',
        completedGame: fallbackCompletedGame,
        message: `Game ${gameNumber} is finished, but the result has not been saved yet.`,
        error: message,
        game,
      });
    }
  }, [buildCompletedGame, submitSetCompletion]);

  const handleDailyFritzGameComplete = useCallback(async (game: DailyFritzGameCompletionPayload) => {
    await submitCompletedGame(game);
  }, [submitCompletedGame]);

  const currentUsername = profile?.username?.trim() ?? null;
  const todaySetResult = useMemo(
    () => normalizeSetResult(today?.set_result ?? today?.result),
    [today],
  );

  const leaderboardSummaryCards = useMemo<LeaderboardSummaryCard[]>(() => {
    const currentLeaderboardRow = leaderboard.find(r => r.is_current_user || (currentUsername && r.username.toLowerCase() === currentUsername.toLowerCase()));
    const rankValue = currentLeaderboardRow?.rank != null ? `#${currentLeaderboardRow.rank}` : today?.rank != null ? `#${today.rank}` : '—';
    if (rankValue === '—') return [];
    
    const scoreValue = currentLeaderboardRow ? `${currentLeaderboardRow.finalScore}–${currentLeaderboardRow.opponentScore}` : todaySetResult ? `${todaySetResult.playerGamesWon}–${todaySetResult.fritzGamesWon}` : '—';
    const diffValue = currentLeaderboardRow ? `${currentLeaderboardRow.pointDiff >= 0 ? '+' : ''}${currentLeaderboardRow.pointDiff}` : todaySetResult ? formatMargin(todaySetResult.totalPointDiff) : '—';
    
    return [
      { label: 'Your Rank', value: rankValue, sublabel: 'Where you finished today', tone: 'accent', icon: 'rank' },
      { label: 'Set Score', value: scoreValue, sublabel: 'Games won in the set', tone: 'neutral', icon: 'score' },
      { label: 'Set Margin', value: diffValue, sublabel: 'Total point margin', tone: 'neutral', icon: 'margin' },
    ];
  }, [leaderboard, currentUsername, today, todaySetResult]);

  const resetCountdownLabel = useMemo(
    () => formatCountdownHms(secondsUntilNextPacificMidnight(new Date())),
    [countdownTick],
  );

  const activeSetResult = useMemo(
    () => normalizeSetResult(activeRun?.set_result ?? null),
    [activeRun?.set_result],
  );
  const activeGameNumber = normalizeGameNumber(activeRun?.current_game_number, getNextGameNumberFromSetResult(activeSetResult));

  const dailyFritzPackageForMatch = useMemo((): DailyFritzStartResponse | null => {
    if (!activeRun) return null;
    return {
      ...activeRun,
      current_game_number: activeGameNumber,
      set_result: activeSetResult,
    };
  }, [activeRun, activeGameNumber, activeSetResult]);

  const setOverlayConfig = useMemo(() => {
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
      tracker: [] as OverlayTrackerItem[],
      games: [] as OverlayGameItem[],
      onPrimary: () => {},
      onSecondary: () => {},
    };

    if (setOverlay.kind === 'saving') {
      return {
        ...base,
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
        headline: 'Could not continue',
        subheadline: setOverlay.error,
        primaryLabel: 'Try again',
        primaryTone: 'default' as const,
        onPrimary: () => void submitCompletedGame(setOverlay.game),
        secondaryLabel: 'Return to Hub',
        onSecondary: () => {
          setSetOverlay(null);
          setActiveRun(null);
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
      return {
        ...base,
        headline: 'Posting set',
        subheadline: setOverlay.message,
        primaryLabel: 'Please wait…',
        primaryDisabled: true,
        gameScoreLabel: 'Set score',
        gameScoreValue: `${setOverlay.setResult.playerGamesWon}–${setOverlay.setResult.fritzGamesWon}`,
        setScoreValue: `${setOverlay.completedGame.playerScore}–${setOverlay.completedGame.fritzScore}`,
        marginValue: formatMargin(setOverlay.setResult.totalPointDiff),
        marginTone:
          setOverlay.setResult.totalPointDiff > 0 ? ('win' as const) : setOverlay.setResult.totalPointDiff < 0 ? ('loss' as const) : ('idle' as const),
      };
    }

    if (setOverlay.kind === 'final-error') {
      return {
        ...base,
        headline: 'Could not finalize',
        subheadline: setOverlay.error,
        primaryLabel: 'Return to Hub',
        onPrimary: () => {
          setSetOverlay(null);
          setActiveRun(null);
          void loadToday();
        },
        gameScoreLabel: 'Set score',
        gameScoreValue: `${setOverlay.setResult.playerGamesWon}–${setOverlay.setResult.fritzGamesWon}`,
        setScoreValue: `${setOverlay.completedGame.playerScore}–${setOverlay.completedGame.fritzScore}`,
        marginValue: formatMargin(setOverlay.setResult.totalPointDiff),
        marginTone: 'idle' as const,
      };
    }

    if (setOverlay.kind === 'between') {
      return {
        ...base,
        headline: `You take Game ${setOverlay.completedGame.gameNumber}`,
        subheadline: `The set is ${setOverlay.setResult.playerGamesWon}-${setOverlay.setResult.fritzGamesWon}`,
        primaryLabel: `Start Game ${setOverlay.nextGameNumber}`,
        onPrimary: () => void continueSet(),
        onSecondary: () => { setSetOverlay(null); setActiveRun(null); void loadToday(); },
        secondaryLabel: 'Return to Hub',
        tracker: [1, 2, 3].map(n => ({
          gameNumber: n as DailyFritzSetGameNumber,
          ...getSetTrackerStatus(setOverlay.setResult, n as DailyFritzSetGameNumber, setOverlay.nextGameNumber)
        }))
      };
    }

    if (setOverlay.kind === 'final') {
      return {
        ...base,
        kind: 'final' as const,
        headline: setOverlay.setResult.setWinner === 'player' ? 'You win the set!' : 'Fritz wins the set',
        subheadline: 'Today’s best-of-3 is complete.',
        primaryLabel: 'Return to Hub',
        onPrimary: () => { setSetOverlay(null); setActiveRun(null); void loadToday(); },
        onSecondary: () => {
          setSetOverlay(null);
          setActiveRun(null);
          void loadToday();
          const rd = activeRun?.run_date ?? setOverlay.setResult.run_date ?? today?.run_date ?? '';
          if (rd) void openLeaderboardForRunDate(rd);
        },
        secondaryLabel: setOverlay.canViewLeaderboard ? 'View Leaderboard' : null,
      };
    }

    return base;
  }, [setOverlay, continueSet, loadToday, today, activeRun, openLeaderboardForRunDate, submitCompletedGame]);

  if (activeRun) {
    return (
      <BotMatchScreen
        key={`${activeRun.attempt_id}:${activeGameNumber}`}
        onBack={() => { setActiveRun(null); void loadToday(); }}
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
    );
  }

  if (leaderboardOpen) {
    return (
      <LeaderboardPageShell
        mode="fritz"
        className="mode-subpage-screen mode-accent-daily-fritz"
        label="Daily Fritz"
        title="Leaderboard"
        subtitle={`${today ? formatLeaderboardDateLabel(today.run_date) : 'Today'} · Global ranking`}
        backLabel="Back to Daily Fritz"
        showLiveBadge={false}
        summaryCards={leaderboardSummaryCards}
        resultsLabel={`Global Results · ${leaderboard.length} ${leaderboard.length === 1 ? 'player' : 'players'}`}
        onClose={() => setLeaderboardOpen(false)}
      >
        <DailyFritzLeaderboard
          rows={leaderboard}
          loading={leaderboardLoading}
          error={leaderboardError}
          currentUsername={currentUsername}
          variant="page"
        />
      </LeaderboardPageShell>
    );
  }

  if (loading) {
    return <DailyFritzLoadingScreen onBack={onBack} />;
  }

  const dateLabel = today ? formatDateLabel(today.run_date) : '—';
  const tierLabel = today ? tierDisplayLabel(today.fritz_tier) : '—';
  const formatLabel = today ? 'Best-of-3' : '—';
  const streakLabel = today ? `${today.streak} days` : '0 days';
  const winTarget = today?.winning_score ?? 60;

  const isComplete = today?.attempt_status === 'completed';
  const isStarted = today?.attempt_status === 'started';

  const games = [1, 2, 3].map((n) => {
    const res = todaySetResult?.games.find((g) => g.gameNumber === n);
    const isNext = todaySetResult ? todaySetResult.games.length + 1 === n && !todaySetResult.setWinner : n === 1;

    const rowVariant = res ? 'done' : isNext ? 'active' : 'muted';
    const outcome = res ? (res.playerWon ? ('won' as const) : ('lost' as const)) : null;
    const isLocked = rowVariant === 'muted';

    let statusSub: string;
    let unlockHint: string | null = null;
    let showPlay = false;
    if (res) {
      statusSub = res.playerWon ? 'Won' : 'Lost';
    } else if (isNext) {
      statusSub = 'Ready to play';
      showPlay = !isComplete && !startActionPending;
    } else {
      statusSub = 'Locked';
      unlockHint = n === 2 ? 'Win game 1 to unlock' : 'Win game 2 to unlock';
    }

    const scoreLine = res ? `${res.playerScore}–${res.fritzScore}` : null;

    return {
      n,
      statusSub,
      unlockHint,
      showPlay,
      scoreLine,
      rowVariant,
      outcome,
      isLocked,
    };
  });

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
        activeColor="#E7B64A"
      />

      <div className="df-shell df-shell--daily-fritz">
        <button type="button" className="df-back-btn df-back--ghost df-back--floating rh-back-button" onClick={onBack}>
          <span aria-hidden>←</span> Back to Single Player
        </button>

        <div className="df-layout">
          <div className="df-left-col">
            <div className="df-hero-fullbleed">
              <img src={dailyFritzHeroPng} className="df-hero-fullbleed__img" alt="Fritz at the domino table" />
              <div className="df-hero-fullbleed__overlay" aria-hidden />
              <div className="df-hero-fullbleed__rim" aria-hidden />
              <div className="df-hero-fullbleed__copy">
                <div className="df-hero-kicker">• DAILY FRITZ</div>
                <h1 className="df-title df-title--page df-hero-title">Daily Fritz</h1>
                <p className="df-hero-subtitle">
                  Best-of-3 games. Same deal for everyone.
                  <br />
                  Beat Fritz today and climb the leaderboard.
                </p>
              </div>
              <div className="df-feature-bar" aria-label="Daily Fritz features">
                <div className="df-feature-bar__col">
                  <span className="df-feature-bar__icon" aria-hidden>
                    <DfPvfIconCrown color="var(--tier-elite)" />
                  </span>
                  <div className="df-feature-bar__text">
                    <span className="df-feature-bar__label">Rated Practice</span>
                    <span className="df-feature-bar__desc">Matches affect practice rating.</span>
                  </div>
                </div>
                <div className="df-feature-bar__col">
                  <span className="df-feature-bar__icon" aria-hidden>
                    <DfPvfIconLightning color="var(--tier-elite)" />
                  </span>
                  <div className="df-feature-bar__text">
                    <span className="df-feature-bar__label">Instant Match</span>
                    <span className="df-feature-bar__desc">Jump in and play right away.</span>
                  </div>
                </div>
                <div className="df-feature-bar__col">
                  <span className="df-feature-bar__icon" aria-hidden>
                    <DfPvfIconRobotNav color="var(--tier-elite)" />
                  </span>
                  <div className="df-feature-bar__text">
                    <span className="df-feature-bar__label">Bot Opponent</span>
                    <span className="df-feature-bar__desc">Consistent. Fair. Improving.</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="df-streak-card">
              <div className="df-streak-card__block df-streak-card__block--current">
                <span className="df-streak-card__crown" aria-hidden>
                  <DfPvfIconCrown color="var(--tier-elite)" />
                </span>
                <div className="df-streak-card__meta">
                  <span className="df-streak-card__key">Your Streak</span>
                  <span className="df-streak-card__value">{today ? `${today.streak} Days` : '—'}</span>
                </div>
              </div>
              <div className="df-streak-card__block df-streak-card__block--best">
                <span className="df-streak-card__key">Best Streak</span>
                <span className="df-streak-card__value">{today ? `${peakDailyFritzStreak} Days` : '—'}</span>
              </div>
              <div className="df-streak-card__block df-streak-card__block--copy">
                <p className="df-streak-card__gold-lead">Beat Today. Build Tomorrow.</p>
                <p className="df-streak-card__gold-line">New challenge every day at midnight.</p>
                <p className="df-streak-card__gold-line">Your streak, your legacy.</p>
              </div>
            </div>
          </div>

          <div className="df-control-panel">
            <div className="df-panel-surface">
              <div className="df-panel-body">
                <div className="df-section df-section--overview">
                  <div className="fritz-section-label">1. SET OVERVIEW</div>
                  <div className="df-overview-stats">
                    <div className="df-overview-stat">
                      <div className="df-overview-stat__icon fritz-summary-icon fritz-summary-icon--df-gold">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                      </div>
                      <div className="df-overview-stat__value">{dateLabel}</div>
                      <div className="df-overview-stat__key">Date</div>
                    </div>
                    <div className="df-overview-stat">
                      <div className="df-overview-stat__icon fritz-summary-icon fritz-summary-icon--df-gold">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                          <path
                            d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"
                            fill="currentColor"
                          />
                        </svg>
                      </div>
                      <div className="df-overview-stat__value">{tierLabel}</div>
                      <div className="df-overview-stat__key">Tier</div>
                    </div>
                    <div className="df-overview-stat">
                      <div className="df-overview-stat__icon fritz-summary-icon fritz-summary-icon--df-gold">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                          <path d="M8 6h12M6 12h12M4 18h12" />
                        </svg>
                      </div>
                      <div className="df-overview-stat__value">{formatLabel}</div>
                      <div className="df-overview-stat__key">Format</div>
                    </div>
                    <div className="df-overview-stat">
                      <div className="df-overview-stat__icon fritz-summary-icon fritz-summary-icon--df-gold">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.5 3.5 6.5 1 1.5 2 3 2 5a7 7 0 1 1-14 0c0-3 2.5-5 2.5-5s0 1 1 2.5z" />
                        </svg>
                      </div>
                      <div className="df-overview-stat__value">{streakLabel}</div>
                      <div className="df-overview-stat__key">Streak</div>
                    </div>
                  </div>
                </div>

                <div className="df-section df-section--games-spotlight">
                  <div className="fritz-section-label">2. BEST-OF-3 GAMES</div>
                  <div className="df-bof3-arena">
                    <div className="df-bof3-arena__chrome" aria-hidden />
                    <div className="df-bof3-arena__head">
                      <span className="df-bof3-arena__pulse" aria-hidden />
                      <span className="df-bof3-arena__tag">Live set</span>
                      <span className="df-bof3-arena__rule">
                        First to {winTarget} wins each game · win two for the match
                      </span>
                    </div>
                  <div className="df-bof3">
                    {games.map((game, idx) => (
                      <Fragment key={game.n}>
                        <div className="df-bof3__rail">
                          <span
                            className={[
                              'df-bof3__step',
                              game.rowVariant === 'active' && 'df-bof3__step--active',
                              game.outcome === 'won' && 'df-bof3__step--won',
                              game.outcome === 'lost' && 'df-bof3__step--lost',
                              game.isLocked && 'df-bof3__step--locked',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {game.n}
                          </span>
                          {idx < games.length - 1 ? <span className="df-bof3__connector" /> : null}
                        </div>
                        <div
                          className={[
                            'fritz-selectable-row',
                            'df-game-row',
                            'df-game-row--bof3',
                            'df-bof3-slot',
                            game.rowVariant === 'muted' && 'fritz-selectable-row--muted',
                            game.rowVariant === 'active' && 'fritz-selectable-row--active',
                            game.rowVariant === 'done' && 'fritz-selectable-row--done',
                            game.rowVariant === 'active' && 'df-game-row--bof3-active',
                            game.isLocked && 'df-game-row--locked',
                            game.outcome === 'won' ? 'df-game-row--player-won' : '',
                            game.outcome === 'lost' ? 'df-game-row--player-lost' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          data-game={game.n}
                        >
                          <div className="df-game-info">
                            <h4>
                              <span className="df-bof3-slot__game-label">Game {game.n}</span>
                            </h4>
                            <div
                              className={[
                                'df-game-status',
                                game.rowVariant === 'active' && !game.outcome ? 'df-game-status--gold' : '',
                                game.isLocked ? 'df-game-status--locked' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {game.statusSub}
                            </div>
                          </div>
                          {game.showPlay ? (
                            <Button
                              type="button"
                              variant="tier-elite"
                              size="sm"
                              className="df-game-play-btn df-bof3-play-btn"
                              disabled={startActionPending || isComplete}
                              onClick={() => void beginRun()}
                            >
                              Play
                            </Button>
                          ) : null}
                          {game.rowVariant === 'done' && game.scoreLine ? (
                            <div className="df-game-done-score df-bof3-done-pill">{game.scoreLine}</div>
                          ) : null}
                          {game.isLocked && game.unlockHint ? (
                            <>
                              <div className="df-game-unlock-hint df-bof3-unlock-hint">{game.unlockHint}</div>
                              <div className="df-game-lock-wrap df-bof3-lock" aria-hidden>
                                <DfLockIcon />
                              </div>
                            </>
                          ) : null}
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  </div>
                </div>
              </div>

              <div className="df-panel-footer">
                <Button
                  variant="tier-elite"
                  size="lg"
                  type="button"
                  className={['df-start-match-btn', !isComplete && !startActionPending && !isStarted ? 'df-start-match-btn--ready-pulse' : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => void beginRun()}
                  disabled={startActionPending || isComplete}
                >
                  {isComplete ? 'Set complete' : isStarted ? 'Resume Set' : 'Start Set'}
                  {!isComplete ? (
                    <span className="df-start-match-chevron" aria-hidden>
                      {' '}
                      ›
                    </span>
                  ) : null}
                </Button>
                <div className="df-reset-countdown">
                  <span className="df-reset-countdown__icon" aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span>
                    Resets in {resetCountdownLabel}
                  </span>
                </div>
                <Button type="button" variant="ghost" className="df-leaderboard-link" onClick={() => void openLeaderboard()}>
                  View Leaderboard →
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
