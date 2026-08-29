import { identifyUser, resetAnalytics } from '../lib/analytics';
import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import type { AuthChangeEvent, User } from '@supabase/supabase-js';
import { getSupabaseConfigError, isSupabaseConfigured, supabase } from '../lib/supabase';
import { formatAuthErrorMessage } from './authErrors';
import { clearCachedSession, setCachedSession } from './sessionToken';
import { getAuthEmailRedirectTo } from './authRedirect';
import { evaluateAuthTimeoutSessionFallback, AUTH_TIMEOUT_FALLBACK_ERROR } from './authTimeoutSessionFallback';
import { PASSWORD_RECOVERY_PENDING_KEY } from './recoveryHash';
import { readE2eDevAuth } from './e2eDevAuth';
import { EMAIL_CHANGE_PENDING_MESSAGE, resolveEmailChange } from './emailChange';

export interface UserProfile {
  id: string;
  username: string;
  created_at?: string;
  glicko_rating?: number | null;
  glicko_rd?: number | null;
  glicko_vol?: number | null;
  ghost_rating?: number | null;
  ranked_games_played?: number | null;
}

interface AuthResult {
  error: string | null;
  message?: string | null;
  pendingVerification?: boolean;
}

const TEMP_USERNAME_PREFIX = 'user_';
const USERNAME_REQUEST_TIMEOUT_MS = 10000;
const AUTH_REQUEST_TIMEOUT_MS = 15000;
const SESSION_BOOTSTRAP_TIMEOUT_MS = 8000;
const SIGN_OUT_TIMEOUT_MS = 1200;
const AUTH_RETRY_DELAY_MS = 350;
const PROFILE_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_GLICKO_RATING = 800;
const DEFAULT_GLICKO_RD = 200;
const DEFAULT_GLICKO_VOL = 0.06;
const EMAIL_VERIFICATION_PENDING_KEY = 'racehorse_email_verification_pending';

function needsLegacyRatingNormalization(profile: Record<string, unknown> | null | undefined): boolean {
  if (!profile) return false;
  const rating = Number(profile.glicko_rating ?? NaN);
  const games = Number(profile.ranked_games_played ?? 0);
  const peakRaw = profile.peak_rating;
  const peak = peakRaw == null ? null : Number(peakRaw);
  return games === 0 && rating === 1500 && (peak === null || peak === 0 || peak === 1500);
}

export function isTemporaryUsername(username: string | null | undefined): boolean {
  if (!username) return true;
  return username.startsWith(TEMP_USERNAME_PREFIX);
}

function normalizeDesiredUsername(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized.length < 3) return null;
  if (!/^[a-z0-9_]+$/.test(normalized)) return null;
  return normalized;
}

async function ensureProfile(user: User): Promise<void> {
  if (!supabase) return;
  const client = supabase;
  const userId = user.id;
  try {
    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), PROFILE_REQUEST_TIMEOUT_MS);
    });
    const profilePromise =
      client
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle()
        .then(({ data, error }) => ({ timedOut: false as const, data, error }));

    const result = await Promise.race([profilePromise, timeoutPromise]);
    if ('timedOut' in result && result.timedOut) {
      console.warn('[auth] ensureProfile timed out; continuing without blocking auth');
      return;
    }
    if (result.error || !result.data) {
      console.warn(
        '[auth] profile bootstrap trigger has not produced a profile; continuing without blocking auth',
        result.error,
      );
    }
  } catch (err) {
    console.warn('[auth] ensureProfile errored; continuing without blocking auth', err);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Request timed out. Try again.'));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message.toLowerCase().includes('timed out');
}

function isRetryableAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('request failed')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clearLocalSupabaseAuthTokens(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys = Object.keys(window.localStorage);
    for (const key of keys) {
      if (key.startsWith('sb-') && key.includes('auth-token')) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // no-op
  }
}

function markEmailVerificationPending(email: string): void {
  if (typeof window === 'undefined') return;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return;
  try {
    window.localStorage.setItem(
      EMAIL_VERIFICATION_PENDING_KEY,
      JSON.stringify({ email: normalizedEmail, createdAt: Date.now() }),
    );
  } catch {
    // no-op
  }
}

function clearPasswordRecoveryPendingMarker(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PASSWORD_RECOVERY_PENDING_KEY);
  } catch {
    // no-op
  }
}

function hasPasswordRecoveryPendingMarker(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

function consumeEmailVerificationPending(email: string | null | undefined): boolean {
  if (typeof window === 'undefined') return false;
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return false;
  try {
    const raw = window.localStorage.getItem(EMAIL_VERIFICATION_PENDING_KEY);
    if (!raw) return false;
    window.localStorage.removeItem(EMAIL_VERIFICATION_PENDING_KEY);
    const parsed = JSON.parse(raw) as { email?: unknown; createdAt?: unknown };
    const pendingEmail =
      typeof parsed.email === 'string' ? parsed.email.trim().toLowerCase() : '';
    const createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : 0;
    const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
    if (!pendingEmail || pendingEmail !== normalizedEmail) return false;
    if (!createdAt || Date.now() - createdAt > maxAgeMs) return false;
    return true;
  } catch {
    return false;
  }
}

function useAuthInternal() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [justVerified, setJustVerified] = useState(false);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);

  const fallbackProfile = useCallback((sessionUser: User): UserProfile => {
    const derived = sessionUser.email?.split('@')[0]?.trim().toLowerCase();
    return {
      id: sessionUser.id,
      username: derived || `${TEMP_USERNAME_PREFIX}${sessionUser.id.replace(/-/g, '').slice(0, 8)}`,
    };
  }, []);

  const refreshProfile = useCallback(async (sessionUser: User) => {
    if (!supabase) {
      setProfile(fallbackProfile(sessionUser));
      return;
    }
    const client = supabase;

    try {
      const applyResolvedProfile = async (rawProfileData: Record<string, unknown>) => {
        let profileData = rawProfileData;
        if (needsLegacyRatingNormalization(profileData)) {
          const normalizedPatch = {
            glicko_rating: DEFAULT_GLICKO_RATING,
            glicko_rd: DEFAULT_GLICKO_RD,
            glicko_vol: DEFAULT_GLICKO_VOL,
            provisional: true,
            peak_rating: DEFAULT_GLICKO_RATING,
            ranked_games_played: 0,
          };
          // Display the current default locally. The server normalizes the
          // persisted legacy value before its first authoritative rating write.
          profileData = {
            ...profileData,
            ...normalizedPatch,
          };
        }
        let ghostRating: number | null = null;
        try {
          const ghostResp = await Promise.race([
            client
              .from('ghost_profiles')
              .select('ghost_rating')
              .eq('user_id', sessionUser.id)
              .maybeSingle()
              .then(({ data }) => data),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), PROFILE_REQUEST_TIMEOUT_MS)),
          ]);
          ghostRating =
            ghostResp && typeof ghostResp === 'object' && 'ghost_rating' in ghostResp
              ? Number((ghostResp as { ghost_rating?: unknown }).ghost_rating ?? 800)
              : null;
        } catch {
          ghostRating = null;
        }
        setProfile((prev) => {
          if (prev && prev.id === sessionUser.id) {
            return {
              ...prev,
              ...(profileData as unknown as UserProfile),
              ghost_rating: ghostRating,
            };
          }
          return {
            ...(profileData as unknown as UserProfile),
            ghost_rating: ghostRating,
          };
        });
      };

      const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
        setTimeout(() => resolve({ timedOut: true }), PROFILE_REQUEST_TIMEOUT_MS);
      });
      const queryPromise = client
        .from('profiles')
        .select(
          'id, username, created_at, glicko_rating, glicko_rd, glicko_vol, provisional, peak_rating, ranked_games_played',
        )
        .eq('id', sessionUser.id)
        .maybeSingle()
        .then(({ data, error }) => ({ timedOut: false as const, data, error }));

      const result = await Promise.race([queryPromise, timeoutPromise]);
      if ('timedOut' in result && result.timedOut) {
        console.warn('[auth] refreshProfile timed out; preserving current profile until the response arrives');
        void queryPromise.then(
          async (lateResult) => {
            if (lateResult.error || !lateResult.data) return;
            await applyResolvedProfile(lateResult.data as Record<string, unknown>);
          },
          (err: unknown) => {
            console.warn('[auth] late refreshProfile resolution failed', err);
          },
        );
        setProfile((prev) => (prev && prev.id === sessionUser.id ? prev : fallbackProfile(sessionUser)));
        return;
      }
      if (result.error || !result.data) {
        if (result.error) {
          console.warn('[auth] refreshProfile failed; preserving current profile', result.error);
        }
        setProfile((prev) => (prev && prev.id === sessionUser.id ? prev : fallbackProfile(sessionUser)));
        return;
      }
      await applyResolvedProfile(result.data as Record<string, unknown>);
    } catch (err) {
      console.warn('[auth] refreshProfile errored; preserving current profile', err);
      setProfile((prev) => (prev && prev.id === sessionUser.id ? prev : fallbackProfile(sessionUser)));
    }
  }, [fallbackProfile]);

  const hydrateProfile = useCallback(
    async (sessionUser: User): Promise<void> => {
      await ensureProfile(sessionUser);
      await refreshProfile(sessionUser);
    },
    [refreshProfile],
  );

  useEffect(() => {
    let active = true;
    /**
     * Set once a live auth event has delivered a real signed-in user. The
     * bootstrap `getSession()` call can stay pending long after it timed out,
     * and when it finally settles it must not overwrite a *newer*, authoritative
     * signed-in state that arrived via onAuthStateChange in the meantime —
     * otherwise a slow connection silently signs the user back out.
     */
    let signedInObserved = false;

    const syncSession = async (
      event: AuthChangeEvent | 'INITIAL_BOOTSTRAP',
      sessionUser: User | null,
    ) => {
      if (!active) return;
      if (event === 'SIGNED_OUT' || !sessionUser) {
        setUser(null);
        setProfile(null);
        setAccessToken(null);
        return;
      }

      setUser(sessionUser);
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryPending(true);
        try {
          window.sessionStorage.setItem(PASSWORD_RECOVERY_PENDING_KEY, '1');
        } catch {
          // no-op
        }
      }
      if (
        event === 'SIGNED_IN' &&
        sessionUser.email_confirmed_at &&
        consumeEmailVerificationPending(sessionUser.email)
      ) {
        // Only show the verification toast after a signup flow in this browser
        // actually left a pending verification marker.
        setJustVerified((prev) => {
          if (prev) return prev;
          return true;
        });
        setTimeout(() => setJustVerified(false), 8000);
      }
      if (
        event === 'SIGNED_IN' ||
        event === 'INITIAL_SESSION' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED' ||
        event === 'INITIAL_BOOTSTRAP'
      ) {
        void hydrateProfile(sessionUser);
      }
    };

    const init = async () => {
      const e2eAuth = readE2eDevAuth();
      if (e2eAuth) {
        if (active) {
          setUser(e2eAuth.user);
          setAccessToken(e2eAuth.token);
          setProfile({
            id: e2eAuth.user.id,
            username: 'e2e_daily_fritz',
          });
          setLoading(false);
        }
        return;
      }

      if (!supabase) {
        if (active) {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      // A slow session restore (phone on a weak connection, a stalled token
      // refresh) must not be reported as "signed out". Timing out only means the
      // answer has not arrived yet, so keep the session state unresolved and let
      // the real result land via the late resolution below or onAuthStateChange.
      const client = supabase;
      const sessionPromise = client.auth.getSession();
      let timedOut = false;

      const applySession = async (
        session: Awaited<ReturnType<typeof client.auth.getSession>>['data']['session'],
      ) => {
        if (!active) return;
        if (session?.access_token) setCachedSession(session.access_token, session.user?.id ?? null);
        else clearCachedSession();
        setAccessToken(session?.access_token ?? null);
        await syncSession('INITIAL_BOOTSTRAP', session?.user ?? null);
        if (session?.user && hasPasswordRecoveryPendingMarker()) {
          setPasswordRecoveryPending(true);
        }
      };

      try {
        const {
          data: { session },
        } = await withTimeout(sessionPromise, SESSION_BOOTSTRAP_TIMEOUT_MS);
        await applySession(session);
        if (active) setLoading(false);
      } catch {
        timedOut = true;
        console.warn('[auth] session bootstrap did not settle in time; holding auth as unresolved');
      }

      if (!timedOut) return;

      // Still unresolved: stay in the loading state (callers render "checking",
      // not "signed out") until getSession actually answers. Whatever it answers
      // is stale the moment a live auth event has already reported a signed-in
      // user, so in that case only settle `loading` and leave the session alone.
      void sessionPromise.then(
        async ({ data: { session } }) => {
          if (!active) return;
          if (signedInObserved && !session?.user) {
            setLoading(false);
            return;
          }
          await applySession(session);
          if (active) setLoading(false);
        },
        (err: unknown) => {
          console.warn('[auth] session bootstrap failed', err);
          if (!active) return;
          setLoading(false);
          if (signedInObserved) return;
          setUser(null);
          setProfile(null);
          setAccessToken(null);
        },
      );
    };

    void init();

    if (!supabase)
      return () => {
        active = false;
      };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;
      try {
        if (session?.user) signedInObserved = true;
        else if (event === 'SIGNED_OUT') signedInObserved = false;
        // Keep the module-level session cache authoritative: every request
        // reads from it instead of calling getSession() again.
        if (session?.access_token) setCachedSession(session.access_token, session.user?.id ?? null);
        else clearCachedSession();
        setAccessToken(session?.access_token ?? null);
        await syncSession(event, session?.user ?? null);
      } finally {
        if (active) setLoading(false);
      }
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && supabase) {
        void supabase.auth
          .getSession()
          .then(({ data: { session } }) => {
            const nextUser = session?.user ?? null;
            setUser(nextUser);
            if (nextUser) {
              void hydrateProfile(nextUser);
            } else {
              setProfile(null);
            }
          })
          .catch(() => {
            setProfile(null);
          });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      subscription.unsubscribe();
    };
  }, [hydrateProfile]);

  const signUp = useCallback(
    async (email: string, password: string, username?: string): Promise<AuthResult> => {
      if (!supabase) return { error: getSupabaseConfigError() };
      const client = supabase;
      const normalizedUsername = normalizeDesiredUsername(username ?? null);
      if (!normalizedUsername) {
        return { error: 'Username must be at least 3 characters and use lowercase letters, numbers, and underscores only.' };
      }
      const runSignUp = async () =>
        withTimeout(
          client.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: typeof window !== 'undefined' ? getAuthEmailRedirectTo() : undefined,
              data: {
                preferred_username: normalizedUsername,
                username: normalizedUsername,
              },
            },
          }),
          AUTH_REQUEST_TIMEOUT_MS,
        );
      try {
        let result: Awaited<ReturnType<typeof runSignUp>>;
        try {
          result = await runSignUp();
        } catch (firstErr) {
          if (!isRetryableAuthError(firstErr)) throw firstErr;
          await delay(AUTH_RETRY_DELAY_MS);
          result = await runSignUp();
        }
        const { data, error } = result;
        if (error) return { error: formatAuthErrorMessage(error) };

        if (data.user) {
          void hydrateProfile(data.user);
          if (!data.session) {
            markEmailVerificationPending(email);
            return {
              error: null,
              pendingVerification: true,
              message: 'Account created. Check your email and verify your address to finish signing in.',
            };
          }
        }

        return { error: null, message: 'Account created.' };
      } catch (err) {
        if (isTimeoutError(err)) {
          try {
            const {
              data: { session },
            } = await withTimeout(supabase.auth.getSession(), 3000);
            const fallback = evaluateAuthTimeoutSessionFallback({
              session,
              attemptedEmail: email,
              flow: 'sign_up',
            });
            if (!fallback.ok) {
              // Unrelated / missing session: real timeout. Do not clear that session.
              return { error: fallback.error };
            }
            if (session?.user) {
              void hydrateProfile(session.user);
              return { error: null };
            }
            return { error: AUTH_TIMEOUT_FALLBACK_ERROR };
          } catch {
            // ignore probe failures; fall through to timeout error
          }
        }
        return { error: err instanceof Error ? err.message : 'Unable to sign up.' };
      }
    },
    [hydrateProfile],
  );

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!supabase) return { error: getSupabaseConfigError() };
      const client = supabase;
      const runSignIn = async () =>
        withTimeout(client.auth.signInWithPassword({ email, password }), AUTH_REQUEST_TIMEOUT_MS);
      try {
        let result: Awaited<ReturnType<typeof runSignIn>>;
        try {
          result = await runSignIn();
        } catch (firstErr) {
          if (!isRetryableAuthError(firstErr)) throw firstErr;
          await delay(AUTH_RETRY_DELAY_MS);
          result = await runSignIn();
        }
        const { data, error } = result;
        if (error) return { error: formatAuthErrorMessage(error) };

        if (data.user) {
          void hydrateProfile(data.user);
        }

        return { error: null };
      } catch (err) {
        if (isTimeoutError(err)) {
          try {
            const {
              data: { session },
            } = await withTimeout(supabase.auth.getSession(), 3000);
            const fallback = evaluateAuthTimeoutSessionFallback({
              session,
              attemptedEmail: email,
              flow: 'sign_in',
            });
            if (!fallback.ok) {
              // Unrelated / missing session: real timeout. Do not clear that session.
              return { error: fallback.error };
            }
            if (session?.user) {
              void hydrateProfile(session.user);
              return { error: null };
            }
            return { error: AUTH_TIMEOUT_FALLBACK_ERROR };
          } catch {
            // ignore probe failures; fall through to timeout error
          }
        }
        return { error: err instanceof Error ? err.message : 'Unable to sign in.' };
      }
    },
    [hydrateProfile],
  );

  const signOut = useCallback(async (): Promise<AuthResult> => {
    if (!supabase) return { error: getSupabaseConfigError() };

    const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
    if (isDev) {
       
      console.warn('[Auth] signOut start');
    }

    let errorMessage: string | null = null;
    let usedTimeoutFallback = false;

    // Optimistically reset local auth UI immediately. Drop the cached session
    // in the same breath: signOut has a timeout fallback, and until the
    // SIGNED_OUT event lands a stale token would still be attached to requests.
    clearCachedSession();
    setProfile(null);
    setUser(null);

    try {
      const signOutPromise = supabase.auth.signOut().then(({ error }) => ({
        kind: 'signout' as const,
        error,
      }));
      const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
        setTimeout(() => resolve({ kind: 'timeout' }), SIGN_OUT_TIMEOUT_MS);
      });

      const result = await Promise.race([signOutPromise, timeoutPromise]);
      if (result.kind === 'timeout') {
        usedTimeoutFallback = true;
        if (isDev) {
           
          console.warn('[Auth] signOut timed out; forcing local token clear');
        }

        // IMPORTANT: do not await anything that can hang here. We want UI to recover.
        try {
          void supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        } catch {
          // ignore
        } finally {
          clearLocalSupabaseAuthTokens();
        }
      } else if (result.error) {
        errorMessage = result.error.message;
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Unable to sign out.';
    } finally {
      clearLocalSupabaseAuthTokens();
      setProfile(null);
      setUser(null);
      if (isDev) {
         
        console.warn('[Auth] signOut end', { usedTimeoutFallback, error: errorMessage });
      }
    }

    return { error: errorMessage };
  }, []);

  const updateUsername = useCallback(
    async (username: string): Promise<AuthResult> => {
      if (!supabase) return { error: getSupabaseConfigError() };
      if (!user) return { error: 'You must be signed in.' };

      const normalized = username.trim().toLowerCase();
      if (normalized.length < 3) return { error: 'Username must be at least 3 characters.' };
      if (!/^[a-z0-9_]+$/.test(normalized)) {
        return { error: 'Use lowercase letters, numbers, and underscores only.' };
      }
      if (isTemporaryUsername(normalized)) {
        return { error: 'Pick a permanent handle — auto-generated names cannot be saved.' };
      }

      try {
        const request = supabase
          .from('profiles')
          .update({ username: normalized })
          .eq('id', user.id)
          .select('id, username, created_at')
          .single();

        const { data, error } = await withTimeout(
          Promise.resolve(request),
          USERNAME_REQUEST_TIMEOUT_MS,
        );

        if (error) {
          const message = error.message.toLowerCase();
          if (message.includes('duplicate key') || message.includes('unique')) {
            return { error: 'Username already taken. Try another one.' };
          }
          return { error: error.message };
        }

        setProfile(data as UserProfile);
        return { error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to save username.';
        if (
          message.toLowerCase().includes('duplicate key') ||
          message.toLowerCase().includes('unique')
        ) {
          return { error: 'Username already taken. Try another one.' };
        }
        return { error: message };
      }
    },
    [user],
  );

  const resetPassword = useCallback(async (email: string): Promise<AuthResult> => {
    if (!supabase) return { error: getSupabaseConfigError() };
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return { error: 'Enter your email address.' };
    try {
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: getAuthEmailRedirectTo(),
        }),
        AUTH_REQUEST_TIMEOUT_MS,
      );
      if (error) return { error: formatAuthErrorMessage(error) };
      return { error: null, message: 'If that email has an account, we sent a reset link.' };
    } catch (err) {
      return {
        error: formatAuthErrorMessage(
          err instanceof Error ? { message: err.message } : { message: 'Unable to send reset email.' },
        ),
      };
    }
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<AuthResult> => {
    if (!supabase) return { error: getSupabaseConfigError() };
    if (!user) return { error: 'You must be signed in to update your password.' };
    try {
      const { error } = await withTimeout(
        supabase.auth.updateUser({ password }),
        AUTH_REQUEST_TIMEOUT_MS,
      );
      if (error) return { error: error.message };
      setPasswordRecoveryPending(false);
      clearPasswordRecoveryPendingMarker();
      return { error: null, message: 'Password updated.' };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Unable to update password.' };
    }
  }, [user]);

  const updateEmail = useCallback(async (email: string): Promise<AuthResult> => {
    if (!supabase) return { error: getSupabaseConfigError() };
    if (!user) return { error: 'You must be signed in to change your email.' };

    const resolved = resolveEmailChange(email, user.email);
    if ('error' in resolved) return resolved;

    try {
      const { error } = await withTimeout(
        supabase.auth.updateUser({ email: resolved.email }),
        AUTH_REQUEST_TIMEOUT_MS,
      );
      if (error) return { error: formatAuthErrorMessage(error) };
      // Not a success message: the address on the account is unchanged until
      // the emailed link is followed. `user.email` deliberately is not patched.
      return { error: null, message: EMAIL_CHANGE_PENDING_MESSAGE(resolved.email) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Unable to change your email.' };
    }
  }, [user]);

  const clearPasswordRecoveryPending = useCallback(() => {
    setPasswordRecoveryPending(false);
    clearPasswordRecoveryPendingMarker();
  }, []);

  const refreshAuthProfile = useCallback(async (): Promise<void> => {
    if (!user) return;
    await hydrateProfile(user);
  }, [hydrateProfile, user]);

  const applyProfilePatch = useCallback((patch: Partial<UserProfile>): void => {
    setProfile((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  return {
    user,
    profile,
    accessToken,
    loading,
    justVerified,
    supabaseEnabled: isSupabaseConfigured,
    supabaseConfigError: getSupabaseConfigError(),
    signUp,
    signIn,
    signOut,
    updateUsername,
    resetPassword,
    updatePassword,
    updateEmail,
    passwordRecoveryPending,
    clearPasswordRecoveryPending,
    refreshAuthProfile,
    applyProfilePatch,
  };
}

export type AuthContextType = ReturnType<typeof useAuthInternal>;

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const value = useAuthInternal();
  useAnalyticsIdentity(value.user?.id ?? null);
  return React.createElement(AuthContext.Provider, { value }, children);
}

/**
 * Links the anonymous person to the account, once per identity.
 *
 * Keyed on the id string, never the user object: #61 was an effect that
 * re-ran on every new object reference for the same signed-in user. The
 * lastIdentified ref makes a repeated run a no-op even if the effect fires
 * again, which StrictMode guarantees it will in development.
 */
export function useAnalyticsIdentity(userId: string | null): void {
  const lastIdentified = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (userId === lastIdentified.current) return;
    if (userId) {
      identifyUser(userId);
    } else if (lastIdentified.current !== null) {
      // Signed out, rather than never signed in: unlink so a shared device
      // does not fold two people into one person.
      resetAnalytics();
    }
    lastIdentified.current = userId;
  }, [userId]);
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
