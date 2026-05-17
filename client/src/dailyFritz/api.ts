import { supabase } from '../lib/supabase';
import type { BotDealSize, BotHandDeal } from '../bot/botEngine';
import type { FritzTier } from '../bot/fritzConfig';

const DEFAULT_SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const DEFAULT_SERVER_ORIGIN = 'http://localhost:3001';

const DAILY_FRITZ_CLIENT_DEBUG_LOGS =
  import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true';

function dfClientDebug(...args: unknown[]): void {
  if (DAILY_FRITZ_CLIENT_DEBUG_LOGS) console.log(...args);
}

function resolveServerBaseUrl(): string {
  const configured = DEFAULT_SERVER_URL.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    if (port === '5173' || hostname === 'localhost' || hostname === '127.0.0.1') return '';
    return '';
  }
  return DEFAULT_SERVER_ORIGIN;
}

async function authHeaders(): Promise<Record<string, string>> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (!supabase) return headers;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // no-op
  }
  const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  dfClientDebug('[daily-fritz-client] authHeaders', {
    ms: Number((endedAt - startedAt).toFixed(1)),
    hasSupabase: Boolean(supabase),
    hasAuthorization: Boolean(headers.Authorization),
  });
  return headers;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const headers = {
    ...(await authHeaders()),
    ...(init?.headers ?? {}),
  };
  const fetchStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const response = await fetch(`${resolveServerBaseUrl()}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });
  const fetchEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const text = await response.text().catch(() => '');
  const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  dfClientDebug('[daily-fritz-client] requestJson', {
    path,
    status: response.status,
    authMs: Number((fetchStartedAt - startedAt).toFixed(1)),
    fetchMs: Number((fetchEndedAt - fetchStartedAt).toFixed(1)),
    parseMs: Number((endedAt - fetchEndedAt).toFixed(1)),
    totalMs: Number((endedAt - startedAt).toFixed(1)),
  });
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new Error(
          text.startsWith('<!DOCTYPE') || text.startsWith('<html')
            ? `Daily Fritz backend returned HTML for ${path}. Check production API routing / VITE_SERVER_URL.`
            : `${path} failed with ${response.status}`,
        );
      }
      throw new Error(`Invalid JSON response from ${path}`);
    }
  }
  if (!response.ok) {
    throw new Error(parsed?.error ?? `${path} failed with ${response.status}`);
  }
  return parsed as T;
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

export type DailyFritzSetGameNumber = 1 | 2 | 3;

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
}

export interface DailyFritzStartResponse {
  ok: true;
  attempt_id: string;
  verified_match_id: string;
  run_date: string;
  current_hand_index: number;
  current_game_number?: DailyFritzSetGameNumber | null;
  needs_completion?: boolean;
  set_result: DailyFritzSetResult | null;
  fritz_tier: FritzTier;
  deal_size: BotDealSize;
  winning_score: number;
  first_hand: BotHandDeal;
}

export interface DailyFritzNextHandResponse {
  ok: true;
  run_date: string;
  game_number?: DailyFritzSetGameNumber;
  current_game_number?: DailyFritzSetGameNumber | null;
  set_result?: DailyFritzSetResult | null;
  current_hand_index: number;
  hand: BotHandDeal;
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

export async function getTodayDailyFritz(): Promise<DailyFritzTodayResponse> {
  return requestJson<DailyFritzTodayResponse>('/api/daily-fritz/today', { method: 'GET' });
}

export async function startDailyFritz(): Promise<DailyFritzStartResponse> {
  return requestJson<DailyFritzStartResponse>('/api/daily-fritz/start', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function fetchDailyFritzLeaderboard(date: string): Promise<DailyFritzLeaderboardRow[]> {
  const response = await requestJson<DailyFritzLeaderboardResponse>(`/api/daily-fritz/leaderboard/${date}`, {
    method: 'GET',
  });
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

export async function nextDailyFritzHand(input: {
  attemptId: string;
  verifiedMatchId: string;
  runDate: string;
  gameNumber?: DailyFritzSetGameNumber;
  completedHandIndex: number;
  completedHandScores: { you: number; fritz: number };
  timeoutMs?: number;
}): Promise<DailyFritzNextHandResponse> {
  // Use a manual fetch so we can inspect the status code before throwing.
  // requestJson treats all non-2xx responses identically; we need to
  // distinguish the terminal 409 "no hands remain" from retryable errors.
  const headers = await authHeaders();
  const timeoutMs = Math.max(1000, input.timeoutMs ?? 6500);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(
    `${resolveServerBaseUrl()}/api/daily-fritz/next-hand`,
    {
      method: 'POST',
      credentials: 'include',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        attempt_id: input.attemptId,
        verified_match_id: input.verifiedMatchId,
        run_date: input.runDate,
        game_number: input.gameNumber ?? 1,
        completed_hand_index: input.completedHandIndex,
        completed_hand_scores: input.completedHandScores,
      }),
    },
  ).catch((error) => {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Timed out loading the next Daily Fritz hand after ${timeoutMs}ms.`);
    }
    throw error;
  }).finally(() => {
    window.clearTimeout(timeoutId);
  });

  const text = await response.text().catch(() => '');
  let parsed: any = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { /* fall through */ }
  }

  // Only the terminal no-hands-remain 409 means the game is complete. Other
  // conflicts are real hand-transition errors and must not auto-complete a set.
  if (response.status === 409) {
    const message = parsed?.error ?? 'No hands remain in this Daily Fritz run.';
    if (!String(message).toLowerCase().includes('no hands remain')) {
      throw new Error(message);
    }
    throw new DailyFritzEndOfRunError(
      message,
    );
  }

  if (!response.ok) {
    throw new Error(
      parsed?.error ?? `/api/daily-fritz/next-hand failed with ${response.status}`,
    );
  }

  return parsed as DailyFritzNextHandResponse;
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
  return requestJson<DailyFritzCompleteResponse>('/api/daily-fritz/complete', {
    method: 'POST',
    body: JSON.stringify({
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
  });
}

export async function recordDailyFritzGame(input: {
  attemptId: string;
  verifiedMatchId: string;
  runDate: string;
  gameNumber: DailyFritzSetGameNumber;
  playerScore: number;
  fritzScore: number;
  movesUsed: number;
  handsPlayed: number;
}): Promise<DailyFritzRecordGameResponse> {
  return requestJson<DailyFritzRecordGameResponse>('/api/daily-fritz/record-game', {
    method: 'POST',
    body: JSON.stringify({
      attempt_id: input.attemptId,
      verified_match_id: input.verifiedMatchId,
      run_date: input.runDate,
      game_number: input.gameNumber,
      player_score: input.playerScore,
      fritz_score: input.fritzScore,
      moves_used: input.movesUsed,
      hands_played: input.handsPlayed,
    }),
  });
}

export async function abandonDailyFritz(attemptId: string): Promise<void> {
  await requestJson<{ ok: true }>('/api/daily-fritz/abandon', {
    method: 'POST',
    body: JSON.stringify({ attempt_id: attemptId }),
  });
}
