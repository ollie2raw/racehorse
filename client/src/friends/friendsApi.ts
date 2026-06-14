import { supabase } from '../lib/supabase';

export type FriendRecord = {
  id: string;
  username: string;
  userId: string;
  online: boolean;
};

export type FriendRequestRecord = {
  id: string;
  username: string;
  userId: string;
};

type FriendsResult = {
  friends: FriendRecord[];
  incoming: FriendRequestRecord[];
  outgoing: FriendRequestRecord[];
  error: string | null;
};

type FriendsCacheEntry = {
  value: FriendsResult;
  expiresAt: number;
};

const friendsCache = new Map<string, FriendsCacheEntry>();
const friendsInFlight = new Map<string, Promise<FriendsResult>>();
const FRIENDS_CACHE_TTL_MS = 15_000;

function normalizeDbError(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('relation') ||
    normalized.includes('does not exist') ||
    normalized.includes('42p01') ||
    normalized.includes('schema cache') ||
    normalized.includes('public.friends')
  ) {
    return 'Friends are unavailable until the friends table is created.';
  }
  return message;
}

function readFriendsCache(userId: string): FriendsResult | null {
  const entry = friendsCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    friendsCache.delete(userId);
    return null;
  }
  return entry.value;
}

function writeFriendsCache(userId: string, value: FriendsResult): FriendsResult {
  friendsCache.set(userId, {
    value,
    expiresAt: Date.now() + FRIENDS_CACHE_TTL_MS,
  });
  return value;
}

export function invalidateFriendsCache(userId?: string | null): void {
  if (!userId) return;
  friendsCache.delete(userId);
  friendsInFlight.delete(userId);
}

export async function fetchFriends(userId: string): Promise<FriendsResult> {
  const cached = readFriendsCache(userId);
  if (cached) return cached;

  const existing = friendsInFlight.get(userId);
  if (existing) return existing;

  const pending = (async (): Promise<FriendsResult> => {
  if (!supabase) return { friends: [], incoming: [], outgoing: [], error: 'Supabase not configured.' };

  const relationResp = await supabase
    .from('friends')
    .select('id, user_id, friend_user_id, status, created_at')
    .or(`user_id.eq.${userId},friend_user_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (relationResp.error) {
    return {
      friends: [],
      incoming: [],
      outgoing: [],
      error: normalizeDbError(relationResp.error.message ?? 'Unable to load friends.'),
    };
  }

  const rows = relationResp.data ?? [];
  const otherIds = Array.from(
    new Set(
      rows
        .map((row) => (row.user_id === userId ? row.friend_user_id : row.user_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const profilesById = new Map<string, { username: string }>();
  if (otherIds.length) {
    const profileResp = await supabase.from('profiles').select('id, username').in('id', otherIds);
    if (!profileResp.error) {
      for (const profile of profileResp.data ?? []) {
        profilesById.set(profile.id, { username: profile.username ?? 'player' });
      }
    }
  }

  const friends: FriendRecord[] = [];
  const incoming: FriendRequestRecord[] = [];
  const outgoing: FriendRequestRecord[] = [];

  for (const row of rows) {
    const otherId = row.user_id === userId ? row.friend_user_id : row.user_id;
    if (!otherId) continue;
    const username = profilesById.get(otherId)?.username ?? 'player';
    if (row.status === 'accepted') {
      friends.push({ id: row.id, userId: otherId, username, online: false });
      continue;
    }
    if (row.status !== 'pending') continue;
    if (row.friend_user_id === userId) {
      incoming.push({ id: row.id, userId: otherId, username });
    } else {
      outgoing.push({ id: row.id, userId: otherId, username });
    }
  }

    return { friends, incoming, outgoing, error: null };
  })()
    .then((result) => writeFriendsCache(userId, result))
    .finally(() => {
      friendsInFlight.delete(userId);
    });

  friendsInFlight.set(userId, pending);
  return pending;
}

export async function sendFriendRequest(userId: string, usernameQuery: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured.' };
  const username = usernameQuery.trim().replace(/^@/, '').toLowerCase();
  if (!username) return { error: 'Enter a username.' };

  const profileResp = await supabase
    .from('profiles')
    .select('id, username')
    .ilike('username', username)
    .maybeSingle();
  if (profileResp.error) return { error: normalizeDbError(profileResp.error.message) };
  if (!profileResp.data?.id) return { error: 'User not found.' };
  if (profileResp.data.id === userId) return { error: 'You cannot add yourself.' };

  const targetId = profileResp.data.id;
  const existingResp = await supabase
    .from('friends')
    .select('id, status')
    .or(
      `and(user_id.eq.${userId},friend_user_id.eq.${targetId}),and(user_id.eq.${targetId},friend_user_id.eq.${userId})`,
    )
    .maybeSingle();
  if (existingResp.error && !existingResp.error.message.toLowerCase().includes('multiple')) {
    return { error: normalizeDbError(existingResp.error.message) };
  }
  if (existingResp.data?.status === 'accepted') return { error: 'You are already friends.' };
  if (existingResp.data?.status === 'pending') return { error: 'Friend request already pending.' };

  const insertResp = await supabase
    .from('friends')
    .insert({ user_id: userId, friend_user_id: targetId, status: 'pending' });
  if (insertResp.error) return { error: normalizeDbError(insertResp.error.message) };
  invalidateFriendsCache(userId);
  return { error: null };
}

export async function acceptFriendRequest(
  requestId: string,
  userId: string,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured.' };
  const resp = await supabase
    .from('friends')
    .update({ status: 'accepted' })
    .eq('id', requestId)
    .eq('friend_user_id', userId);
  if (resp.error) return { error: normalizeDbError(resp.error.message) };
  invalidateFriendsCache(userId);
  return { error: null };
}

export async function declineFriendRequest(
  requestId: string,
  userId: string,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured.' };
  const resp = await supabase.from('friends').delete().eq('id', requestId).eq('friend_user_id', userId);
  if (resp.error) return { error: normalizeDbError(resp.error.message) };
  invalidateFriendsCache(userId);
  return { error: null };
}

export async function removeFriend(
  requestId: string,
  userId: string,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured.' };
  const resp = await supabase
    .from('friends')
    .delete()
    .eq('id', requestId)
    .or(`user_id.eq.${userId},friend_user_id.eq.${userId}`);
  if (resp.error) return { error: normalizeDbError(resp.error.message) };
  invalidateFriendsCache(userId);
  return { error: null };
}
