// @vitest-environment jsdom
/**
 * The signup and rename paths apply the public username policy before talking
 * to Supabase, and translate the database's own rejection (the trigger in
 * 2026-10-12_username_policy.sql) into a readable message. The database is the
 * enforcement; this is the UX layer on top of it.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

const signUpMock = vi.fn();
const updateMock = vi.fn();

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseConfigError: () => null,
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signUp: (...args: unknown[]) => signUpMock(...args),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
      update: (...args: unknown[]) => {
        updateMock(...args);
        return {
          eq: () => ({
            select: () => ({ single: () => Promise.resolve(updateResult) }),
          }),
        };
      },
    }),
  },
}));

let updateResult: { data: unknown; error: { message: string } | null } = { data: null, error: null };

vi.mock('../lib/analytics', () => ({ identifyUser: vi.fn(), resetAnalytics: vi.fn(), track: vi.fn() }));

const readE2eDevAuthMock = vi.fn();
vi.mock('./e2eDevAuth', () => ({
  readE2eDevAuth: () => readE2eDevAuthMock(),
  readMobileVisualIdentity: () => null,
}));

const { AuthProvider, useAuth } = await import('./useAuth');

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider }).result.current;
}

describe('useAuth — username policy', () => {
  beforeEach(() => {
    signUpMock.mockReset();
    updateMock.mockReset();
    readE2eDevAuthMock.mockReset();
    updateResult = { data: null, error: null };
  });

  it('signup rejects a reserved name before calling Supabase', async () => {
    readE2eDevAuthMock.mockReturnValue(null);
    const a = renderAuth();
    let result: { error: string | null } | undefined;
    await act(async () => {
      result = await a.signUp('x@example.com', 'password123', 'Racehorse_Support');
    });
    expect(result?.error).toMatch(/reserved/i);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('signup passes an ordinary name through to Supabase', async () => {
    readE2eDevAuthMock.mockReturnValue(null);
    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const a = renderAuth();
    await act(async () => {
      await a.signUp('x@example.com', 'password123', 'domino_king');
    });
    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(signUpMock.mock.calls[0][0].options.data.username).toBe('domino_king');
  });

  it('rename rejects a prohibited name, case-insensitively, before writing', async () => {
    readE2eDevAuthMock.mockReturnValue({ user: { id: 'u-1', aud: 'authenticated', role: 'authenticated' } as User, token: 't' });
    const a = renderAuth();
    let result: { error: string | null } | undefined;
    await act(async () => {
      result = await a.updateUsername('ADMIN');
    });
    expect(result?.error).toMatch(/reserved/i);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rename surfaces the database policy rejection as a readable message', async () => {
    readE2eDevAuthMock.mockReturnValue({ user: { id: 'u-1', aud: 'authenticated', role: 'authenticated' } as User, token: 't' });
    updateResult = { data: null, error: { message: 'username_not_allowed' } };
    const a = renderAuth();
    let result: { error: string | null } | undefined;
    await act(async () => {
      result = await a.updateUsername('fine_name');
    });
    expect(updateMock).toHaveBeenCalledWith({ username: 'fine_name' });
    expect(result?.error).toMatch(/isn’t allowed/);
  });
});
