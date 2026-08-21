import { apiGet } from '../api/client';
import { supabase } from '../lib/supabase';
import { getCachedSession } from '../auth/sessionToken';

async function authCacheScope(): Promise<string> {
  if (!supabase) return 'anon';
  const client = supabase;
  // Same in-memory session the request headers use — this ran a second
  // getSession() per cached call purely to build a cache key.
  const { userId } = await getCachedSession(async () => {
    const { data } = await client.auth.getSession();
    return {
      token: data.session?.access_token ?? null,
      userId: data.session?.user?.id ?? null,
    };
  });
  return userId ?? 'anon';
}

/** Throws on HTTP/auth failure — caught by exported loaders that return `{ error }`. */
async function apiFetch<T>(path: string): Promise<T> {
  const result = await apiGet<T>(path);
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const friendsWithPresenceCache = new Map<string, CacheEntry<{ friends: FriendWithPresence[]; error: string | null }>>();
const activityFeedCache = new Map<string, CacheEntry<{ feed: FeedItem[]; error: string | null }>>();
const userActivityCache = new Map<string, CacheEntry<{ feed: FeedItem[]; error: string | null }>>();
const globalLeaderboardCache = new Map<
  string,
  CacheEntry<{ leaderboard: GlobalLeaderboardEntry[]; self: GlobalLeaderboardEntry | null; error: string | null }>
>();
const publicProfileCache = new Map<string, CacheEntry<{ profile: PublicProfile | null; error: string | null }>>();
const rivalsCache = new Map<string, CacheEntry<{ rivals: RivalEntry[]; error: string | null }>>();

const friendsWithPresenceInFlight = new Map<string, Promise<{ friends: FriendWithPresence[]; error: string | null }>>();
const activityFeedInFlight = new Map<string, Promise<{ feed: FeedItem[]; error: string | null }>>();
const userActivityInFlight = new Map<string, Promise<{ feed: FeedItem[]; error: string | null }>>();
const globalLeaderboardInFlight = new Map<
  string,
  Promise<{ leaderboard: GlobalLeaderboardEntry[]; self: GlobalLeaderboardEntry | null; error: string | null }>
>();
const publicProfileInFlight = new Map<string, Promise<{ profile: PublicProfile | null; error: string | null }>>();
const rivalsInFlight = new Map<string, Promise<{ rivals: RivalEntry[]; error: string | null }>>();

const FRIENDS_WITH_PRESENCE_TTL_MS = 15_000;
const ACTIVITY_FEED_TTL_MS = 15_000;
const USER_ACTIVITY_TTL_MS = 30_000;
const GLOBAL_LEADERBOARD_TTL_MS = 30_000;
const PUBLIC_PROFILE_TTL_MS = 5 * 60_000;
// Rivals is a 90-day head-to-head rollup — it barely moves within a session.
const RIVALS_TTL_MS = 60_000;

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): T {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function withCachedRequest<T>({
  cache,
  inFlight,
  cacheKey,
  ttlMs,
  load,
}: {
  cache: Map<string, CacheEntry<T>>;
  inFlight: Map<string, Promise<T>>;
  cacheKey: string;
  ttlMs: number;
  load: () => Promise<T>;
}): Promise<T> {
  const cached = readCache(cache, cacheKey);
  if (cached !== null) return cached;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const pending = load()
    .then((value) => writeCache(cache, cacheKey, value, ttlMs))
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, pending);
  return pending;
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
  wins: number;
  win_rate: number;
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

export interface GlobalLeaderboardEntry {
  userId: string;
  username: string;
  glicko_rating: number;
  ranked_games_played: number;
  provisional: boolean;
  global_rank: number;
  is_self: boolean;
}

export interface WeeklyLeaderboardEntry {
  userId: string;
  username: string;
  glicko_rating: number;
  provisional: boolean;
  wins_this_week: number;
  rank: number;
  is_self: boolean;
}

export interface ModeLeaderboardEntry {
  userId: string;
  username: string;
  glicko_rating: number;
  provisional: boolean;
  wins: number;
  rank: number;
  is_self: boolean;
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
  puzzles_completed: number;
  best_puzzle_score: number | null;
  fritz_wins: number;
  fritz_losses: number;
  best_streak: number;
  is_self: boolean;
  is_friend: boolean;
  has_pending_request: boolean;
  /** Signed-in viewer's record vs this profile (always your W–L, not theirs). */
  h2h: { wins: number; losses: number } | null;
  presence: { status: PresenceStatus; current_mode: string | null };
  recent_matches: RecentMatch[];
}

type PublicProfileApiH2h = {
  wins?: number;
  losses?: number;
  viewer_wins?: number;
  viewer_losses?: number;
};

type PublicProfileApiResponse = Omit<PublicProfile, 'h2h'> & {
  h2h: PublicProfileApiH2h | null;
};

function mapViewerH2h(raw: PublicProfileApiH2h | null | undefined): PublicProfile['h2h'] {
  if (!raw) return null;
  if (typeof raw.viewer_wins === 'number' && typeof raw.viewer_losses === 'number') {
    return { wins: raw.viewer_wins, losses: raw.viewer_losses };
  }
  if (typeof raw.wins === 'number' && typeof raw.losses === 'number') {
    // Legacy API: wins/losses were the profile owner's record vs you — invert for your record.
    return { wins: raw.losses, losses: raw.wins };
  }
  return null;
}

function mapPublicProfileFromApi(data: PublicProfileApiResponse): PublicProfile {
  const { h2h: rawH2h, ...rest } = data;
  return { ...rest, h2h: mapViewerH2h(rawH2h) };
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function fetchFriendsWithPresence(): Promise<{ friends: FriendWithPresence[]; error: string | null }> {
  const cacheScope = await authCacheScope();
  return withCachedRequest({
    cache: friendsWithPresenceCache,
    inFlight: friendsWithPresenceInFlight,
    cacheKey: `friends-with-presence:${cacheScope}`,
    ttlMs: FRIENDS_WITH_PRESENCE_TTL_MS,
    load: async () => {
      try {
        const data = await apiFetch<{ ok: boolean; friends: FriendWithPresence[] }>('/api/social/friends/with-presence');
        return { friends: data.friends, error: null };
      } catch (err) {
        return { friends: [], error: err instanceof Error ? err.message : 'Failed to load friends.' };
      }
    },
  });
}

export async function fetchActivityFeed(): Promise<{ feed: FeedItem[]; error: string | null }> {
  const cacheScope = await authCacheScope();
  return withCachedRequest({
    cache: activityFeedCache,
    inFlight: activityFeedInFlight,
    cacheKey: `activity-feed:${cacheScope}`,
    ttlMs: ACTIVITY_FEED_TTL_MS,
    load: async () => {
      try {
        const data = await apiFetch<{ ok: boolean; feed: FeedItem[] }>('/api/social/feed');
        return { feed: data.feed, error: null };
      } catch (err) {
        return { feed: [], error: err instanceof Error ? err.message : 'Failed to load feed.' };
      }
    },
  });
}

export async function fetchGlobalLeaderboard(): Promise<{ leaderboard: GlobalLeaderboardEntry[]; self: GlobalLeaderboardEntry | null; error: string | null }> {
  const cacheScope = await authCacheScope();
  return withCachedRequest({
    cache: globalLeaderboardCache,
    inFlight: globalLeaderboardInFlight,
    cacheKey: `global-leaderboard:${cacheScope}`,
    ttlMs: GLOBAL_LEADERBOARD_TTL_MS,
    load: async () => {
      try {
        const data = await apiFetch<{ ok: boolean; leaderboard: GlobalLeaderboardEntry[]; self: GlobalLeaderboardEntry | null }>('/api/social/leaderboard/global');
        return { leaderboard: data.leaderboard, self: data.self, error: null };
      } catch (err) {
        return { leaderboard: [], self: null, error: err instanceof Error ? err.message : 'Failed to load leaderboard.' };
      }
    },
  });
}

export async function fetchFriendsLeaderboard(): Promise<{ leaderboard: LeaderboardEntry[]; error: string | null }> {
  try {
    const data = await apiFetch<{ ok: boolean; leaderboard: LeaderboardEntry[] }>('/api/social/leaderboard/friends');
    return { leaderboard: data.leaderboard, error: null };
  } catch (err) {
    return { leaderboard: [], error: err instanceof Error ? err.message : 'Failed to load leaderboard.' };
  }
}

export async function fetchWeeklyLeaderboard(): Promise<{ leaderboard: WeeklyLeaderboardEntry[]; self: WeeklyLeaderboardEntry | null; error: string | null }> {
  try {
    const data = await apiFetch<{ ok: boolean; leaderboard: WeeklyLeaderboardEntry[]; self: WeeklyLeaderboardEntry | null }>('/api/social/leaderboard/weekly');
    return { leaderboard: data.leaderboard, self: data.self, error: null };
  } catch (err) {
    return { leaderboard: [], self: null, error: err instanceof Error ? err.message : 'Failed to load leaderboard.' };
  }
}

export async function fetchModeLeaderboard(mode: string): Promise<{ leaderboard: ModeLeaderboardEntry[]; self: ModeLeaderboardEntry | null; error: string | null }> {
  try {
    const data = await apiFetch<{ ok: boolean; leaderboard: ModeLeaderboardEntry[]; self: ModeLeaderboardEntry | null }>(`/api/social/leaderboard/mode/${encodeURIComponent(mode)}`);
    return { leaderboard: data.leaderboard, self: data.self, error: null };
  } catch (err) {
    return { leaderboard: [], self: null, error: err instanceof Error ? err.message : 'Failed to load leaderboard.' };
  }
}

export async function fetchRivals(): Promise<{ rivals: RivalEntry[]; error: string | null }> {
  const cacheScope = await authCacheScope();
  return withCachedRequest({
    cache: rivalsCache,
    inFlight: rivalsInFlight,
    cacheKey: `rivals:${cacheScope}`,
    ttlMs: RIVALS_TTL_MS,
    load: async () => {
      try {
        const data = await apiFetch<{ ok: boolean; rivals: RivalEntry[] }>('/api/social/rivals');
        return { rivals: data.rivals, error: null };
      } catch (err) {
        return { rivals: [], error: err instanceof Error ? err.message : 'Failed to load rivals.' };
      }
    },
  });
}

export async function fetchUserActivity(userId: string): Promise<{ feed: FeedItem[]; error: string | null }> {
  const cacheScope = await authCacheScope();
  return withCachedRequest({
    cache: userActivityCache,
    inFlight: userActivityInFlight,
    cacheKey: `${cacheScope}:${userId}`,
    ttlMs: USER_ACTIVITY_TTL_MS,
    load: async () => {
      try {
        const data = await apiFetch<{ ok: boolean; feed: FeedItem[] }>(`/api/social/feed/user/${encodeURIComponent(userId)}`);
        return { feed: data.feed, error: null };
      } catch (err) {
        return { feed: [], error: err instanceof Error ? err.message : 'Activity unavailable.' };
      }
    },
  });
}

export async function fetchPublicProfile(username: string): Promise<{ profile: PublicProfile | null; error: string | null }> {
  const normalizedUsername = username.replace(/^@/, '').trim().toLowerCase();
  const cacheScope = await authCacheScope();
  return withCachedRequest({
    cache: publicProfileCache,
    inFlight: publicProfileInFlight,
    cacheKey: `${cacheScope}:${normalizedUsername}`,
    ttlMs: PUBLIC_PROFILE_TTL_MS,
    load: async () => {
      try {
        const data = await apiFetch<PublicProfileApiResponse>(
          `/api/profile/${encodeURIComponent(normalizedUsername)}`,
        );
        return { profile: mapPublicProfileFromApi(data), error: null };
      } catch (err) {
        return { profile: null, error: err instanceof Error ? err.message : 'Player not found.' };
      }
    },
  });
}
