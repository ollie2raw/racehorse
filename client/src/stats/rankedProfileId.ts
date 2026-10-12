const REGISTERED_USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Only registered accounts (Supabase auth uuids) have a ranked profile. Guest
 * seats carry a client-minted `guest_<…>` id and bots their own ids; those are
 * never looked up — the UI renders its unrated guest state instead.
 */
export function hasRankedProfile(userId: string | null | undefined): userId is string {
  return typeof userId === 'string' && REGISTERED_USER_ID_RE.test(userId.trim());
}
