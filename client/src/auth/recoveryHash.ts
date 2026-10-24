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

/** Written when THIS browser asks Supabase to send a reset email; lets the matching link sign in without a prompt. */
export const PASSWORD_RESET_REQUEST_KEY = 'racehorse_password_reset_requested';
const RESET_REQUEST_TTL_MS = 60 * 60 * 1000;

export function rememberPasswordResetRequest(email: string): void {
  try {
    window.localStorage.setItem(
      PASSWORD_RESET_REQUEST_KEY,
      JSON.stringify({ email: email.trim().toLowerCase(), at: Date.now() }),
    );
  } catch {
    /* noop */
  }
}

function hasMatchingResetRequest(email: string): boolean {
  try {
    const raw = window.localStorage.getItem(PASSWORD_RESET_REQUEST_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { email?: unknown; at?: unknown };
    const fresh = typeof parsed.at === 'number' && Date.now() - parsed.at <= RESET_REQUEST_TTL_MS;
    const matches = typeof parsed.email === 'string' && parsed.email === email.trim().toLowerCase();
    return fresh && matches;
  } catch {
    return false;
  }
}

function clearResetRequest(): void {
  try {
    window.localStorage.removeItem(PASSWORD_RESET_REQUEST_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Removes auth material from the visible URL (hash and query) without touching the router state.
 * Safe to call once the tokens have been consumed, held in memory, or are known to be unusable.
 */
export function scrubAuthMaterialFromUrl(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  let changed = false;
  for (const key of ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'token_hash']) {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  }
  const nextHash = hash.startsWith('#') && !hash.startsWith('#/') && hash.includes('access_token=') ? '' : hash;
  if (nextHash !== hash) changed = true;
  if (!changed) return;
  const nextSearch = params.toString();
  window.history.replaceState(window.history.state, '', `${pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`);
}

// ---- Unsolicited recovery links -------------------------------------------------------------------------------
// A recovery link is a bearer credential for WHICHEVER account requested it. Anyone can request one for their own
// account and hand the resulting URL to someone else; applying it silently signs the recipient's browser in as the
// sender's account (login CSRF / session fixation). So a link is only applied without a prompt when this browser
// asked for that reset; otherwise the verified account email is shown and the user must confirm.
type HeldRecovery = { email: string; access_token: string; refresh_token: string };
let held: HeldRecovery | null = null;
let snapshot: { email: string } | null = null;
const listeners = new Set<() => void>();

function setHeld(next: HeldRecovery | null): void {
  held = next;
  snapshot = next ? { email: next.email } : null;
  listeners.forEach((listener) => listener());
}

export function subscribeRecoveryConfirmation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** The account a held recovery link would sign in as (never the tokens). Stable between changes. */
export function getRecoveryConfirmation(): { email: string } | null {
  return snapshot;
}
export function declineRecoveryConfirmation(): void {
  setHeld(null);
}
export async function acceptRecoveryConfirmation(): Promise<boolean> {
  const current = held;
  if (!current) return false;
  setHeld(null);
  return establishRecoverySession(current);
}

async function establishRecoverySession(tokens: { access_token: string; refresh_token: string }): Promise<boolean> {
  if (!supabase) return false;
  // Marker first: the SIGNED_IN event produced by setSession is what opens the new-password form.
  try {
    window.sessionStorage.setItem(PASSWORD_RECOVERY_PENDING_KEY, '1');
  } catch {
    // no-op
  }
  const { error } = await supabase.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  if (error) {
    try {
      window.sessionStorage.removeItem(PASSWORD_RECOVERY_PENDING_KEY);
    } catch {
      // no-op
    }
    reportRecoverySetSessionFailure(error, {
      accessTokenLen: tokens.access_token.length,
      refreshTokenLen: tokens.refresh_token.length,
    });
    return false;
  }
  return true;
}

/**
 * If the current URL carries a Supabase password-recovery hash, verify it with the auth server and either sign in
 * (this browser requested that reset) or hold it for explicit confirmation. Auth material is removed from the URL once
 * it is consumed, held in memory, or known to be unusable. Returns true when a recovery session was established
 * (the new-password form opens from the SIGNED_IN event).
 *
 * On a transient failure (network) the hash is left in place so a refresh can retry: tokens are never cleared before
 * proof of a durable session or of an unusable link.
 */
export async function consumeSupabaseRecoveryHash(): Promise<boolean> {
  if (typeof window === 'undefined' || !supabase) return false;

  const parsed = parseSupabaseAuthHash(window.location.hash);
  if (!parsed) {
    scrubAuthMaterialFromUrl();
    return false;
  }
  if (parsed.type !== 'recovery') {
    // Signup/magiclink/invite/email-change tokens are not consumed by this app (detectSessionInUrl is off); they must
    // not linger in the address bar, history entry or telemetry.
    scrubAuthMaterialFromUrl();
    return false;
  }

  const { access_token, refresh_token } = parsed;

  // Ask the auth server who these tokens belong to WITHOUT adopting them. Anything not issued to a real, current
  // session (forged, expired, revoked) is rejected here and never reaches setSession.
  let verifiedEmail: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser(access_token);
    if (error) {
      const status = (error as { status?: number }).status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        console.warn('[auth] recovery link rejected by auth server', { status });
        scrubAuthMaterialFromUrl();
      } else {
        reportRecoverySetSessionFailure(error, {
          accessTokenLen: access_token.length,
          refreshTokenLen: refresh_token.length,
        });
      }
      return false;
    }
    verifiedEmail = data.user?.email?.trim().toLowerCase() || null;
  } catch (error) {
    reportRecoverySetSessionFailure(error as { message?: string }, {
      accessTokenLen: access_token.length,
      refreshTokenLen: refresh_token.length,
    });
    return false;
  }
  if (!verifiedEmail) {
    scrubAuthMaterialFromUrl();
    return false;
  }

  if (!hasMatchingResetRequest(verifiedEmail)) {
    setHeld({ email: verifiedEmail, access_token, refresh_token });
    scrubAuthMaterialFromUrl();
    return false;
  }

  const established = await establishRecoverySession({ access_token, refresh_token });
  if (!established) return false; // hash and request marker intentionally kept: a refresh can retry
  clearResetRequest();
  // Strip auth tokens from the URL only after the session is established.
  // Bootstrap awaits this before mounting the router, so App navigate effects
  // never see the recovery hash on the success path.
  clearRecoveryHash();
  return true;
}
