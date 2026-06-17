/** Production client origin — must match Supabase Auth Site URL + Redirect URLs. */
const CANONICAL_CLIENT_ORIGIN = 'https://racehorsedoms.vercel.app';

/**
 * Redirect target for Supabase auth emails (signup confirm + password recovery).
 *
 * Use the canonical production origin on Vercel preview URLs so recovery links
 * are always allowlisted. Local dev keeps `http://localhost:…`.
 */
export function getAuthEmailRedirectTo(): string {
  if (typeof window === 'undefined') return CANONICAL_CLIENT_ORIGIN;

  const { origin, hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return origin;
  }
  if (hostname.endsWith('.vercel.app')) {
    return CANONICAL_CLIENT_ORIGIN;
  }
  return origin;
}
