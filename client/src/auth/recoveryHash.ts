import * as Sentry from '@sentry/react';
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
 * Legacy client routes start with "#/…". Supabase recovery links instead use a
 * bare query string hash:
 *   #access_token=…&refresh_token=…&type=recovery
 *
 * Callers must read the hash before the router starts (see `main.tsx` bootstrap).
 * Tokens are cleared from the URL only after `setSession` succeeds — clearing
 * first burned one-shot recovery links on transient setSession failures.
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

function clearRecoveryHash(): void {
  const next = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(window.history.state, '', next);
}

function reportRecoverySetSessionFailure(
  error: { message?: string; status?: number; name?: string },
  tokenMeta: { accessTokenLen: number; refreshTokenLen: number },
): void {
  const message = error.message ?? 'unknown';
  const extra = {
    auth_flow: 'password_recovery',
    hash_type: 'recovery',
    pathname: typeof window !== 'undefined' ? window.location.pathname : null,
    // Lengths only — never token material.
    access_token_len: tokenMeta.accessTokenLen,
    refresh_token_len: tokenMeta.refreshTokenLen,
    error_name: error.name ?? null,
    error_status: error.status ?? null,
    hash_still_present: typeof window !== 'undefined' && window.location.hash.includes('access_token='),
  };

  // Always visible in prod consoles / log drains; Sentry for alerting.
  console.warn('[auth] recovery hash setSession failed', { message, ...extra });
  Sentry.captureMessage(`[auth] recovery hash setSession failed: ${message}`, {
    level: 'error',
    tags: {
      auth_alert: 'recovery_set_session_failed',
      auth_flow: 'password_recovery',
    },
    extra: { message, ...extra },
  });
}

/**
 * If the current URL carries a Supabase password-recovery hash, exchange it for a
 * session and remove the sensitive hash. Returns true when a recovery session was
 * established (PASSWORD_RECOVERY will fire via onAuthStateChange).
 *
 * On setSession failure the hash is left in place so a refresh can retry; tokens
 * are never cleared before proof of a durable session.
 */
export async function consumeSupabaseRecoveryHash(): Promise<boolean> {
  if (typeof window === 'undefined' || !supabase) return false;

  const parsed = parseSupabaseAuthHash(window.location.hash);
  if (!parsed || parsed.type !== 'recovery') return false;

  const { access_token, refresh_token } = parsed;

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) {
    reportRecoverySetSessionFailure(error, {
      accessTokenLen: access_token.length,
      refreshTokenLen: refresh_token.length,
    });
    return false;
  }

  // Strip auth tokens from the URL only after the session is established.
  // Bootstrap awaits this before mounting the router, so App navigate effects
  // never see the recovery hash on the success path.
  clearRecoveryHash();

  try {
    window.sessionStorage.setItem(PASSWORD_RECOVERY_PENDING_KEY, '1');
  } catch {
    // no-op
  }

  return true;
}
