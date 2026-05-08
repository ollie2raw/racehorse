import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { GhostProfileSummary } from '../ghost/api';
import BotMatchScreen from '../bot/BotMatchScreen';
import LeaderboardPageShell, { type LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';
import DailyFritzLeaderboard from './DailyFritzLeaderboard';
import {
  ClaudePrimaryAction,
  ClaudeSecondaryAction,
  ClaudeSectionLabel,
  ClaudeStatLine,
} from '../ui/claudeMode';
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
}

type DailyFritzOverlayState =
  | {
      kind: 'between';
      completedGame: DailyFritzSetGameResult;
      setResult: DailyFritzSetResult;
      nextGameNumber: DailyFritzSetGameNumber;
    }
  | {
      kind: 'final';
      completedGame: DailyFritzSetGameResult;
      setResult: DailyFritzSetResult;
      rank: number | null;
      canViewLeaderboard: boolean;
    };

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
  if (rec.version !== DAILY_FRITZ_SET_VERSION || rec.format !== 'best_of_3' || !Array.isArray(rec.games)) {
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
  const fallbackGameNumber = getNextGameNumberFromSetResult(setResult);
  const currentGameNumber = normalizeGameNumber(response.current_game_number, fallbackGameNumber);
  const normalized = {
    ...response,
    current_game_number: currentGameNumber,
    set_result: setResult,
  };
  console.debug('[daily-fritz-set] start response', {
    rawGameNumber: response.current_game_number ?? null,
    currentGameNumber,
    setResult,
  });
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

function getBetweenGameSubheadline(setResult: DailyFritzSetResult, nextGameNumber: DailyFritzSetGameNumber): string {
  if (setResult.playerGamesWon === 1 && setResult.fritzGamesWon === 0) {
    return 'You lead the set 1-0. Win Game 2 to close the set.';
  }
  if (setResult.playerGamesWon === 0 && setResult.fritzGamesWon === 1) {
    return 'Fritz leads the set 1-0. Win Game 2 to force a decider.';
  }
  if (setResult.playerGamesWon === 1 && setResult.fritzGamesWon === 1 && nextGameNumber === 3) {
    return 'The set is tied 1-1. One game decides today’s Fritz.';
  }
  if (setResult.playerGamesWon > setResult.fritzGamesWon) {
    return `You lead the set ${setResult.playerGamesWon}-${setResult.fritzGamesWon}.`;
  }
  if (setResult.fritzGamesWon > setResult.playerGamesWon) {
    return `Fritz leads the set ${setResult.fritzGamesWon}-${setResult.playerGamesWon}.`;
  }
  return `The set is tied ${setResult.playerGamesWon}-${setResult.fritzGamesWon}.`;
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

function getBetweenGameHeadline(
  completedGame: DailyFritzSetGameResult,
  setResult: DailyFritzSetResult,
  nextGameNumber: DailyFritzSetGameNumber,
): string {
  if (setResult.playerGamesWon === 1 && setResult.fritzGamesWon === 1 && nextGameNumber === 3) {
    return 'Game 3 Decides It';
  }
  return `${completedGame.playerWon ? 'You' : 'Fritz'} take${completedGame.playerWon ? '' : 's'} Game ${completedGame.gameNumber}`;
}

function getBetweenGameObjective(
  setResult: DailyFritzSetResult,
  nextGameNumber: DailyFritzSetGameNumber,
): string {
  if (setResult.playerGamesWon === 1 && setResult.fritzGamesWon === 0 && nextGameNumber === 2) {
    return 'Win Game 2 to finish the set.';
  }
  if (setResult.playerGamesWon === 0 && setResult.fritzGamesWon === 1 && nextGameNumber === 2) {
    return 'Win Game 2 to stay alive.';
  }
  if (setResult.playerGamesWon === 1 && setResult.fritzGamesWon === 1 && nextGameNumber === 3) {
    return 'Win the decider to claim today’s Fritz.';
  }
  return `Start Game ${nextGameNumber} when you are ready.`;
}

function getFinalOverlayHeadline(setResult: DailyFritzSetResult): string {
  if (setResult.setWinner === 'player') {
    return `You win the set ${setResult.playerGamesWon}-${setResult.fritzGamesWon}`;
  }
  return `Fritz wins the set ${setResult.fritzGamesWon}-${setResult.playerGamesWon}`;
}

function getFinalOverlaySubheadline(setResult: DailyFritzSetResult): string {
  const decidedInThree = setResult.games.length === 3;
  if (setResult.setWinner === 'player') {
    return decidedInThree
      ? 'You claimed the decider and beat Fritz today.'
      : 'Daily Fritz complete. You took today’s best-of-3.';
  }
  return decidedInThree
    ? 'Today’s best-of-3 is complete. You pushed it to a decider, but Fritz takes today’s set.'
    : 'Today’s best-of-3 is complete. Fritz takes the set.';
}

function getSetStatusLabel(today: DailyFritzTodayResponse | null): string {
  if (!today || today.attempt_status === 'none') return 'Not started';
  const setResult = normalizeSetResult(today.set_result ?? today.result);
  if (today.attempt_status === 'completed') {
    return `Complete: ${formatSetResultLabel(setResult, Boolean(today.result?.won))}`;
  }
  if (today.attempt_status === 'abandoned') return 'Attempt spent';
  if (!setResult || setResult.games.length === 0) return 'Game 1 in progress';
  if (setResult.playerGamesWon === setResult.fritzGamesWon) return `Tied ${setResult.playerGamesWon}-${setResult.fritzGamesWon}`;
  if (setResult.playerGamesWon > setResult.fritzGamesWon) return `You lead ${setResult.playerGamesWon}-${setResult.fritzGamesWon}`;
  return `Fritz leads ${setResult.fritzGamesWon}-${setResult.playerGamesWon}`;
}

function getPrimaryActionCopy(today: DailyFritzTodayResponse | null): { title: string; meta: string } {
  if (!today || today.attempt_status === 'none') {
    return { title: 'Start Set', meta: 'Begin today’s best-of-3' };
  }
  if (today.attempt_status === 'started') {
    const setResult = normalizeSetResult(today.set_result ?? today.result);
    const nextGame = Math.min((setResult?.games.length ?? 0) + 1, 3);
    if ((setResult?.games.length ?? 0) > 0) {
      return {
        title: nextGame === 3 ? 'Continue to Game 3' : `Continue to Game ${nextGame}`,
        meta: nextGame === 3 ? 'Play today’s decider' : 'Continue the set',
      };
    }
    return { title: 'Resume Set', meta: 'Pick up today’s best-of-3' };
  }
  if (today.attempt_status === 'completed') return { title: 'View Result', meta: 'Today’s set is complete' };
  return { title: 'Attempt Spent', meta: 'Come back tomorrow' };
}

function createMockDailyFritzRun(): DailyFritzStartResponse {
  return {
    ok: true,
    attempt_id: 'dev-attempt',
    verified_match_id: 'dev-match',
    run_date: '2026-04-17',
    current_hand_index: 0,
    current_game_number: 1,
    set_result: null,
    fritz_tier: 'standard',
    deal_size: 7,
    winning_score: 60,
    first_hand: {
      player_tiles: [
        { low: 6, high: 6 },
        { low: 4, high: 6 },
        { low: 1, high: 4 },
        { low: 0, high: 5 },
        { low: 2, high: 3 },
        { low: 1, high: 1 },
        { low: 0, high: 0 },
      ],
      fritz_tiles: [
        { low: 5, high: 5 },
        { low: 3, high: 5 },
        { low: 2, high: 5 },
        { low: 4, high: 4 },
        { low: 0, high: 4 },
        { low: 2, high: 2 },
        { low: 3, high: 6 },
      ],
      boneyard: [
        { low: 1, high: 6 },
        { low: 0, high: 6 },
        { low: 2, high: 6 },
        { low: 3, high: 3 },
        { low: 0, high: 3 },
        { low: 1, high: 5 },
        { low: 4, high: 5 },
        { low: 1, high: 2 },
        { low: 2, high: 4 },
        { low: 3, high: 4 },
        { low: 1, high: 3 },
        { low: 0, high: 1 },
        { low: 5, high: 6 },
        { low: 0, high: 2 },
      ],
      locked: [
        { low: 2, high: 2 },
        { low: 3, high: 3 },
      ],
    },
  };
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
}: DailyFritzScreenProps) {
  const mockDailyFritzEnabled =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.localStorage.getItem('DEV_MOCK_DAILY_FRITZ') === '1';
  const [today, setToday] = useState<DailyFritzTodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<DailyFritzLeaderboardRow[]>([]);
  const [activeRun, setActiveRun] = useState<DailyFritzStartResponse | null>(() =>
    mockDailyFritzEnabled ? createMockDailyFritzRun() : null,
  );
  const [setOverlay, setSetOverlay] = useState<DailyFritzOverlayState | null>(null);
  const [setSubmitError, setSetSubmitError] = useState<string | null>(null);

  const cacheKey = useMemo(
    () => (user?.id ? `${DAILY_FRITZ_TODAY_CACHE_PREFIX}${user.id}` : null),
    [user?.id],
  );
  const todayRef = useRef<DailyFritzTodayResponse | null>(today);

  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  useEffect(() => {
    if (!cacheKey || typeof window === 'undefined') return;
    try {
      const raw = window.sessionStorage.getItem(cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as DailyFritzTodayResponse | null;
      if (!parsed?.run_date) return;
      setToday(parsed);
      setLoading(false);
    } catch {
      // no-op
    }
  }, [cacheKey]);

  const loadToday = useCallback(async () => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
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
      const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      console.log('[daily-fritz-client] loadToday', {
        hadCachedToday,
        userId: user?.id ?? null,
        totalMs: Number((endedAt - startedAt).toFixed(1)),
      });
      setLoading(false);
    }
  }, [cacheKey, user?.id]);

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

  const beginRun = useCallback(async () => {
    setError(null);
    setSetSubmitError(null);
    setSetOverlay(null);
    try {
      const started = await startDailyFritz();
      const normalized = normalizeStartResponse(started, normalizeSetResult(today?.set_result ?? today?.result));
      console.debug('[daily-fritz-set] active run game number', normalized.current_game_number);
      setActiveRun(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Daily Fritz.');
    }
  }, [today]);

  const finishEmbeddedRun = useCallback(async () => {
    setActiveRun(null);
    await loadToday();
  }, [loadToday]);

  const continueSet = useCallback(async () => {
    setError(null);
    setSetSubmitError(null);
    const fallbackSetResult = setOverlay?.setResult ?? normalizeSetResult(today?.set_result ?? today?.result);
    try {
      const started = await startDailyFritz();
      const normalized = normalizeStartResponse(started, fallbackSetResult);
      console.debug('[daily-fritz-set] active run game number', normalized.current_game_number);
      setSetOverlay(null);
      setActiveRun(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue Daily Fritz.');
    }
  }, [setOverlay?.setResult, today]);

  const handleDailyFritzGameComplete = useCallback(async (game: {
    winner: 'you' | 'bot' | null;
    yourScore: number;
    botScore: number;
    movesUsed: number;
    handsPlayed: number;
    currentHandIndex: number;
    moveLog: unknown;
  }) => {
    if (!activeRun) return;
    if (game.yourScore === game.botScore) {
      setSetSubmitError('Daily Fritz games cannot finish tied.');
      setError('Daily Fritz games cannot finish tied.');
      setActiveRun(null);
      await loadToday();
      return;
    }
    const gameNumber = normalizeGameNumber(activeRun.current_game_number);
    setSetSubmitError(null);
    try {
      const recorded = await recordDailyFritzGame({
        attemptId: activeRun.attempt_id,
        verifiedMatchId: activeRun.verified_match_id,
        runDate: activeRun.run_date,
        gameNumber,
        playerScore: game.yourScore,
        fritzScore: game.botScore,
        movesUsed: game.movesUsed,
        handsPlayed: game.handsPlayed,
      });
      console.debug('[daily-fritz-set] record game response', recorded);
      const setResult = normalizeSetResult(recorded.set_result) ?? recorded.set_result;
      console.debug('[daily-fritz-set] normalized set result', setResult);
      const completedGame =
        setResult.games.find((entry) => entry.gameNumber === gameNumber) ??
        {
          gameNumber,
          seed: getDailyFritzGameSeed(activeRun.run_date, gameNumber),
          playerWon: game.yourScore > game.botScore,
          playerScore: game.yourScore,
          fritzScore: game.botScore,
          pointDiff: game.yourScore - game.botScore,
          movesUsed: game.movesUsed,
          handsPlayed: game.handsPlayed,
          completedAt: new Date().toISOString(),
        };

      if (setResult.setWinner) {
        const totalMoves = setResult.games.reduce((sum, entry) => sum + Number(entry.movesUsed ?? 0), 0);
        const totalHands = setResult.games.reduce((sum, entry) => sum + Number(entry.handsPlayed ?? 0), 0);
        const completionHash = await buildDailyFritzCompletionHash({
          runDate: activeRun.run_date,
          attemptId: activeRun.attempt_id,
          verifiedMatchId: activeRun.verified_match_id,
          currentHandIndex: game.currentHandIndex,
          finalScore: setResult.playerGamesWon,
          opponentScore: setResult.fritzGamesWon,
          won: setResult.setWinner === 'player',
          movesUsed: totalMoves,
          handsPlayed: totalHands,
          moveLog: setResult,
        });
        const completion = await completeDailyFritz({
          attemptId: activeRun.attempt_id,
          verifiedMatchId: activeRun.verified_match_id,
          runDate: activeRun.run_date,
          completionHash,
          finalScore: setResult.playerGamesWon,
          opponentScore: setResult.fritzGamesWon,
          won: setResult.setWinner === 'player',
          movesUsed: totalMoves,
          handsPlayed: totalHands,
          moveLog: setResult,
          setResult,
        });
        setSetOverlay({
          kind: 'final',
          completedGame,
          setResult,
          rank: completion.rank ?? null,
          canViewLeaderboard: completion.leaderboard_preview.length > 0,
        });
        setActiveRun((current) =>
          current
            ? {
                ...current,
                set_result: setResult,
              }
            : current,
        );
        return;
      }

      const nextGameNumber = recorded.next_game_number;
      if (nextGameNumber) {
        const nextBetweenGame: DailyFritzOverlayState = {
          kind: 'between',
          completedGame,
          setResult,
          nextGameNumber: normalizeGameNumber(nextGameNumber, 2),
        };
        console.debug('[daily-fritz-set] between game state', nextBetweenGame);
        setSetOverlay(nextBetweenGame);
        setActiveRun((current) =>
          current
            ? {
                ...current,
                set_result: setResult,
              }
            : current,
        );
        void loadToday();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save Daily Fritz set progress.';
      setSetSubmitError(message);
      setError(message);
      setActiveRun(null);
      await loadToday();
    }
  }, [activeRun, loadToday]);

  const currentUsername = profile?.username?.trim() ?? null;
  const todaySetResult = useMemo(
    () => normalizeSetResult(today?.set_result ?? today?.result),
    [today],
  );
  const currentLeaderboardRow = useMemo(
    () => {
      const explicitRow = leaderboard.find((row) =>
        Boolean(row.is_current_user) ||
        (currentUsername != null &&
          currentUsername.trim().length > 0 &&
          row.username.trim().toLowerCase() === currentUsername.trim().toLowerCase()),
      );
      if (explicitRow) return explicitRow;
      if (today?.rank != null) {
        const rankMatchedRow = leaderboard.find((row) => row.rank === today.rank);
        if (rankMatchedRow) return rankMatchedRow;
      }
      if (todaySetResult) {
        const scoreMatchedRow = leaderboard.find((row) =>
          row.finalScore === todaySetResult.playerGamesWon &&
          row.opponentScore === todaySetResult.fritzGamesWon &&
          row.pointDiff === todaySetResult.totalPointDiff,
        );
        if (scoreMatchedRow) return scoreMatchedRow;
      }
      return null;
    },
    [currentUsername, leaderboard, today?.rank, todaySetResult],
  );
  const leaderboardSummaryCards = useMemo<LeaderboardSummaryCard[]>(() => {
    const rankValue =
      currentLeaderboardRow?.rank != null
        ? `#${currentLeaderboardRow.rank}`
        : today?.rank != null
          ? `#${today.rank}`
          : '—';

    // If we don't have a rank, we haven't finished the run or it's not yet posted.
    // Per requirements, hide the summary strip if unavailable.
    if (rankValue === '—') return [];

    const scoreValue = currentLeaderboardRow
      ? `${currentLeaderboardRow.finalScore}–${currentLeaderboardRow.opponentScore}`
      : todaySetResult
        ? `${todaySetResult.playerGamesWon}–${todaySetResult.fritzGamesWon}`
      : today?.result
        ? `${Number(today.result.final_score ?? 0)}–${Number(today.result.opponent_score ?? 0)}`
        : '—';
    const diffValue = currentLeaderboardRow
      ? `${currentLeaderboardRow.pointDiff >= 0 ? '+' : ''}${currentLeaderboardRow.pointDiff}`
      : todaySetResult
        ? formatMargin(todaySetResult.totalPointDiff)
        : '—';
    const resultValue = currentLeaderboardRow
      ? currentLeaderboardRow.won
        ? `Won ${currentLeaderboardRow.finalScore}–${currentLeaderboardRow.opponentScore}`
        : `Lost ${currentLeaderboardRow.finalScore}–${currentLeaderboardRow.opponentScore}`
      : todaySetResult?.setWinner
        ? formatSetResultLabel(todaySetResult)
      : today?.result
        ? Boolean(today.result.won) ? 'Win' : 'Loss'
        : '—';
    const diffTone =
      currentLeaderboardRow == null
        ? 'neutral'
        : currentLeaderboardRow.pointDiff < 0
          ? 'danger'
          : currentLeaderboardRow.pointDiff > 0
            ? 'success'
            : 'neutral';
    const resultTone =
      currentLeaderboardRow == null && !today?.result
        ? 'neutral'
        : currentLeaderboardRow
          ? currentLeaderboardRow.won ? 'success' : 'danger'
          : Boolean(today?.result?.won)
            ? 'success'
            : 'danger';

    return [
      { label: 'Your Rank', value: rankValue, sublabel: 'Where you finished today', tone: 'accent', icon: 'rank' },
      { label: 'Set Score', value: scoreValue, sublabel: 'Games won in the set', tone: 'neutral', icon: 'score' },
      { label: 'Set Margin', value: diffValue, sublabel: 'Total point margin', tone: diffTone, icon: 'margin' },
      { label: 'Set Result', value: resultValue, sublabel: 'How your set finished', tone: resultTone, icon: 'result' },
    ];
  }, [currentLeaderboardRow, today, todaySetResult]);
  const showAuthPrompt =
    !loading &&
    Boolean(
      error &&
        (error.toLowerCase() === 'unauthorized' ||
          error.toLowerCase().includes('unauthorized')),
    );
  const activeSetResult = normalizeSetResult(activeRun?.set_result ?? null);
  const activeGameNumber = normalizeGameNumber(activeRun?.current_game_number, getNextGameNumberFromSetResult(activeSetResult));
  const setOverlayMarginTone: 'win' | 'loss' | 'idle' =
    setOverlay == null
      ? 'idle'
      : setOverlay.setResult.totalPointDiff > 0
        ? 'win'
        : setOverlay.setResult.totalPointDiff < 0
          ? 'loss'
          : 'idle';
  const setOverlayConfig = setOverlay
    ? setOverlay.kind === 'between'
      ? {
          kind: 'between' as const,
          eyebrow: 'Daily Fritz Set',
          headline: getBetweenGameHeadline(setOverlay.completedGame, setOverlay.setResult, setOverlay.nextGameNumber),
          subheadline: getBetweenGameSubheadline(setOverlay.setResult, setOverlay.nextGameNumber),
          objective: getBetweenGameObjective(setOverlay.setResult, setOverlay.nextGameNumber),
          nextLabel:
            setOverlay.nextGameNumber === 3
              ? null
              : `Game ${setOverlay.nextGameNumber} is up next`,
          primaryLabel: setOverlay.nextGameNumber === 3 ? 'Start Game 3' : `Start Game ${setOverlay.nextGameNumber}`,
          primaryTone: setOverlay.nextGameNumber === 3 ? 'decider' as const : 'default' as const,
          secondaryLabel: 'Return to Daily Fritz',
          onPrimary: () => void continueSet(),
          onSecondary: () => {
            setSetOverlay(null);
            setActiveRun(null);
            void loadToday();
          },
          gameScoreLabel: `Game ${setOverlay.completedGame.gameNumber} Score`,
          gameScoreValue: `You ${setOverlay.completedGame.playerScore} — Fritz ${setOverlay.completedGame.fritzScore}`,
          setScoreValue: `You ${setOverlay.setResult.playerGamesWon} — Fritz ${setOverlay.setResult.fritzGamesWon}`,
          marginValue: formatMargin(setOverlay.setResult.totalPointDiff),
          marginTone: setOverlayMarginTone,
          resultValue: null,
          rankValue: null,
          tracker: ([1, 2, 3] as DailyFritzSetGameNumber[]).map((trackerGame) => ({
            gameNumber: trackerGame,
            ...getSetTrackerStatus(setOverlay.setResult, trackerGame, setOverlay.nextGameNumber),
          })),
          games: [],
        }
      : {
          kind: 'final' as const,
          eyebrow: 'Daily Fritz Complete',
          headline: getFinalOverlayHeadline(setOverlay.setResult),
          subheadline: getFinalOverlaySubheadline(setOverlay.setResult),
          objective: null,
          nextLabel: null,
          primaryLabel: 'Return to Daily Fritz',
          primaryTone: setOverlay.setResult.setWinner === 'player' ? 'success' as const : 'default' as const,
          secondaryLabel: setOverlay.canViewLeaderboard ? 'View Leaderboard' : null,
          onPrimary: () => {
            setSetOverlay(null);
            setActiveRun(null);
            void loadToday();
          },
          onSecondary: () => {
            setSetOverlay(null);
            setActiveRun(null);
            void loadToday();
            const runDate = activeRun?.run_date ?? setOverlay.setResult.run_date ?? today?.run_date ?? '';
            if (runDate) {
              void openLeaderboardForRunDate(runDate);
            }
          },
          gameScoreLabel: 'Set Score',
          gameScoreValue: `You ${setOverlay.setResult.playerGamesWon} — Fritz ${setOverlay.setResult.fritzGamesWon}`,
          setScoreValue: `You ${setOverlay.setResult.playerGamesWon} — Fritz ${setOverlay.setResult.fritzGamesWon}`,
          marginValue: formatMargin(setOverlay.setResult.totalPointDiff),
          marginTone: setOverlayMarginTone,
          resultValue: formatSetResultLabel(setOverlay.setResult),
          rankValue: null,
          tracker: ([1, 2, 3] as DailyFritzSetGameNumber[]).map((trackerGame) => ({
            gameNumber: trackerGame,
            ...getSetTrackerStatus(setOverlay.setResult, trackerGame, null),
          })),
          games: setOverlay.setResult.games.map((game) => ({
            gameNumber: game.gameNumber,
            value: `You ${game.playerScore} — Fritz ${game.fritzScore}`,
            tone: (game.playerWon ? 'win' : 'loss') as 'win' | 'loss',
          })),
        }
    : null;

  if (activeRun) {
    return (
      <BotMatchScreen
        key={`${activeRun.attempt_id}:${activeGameNumber}`}
        onBack={() => {
          setActiveRun(null);
          void loadToday();
        }}
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
        onDailyFritzGameComplete={(result) => {
          void handleDailyFritzGameComplete(result);
        }}
        onDailyFritzComplete={() => {
          void finishEmbeddedRun();
        }}
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

  return (
    <div className="screen daily-fritz-screen mode-subpage-screen mode-accent-daily-fritz">
      <div className="daily-dash" style={{ ['--dash-accent' as string]: '#e05c6a' }}>

        {/* ── Top bar ── */}
        <header className="daily-dash-topbar">
          <div className="daily-dash-brand">RACEHORSE</div>
          <button type="button" className="daily-dash-back" onClick={onBack}>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M7.5 2L3 6l4.5 4" />
            </svg>
            Back to Home
          </button>
        </header>

        {/* ── Main content ── */}
        <main className="daily-dash-main">

          {/* Header */}
          <div className="daily-dash-header">
            <p className="daily-dash-eyebrow">Daily Fritz</p>
            <h1 className="daily-dash-title">Daily Fritz</h1>
            <p className="daily-dash-subtitle">Best-of-3 set. Same deals for everyone.</p>
          </div>

          <div className="daily-dash-separator" aria-hidden="true" />

          {/* Body — varies by load/auth/data state */}
          {loading ? (
            <div className="daily-fritz-empty claude-mode-card">Loading today’s run…</div>
          ) : showAuthPrompt ? (
            <div className="daily-dash-body daily-fritz-home-body">
              <div className="daily-dash-details daily-fritz-home-primary">
                <div className="daily-fritz-empty claude-mode-card">
                  <p>Sign in to play Daily Fritz.</p>
                </div>
              </div>
              <div className="daily-dash-actions daily-fritz-home-secondary">
                <ClaudePrimaryAction accent="#e05c6a" title="Sign In" meta="Open account access" onClick={onOpenAuth} />
              </div>
            </div>
          ) : error ? (
            <div className="daily-fritz-empty claude-mode-card">{error}</div>
          ) : today ? (
            <div className="daily-dash-body daily-fritz-home-body">
              <div className="daily-dash-details daily-fritz-home-primary">
                <div className="claude-mode-info-card">
                  <ClaudeSectionLabel color="#e05c6a">Match Details</ClaudeSectionLabel>
                  <ClaudeStatLine label="Date" value={formatDateLabel(today.run_date)} />
                  <ClaudeStatLine label="Tier" value={tierDisplayLabel(today.fritz_tier)} accent={today.fritz_tier === 'elite' ? '#ff7070' : undefined} />
                  <ClaudeStatLine label="Mode" value={`Best-of-3 · ${today.deal_size}-tile`} />
                  <ClaudeStatLine label="Set Status" value={getSetStatusLabel(today)} accent="#e05c6a" />
                  <ClaudeStatLine
                    label="Streak"
                    value={`${today.streak} day${today.streak === 1 ? '' : 's'}`}
                    accent="#e05c6a"
                  />
                </div>

              </div>

              <div className="daily-dash-actions daily-fritz-home-secondary">
                {today.attempt_status === 'started' && (
                  <div className="daily-fritz-status-card is-active claude-mode-card">
                    <span className="daily-fritz-status-label">In Progress</span>
                    <strong>Resume your run.</strong>
                    <p>Your spot is saved.</p>
                  </div>
                )}

                {today.attempt_status === 'completed' && (
                  <div className="daily-fritz-status-card is-complete-panel claude-mode-card">
                    <span className="daily-fritz-status-label">Completed</span>
                    <strong>{formatSetResultLabel(normalizeSetResult(today.set_result ?? today.result), Boolean(today.result?.won))}</strong>
                    <p>Your set result is posted. Leaderboard remains available as a secondary view.</p>
                  </div>
                )}

                {today.attempt_status === 'abandoned' && (
                  <div className="daily-fritz-status-card is-muted claude-mode-card">
                    <span className="daily-fritz-status-label">Spent</span>
                    <strong>Today’s run is spent.</strong>
                    <p>Come back tomorrow for a new one.</p>
                  </div>
                )}

                {today.attempt_status !== 'completed' && today.attempt_status !== 'abandoned' ? (
                  <ClaudePrimaryAction
                    accent="#e05c6a"
                    onClick={() => void beginRun()}
                    title={getPrimaryActionCopy(today).title}
                    meta={getPrimaryActionCopy(today).meta}
                  />
                ) : null}

                <div className="daily-fritz-secondary-panel claude-mode-card">
                  <ClaudeSecondaryAction
                    title="Leaderboard"
                    meta="See today’s standings"
                    onClick={() => void openLeaderboard()}
                  />
                </div>
              </div>
            </div>
          ) : null}

        </main>
      </div>
    </div>
  );
}
