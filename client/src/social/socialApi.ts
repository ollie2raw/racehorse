import { supabase } from '../lib/supabase';

function resolveBaseUrl(): string {
  const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ?? '';
  if (configured) return configured.replace(/\/$/, '');
  return '';
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${resolveBaseUrl()}${path}`, { headers, credentials: 'include' });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  return body;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type PresenceStatus = 'online' | 'in_game' | 'offline';

export interface FriendWithPresence {
  id: string;
  userId: string;
  username: string;
  presence_status: PresenceStatus;
  current_mode: string | null;
}

export interface FeedItem {
  id: string;
  user_id: string;
  username: string;
  type: 'win' | 'loss' | 'streak' | 'tournament' | 'puzzle' | 'daily_fritz';
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  glicko_rating: number;
  ranked_games_played: number;
  provisional: boolean;
  rank_in_friends: number;
  is_self: boolean;
}

export interface RivalEntry {
  userId: string;
  username: string;
  gamesPlayed: number;
  winsAgainst: number;
  lossesAgainst: number;
  rating: number | null;
}

export interface RecentMatch {
  opponent_username: string;
  result: 'win' | 'loss';
  score: number | null;
  opponent_score: number | null;
  mode: string;
  played_at: string;
}

export interface PublicProfile {
  ok: boolean;
  userId: string;
  username: string;
  glicko_rating: number;
  peak_rating: number;
  provisional: boolean;
  ranked_games_played: number;
  global_rank: number | null;
  wins: number;
  losses: number;
  win_rate: number;
  is_self: boolean;
  is_friend: boolean;
  has_pending_request: boolean;
  presence: { status: PresenceStatus; current_mode: string | null };
  recent_matches: RecentMatch[];
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function fetchFriendsWithPresence(): Promise<{ friends: FriendWithPresence[]; error: string | null }> {
  try {
    const data = await apiFetch<{ ok: boolean; friends: FriendWithPresence[] }>('/api/social/friends/with-presence');
    return { friends: data.friends, error: null };
  } catch (err) {
    return { friends: [], error: err instanceof Error ? err.message : 'Failed to load friends.' };
  }
}

export async function fetchActivityFeed(): Promise<{ feed: FeedItem[]; error: string | null }> {
  try {
    const data = await apiFetch<{ ok: boolean; feed: FeedItem[] }>('/api/social/feed');
    return { feed: data.feed, error: null };
  } catch (err) {
    return { feed: [], error: err instanceof Error ? err.message : 'Failed to load feed.' };
  }
}

export async function fetchFriendsLeaderboard(): Promise<{ leaderboard: LeaderboardEntry[]; error: string | null }> {
  try {
    const data = await apiFetch<{ ok: boolean; leaderboard: LeaderboardEntry[] }>('/api/social/leaderboard/friends');
    return { leaderboard: data.leaderboard, error: null };
  } catch (err) {
    return { leaderboard: [], error: err instanceof Error ? err.message : 'Failed to load leaderboard.' };
  }
}

export async function fetchRivals(): Promise<{ rivals: RivalEntry[]; error: string | null }> {
  try {
    const data = await apiFetch<{ ok: boolean; rivals: RivalEntry[] }>('/api/social/rivals');
    return { rivals: data.rivals, error: null };
  } catch (err) {
    return { rivals: [], error: err instanceof Error ? err.message : 'Failed to load rivals.' };
  }
}

export async function fetchPublicProfile(username: string): Promise<{ profile: PublicProfile | null; error: string | null }> {
  try {
    const data = await apiFetch<PublicProfile>(`/api/profile/${encodeURIComponent(username.replace(/^@/, ''))}`);
    return { profile: data, error: null };
  } catch (err) {
    return { profile: null, error: err instanceof Error ? err.message : 'Player not found.' };
  }
}
