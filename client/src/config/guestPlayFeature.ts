/**
 * Guest play (docs/guest-play-design.md): a visitor plays Daily Fritz and Play vs Fritz on an anonymous Supabase session
 * and keeps the games when they create an account.
 *
 * Off until the server and database half is deployed. Without the eligibility filter (roadmap 3.12, `profiles.is_guest`
 * excluded from leaderboards and tournaments) a guest could appear on a leaderboard under a placeholder name, so this
 * flag must not be turned on before that migration is live. On only when VITE_ENABLE_GUEST_PLAY is exactly "true"
 * (build-time).
 */
export function parseGuestPlayFlag(value: unknown): boolean {
  return value === 'true';
}

export function isGuestPlayEnabled(value: unknown = import.meta.env.VITE_ENABLE_GUEST_PLAY): boolean {
  return parseGuestPlayFlag(value);
}
