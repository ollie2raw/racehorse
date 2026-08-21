import type { Request, Response } from 'express';
import { supabaseFetch } from '../supabaseUtils';

export async function requireAuth(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  try {
    const userData = await supabaseFetch<{ id?: string }>(
      `/auth/v1/user`,
      { headers: { Authorization: `Bearer ${token}` } } as RequestInit,
    );
    const userId = (userData as { id?: string })?.id ?? null;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    return userId;
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

export type AcceptedFriendRow = { id: string; user_id: string; friend_user_id: string };

/**
 * Accepted friendship rows for a user, in full. Callers that need the row `id`
 * as well as the other party's id should use this and derive the ids with
 * `friendIdsFromRows`, rather than querying `friends` a second time.
 */
export async function getFriendRows(userId: string): Promise<AcceptedFriendRow[]> {
  const enc = encodeURIComponent(userId);
  return supabaseFetch<AcceptedFriendRow[]>(
    `/rest/v1/friends` +
    `?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
    `&status=eq.accepted` +
    `&select=id,user_id,friend_user_id`,
  );
}

export function friendIdsFromRows(userId: string, rows: AcceptedFriendRow[]): string[] {
  return rows.map((r) => (r.user_id === userId ? r.friend_user_id : r.user_id));
}

export async function getFriendIds(userId: string): Promise<string[]> {
  return friendIdsFromRows(userId, await getFriendRows(userId));
}