import { supabase } from '../lib/supabase';
import type { BotDealSize, BotHandDeal } from '../bot/botEngine';
import type { FritzTier } from '../bot/fritzConfig';

function resolveServerBaseUrl(): string {
  const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ?? '';
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    if (port === '5173' || hostname === 'localhost' || hostname === '127.0.0.1') return '';
  }
  return 'http://localhost:3001';
}

async function authHeaders(): Promise<Record<string, string>> {
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
  return headers;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${resolveServerBaseUrl()}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(await authHeaders()),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text().catch(() => '');
  const parsed = text ? JSON.parse(text) : null;
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
  is_current_user?: boolean;
}

export interface DailyFritzTodayResponse {
  ok: true;
  run_date: string;
  fritz_tier: FritzTier;
  deal_size: BotDealSize;
  winning_score: number;
  attempt_status: 'none' | 'started' | 'completed' | 'abandoned';
  streak: number;
  result: Record<string, unknown> | null;
  rank: number | null;
  leaderboard_preview: DailyFritzLeaderboardRow[];
}

export interface DailyFritzStartResponse {
  ok: true;
  attempt_id: string;
  verified_match_id: string;
  run_date: string;
  current_hand_index: number;
  fritz_tier: FritzTier;
  deal_size: BotDealSize;
  winning_score: number;
  first_hand: BotHandDeal;
}

export interface DailyFritzNextHandResponse {
  ok: true;
  current_hand_index: number;
  hand: BotHandDeal;
}

export interface DailyFritzCompleteResponse {
  ok: true;
  replayed?: boolean;
  rank: number | null;
  leaderboard_preview: DailyFritzLeaderboardRow[];
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

export async function nextDailyFritzHand(input: {
  attemptId: string;
  verifiedMatchId: string;
  completedHandScores: { you: number; fritz: number };
}): Promise<DailyFritzNextHandResponse> {
  return requestJson<DailyFritzNextHandResponse>('/api/daily-fritz/next-hand', {
    method: 'POST',
    body: JSON.stringify({
      attempt_id: input.attemptId,
      verified_match_id: input.verifiedMatchId,
      completed_hand_scores: input.completedHandScores,
    }),
  });
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
  completionHash: string;
  finalScore: number;
  opponentScore: number;
  won: boolean;
  movesUsed: number;
  handsPlayed: number;
  moveLog: unknown;
}): Promise<DailyFritzCompleteResponse> {
  return requestJson<DailyFritzCompleteResponse>('/api/daily-fritz/complete', {
    method: 'POST',
    body: JSON.stringify({
      attempt_id: input.attemptId,
      verified_match_id: input.verifiedMatchId,
      completion_hash: input.completionHash,
      final_score: input.finalScore,
      opponent_score: input.opponentScore,
      won: input.won,
      moves_used: input.movesUsed,
      hands_played: input.handsPlayed,
      move_log: input.moveLog,
    }),
  });
}

export async function abandonDailyFritz(attemptId: string): Promise<void> {
  await requestJson<{ ok: true }>('/api/daily-fritz/abandon', {
    method: 'POST',
    body: JSON.stringify({ attempt_id: attemptId }),
  });
}

