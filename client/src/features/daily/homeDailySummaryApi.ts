import { supabase } from '../../lib/supabase';
import { resolveGameServerUrl } from '../../lib/gameServerUrl';

function resolveServerBaseUrl(): string {
  return resolveGameServerUrl();
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

export interface HomeDailySummaryWeekDay {
  dateKey: string;
  label: string;
  fritzCompleted: boolean;
  puzzleCompleted: boolean;
  complete: boolean;
  isToday: boolean;
  isFuture: boolean;
}

export interface HomeDailySummaryResponse {
  ok: true;
  today: string;
  week: HomeDailySummaryWeekDay[];
  weeklyCompletedCount: number;
  currentStreakCount: number;
  todayComplete: boolean;
}

export async function getHomeDailySummary(): Promise<HomeDailySummaryResponse> {
  return requestJson<HomeDailySummaryResponse>('/api/home/daily-summary', { method: 'GET' });
}
