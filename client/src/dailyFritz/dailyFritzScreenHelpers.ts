import type {
  DailyFritzClientNextAction,
  DailyFritzServerNextAction,
  DailyFritzSetGameNumber,
  DailyFritzSetGameResult,
  DailyFritzSetResult,
  DailyFritzStartResponse,
  DailyFritzTodayResponse,
} from './api';
import { isDailyFritzSkunk } from './skunk';
import type { BetweenGameTrackerTone } from './dailyFritzScreenTypes';

const DAILY_FRITZ_SET_VERSION = 2;

export const DAILY_FRITZ_INIT_SLOW_MS = 10_000;

export function dfInitLog(_event: string, _payload?: Record<string, unknown>): void {
  void _event;
  void _payload;
}

export function readTodayCache(cacheKey: string | null): DailyFritzTodayResponse | null {
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

export function shouldClearStaleClientState(
  cached: DailyFritzTodayResponse,
  server: DailyFritzTodayResponse,
): boolean {
  if (cached.run_date !== server.run_date) return true;
  if (cached.attempt_status === 'started' && server.attempt_status !== 'started') return true;
  if (cached.attempt_status === 'completed' && server.attempt_status === 'none') return true;
  return false;
}

function inferFallbackNextActionFromToday(today: DailyFritzTodayResponse | null): DailyFritzClientNextAction {
  if (!today) return 'play_hand';
  if (today.attempt_status === 'completed') return 'view_results';
  if (today.attempt_status === 'abandoned') return 'locked';
  if (today.attempt_status === 'started' && (today.needs_completion || today.set_result?.setWinner)) {
    return 'finalize_set';
  }
  return 'play_hand';
}

function inferFallbackNextActionFromStart(started: DailyFritzStartResponse): DailyFritzClientNextAction {
  if (started.needs_completion || started.set_result?.setWinner) return 'finalize_set';
  return 'play_hand';
}

export function normalizeDailyFritzNextAction(
  nextAction: DailyFritzServerNextAction | null | undefined,
  fallback: DailyFritzClientNextAction,
): DailyFritzClientNextAction {
  if (nextAction === 'play_hand'
    || nextAction === 'between_games'
    || nextAction === 'finalize_set'
    || nextAction === 'view_results'
    || nextAction === 'locked') {
    return nextAction;
  }
  // Backward-compatibility with older cached API payloads.
  if (nextAction === 'start_set' || nextAction === 'resume_hand') {
    return 'play_hand';
  }
  return fallback;
}

export function resolveTodayNextAction(today: DailyFritzTodayResponse | null): DailyFritzClientNextAction {
  return normalizeDailyFritzNextAction(today?.next_action, inferFallbackNextActionFromToday(today));
}

export function resolveStartNextAction(started: DailyFritzStartResponse): DailyFritzClientNextAction {
  return normalizeDailyFritzNextAction(started.next_action, inferFallbackNextActionFromStart(started));
}

export function friendlyDailyFritzInitError(error: unknown): string {
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

export function formatDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function titleCaseTier(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function tierDisplayLabel(tier: string): string {
  if (tier === 'elite') return 'Elite · Competitive';
  if (tier === 'standard') return 'Standard · Balanced';
  if (tier === 'rookie') return 'Rookie · Beginner';
  if (tier === 'master') return 'Master · Expert';
  return titleCaseTier(tier);
}

export function getDailyFritzGameSeed(runDate: string, gameNumber: DailyFritzSetGameNumber): string {
  return `daily-fritz-${runDate}:game:${gameNumber}`;
}

export function normalizeGameNumber(value: unknown, fallback: DailyFritzSetGameNumber = 1): DailyFritzSetGameNumber {
  const parsed = Number(value);
  return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : fallback;
}

export function normalizeSetResult(value: unknown): DailyFritzSetResult | null {
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
export function setResultForOverlay(raw: unknown): DailyFritzSetResult | null {
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

export function getNextGameNumberFromSetResult(setResult: DailyFritzSetResult | null): DailyFritzSetGameNumber {
  if (!setResult || setResult.setWinner) return 1;
  return normalizeGameNumber(setResult.games.length + 1, 3);
}

/**
 * Current game slot (1–3) from recorded games + server hint.
 * `current_game_number` can stay stale after we merge only `set_result` into `activeRun`; prefer the next
 * game implied by `games.length + 1` while the set is still live.
 */
export function resolveDailyFritzCurrentGameNumber(
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

export function normalizeStartResponse(
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

/**
 * Reconstruct the live between-games overlay from a /start resume payload.
 * `/start` already includes next_action, set_result (completed games), and the next game slot.
 */
export function resolveBetweenGamesOverlayFromStart(started: DailyFritzStartResponse): {
  completedGame: DailyFritzSetGameResult;
  setResult: DailyFritzSetResult;
  nextGameNumber: DailyFritzSetGameNumber;
} | null {
  if (resolveStartNextAction(started) !== 'between_games') return null;
  const setResult = normalizeSetResult(started.set_result);
  if (!setResult || setResult.setWinner || setResult.games.length === 0) return null;
  const completedGame = setResult.games[setResult.games.length - 1];
  if (!completedGame) return null;
  const nextGameNumber = resolveDailyFritzCurrentGameNumber(setResult, started.current_game_number);
  if (nextGameNumber === completedGame.gameNumber) return null;
  return { completedGame, setResult, nextGameNumber };
}

export function formatMargin(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value}`;
}

export function getSetTrackerStatus(
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

export function secondsUntilNextPacificMidnight(now: Date): number {
  const { h, m, s } = getLosAngelesHms(now);
  const elapsed = h * 3600 + m * 60 + s;
  return Math.max(0, 86400 - elapsed);
}

export function formatCountdownHms(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
