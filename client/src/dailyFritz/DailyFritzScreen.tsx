import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { GhostProfileSummary } from '../ghost/api';
import BotMatchScreen from '../bot/BotMatchScreen';
import LeaderboardPageShell, { type LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';
import DailyFritzLeaderboard from './DailyFritzLeaderboard';
import { BrandLogo, GlobalNav } from '../components';
import { Button } from '../components/primitives';
import '../screens/RacehorseHomeArt.css';
import fritzTilesArt from '../assets/home/fritzpngtiles.png';

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
import './dailyFritz.css';

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
  onBack: () => void;
  onNavigate?: (mode: string) => void;
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

function formatSetResultLabel(setResult: DailyFritzSetResult | null, legacyWon?: boolean | null): string {
  if (setResult?.setWinner) {
    const prefix = setResult.setWinner === 'player' ? 'Won set' : 'Lost set';
    return `${prefix} ${setResult.playerGamesWon}–${setResult.fritzGamesWon}`;
  }
  if (legacyWon != null) return legacyWon ? 'Win' : 'Loss';
  return '—';
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

const DOMINO_PIPS: Record<number, [number, number][]> = {
  0: [],
  1: [[12, 11]],
  2: [[5, 5], [19, 17]],
  3: [[5, 5], [12, 11], [19, 17]],
  4: [[5, 5], [19, 5], [5, 17], [19, 17]],
  5: [[5, 5], [19, 5], [12, 11], [5, 17], [19, 17]],
  6: [[5, 4], [19, 4], [5, 11], [19, 11], [5, 18], [19, 18]],
};

const GAME_DOMINO_CONFIGS: [number, number][] = [
  [5, 3],
  [4, 6],
  [2, 1],
];

function DominoTile({ index }: { index: number }) {
  const [top, bottom] = GAME_DOMINO_CONFIGS[index] ?? [0, 0];
  const topPips = DOMINO_PIPS[top] ?? [];
  const bottomPips = DOMINO_PIPS[bottom] ?? [];
  return (
    <svg viewBox="0 0 24 46" width="26" height="46" className="df-domino-tile">
      <rect x="0.75" y="0.75" width="22.5" height="44.5" rx="3.5" fill="#0c0a01" stroke="rgba(255,255,255,0.14)" strokeWidth="0.75" />
      <line x1="1.5" y1="23" x2="22.5" y2="23" stroke="rgba(255,255,255,0.1)" strokeWidth="0.75" />
      {topPips.map(([x, y], i) => (
        <circle key={`t${i}`} cx={x} cy={y} r="2" fill="rgba(255,255,255,0.75)" />
      ))}
      {bottomPips.map(([x, y], i) => (
        <circle key={`b${i}`} cx={x} cy={y + 23} r="2" fill="rgba(255,255,255,0.75)" />
      ))}
    </svg>
  );
}

function DailyFritzLoadingScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="df-page">
      <div className="df-container">
        <nav className="df-nav">
          <button type="button" className="df-back-btn" onClick={onBack}>← Back to Home</button>
        </nav>
        <header className="df-hero">
          <BrandLogo iconSize={32} showWordmark={true} />
          <h1 className="df-title" style={{ marginTop: '24px' }}>Preparing...</h1>
        </header>
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
  onBack,
  onNavigate,
}: DailyFritzScreenProps) {
  // Use onOpenAuth to avoid unused variable warning
  console.log('DailyFritzScreen: Auth available', !!onOpenAuth);

  const [today, setToday] = useState<DailyFritzTodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<DailyFritzLeaderboardRow[]>([]);
  const [activeRun, setActiveRun] = useState<DailyFritzStartResponse | null>(null);
  const [setOverlay, setSetOverlay] = useState<DailyFritzOverlayState | null>(null);
  const [setSubmitError, setSetSubmitError] = useState<string | null>(null);
  const [startActionPending, setStartActionPending] = useState(false);

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
        setResult.games.find((entry: any) => entry.gameNumber === gameNumber) ?? fallbackCompletedGame;

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
      if (nextGameNumber) {
        setSetOverlay({
          kind: 'between',
          completedGame,
          setResult,
          nextGameNumber: normalizeGameNumber(nextGameNumber, 2),
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

  const activeSetResult = normalizeSetResult(activeRun?.set_result ?? null);
  const activeGameNumber = normalizeGameNumber(activeRun?.current_game_number, getNextGameNumberFromSetResult(activeSetResult));

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
      tracker: [] as any[],
      games: [] as any[],
      onPrimary: () => {},
      onSecondary: () => {},
    };

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
  }, [setOverlay, continueSet, loadToday, today, activeRun, openLeaderboardForRunDate]);

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
        dailyFritzPackage={{ ...activeRun, current_game_number: activeGameNumber, set_result: activeSetResult }}
        dailyFritzSetOverlay={setOverlayConfig}
        onDailyFritzGameComplete={(result) => { void handleDailyFritzGameComplete(result); }}
        onDailyFritzComplete={() => { void finishEmbeddedRun(); }}
      />
    );
  }

  const handleDailyFritzGameComplete = async (game: DailyFritzGameCompletionPayload) => {
    await submitCompletedGame(game);
  };

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
  const formatLabel = today ? `Best-of-3 · ${today.deal_size}-tile` : '—';
  const streakLabel = today ? `${today.streak} days` : '0 days';

  const isComplete = today?.attempt_status === 'completed';
  const isStarted = today?.attempt_status === 'started';
  const isElite = today?.fritz_tier === 'elite';

  const games = [1, 2, 3].map(n => {
    const res = todaySetResult?.games.find(g => g.gameNumber === n);
    const isNext = todaySetResult ? (todaySetResult.games.length + 1 === n && !todaySetResult.setWinner) : (n === 1);
    const isMuted = todaySetResult ? (n > todaySetResult.games.length + 1 || !!todaySetResult.setWinner) : (n > 1);
    
    let barColor = 'var(--border-subtle)';
    if (n === 1) barColor = 'var(--tier-elite)';
    if (n === 2) barColor = 'var(--tier-rookie)';

    let status = 'Not played';
    let statusColor = 'var(--text-dim)';
    if (res) {
      status = res.playerWon ? 'Won' : 'Lost';
      statusColor = res.playerWon ? 'var(--tier-rookie)' : 'var(--accent-red)';
    } else if (isNext) {
      status = 'Ready';
      statusColor = 'var(--tier-elite)';
    } else if (n === 3) {
      status = 'If needed';
    }

    return {
      n,
      barColor,
      status,
      statusColor,
      formatText: res ? `Final: ${res.playerScore}–${res.fritzScore}` : (isNext ? `First to ${today?.winning_score ?? 7}` : 'Starts on set launch'),
      isMuted
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
        onNavigate={onNavigate as any}
        onOpenAuth={onOpenAuth}
        activeColor="var(--tier-elite)"
      />

      <div className="df-container">
        {/* ── Hero ── */}
        <header className="df-hero">
          <div className="df-hero-left">
            <button type="button" className="df-back-btn" onClick={onBack}>← Back to Home</button>

            <div className="df-kicker">
              <span className="df-kicker-dot" />
              <span className="df-kicker-text">DAILY FRITZ</span>
            </div>
            <h1 className="df-title">Daily Fritz</h1>
            <p className="df-subtitle">Best-of-3 set. Same deal for everyone.</p>
            <div className="df-hero-pill">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Today's set ready
            </div>
          </div>
          <img src={fritzTilesArt} alt="" className="df-hero-art" />
        </header>

        {/* ── Main Grid ── */}
        <main className="df-main-grid">

          {/* Left Column */}
          <div className="df-left-col">

            {/* Set Overview Card */}
            <div className="df-overview-card">
              <div className="df-overview-top">
                <div className="df-overview-icon-ring">
                  <svg viewBox="0 0 56 56" width="56" height="56">
                    <rect x="4" y="4" width="48" height="48" rx="7" fill="rgba(10,7,0,0.95)" stroke="rgba(231,182,74,0.35)" strokeWidth="1.5" />
                    <line x1="4" y1="30" x2="52" y2="30" stroke="rgba(231,182,74,0.2)" strokeWidth="1" />
                    <circle cx="17" cy="14" r="3.5" fill="rgba(231,182,74,0.75)" />
                    <circle cx="28" cy="14" r="3.5" fill="rgba(231,182,74,0.75)" />
                    <circle cx="39" cy="14" r="3.5" fill="rgba(231,182,74,0.75)" />
                    <circle cx="17" cy="22" r="3.5" fill="rgba(231,182,74,0.75)" />
                    <circle cx="28" cy="22" r="3.5" fill="rgba(231,182,74,0.75)" />
                    <circle cx="39" cy="22" r="3.5" fill="rgba(231,182,74,0.75)" />
                    <path d="M20 33 L40 42 L20 51 Z" fill="var(--tier-elite)" />
                  </svg>
                </div>
                <div className="df-overview-content">
                  <div className="df-overview-eyebrow">SET OVERVIEW</div>
                  <h2>{isComplete ? 'Set Complete' : isStarted ? 'In Progress' : 'Ready to begin'}</h2>
                  <p>Play today's best-of-3 against Fritz.<br />Win two games to take the set.</p>
                </div>
              </div>

              <div className="df-overview-divider" />

              <div className="df-stat-row">
                <div className="df-stat-item">
                  <svg viewBox="0 0 24 24" className="df-stat-icon" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  <div className="df-stat-info">
                    <div className="df-stat-label">DATE</div>
                    <div className="df-stat-value">{dateLabel}</div>
                  </div>
                </div>
                <div className="df-stat-item">
                  <svg viewBox="0 0 24 24" className="df-stat-icon tier" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
                  <div className="df-stat-info">
                    <div className="df-stat-label">TIER</div>
                    <div className="df-stat-value tier">{tierLabel}</div>
                  </div>
                </div>
                <div className="df-stat-item">
                  <svg viewBox="0 0 24 24" className="df-stat-icon" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                  <div className="df-stat-info">
                    <div className="df-stat-label">FORMAT</div>
                    <div className="df-stat-value">{formatLabel}</div>
                  </div>
                </div>
                <div className="df-stat-item">
                  <svg viewBox="0 0 24 24" className="df-stat-icon" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.5 3.5 6.5 1 1.5 2 3 2 5a7 7 0 1 1-14 0c0-3 2.5-5 2.5-5s0 1 1 2.5z" /></svg>
                  <div className="df-stat-info">
                    <div className="df-stat-label">STREAK</div>
                    <div className="df-stat-value">{streakLabel}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Row: Stats + CTA */}
            <div className="df-bottom-row">

              {/* Stats Panel */}
              <div className="df-stats-panel">
                <div className="df-big-stat">
                  <div className="df-big-stat-icon">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
                  </div>
                  <div className="df-big-stat-label">SET GOAL</div>
                  <div className="df-big-stat-value">Win 2 / 3</div>
                  <div className="df-big-stat-sub">Take two games to win today's set</div>
                </div>
                <div className="df-big-stat-divider" />
                <div className="df-big-stat">
                  <div className="df-big-stat-icon">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                  </div>
                  <div className="df-big-stat-label">TODAY'S DIFFICULTY</div>
                  <div className="df-big-stat-value">{isElite ? 'Elite' : titleCaseTier(today?.fritz_tier || 'standard')}</div>
                  <div className="df-big-stat-sub">1800 rated challenge</div>
                </div>
                <div className="df-big-stat-divider" />
                <div className="df-big-stat">
                  <div className="df-big-stat-icon">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                  </div>
                  <div className="df-big-stat-label">LEADERBOARD</div>
                  <div className="df-big-stat-value">{today?.rank ? `#${today.rank}` : '— — —'}</div>
                  <div className="df-big-stat-sub">See where you rank after completion</div>
                </div>
              </div>

              {/* CTA Panel */}
              <div className="df-cta-panel">
                <div className="df-cta-info">
                  <div className="df-cta-play-ring">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="var(--tier-elite)"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                  <div className="df-cta-text">
                    <div className="df-cta-heading">Start today's set</div>
                    <div className="df-cta-sub">Your result will post<br />after the set ends.</div>
                  </div>
                </div>
                <div className="df-cta-actions">
                  <Button
                    variant="tier-elite"
                    size="lg"
                    className="df-start-btn"
                    onClick={() => void beginRun()}
                    disabled={startActionPending || isComplete}
                  >
                    {isComplete ? 'Set Complete' : isStarted ? 'Resume Set' : 'Start Set'}
                  </Button>
                  <div className="df-leaderboard-link" onClick={() => void openLeaderboard()}>
                    View Leaderboard →
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column — Set Games */}
          <aside className="df-games-card">
            <div className="df-games-header">SET GAMES</div>
            {games.map((game, idx) => (
              <div key={game.n} className="df-game-row" style={{ opacity: game.isMuted ? 0.45 : 1 }}>
                <div className="df-accent-bar" style={{ background: game.barColor }} />
                <div className="df-game-info">
                  <h4>GAME {game.n}</h4>
                  <div className="df-game-status" style={{ color: game.statusColor }}>{game.status}</div>
                </div>
                <DominoTile index={idx} />
                <div className="df-game-right">
                  <div className="df-game-format">{game.formatText}</div>
                  <span className="df-game-chevron">›</span>
                </div>
              </div>
            ))}
          </aside>
        </main>

        {/* Info Row */}
        <div className="df-info-row">
          <div className="df-info-icon">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
          </div>
          <div className="df-info-content">
            <span className="df-info-title">How Daily Fritz works</span>
            <span>One attempt today. Same deal for everyone. Results post after the set is complete.</span>
          </div>
          <Button variant="tier-standard" size="sm" className="df-rules-btn">View rules ›</Button>
        </div>

        {/* Countdown */}
        <div className="df-countdown">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          <span>Today's set resets in 23:52:17</span>
        </div>

      </div>
    </div>
  );
}
