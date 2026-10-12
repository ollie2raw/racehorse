import { Capacitor } from '@capacitor/core';

/** Production client origin — must match Supabase Auth Site URL + Redirect URLs. */
const CANONICAL_CLIENT_ORIGIN = 'https://playracehorse.com';

const LEGACY_CLIENT_ORIGINS = new Set([
  'https://racehorsedoms.vercel.app',
  'https://playracehorse.com',
]);

/**
 * Redirect target for Supabase auth emails (signup confirm + password recovery).
 *
 * Use the canonical production origin on Vercel preview URLs so recovery links
 * are always allowlisted. Local dev keeps `http://localhost:…`.
 *
 * The iOS app always uses the canonical site. Its WebView origin is
 * `capacitor://localhost`, which no mail client can open (and which looks like
 * local dev by hostname, hence the check comes first). The reset or email
 * change finishes on playracehorse.com; the player then signs in to the app.
 */
export function getAuthEmailRedirectTo(isNativeApp: boolean = Capacitor.isNativePlatform()): string {
  if (isNativeApp) return CANONICAL_CLIENT_ORIGIN;
  if (typeof window === 'undefined') return CANONICAL_CLIENT_ORIGIN;

  const { origin, hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return origin;
  }
  if (hostname.endsWith('.vercel.app') || LEGACY_CLIENT_ORIGINS.has(origin)) {
    return CANONICAL_CLIENT_ORIGIN;
  }
  return origin;
}
