import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { GhostProfileSummary } from '../ghost/api';
import type { AppMode } from '../types';
import BotMatchScreen from '../bot/BotMatchScreen';
import { BrandLogo, GlobalNav } from '../components';
import { Button } from '../components/primitives';
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
import { getGameSkunkChipLabel, getSetSkunkBadge, getSkunkOverlayCopy, isDailyFritzSkunk } from './skunk';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';
import dailyFritzHeroPng from '../assets/dailyFritz/playvsfritzdone.png';
import './dailyFritz.css';

/* Same marks as Play vs Fritz left-panel badges (compact header icons). */
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

const DfIconCalendar = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="4" y="5" width="16" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M4 11h16" strokeLinecap="round" />
  </svg>
);

const DfIconSwords = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M4 20L9 15M15 9L20 4" strokeLinecap="round" />
    <path d="M14 4l6 6M4 14l6 6" strokeLinecap="round" />
  </svg>
);

const DfIconFlame = ({ color = 'var(--tier-elite)' }: { color?: string }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M12 22c4-2.5 6-6 6-10 0-3-1.5-5-3-6.5C13 4.5 12 2 12 2s-1 2.5-3 3.5C7.5 7 6 9 6 12c0 4 2 7.5 6 10z"
      stroke={color}
      strokeWidth="1.6"
      fill={color}
      fillOpacity="0.2"
    />
  </svg>
);

const DfIconGlobe = ({ color = 'var(--tier-elite)' }: { color?: string }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" />
    <path d="M3 12h18M12 3c2.5 2.8 4 6.2 4 9s-1.5 6.2-4 9M12 3c-2.5 2.8-4 6.2-4 9s1.5 6.2 4 9" stroke={color} strokeWidth="1.4" />
  </svg>
);

const DfIconTrophy = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M8 21h8M12 17v4M8 4h8v4a4 4 0 0 1-8 0V4z" strokeLinejoin="round" />
    <path d="M16 6h2a2 2 0 0 1 0 4h-2M8 6H6a2 2 0 0 0 0 4h2" strokeLinecap="round" />
  </svg>
);

const DfIconStar = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2.8l2.8 5.66 6.25.91-4.53 4.42 1.07 6.21L12 17.1l-5.59 2.9 1.07-6.21L2.95 9.37l6.25-.91L12 2.8z" />
  </svg>
);

const DfIconLock = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M7 11V8a5 5 0 0 1 10 0v3" strokeLinecap="round" />
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

const DfIconDomino = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    <rect x="7" y="3.5" width="10" height="17" rx="2.5" />
    <path d="M12 9v6" strokeLinecap="round" />
    <circle cx="10" cy="7" r="1" fill="currentColor" stroke="none" />
    <circle cx="14" cy="17" r="1" fill="currentColor" stroke="none" />
    <circle cx="14" cy="13" r="1" fill="currentColor" stroke="none" />
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
  playerScore: number;
  fritzScore: number;
  skunk?: boolean;
  skunkLabel?: string | null;
}

const DAILY_FRITZ_SET_VERSION = 2;
const DAILY_FRITZ_INIT_SLOW_MS = 10_000;

const DAILY_FRITZ_INIT_DEBUG =
  import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true';

type DailyFritzInitPhase = 'preparing' | 'still-preparing' | 'failed' | 'retrying' | 'ready';

function dfInitLog(event: string, payload?: Record<string, unknown>): void {
  if (DAILY_FRITZ_INIT_DEBUG) {
    console.log(`[daily-fritz:init] ${event}`, payload ?? {});
  }
}

function readTodayCache(cacheKey: string | null): DailyFritzTodayResponse | null {
  if (!cacheKey || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyFritzTodayResponse;
    if (!parsed || parsed.ok !== true || typeof parsed.run_date !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function shouldClearStaleClientState(
  cached: DailyFritzTodayResponse,
  server: DailyFritzTodayResponse,
): boolean {
  if (cached.run_date !== server.run_date) return true;
  if (cached.attempt_status === 'started' && server.attempt_status !== 'started') return true;
  if (cached.attempt_status === 'completed' && server.attempt_status === 'none') return true;
  return false;
}

function friendlyDailyFritzInitError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    const message = error.message.trim().toLowerCase();
    if (message.includes('unauthorized') || message.includes('sign in')) {
      return 'Please sign in again to play Daily Fritz.';
    }
    if (message.includes('timed out') || message.includes('longer than expected') || message.includes('waking')) {
      return 'The game server may be waking up.';
    }
    if (message.includes('failed to fetch') || message.includes('network')) {
      return 'Please try again.';
    }
  }
  return 'Please try again.';
}

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
type DailyFritzGameCardState = 'active' | 'won' | 'lost' | 'locked' | 'not-needed' | 'pending';

function formatDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'long',
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
  if (!Array.isArray(rec.games)) {
    return null;
  }
  const formatNorm =
    rec.format == null || rec.format === ''
      ? 'best_of_3'
      : String(rec.format).toLowerCase().replace(/-/g, '_');
  if (formatNorm !== 'best_of_3') {
    return null;
  }
  const games = rec.games
    .map((game): DailyFritzSetGameResult | null => {
      if (!game || typeof game !== 'object') return null;
      const g = game as Record<string, unknown>;
      const rawGameNumber = g.gameNumber ?? g.game_number;
      const gameNumber = Number(rawGameNumber) as DailyFritzSetGameNumber;
      if (gameNumber !== 1 && gameNumber !== 2 && gameNumber !== 3) return null;
      const seed = typeof g.seed === 'string' ? g.seed : '';
      const playerScore = Number(g.playerScore ?? g.player_score);
      const fritzScore = Number(g.fritzScore ?? g.fritz_score);
      const pointDiff = Number(g.pointDiff ?? g.point_diff);
      const completedAt =
        typeof g.completedAt === 'string' ? g.completedAt : typeof g.completed_at === 'string' ? g.completed_at : '';
      const rawWon = g.playerWon ?? g.player_won;
      const playerWonFromScores =
        Number.isFinite(playerScore) && Number.isFinite(fritzScore) && playerScore !== fritzScore
          ? playerScore > fritzScore
          : null;
      const playerWonFromFlag =
        typeof rawWon === 'boolean' ? rawWon : rawWon === 'true' || rawWon === 1 || rawWon === '1' ? true : rawWon === 'false' || rawWon === 0 || rawWon === '0' ? false : null;
      const playerWon = playerWonFromScores ?? playerWonFromFlag;
      if (!seed || playerWon === null || !Number.isFinite(playerScore) || !Number.isFinite(fritzScore) || !completedAt) {
        return null;
      }
      const movesUsed = g.movesUsed == null && g.moves_used == null ? undefined : Number(g.movesUsed ?? g.moves_used);
      const handsPlayed =
        g.handsPlayed == null && g.hands_played == null ? undefined : Number(g.handsPlayed ?? g.hands_played);
      const losingScore = playerWon ? fritzScore : playerScore;
      const skunk = g.skunk === true || isDailyFritzSkunk(losingScore);
      const skunkByRaw = g.skunkBy ?? g.skunk_by;
      const skunkBy =
        skunkByRaw === 'player' || skunkByRaw === 'fritz'
          ? skunkByRaw
          : skunk
            ? playerWon
              ? 'player'
              : 'fritz'
            : undefined;
      return {
        gameNumber,
        seed,
        playerWon,
        playerScore,
        fritzScore,
        pointDiff: Number.isFinite(pointDiff) ? pointDiff : playerScore - fritzScore,
        ...(Number.isFinite(movesUsed) ? { movesUsed } : {}),
        ...(Number.isFinite(handsPlayed) ? { handsPlayed } : {}),
        completedAt,
        ...(skunk ? { skunk: true } : {}),
        ...(skunkBy ? { skunkBy } : {}),
      };
    })
    .filter((game): game is DailyFritzSetGameResult => Boolean(game))
    .sort((a, b) => a.gameNumber - b.gameNumber);
  const totalPointDiff = games.reduce((sum, game) => sum + game.pointDiff, 0);
  const totalPointDiffSafe = Number.isFinite(totalPointDiff) ? totalPointDiff : 0;
  const instantSkunk = rec.instantSkunk === true || rec.instant_skunk === true;
  const hasSkunk =
    rec.hasSkunk === true || rec.has_skunk === true || games.some((game) => game.skunk);
  const skunkGameNumberRaw = rec.skunkGameNumber ?? rec.skunk_game_number;
  const skunkGameNumber =
    skunkGameNumberRaw === 1 || skunkGameNumberRaw === 2 || skunkGameNumberRaw === 3
      ? (skunkGameNumberRaw as DailyFritzSetGameNumber)
      : games.find((game) => game.skunk)?.gameNumber ?? null;
  const skunkByRaw = rec.skunkBy ?? rec.skunk_by;
  const skunkBy =
    skunkByRaw === 'player' || skunkByRaw === 'fritz'
      ? skunkByRaw
      : games.find((game) => game.skunkBy)?.skunkBy ?? null;
  const playedWins = games.filter((game) => game.playerWon).length;
  const playedLosses = games.length - playedWins;
  let setWinner: 'player' | 'fritz' | undefined =
    playedWins >= 2 ? 'player' : playedLosses >= 2 ? 'fritz' : undefined;
  if (rec.setWinner === 'player' || rec.setWinner === 'fritz') {
    setWinner = rec.setWinner;
  } else if (rec.set_winner === 'player' || rec.set_winner === 'fritz') {
    setWinner = rec.set_winner;
  }
  if (!setWinner && skunkGameNumber === 2 && games.length === 2 && playedWins === 1 && playedLosses === 1) {
    const skunkGame = games.find((game) => game.gameNumber === 2 && game.skunk);
    if (skunkGame) setWinner = skunkGame.playerWon ? 'player' : 'fritz';
  }
  const storedPlayerGamesWon = Number(rec.playerGamesWon ?? rec.player_games_won);
  const storedFritzGamesWon = Number(rec.fritzGamesWon ?? rec.fritz_games_won);
  const playerGamesWon =
    instantSkunk && setWinner === 'player'
      ? 2
      : instantSkunk && setWinner === 'fritz'
        ? 0
        : Number.isFinite(storedPlayerGamesWon)
          ? Math.round(storedPlayerGamesWon)
          : playedWins;
  const fritzGamesWon =
    instantSkunk && setWinner === 'fritz'
      ? 2
      : instantSkunk && setWinner === 'player'
        ? 0
        : Number.isFinite(storedFritzGamesWon)
          ? Math.round(storedFritzGamesWon)
          : playedLosses;
  return {
    version: 2,
    format: 'best_of_3',
    playerGamesWon,
    fritzGamesWon,
    totalPointDiff: totalPointDiffSafe,
    games,
    ...(setWinner ? { setWinner } : {}),
    ...(hasSkunk ? { hasSkunk: true } : {}),
    ...(instantSkunk ? { instantSkunk: true } : {}),
    ...(skunkGameNumber ? { skunkGameNumber } : {}),
    ...(skunkBy ? { skunkBy } : {}),
    ...(typeof rec.run_date === 'string' ? { run_date: rec.run_date } : {}),
    ...(typeof rec.won === 'boolean' ? { won: rec.won } : {}),
    ...(Number.isFinite(Number(rec.final_score)) ? { final_score: Number(rec.final_score) } : {}),
    ...(Number.isFinite(Number(rec.opponent_score)) ? { opponent_score: Number(rec.opponent_score) } : {}),
    ...(Number.isFinite(Number(rec.point_diff)) ? { point_diff: Number(rec.point_diff) } : {}),
    ...(Number.isFinite(Number(rec.moves_used)) ? { moves_used: Number(rec.moves_used) } : {}),
    ...(Number.isFinite(Number(rec.hands_played)) ? { hands_played: Number(rec.hands_played) } : {}),
  };
}

/** Normalize set payloads for interstitials; tolerates slightly invalid roots if `games` parses. */
function setResultForOverlay(raw: unknown): DailyFritzSetResult | null {
  const primary = normalizeSetResult(raw);
  if (primary) return primary;
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec.games)) return null;
  return normalizeSetResult({
    version: 2,
    format: 'best_of_3',
    games: rec.games,
  });
}

function getNextGameNumberFromSetResult(setResult: DailyFritzSetResult | null): DailyFritzSetGameNumber {
  if (!setResult || setResult.setWinner) return 1;
  return normalizeGameNumber(setResult.games.length + 1, 3);
}

/**
 * Current game slot (1–3) from recorded games + server hint.
 * `current_game_number` can stay stale after we merge only `set_result` into `activeRun`; prefer the next
 * game implied by `games.length + 1` while the set is still live.
 */
function resolveDailyFritzCurrentGameNumber(
  setResult: DailyFritzSetResult | null | undefined,
  reportedCurrent: unknown,
): DailyFritzSetGameNumber {
  if (!setResult || setResult.setWinner) {
    return normalizeGameNumber(reportedCurrent, 1);
  }
  const inferred = getNextGameNumberFromSetResult(setResult);
  const reported = normalizeGameNumber(reportedCurrent, inferred);
  return reported < inferred ? inferred : reported;
}

function normalizeStartResponse(
  response: DailyFritzStartResponse,
  fallbackSetResult: DailyFritzSetResult | null,
): DailyFritzStartResponse {
  const setResult = normalizeSetResult(response.set_result) ?? fallbackSetResult;
  const currentGameNumber =
    response.needs_completion && setResult?.setWinner
      ? null
      : resolveDailyFritzCurrentGameNumber(setResult, response.current_game_number);
  const normalized = {
    ...response,
    current_game_number: currentGameNumber,
    set_result: setResult,
  };
  return normalized;
}

function formatMargin(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value}`;
}

function getSetTrackerStatus(
  setResult: DailyFritzSetResult,
  gameNumber: DailyFritzSetGameNumber,
  nextGameNumber?: DailyFritzSetGameNumber | null,
): { label: string; tone: BetweenGameTrackerTone } {
  const completedGame = setResult.games.find((game) => game.gameNumber === gameNumber);
  if (completedGame) {
    const youWonGame = Number(completedGame.playerScore) > Number(completedGame.fritzScore);
    if (completedGame.skunk) {
      return {
        label: youWonGame ? 'Skunk' : 'Skunked',
        tone: youWonGame ? 'win' : 'loss',
      };
    }
    return {
      label: youWonGame ? 'You won' : 'Fritz won',
      tone: youWonGame ? 'win' : 'loss',
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

const DF_LOADING_STEPS = [
  { label: '1 Game one' },
  { label: '2 Game two' },
  { label: '3 Decider' },
] as const;

function DailyFritzLoadingScreen({
  phase,
  loadError,
  onBack,
  onRetry,
  retryPending,
}: {
  phase: Exclude<DailyFritzInitPhase, 'ready'>;
  loadError: string | null;
  onBack: () => void;
  onRetry: () => void;
  retryPending: boolean;
}) {
  const [activeStep, setActiveStep] = useState(0);
  const isFailed = phase === 'failed';
  const isSlow = phase === 'still-preparing';
  const isRetrying = phase === 'retrying';

  useEffect(() => {
    if (isFailed) return undefined;
    const timer = window.setInterval(() => {
      setActiveStep((prev) => (prev + 1) % DF_LOADING_STEPS.length);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [isFailed]);
  const title = isFailed
    ? 'Couldn’t load Daily Fritz'
    : isSlow || isRetrying
      ? 'Still preparing…'
      : 'Preparing today’s set';
  const subtitle = isFailed
    ? loadError ?? 'Please try again.'
    : isSlow || isRetrying
      ? 'The game server may be waking up.'
      : 'Best of 3 vs Fritz. Same deal for everyone.';
  const showRetry = isFailed || isSlow;
  const busy = !isFailed && phase !== 'still-preparing';

  return (
    <div className="df-fritz-loading-root">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__texture" />
      </div>

      <div className="df-fritz-loading-shell">
        <nav className="df-fritz-loading-nav">
          <div className="df-fritz-loading-brand">
            <BrandLogo iconSize={32} showWordmark={true} />
          </div>
          <button type="button" className="df-fritz-loading-back rh-back-button" onClick={onBack}>
            <span className="df-fritz-loading-back-icon">←</span>
            <span>Back to Single Player</span>
          </button>
        </nav>

        <main className="df-fritz-loading-main">
          <div
            className="df-fritz-loading-lockup"
            role="status"
            aria-live="polite"
            aria-busy={busy || retryPending}
          >
            <div className="df-fritz-loading-eyebrow">
              <span className="df-fritz-loading-dot" aria-hidden />
              DAILY FRITZ
            </div>
            <h1 className="df-fritz-loading-title">{title}</h1>
            <p className="df-fritz-loading-subtitle">{subtitle}</p>

            {!isFailed ? (
              <div className="df-fritz-loading-steps">
                {DF_LOADING_STEPS.map((step, index) => (
                  <Fragment key={step.label}>
                    {index > 0 ? <div className="df-fritz-loading-step-connector" aria-hidden /> : null}
                    <div className="df-fritz-loading-step">
                      <div
                        className={`df-fritz-loading-chip${activeStep === index ? ' is-active' : ''}`}
                      />
                      <span
                        className={`df-fritz-loading-step-label${activeStep === index ? ' is-active' : ''}`}
                      >
                        {step.label}
                      </span>
                    </div>
                  </Fragment>
                ))}
              </div>
            ) : null}

            {showRetry ? (
              <div className="df-fritz-loading-actions">
                <Button
                  type="button"
                  variant="tier-elite"
                  size="md"
                  className="df-fritz-loading-retry"
                  disabled={retryPending}
                  onClick={onRetry}
                >
                  {retryPending ? 'Retrying…' : 'Retry'}
                </Button>
              </div>
            ) : null}
          </div>
        </main>
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
  const [initPhase, setInitPhase] = useState<DailyFritzInitPhase>('preparing');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initRetryPending, setInitRetryPending] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<DailyFritzStartResponse | null>(null);
  const [setOverlay, setSetOverlay] = useState<DailyFritzOverlayState | null>(null);
  const [, setSetSubmitError] = useState<string | null>(null);
  const [startActionPending, setStartActionPending] = useState(false);
  const [countdownTick, setCountdownTick] = useState(0);

  const cacheKey = useMemo(
    () => (user?.id ? `${DAILY_FRITZ_TODAY_CACHE_PREFIX}${user.id}` : null),
    [user?.id],
  );
  const todayRef = useRef<DailyFritzTodayResponse | null>(today);
  const activeRunRef = useRef<DailyFritzStartResponse | null>(activeRun);
  const initRequestIdRef = useRef(0);
  const initInFlightRef = useRef(false);
  const initSlowTimerRef = useRef<number | null>(null);

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
      setHubError(null);
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
    setHubError(null);
    setSetSubmitError(null);
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
    setSetSubmitError(null);
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
    const gameNumber = getNextGameNumberFromSetResult(priorSet);
    const fallbackCompletedGame = buildCompletedGame(run, game, gameNumber);
    setSetSubmitError(null);
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
          setActiveRun(null);
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
        onSecondary: () => { setSetOverlay(null); setActiveRun(null); void loadToday(); },
        secondaryLabel: 'Return to Hub',
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
        setActiveRun(null);
        void loadToday();
      };
      const openLeaderboard = (): void => {
        setSetOverlay(null);
        setActiveRun(null);
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
      };
    }

    return base;
  }, [setOverlay, continueSet, loadToday, today, activeRun, profile?.glicko_rating, openLeaderboardForRunDate, submitCompletedGame]);

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
              <p className="df-pvf-subtitle">Best of 3. Same deal for everyone.</p>
            </div>

            <article className="df-pvf-opponent-card" aria-label="Daily Fritz overview">
              <img src={dailyFritzHeroPng} className="df-pvf-card-bg-img" alt="Fritz waiting at the domino table" />
              <div className="df-pvf-card-overlay" aria-hidden />

              <div className="df-pvf-card-content">
                <div className="df-pvf-card-header">
                  <div className="df-pvf-card-eyebrow">TODAY&apos;S OPPONENT</div>
                  <h2 className="df-pvf-card-name">Fritz</h2>
                  <p className="df-pvf-card-description">
                    Same set. No resets.
                    <br />
                    Beat Fritz today.
                  </p>
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

          <section className="df-pvf-control-panel" aria-label="Today's Set">
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
                    <DfIconDomino />
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
