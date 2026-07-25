import { apiGet, apiPost, type ApiResult } from '../api/client';
import type { BotDealSize, BotHandDeal } from '../bot/botEngine';
import type { FritzTier } from '../bot/fritzConfig';
import type { Tile } from '../types.ts';
import { normalizePreGameDrawTile } from '../match/preGameDraw/preGameDrawLogic.ts';

const DAILY_FRITZ_CLIENT_DEBUG_LOGS =
  import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true';

/** Init/today/start requests — 8–12s window before the UI leaves infinite loading. */
export const DAILY_FRITZ_INIT_TIMEOUT_MS = 10_000;

/** Next-hand advance (prefetch + reveal auto-advance). Match init — Render cold starts can exceed 4.5s. */
export const DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS = 10_000;

export const DAILY_FRITZ_TODAY_CACHE_PREFIX = 'racehorse:daily-fritz:today:';

function dfClientDebug(...args: unknown[]): void {
  if (DAILY_FRITZ_CLIENT_DEBUG_LOGS) console.log(...args);
}

function dfInitLog(event: string, payload?: Record<string, unknown>): void {
  if (DAILY_FRITZ_CLIENT_DEBUG_LOGS) {
    console.log(`[daily-fritz:init] ${event}`, payload ?? {});
  }
}

function isDailyFritzInitPath(path: string): boolean {
  return path === '/api/daily-fritz/today' || path === '/api/daily-fritz/start';
}

/** Clears only the Daily Fritz "today" hub cache (sessionStorage). */
export function clearDailyFritzTodayCache(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.sessionStorage.removeItem(`${DAILY_FRITZ_TODAY_CACHE_PREFIX}${userId}`);
  } catch {
    /* noop */
  }
}

/** Clears in-match localStorage checkpoints for Daily Fritz. */
export function clearDailyFritzMatchSnapshots(): void {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith('racehorse:daily-fritz:') && !key.startsWith(DAILY_FRITZ_TODAY_CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* noop */
  }
}

/** Clears Daily Fritz today cache + in-match saves. Prefer clearDailyFritzTodayCache on soft retries. */
export function clearDailyFritzClientStorage(userId: string): void {
  clearDailyFritzTodayCache(userId);
  clearDailyFritzMatchSnapshots();
}

function resolveDailyFritzApiError(path: string, error: string, status?: number): Error {
  if (error.startsWith('<!DOCTYPE') || error.startsWith('<html')) {
    return new Error(
      `Daily Fritz backend returned HTML for ${path}. Check production API routing / VITE_SERVER_URL.`,
    );
  }
  return new Error(error || `${path} failed with ${status ?? 'unknown'}`);
}

type RequestJsonOptions = RequestInit & {
  timeoutMs?: number;
};

async function dfRequestJsonWithTimeout<T>(path: string, init?: RequestJsonOptions): Promise<T> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const timeoutMs =
    init?.timeoutMs ??
    (isDailyFritzInitPath(path) ? DAILY_FRITZ_INIT_TIMEOUT_MS : undefined);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId: ReturnType<typeof window.setTimeout> | undefined;
  let timedOut = false;

  if (isDailyFritzInitPath(path)) {
    dfInitLog('request-start', { endpoint: path });
  }

  const run = async (): Promise<T> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const fetchStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const requestOptions = {
      signal: controller?.signal ?? init?.signal ?? undefined,
    };
    const result: ApiResult<T> =
      method === 'POST'
        ? await apiPost<T>(
            path,
            init?.body ? JSON.parse(String(init.body)) : {},
            requestOptions,
          )
        : await apiGet<T>(path, requestOptions);
    const fetchEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    dfClientDebug('[daily-fritz-client] requestJson', {
      path,
      status: result.status,
      authMs: Number((fetchStartedAt - startedAt).toFixed(1)),
      fetchMs: Number((fetchEndedAt - fetchStartedAt).toFixed(1)),
      parseMs: Number((endedAt - fetchEndedAt).toFixed(1)),
      totalMs: Number((endedAt - startedAt).toFixed(1)),
    });

    if (result.error) {
      if (controller?.signal.aborted && timedOut) {
        throw new Error('The game server is taking longer than expected. Please try again.');
      }
      throw resolveDailyFritzApiError(path, result.error, result.status);
    }

    if (isDailyFritzInitPath(path)) {
      const initPayload = result.data as Record<string, unknown> | null;
      dfInitLog('request-success', {
        ms: Number((endedAt - startedAt).toFixed(1)),
        status: result.status,
        hasSet: Boolean(initPayload?.set_result ?? initPayload?.result),
        gameNumber: initPayload?.current_game_number ?? null,
        phase: initPayload?.attempt_status ?? null,
        drawWinner: initPayload?.draw_winner ?? null,
        drawPlayerTile: initPayload?.draw_player_tile ?? null,
        drawFritzTile: initPayload?.draw_fritz_tile ?? null,
      });
    }
    return result.data as T;
  };

  try {
    if (timeoutMs && controller) {
      timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }
    return await run();
  } catch (error) {
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ms = Number((endedAt - startedAt).toFixed(1));
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (controller?.signal.aborted && timedOut)
    ) {
      if (isDailyFritzInitPath(path)) {
        dfInitLog('timeout', { ms: timeoutMs ?? ms, endpoint: path });
      }
      throw new Error('The game server is taking longer than expected. Please try again.');
    }
    if (isDailyFritzInitPath(path)) {
      dfInitLog('request-error', {
        ms,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }
}

async function timedApiGet<T>(path: string): Promise<ApiResult<T>> {
  const start = performance.now();
  const result = await apiGet<T>(path);
  dfClientDebug('[daily-fritz-client] request', {
    path,
    ms: Number((performance.now() - start).toFixed(1)),
    ok: result.error === null,
    status: result.status,
  });
  return result;
}

async function timedApiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const start = performance.now();
  const result = await apiPost<T>(path, body);
  dfClientDebug('[daily-fritz-client] request', {
    path,
    ms: Number((performance.now() - start).toFixed(1)),
    ok: result.error === null,
    status: result.status,
  });
  return result;
}

function throwApiResult<T>(result: ApiResult<T>): T {
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

export interface DailyFritzLeaderboardRow {
  rank: number;
  username: string;
  won: boolean;
  finalScore: number;
  opponentScore: number;
  pointDiff: number;
  movesUsed: number;
  completedAt: string;
  games?: Array<{
    gameNumber: DailyFritzSetGameNumber;
    playerScore: number;
    fritzScore: number;
    playerWon: boolean;
    pointDiff: number;
    skunk?: boolean;
    skunkBy?: 'player' | 'fritz';
  }>;
  is_current_user?: boolean;
}
export type DailyFritzVerificationStatus = 'in_progress' | 'pending_verification' | 'verified' | 'rejected' | 'legacy_unverified';
export type DailyFritzHistoryEntry = { challenge_date: string; player_score: number; fritz_score: number; won: boolean; completed_at: string | null; verification_status: DailyFritzVerificationStatus };
export async function getDailyFritzHistory(limit = 5): Promise<DailyFritzHistoryEntry[]> {
  const result = await apiGet<{ ok: true; results: DailyFritzHistoryEntry[] }>(`/api/daily-fritz/history?limit=${Math.max(1,Math.min(10,Math.floor(limit)))}`);
  if (result.error) throw new Error(result.error);
  return result.data?.results ?? [];
}

export type DailyFritzSetGameNumber = 1 | 2 | 3;

export type DailyFritzDrawWinner = 'you' | 'bot';

export interface DailyFritzSetGameResult {
  gameNumber: DailyFritzSetGameNumber;
  seed: string;
  playerWon: boolean;
  playerScore: number;
  fritzScore: number;
  pointDiff: number;
  movesUsed?: number;
  handsPlayed?: number;
  completedAt: string;
  skunk?: boolean;
  skunkBy?: 'player' | 'fritz';
}

export interface DailyFritzSetResult {
  version: 2;
  format: 'best_of_3';
  playerGamesWon: number;
  fritzGamesWon: number;
  totalPointDiff: number;
  games: DailyFritzSetGameResult[];
  setWinner?: 'player' | 'fritz';
  hasSkunk?: boolean;
  instantSkunk?: boolean;
  skunkGameNumber?: DailyFritzSetGameNumber | null;
  skunkBy?: 'player' | 'fritz' | null;
  run_date?: string;
  final_score?: number;
  opponent_score?: number;
  point_diff?: number;
  won?: boolean;
  moves_used?: number;
  hands_played?: number;
}

export interface DailyFritzTodayResponse {
  ok: true;
  run_date: string;
  challenge_id?: string;
  rules_version?: number;
  seed_version?: number;
  time_zone?: 'America/Los_Angeles';
  fritz_tier: FritzTier;
  deal_size: BotDealSize;
  winning_score: number;
  attempt_status: 'none' | 'started' | 'completed' | 'abandoned';
  current_game_number: DailyFritzSetGameNumber | null;
  needs_completion?: boolean;
  streak: number;
  result: Record<string, unknown> | null;
  set_result: DailyFritzSetResult | null;
  rank: number | null;
  leaderboard_preview: DailyFritzLeaderboardRow[];
  verification_protocol_version?: number;
  verification_status?: DailyFritzVerificationStatus;
  game_rules_version?: number;
  fritz_policy_version?: number;
  verifier_version?: number;
  competitive_verification_available?: boolean;
}

export interface DailyFritzStartResponse {
  ok: true;
  attempt_id: string;
  verified_match_id: string;
  run_date: string;
  challenge_id?: string;
  rules_version?: number;
  seed_version?: number;
  run_fingerprint?: string;
  verification_protocol_version?: number;
  game_rules_version?: number;
  fritz_policy_version?: number;
  verifier_version?: number;
  time_zone?: 'America/Los_Angeles';
  verification_status?: DailyFritzVerificationStatus;
  current_hand_index: number;
  current_game_scores?: { you: number; fritz: number };
  current_game_number?: DailyFritzSetGameNumber | null;
  needs_completion?: boolean;
  set_result: DailyFritzSetResult | null;
  fritz_tier: FritzTier;
  deal_size: BotDealSize;
  winning_score: number;
  first_hand: BotHandDeal;
  draw_winner: DailyFritzDrawWinner;
  draw_player_tile: Tile;
  draw_fritz_tile: Tile;
}

export interface DailyFritzNextHandResponse {
  ok: true;
  run_date: string;
  game_number?: DailyFritzSetGameNumber;
  current_game_number?: DailyFritzSetGameNumber | null;
  set_result?: DailyFritzSetResult | null;
  current_hand_index: number;
  current_game_scores: { you: number; fritz: number };
  hand: BotHandDeal;
  draw_winner: DailyFritzDrawWinner;
  draw_player_tile: Tile;
  draw_fritz_tile: Tile;
  replayed?: boolean;
  ignored?: boolean;
}

export interface DailyFritzCompleteResponse {
  ok: true;
  replayed?: boolean;
  rank: number | null;
  leaderboard_preview: DailyFritzLeaderboardRow[];
}

export interface DailyFritzRecordGameResponse {
  ok: true;
  replayed?: boolean;
  set_result: DailyFritzSetResult;
  next_game_number: DailyFritzSetGameNumber | null;
}

export interface DailyFritzLeaderboardResponse {
  ok: true;
  run_date: string;
  leaderboard: DailyFritzLeaderboardRow[];
}

function normalizeDailyFritzDrawWinner(value: unknown): DailyFritzDrawWinner | null {
  return value === 'you' || value === 'bot' ? value : null;
}

function normalizeDailyFritzStartDrawFields(
  payload: DailyFritzStartResponse,
): DailyFritzStartResponse {
  const drawPlayerTile = normalizePreGameDrawTile(payload.draw_player_tile);
  const drawFritzTile = normalizePreGameDrawTile(payload.draw_fritz_tile);
  const drawWinner = normalizeDailyFritzDrawWinner(payload.draw_winner);
  return {
    ...payload,
    ...(drawPlayerTile ? { draw_player_tile: drawPlayerTile } : {}),
    ...(drawFritzTile ? { draw_fritz_tile: drawFritzTile } : {}),
    ...(drawWinner ? { draw_winner: drawWinner } : {}),
  };
}

export async function getTodayDailyFritz(options?: {
  timeoutMs?: number;
}): Promise<DailyFritzTodayResponse> {
  return dfRequestJsonWithTimeout<DailyFritzTodayResponse>('/api/daily-fritz/today', {
    method: 'GET',
    timeoutMs: options?.timeoutMs,
  });
}

export async function startDailyFritz(options?: {
  timeoutMs?: number;
}): Promise<DailyFritzStartResponse> {
  const response = await dfRequestJsonWithTimeout<DailyFritzStartResponse>('/api/daily-fritz/start', {
    method: 'POST',
    body: JSON.stringify({
      verification_protocol_version: (await import('@racehorse/game-core')).DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
      game_rules_version: (await import('@racehorse/game-core')).GAME_RULES_VERSION,
      fritz_policy_version: (await import('@racehorse/game-core')).FRITZ_POLICY_VERSION,
    }),
    timeoutMs: options?.timeoutMs,
  });
  const normalized = normalizeDailyFritzStartDrawFields(response);
  console.log('[df-scripted-draw] start response', {
    drawWinner: normalized.draw_winner ?? null,
    rawDrawPlayerTile: response.draw_player_tile ?? null,
    rawDrawFritzTile: response.draw_fritz_tile ?? null,
    normalizedDrawPlayerTile: normalized.draw_player_tile ?? null,
    normalizedDrawFritzTile: normalized.draw_fritz_tile ?? null,
  });
  return normalized;
}

export async function fetchDailyFritzLeaderboard(date: string): Promise<DailyFritzLeaderboardRow[]> {
  const response = throwApiResult(
    await timedApiGet<DailyFritzLeaderboardResponse>(`/api/daily-fritz/leaderboard/${date}`),
  );
  return response.leaderboard;
}

/**
 * Thrown when the server signals there are no more hands left in this Daily
 * Fritz run (HTTP 409 "No hands remain…").  This is a terminal, non-retryable
 * condition — the client must transition to match-complete, not show an error.
 */
export class DailyFritzEndOfRunError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'DailyFritzEndOfRunError';
  }
}

const DAILY_FRITZ_NEXT_HAND_DEBUG_INGEST =
  import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true';

function dfNextHandIngest(payload: {
  location: string;
  message: string;
  hypothesisId?: string;
  data?: Record<string, unknown>;
  runId?: string;
}): void {
  if (!DAILY_FRITZ_NEXT_HAND_DEBUG_INGEST) return;
  void import('../devtools/dailyFritzDebugIngest').then((module) => {
    module.ingestDailyFritzNextHandDebug(payload);
  });
}

/** Production copy for modal; dev keeps the raw message for debugging. */
export function formatDailyFritzNextHandUserMessage(raw: string): string {
  if (import.meta.env.DEV) return raw;
  const lower = raw.toLowerCase();
  if (raw === 'Failed to fetch' || lower.includes('networkerror') || lower.includes('load failed')) {
    return "Couldn't load the next hand. Check connection and retry.";
  }
  if (lower.includes('timed out loading the next daily fritz hand')) {
    return "Couldn't load the next hand. Check connection and retry.";
  }
  return raw.length > 220 ? "Couldn't load the next hand. Check connection and retry." : raw;
}

export async function nextDailyFritzHand(input: {
  attemptId: string;
  verifiedMatchId: string;
  runDate: string;
  gameNumber?: DailyFritzSetGameNumber;
  completedHandIndex: number;
  transcript: import('@racehorse/game-core').DailyFritzTranscript | null;
  completedHandScores: { you: number; fritz: number };
  timeoutMs?: number;
}): Promise<DailyFritzNextHandResponse> {
  const path = '/api/daily-fritz/next-hand';
  const timeoutMs = Math.max(1000, input.timeoutMs ?? DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS);
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  dfNextHandIngest({
    location: 'dailyFritz/api.ts:nextDailyFritzHand',
    message: 'request-start',
    hypothesisId: 'B',
    data: {
      url: path,
      timeoutMs,
      completedHandIndex: input.completedHandIndex,
      gameNumber: input.gameNumber ?? 1,
    },
  });

  let result: ApiResult<DailyFritzNextHandResponse>;
  try {
    result = await apiPost<DailyFritzNextHandResponse>(
      path,
      {
        attempt_id: input.attemptId,
        verified_match_id: input.verifiedMatchId,
        run_date: input.runDate,
        game_number: input.gameNumber ?? 1,
        completed_hand_index: input.completedHandIndex,
        ...(input.transcript
          ? { transcript: input.transcript }
          : { completed_hand_scores: input.completedHandScores }),
      },
      { signal: controller.signal },
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    const message = error instanceof Error ? error.message : String(error);
    dfNextHandIngest({
      location: 'dailyFritz/api.ts:nextDailyFritzHand',
      message: 'fetch-rejected',
      hypothesisId: 'B',
      data: { url: path, errorName: name, errorMessage: message, isAbort: name === 'AbortError' },
    });
    if (import.meta.env.DEV) {
      console.warn('[daily-fritz:next-hand] request failed', { url: path, name, message });
    }
    if ((error instanceof DOMException && error.name === 'AbortError') || timedOut) {
      throw new Error(`Timed out loading the next Daily Fritz hand after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  dfNextHandIngest({
    location: 'dailyFritz/api.ts:nextDailyFritzHand',
    message: 'response',
    hypothesisId: 'B',
    data: { url: path, status: result.status, ok: result.error === null },
  });

  if (controller.signal.aborted && timedOut) {
    throw new Error(`Timed out loading the next Daily Fritz hand after ${timeoutMs}ms.`);
  }

  const parsedError = result.error ?? '';

  // Only the terminal no-hands-remain 409 means the game is complete. Other
  // conflicts are real hand-transition errors and must not auto-complete a set.
  if (result.status === 409) {
    const message = parsedError || 'No hands remain in this Daily Fritz run.';
    if (!String(message).toLowerCase().includes('no hands remain')) {
      throw new Error(message);
    }
    throw new DailyFritzEndOfRunError(message);
  }

  if (result.error) {
    dfNextHandIngest({
      location: 'dailyFritz/api.ts:nextDailyFritzHand',
      message: 'http-non-ok',
      hypothesisId: 'B',
      data: {
        url: path,
        status: result.status,
        error: parsedError || null,
        bodySnippet: parsedError.slice(0, 240),
      },
    });
    if (import.meta.env.DEV) {
      console.warn('[daily-fritz:next-hand] non-OK response', {
        url: path,
        status: result.status,
        error: parsedError || null,
      });
    }
    throw new Error(parsedError || `${path} failed with ${result.status ?? 'unknown'}`);
  }

  return result.data as DailyFritzNextHandResponse;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildDailyFritzCompletionHash(input: {
  runDate: string;
  attemptId: string;
  verifiedMatchId: string;
  currentHandIndex: number;
  finalScore: number;
  opponentScore: number;
  won: boolean;
  movesUsed: number;
  handsPlayed: number;
  moveLog: unknown;
}): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      runDate: input.runDate,
      attemptId: input.attemptId,
      verifiedMatchId: input.verifiedMatchId,
      currentHandIndex: input.currentHandIndex,
      finalScore: input.finalScore,
      opponentScore: input.opponentScore,
      won: input.won,
      movesUsed: input.movesUsed,
      handsPlayed: input.handsPlayed,
      moveLog: input.moveLog,
    }),
  );
}

export async function completeDailyFritz(input: {
  attemptId: string;
  verifiedMatchId: string;
  runDate: string;
  completionHash: string;
  finalScore: number;
  opponentScore: number;
  won: boolean;
  movesUsed: number;
  handsPlayed: number;
  moveLog: unknown;
  setResult?: DailyFritzSetResult | null;
}): Promise<DailyFritzCompleteResponse> {
  return throwApiResult(
    await timedApiPost<DailyFritzCompleteResponse>('/api/daily-fritz/complete', {
      attempt_id: input.attemptId,
      verified_match_id: input.verifiedMatchId,
      run_date: input.runDate,
      completion_hash: input.completionHash,
      final_score: input.finalScore,
      opponent_score: input.opponentScore,
      won: input.won,
      moves_used: input.movesUsed,
      hands_played: input.handsPlayed,
      move_log: input.moveLog,
      set_result: input.setResult ?? null,
    }),
  );
}

export async function recordDailyFritzGame(input: {
  attemptId: string;
  verifiedMatchId: string;
  runDate: string;
  gameNumber: DailyFritzSetGameNumber;
  transcript: import('@racehorse/game-core').DailyFritzTranscript | null;
  playerScore: number;
  fritzScore: number;
  movesUsed: number;
  handsPlayed: number;
}): Promise<DailyFritzRecordGameResponse> {
  return throwApiResult(
    await timedApiPost<DailyFritzRecordGameResponse>('/api/daily-fritz/record-game', {
      attempt_id: input.attemptId,
      verified_match_id: input.verifiedMatchId,
      run_date: input.runDate,
      game_number: input.gameNumber,
      ...(input.transcript
        ? { transcript: input.transcript }
        : {
            player_score: input.playerScore,
            fritz_score: input.fritzScore,
            moves_used: input.movesUsed,
            hands_played: input.handsPlayed,
          }),
    }),
  );
}

export async function abandonDailyFritz(attemptId: string): Promise<void> {
  throwApiResult(await timedApiPost<{ ok: true }>('/api/daily-fritz/abandon', { attempt_id: attemptId }));
}
