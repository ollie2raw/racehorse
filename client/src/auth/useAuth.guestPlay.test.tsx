// @vitest-environment jsdom
/**
 * Guest play, auth layer (docs/guest-play-design.md, roadmap 1.14): a guest session is created lazily and at most once,
 * never replaces an existing session, and signing up while a guest upgrades THAT user in place instead of creating a new
 * one (a new user would orphan the games the guest just played). Everything is behind VITE_ENABLE_GUEST_PLAY.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

const flag = vi.hoisted(() => ({ enabled: false }));
vi.mock('../config/guestPlayFeature', () => ({ isGuestPlayEnabled: () => flag.enabled }));

const getSessionMock = vi.fn();
const signInAnonymouslyMock = vi.fn();
const updateUserMock = vi.fn();
const signUpMock = vi.fn();
const profileUpdateMock = vi.fn();
let profileUpdateResult: { data: unknown; error: { message: string } | null } = { data: null, error: null };

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseConfigError: () => null,
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInAnonymously: (...args: unknown[]) => signInAnonymouslyMock(...args),
      updateUser: (...args: unknown[]) => updateUserMock(...args),
      signUp: (...args: unknown[]) => signUpMock(...args),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
      update: (...args: unknown[]) => {
        profileUpdateMock(...args);
        return {
          eq: () => ({
            select: () => ({ single: () => Promise.resolve(profileUpdateResult) }),
          }),
        };
      },
    }),
  },
}));

vi.mock('../lib/analytics', () => ({ identifyUser: vi.fn(), resetAnalytics: vi.fn(), track: vi.fn() }));

const readE2eDevAuthMock = vi.fn();
vi.mock('./e2eDevAuth', () => ({
  readE2eDevAuth: () => readE2eDevAuthMock(),
  readMobileVisualIdentity: () => null,
}));

const { AuthProvider, useAuth } = await import('./useAuth');

const guest = { id: 'guest-1', aud: 'authenticated', role: 'authenticated', is_anonymous: true } as User;
const account = { id: 'acct-1', aud: 'authenticated', role: 'authenticated', is_anonymous: false } as User;

function renderAuth(asUser: User | null) {
  readE2eDevAuthMock.mockReturnValue(asUser ? { user: asUser, token: 't' } : null);
  return renderHook(() => useAuth(), { wrapper: AuthProvider }).result;
}

beforeEach(() => {
  flag.enabled = false;
  for (const mock of [getSessionMock, signInAnonymouslyMock, updateUserMock, signUpMock, profileUpdateMock, readE2eDevAuthMock]) mock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: null } });
  signInAnonymouslyMock.mockResolvedValue({ data: { user: guest, session: {} }, error: null });
  updateUserMock.mockResolvedValue({ data: { user: guest }, error: null });
  signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: null });
  profileUpdateResult = { data: { id: 'guest-1', username: 'domino_king' }, error: null };
});

describe('ensureGuestSession', () => {
  it('does nothing and says so while the flag is off', async () => {
    const auth = renderAuth(null);
    let result: { error: string | null } | undefined;
    await act(async () => { result = await auth.current.ensureGuestSession(); });
    expect(result?.error).toMatch(/not available/i);
    expect(signInAnonymouslyMock).not.toHaveBeenCalled();
  });

  it('starts one anonymous session when there is no session at all', async () => {
    flag.enabled = true;
    const auth = renderAuth(null);
    let result: { error: string | null } | undefined;
    await act(async () => { result = await auth.current.ensureGuestSession(); });
    expect(result?.error).toBeNull();
    expect(signInAnonymouslyMock).toHaveBeenCalledTimes(1);
  });

  it('two taps at once share one request, so one guest is created, not two', async () => {
    flag.enabled = true;
    const auth = renderAuth(null);
    await act(async () => {
      await Promise.all([auth.current.ensureGuestSession(), auth.current.ensureGuestSession(), auth.current.ensureGuestSession()]);
    });
    expect(signInAnonymouslyMock).toHaveBeenCalledTimes(1);
  });

  it('gives a returning guest their stored session back instead of creating a second user', async () => {
    flag.enabled = true;
    getSessionMock.mockResolvedValue({ data: { session: { user: guest } } });
    const auth = renderAuth(null);
    let result: { error: string | null } | undefined;
    await act(async () => { result = await auth.current.ensureGuestSession(); });
    expect(result?.error).toBeNull();
    expect(signInAnonymouslyMock).not.toHaveBeenCalled();
  });

  it('never replaces a player who is already signed in, guest or account', async () => {
    flag.enabled = true;
    for (const existing of [guest, account]) {
      signInAnonymouslyMock.mockClear();
      getSessionMock.mockClear();
      const auth = renderAuth(existing);
      await act(async () => { await auth.current.ensureGuestSession(); });
      expect(signInAnonymouslyMock, existing.id).not.toHaveBeenCalled();
      expect(getSessionMock, existing.id).not.toHaveBeenCalled();
    }
  });

  it('reports a failure as a message instead of throwing, and can be tried again', async () => {
    flag.enabled = true;
    signInAnonymouslyMock.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'Anonymous sign-ins are disabled' } });
    const auth = renderAuth(null);
    let first: { error: string | null } | undefined;
    await act(async () => { first = await auth.current.ensureGuestSession(); });
    expect(first?.error).toBeTruthy();

    let second: { error: string | null } | undefined;
    await act(async () => { second = await auth.current.ensureGuestSession(); });
    expect(second?.error).toBeNull();
    expect(signInAnonymouslyMock).toHaveBeenCalledTimes(2);
  });

  it('turns a thrown network error into a message too', async () => {
    flag.enabled = true;
    signInAnonymouslyMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const auth = renderAuth(null);
    let result: { error: string | null } | undefined;
    await act(async () => { result = await auth.current.ensureGuestSession(); });
    expect(result?.error).toBeTruthy();
  });
});

describe('isAnonymous', () => {
  it('is true for a guest, false for an account and for nobody', () => {
    expect(renderAuth(guest).current.isAnonymous).toBe(true);
    expect(renderAuth(account).current.isAnonymous).toBe(false);
    expect(renderAuth(null).current.isAnonymous).toBe(false);
  });
});

describe('signUp while a guest', () => {
  it('upgrades the same user in place: saves the handle, then sets the email and password, and never creates a new user', async () => {
    flag.enabled = true;
    const auth = renderAuth(guest);
    let result: { error: string | null; pendingVerification?: boolean; message?: string | null } | undefined;
    await act(async () => { result = await auth.current.signUp('me@example.com', 'password123', 'domino_king'); });

    expect(signUpMock).not.toHaveBeenCalled();
    expect(profileUpdateMock).toHaveBeenCalledWith({ username: 'domino_king' });
    expect(updateUserMock).toHaveBeenCalledTimes(1);
    const [attributes] = updateUserMock.mock.calls[0] as [Record<string, unknown>];
    expect(attributes).toMatchObject({ email: 'me@example.com', password: 'password123', data: { username: 'domino_king' } });
    expect(result?.error).toBeNull();
    expect(result?.pendingVerification).toBe(true);
    expect(result?.message).toMatch(/games are saved/i);
    // the handle is saved before any credential changes, so a taken name cannot half-upgrade the account
    expect(profileUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(updateUserMock.mock.invocationCallOrder[0]);
  });

  it('stops before touching the credentials when the handle is taken', async () => {
    flag.enabled = true;
    profileUpdateResult = { data: null, error: { message: 'duplicate key value violates unique constraint' } };
    const auth = renderAuth(guest);
    let result: { error: string | null } | undefined;
    await act(async () => { result = await auth.current.signUp('me@example.com', 'password123', 'domino_king'); });
    expect(result?.error).toMatch(/already taken/i);
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('applies the same username rules as a normal sign-up, before talking to Supabase', async () => {
    flag.enabled = true;
    const auth = renderAuth(guest);
    let result: { error: string | null } | undefined;
    await act(async () => { result = await auth.current.signUp('me@example.com', 'password123', 'Racehorse_Support'); });
    expect(result?.error).toMatch(/reserved/i);
    expect(profileUpdateMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('reports an email that already has an account without losing the guest session', async () => {
    flag.enabled = true;
    updateUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'A user with this email address has already been registered' } });
    const auth = renderAuth(guest);
    let result: { error: string | null; pendingVerification?: boolean } | undefined;
    await act(async () => { result = await auth.current.signUp('taken@example.com', 'password123', 'domino_king'); });
    expect(result?.error).toBeTruthy();
    expect(result?.pendingVerification).toBeFalsy();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('is an ordinary sign-up while the flag is off, even for an anonymous user', async () => {
    flag.enabled = false;
    const auth = renderAuth(guest);
    await act(async () => { await auth.current.signUp('x@example.com', 'password123', 'domino_king'); });
    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('is an ordinary sign-up for a visitor with no session and for a signed-in account, flag on', async () => {
    flag.enabled = true;
    for (const existing of [null, account]) {
      signUpMock.mockClear();
      const auth = renderAuth(existing);
      await act(async () => { await auth.current.signUp('x@example.com', 'password123', 'domino_king'); });
      expect(signUpMock, String(existing?.id)).toHaveBeenCalledTimes(1);
      expect(updateUserMock, String(existing?.id)).not.toHaveBeenCalled();
    }
  });
});
