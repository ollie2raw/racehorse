import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
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
const SIGN_OUT_TIMEOUT_MS = 8000;

export function isTemporaryUsername(username: string | null | undefined): boolean {
  if (!username) return true;
  return username.startsWith(TEMP_USERNAME_PREFIX);
}

async function ensureProfile(userId: string): Promise<void> {
  if (!supabase) return;
  const tempUsername = `${TEMP_USERNAME_PREFIX}${userId.replace(/-/g, '').slice(0, 8)}`;
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, username: tempUsername }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) {
    throw error;
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

  const refreshProfile = useCallback(async (userId: string) => {
    if (!supabase) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    setProfile(data as UserProfile | null);
  }, []);

  useEffect(() => {
    let active = true;

    const init = async () => {
      if (!supabase) {
        if (active) {
          setLoading(false);
          setUser(null);
          setProfile(null);
        }
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active) return;

      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        try {
          await ensureProfile(currentUser.id);
          await refreshProfile(currentUser.id);
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }

      setLoading(false);
    };

    init();

    if (!supabase)
      return () => {
        active = false;
      };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;

      const nextUser = session?.user ?? null;
      setUser(nextUser);

      if (nextUser) {
        try {
          await ensureProfile(nextUser.id);
          await refreshProfile(nextUser.id);
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && supabase) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          const nextUser = session?.user ?? null;
          setUser(nextUser);
          if (nextUser) {
            void refreshProfile(nextUser.id);
          } else {
            setProfile(null);
          }
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const signUp = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!supabase) return { error: getSupabaseConfigError() };

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: error.message };

      if (data.user) {
        try {
          await ensureProfile(data.user.id);
          await refreshProfile(data.user.id);
        } catch {
          // Ignore profile bootstrap failures here; user can retry via username update.
        }
      }

      return { error: null };
    },
    [refreshProfile],
  );

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!supabase) return { error: getSupabaseConfigError() };

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };

      if (data.user) {
        try {
          await ensureProfile(data.user.id);
          await refreshProfile(data.user.id);
        } catch {
          // Keep auth session even if profile fetch fails.
        }
      }

      return { error: null };
    },
    [refreshProfile],
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
          await Promise.race([
            supabase.auth.signOut({ scope: 'local' }),
            new Promise((resolve) => setTimeout(resolve, 800)),
          ]);
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

  return {
    user,
    profile,
    loading,
    supabaseEnabled: isSupabaseConfigured,
    supabaseConfigError: getSupabaseConfigError(),
    signUp,
    signIn,
    signOut,
    updateUsername,
  };
}
