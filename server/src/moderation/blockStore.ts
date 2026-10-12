import { childLogger } from '../logger';
import { supabaseFetch } from '../supabaseUtils';

const log = childLogger('moderation:blocks');

type BlockRow = { blocker_user_id: string; blocked_user_id: string };

/** Users this account has blocked (one direction only: never reveals who blocked you). */
export async function listBlockedByUser(blockerUserId: string): Promise<string[]> {
  const rows = await supabaseFetch<BlockRow[]>(
    `/rest/v1/user_blocks?blocker_user_id=eq.${encodeURIComponent(blockerUserId)}` +
      `&select=blocker_user_id,blocked_user_id&order=created_at.desc`,
  );
  return (rows ?? []).map((r) => r.blocked_user_id);
}

/**
 * Everyone on the other side of a block with this user, in either direction.
 * Enforcement uses both directions: neither party can reach the other.
 */
export async function listBlockCounterparties(userId: string): Promise<Set<string>> {
  const enc = encodeURIComponent(userId);
  const rows = await supabaseFetch<BlockRow[]>(
    `/rest/v1/user_blocks?or=(blocker_user_id.eq.${enc},blocked_user_id.eq.${enc})` +
      `&select=blocker_user_id,blocked_user_id`,
  );
  const ids = new Set<string>();
  for (const r of rows ?? []) ids.add(r.blocker_user_id === userId ? r.blocked_user_id : r.blocker_user_id);
  return ids;
}

/** True when either user has blocked the other. Throws if the lookup fails. */
export async function isBlockedPair(a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const ea = encodeURIComponent(a);
  const eb = encodeURIComponent(b);
  const rows = await supabaseFetch<BlockRow[]>(
    `/rest/v1/user_blocks?or=(and(blocker_user_id.eq.${ea},blocked_user_id.eq.${eb}),` +
      `and(blocker_user_id.eq.${eb},blocked_user_id.eq.${ea}))&select=blocker_user_id,blocked_user_id&limit=1`,
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Result of a block check that may fail: `unknown` means the lookup failed. */
export type BlockStatus = 'blocked' | 'clear' | 'unknown';

/**
 * Enforcement-path check. NEW user-to-user interactions (friend requests,
 * invites, Quick Match pairing, new private-room seats) fail CLOSED: callers
 * treat `unknown` exactly like `blocked` and refuse, with a generic outward
 * response that reveals neither a block nor an internal failure.
 *
 * Restoring an existing, already-authorised game state (a player reclaiming
 * the seat they hold) never consults blocks, so a moderation outage can't
 * strand anyone mid-match.
 */
export async function blockStatus(a: string, b: string, context: string): Promise<BlockStatus> {
  try {
    return (await isBlockedPair(a, b)) ? 'blocked' : 'clear';
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err, context }, 'block lookup failed; refusing');
    return 'unknown';
  }
}

/** Fail-closed list for the matchmaking join: null when the lookup failed. */
export async function listBlockCounterpartiesOrNull(userId: string, context: string): Promise<Set<string> | null> {
  try {
    return await listBlockCounterparties(userId);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err, context }, 'block list lookup failed; refusing');
    return null;
  }
}

/** Idempotent. Also removes any friendship or pending request between the pair. */
export async function createBlock(blockerUserId: string, blockedUserId: string): Promise<void> {
  await supabaseFetch('/rest/v1/user_blocks?on_conflict=blocker_user_id,blocked_user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ blocker_user_id: blockerUserId, blocked_user_id: blockedUserId }),
  });
  const ea = encodeURIComponent(blockerUserId);
  const eb = encodeURIComponent(blockedUserId);
  await supabaseFetch(
    `/rest/v1/friends?or=(and(user_id.eq.${ea},friend_user_id.eq.${eb}),and(user_id.eq.${eb},friend_user_id.eq.${ea}))`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
  );
}

/** Idempotent. Only ever removes the caller's own block. */
export async function deleteBlock(blockerUserId: string, blockedUserId: string): Promise<void> {
  await supabaseFetch(
    `/rest/v1/user_blocks?blocker_user_id=eq.${encodeURIComponent(blockerUserId)}` +
      `&blocked_user_id=eq.${encodeURIComponent(blockedUserId)}`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
  );
}
