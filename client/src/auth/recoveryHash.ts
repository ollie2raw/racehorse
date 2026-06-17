import { supabase } from '../lib/supabase';

export const PASSWORD_RECOVERY_PENDING_KEY = 'racehorse_password_recovery_pending';

export type SupabaseAuthHashPayload = {
  access_token: string;
  refresh_token: string;
  type: string;
};

/**
 * Parse Supabase auth callback params from the URL hash.
 *
 * HashRouter owns hashes that start with "#/…". Supabase recovery links land as
 * "#/access_token=…&type=recovery" is wrong — they use a bare query string hash:
 *   #access_token=…&refresh_token=…&type=recovery
 *
 * We must read and clear that hash before React/HashRouter runs navigate(), which
 * would replace it with "#/".
 */
export function parseSupabaseAuthHash(rawHash: string): SupabaseAuthHashPayload | null {
  const hash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  if (!hash || hash.startsWith('/')) return null;
  if (!hash.includes('access_token=')) return null;

  const params = new URLSearchParams(hash);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const type = params.get('type') ?? '';

  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token, type };
}

function clearHashToHomeRoute(): void {
  const next = `${window.location.pathname}${window.location.search}#/`;
  window.history.replaceState(window.history.state, '', next);
}

/**
 * If the current URL carries a Supabase password-recovery hash, exchange it for a
 * session and normalize the hash to "#/". Returns true when a recovery session was
 * established (PASSWORD_RECOVERY will fire via onAuthStateChange).
 */
export async function consumeSupabaseRecoveryHash(): Promise<boolean> {
  if (typeof window === 'undefined' || !supabase) return false;

  const parsed = parseSupabaseAuthHash(window.location.hash);
  if (!parsed || parsed.type !== 'recovery') return false;

  const { access_token, refresh_token } = parsed;

  // Strip auth tokens from the hash before App's navigate() effect can run.
  clearHashToHomeRoute();

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) {
    console.warn('[auth] recovery hash setSession failed:', error.message);
    return false;
  }

  try {
    window.sessionStorage.setItem(PASSWORD_RECOVERY_PENDING_KEY, '1');
  } catch {
    // no-op
  }

  return true;
}
