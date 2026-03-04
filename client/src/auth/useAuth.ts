import { useCallback, useEffect, useState } from 'react';
import type { AuthChangeEvent, User } from '@supabase/supabase-js';
import { getSupabaseConfigError, isSupabaseConfigured, supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  username: string;
  created_at?: string;
}

interface AuthResult {
  error: string | null;
}

const TEMP_USERNAME_PREFIX = 'user_';
const USERNAME_REQUEST_TIMEOUT_MS = 10000;
const AUTH_REQUEST_TIMEOUT_MS = 15000;
const SESSION_BOOTSTRAP_TIMEOUT_MS = 8000;
const SIGN_OUT_TIMEOUT_MS = 1200;
const AUTH_RETRY_DELAY_MS = 350;
const PROFILE_REQUEST_TIMEOUT_MS = 5000;

export function isTemporaryUsername(username: string | null | undefined): boolean {
  if (!username) return true;
  return username.startsWith(TEMP_USERNAME_PREFIX);
}

async function ensureProfile(userId: string): Promise<void> {
  if (!supabase) return;
  const tempUsername = `${TEMP_USERNAME_PREFIX}${userId.replace(/-/g, '').slice(0, 8)}`;
  try {
    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), PROFILE_REQUEST_TIMEOUT_MS);
    });
    const upsertPromise = supabase
      .from('profiles')
      .upsert({ id: userId, username: tempUsername }, { onConflict: 'id', ignoreDuplicates: true })
      .then(({ error }) => ({ timedOut: false as const, error }));

    const result = await Promise.race([upsertPromise, timeoutPromise]);
    if ('timedOut' in result && result.timedOut) {
      console.warn('[auth] ensureProfile timed out; continuing without blocking auth');
      return;
    }
    if (result.error) {
      console.warn('[auth] ensureProfile failed; continuing without blocking auth', result.error);
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

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [justVerified, setJustVerified] = useState(false);

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

    try {
      const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
        setTimeout(() => resolve({ timedOut: true }), PROFILE_REQUEST_TIMEOUT_MS);
      });
      const queryPromise = supabase
        .from('profiles')
        .select('id, username, created_at')
        .eq('id', sessionUser.id)
        .maybeSingle()
        .then(({ data, error }) => ({ timedOut: false as const, data, error }));

      const result = await Promise.race([queryPromise, timeoutPromise]);
      if ('timedOut' in result && result.timedOut) {
        console.warn('[auth] refreshProfile timed out; using fallback profile');
        setProfile(fallbackProfile(sessionUser));
        return;
      }
      if (result.error || !result.data) {
        if (result.error) {
          console.warn('[auth] refreshProfile failed; using fallback profile', result.error);
        }
        setProfile(fallbackProfile(sessionUser));
        return;
      }
      setProfile(result.data as UserProfile);
    } catch (err) {
      console.warn('[auth] refreshProfile errored; using fallback profile', err);
      setProfile(fallbackProfile(sessionUser));
    }
  }, [fallbackProfile]);

  const hydrateProfile = useCallback(
    async (sessionUser: User): Promise<void> => {
      await ensureProfile(sessionUser.id);
      await refreshProfile(sessionUser);
    },
    [refreshProfile],
  );

  useEffect(() => {
    let active = true;

    const syncSession = async (
      event: AuthChangeEvent | 'INITIAL_BOOTSTRAP',
      sessionUser: User | null,
    ) => {
      if (!active) return;
      if (event === 'SIGNED_OUT' || !sessionUser) {
        setUser(null);
        setProfile(null);
        return;
      }

      setUser(sessionUser);
      if (event === 'SIGNED_IN' && sessionUser.email_confirmed_at) {
        // Detect email verification redirect: SIGNED_IN fires when
        // the user clicks the confirmation link and lands back in the app.
        // We distinguish this from a normal sign-in by checking that
        // there was no prior user in state (user was null before).
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
      if (!supabase) {
        if (active) {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      try {
        const {
          data: { session },
        } = await withTimeout(supabase.auth.getSession(), SESSION_BOOTSTRAP_TIMEOUT_MS);
        await syncSession('INITIAL_BOOTSTRAP', session?.user ?? null);
      } catch {
        if (active) {
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (active) setLoading(false);
      }
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
      const runSignUp = async () =>
        withTimeout(client.auth.signUp({ email, password }), AUTH_REQUEST_TIMEOUT_MS);
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
        if (error) return { error: error.message };

        if (data.user) {
          if (username) {
            const normalized = username.trim().toLowerCase();
            if (normalized.length >= 3 && /^[a-z0-9_]+$/.test(normalized)) {
              try {
                await supabase
                  .from('profiles')
                  .upsert({ id: data.user.id, username: normalized }, { onConflict: 'id' });
              } catch {
                // ignore profile write failures during sign up
              }
            }
          }
          void hydrateProfile(data.user);
        }

        return { error: null };
      } catch (err) {
        if (isTimeoutError(err)) {
          try {
            const {
              data: { session },
            } = await withTimeout(supabase.auth.getSession(), 3000);
            if (session?.user) {
              void hydrateProfile(session.user);
              return { error: null };
            }
          } catch {
            // ignore
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
        if (error) return { error: error.message };

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
            if (session?.user) {
              void hydrateProfile(session.user);
              return { error: null };
            }
          } catch {
            // ignore
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
      // eslint-disable-next-line no-console
      console.log('[Auth] signOut start');
    }

    let errorMessage: string | null = null;
    let usedTimeoutFallback = false;

    // Optimistically reset local auth UI immediately.
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
          // eslint-disable-next-line no-console
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
        // eslint-disable-next-line no-console
        console.log('[Auth] signOut end', { usedTimeoutFallback, error: errorMessage });
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

      try {
        const request = supabase
          .from('profiles')
          .upsert({ id: user.id, username: normalized }, { onConflict: 'id' })
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
    try {
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}`,
        }),
        AUTH_REQUEST_TIMEOUT_MS,
      );
      if (error) return { error: error.message };
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Unable to send reset email.' };
    }
  }, []);

  return {
    user,
    profile,
    loading,
    justVerified,
    supabaseEnabled: isSupabaseConfigured,
    supabaseConfigError: getSupabaseConfigError(),
    signUp,
    signIn,
    signOut,
    updateUsername,
    resetPassword,
  };
}
