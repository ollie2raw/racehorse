// @vitest-environment jsdom
/**
 * Regression test for the e2e-dev-auth / onAuthStateChange race.
 *
 * Before the fix: the dev-only e2e auth bypass (readE2eDevAuth) set
 * user/accessToken/profile synchronously inside `init()`, then `init()`
 * `return`ed — but the surrounding effect kept running past that point and
 * unconditionally subscribed to `supabase.auth.onAuthStateChange`. Supabase
 * fires that listener's callback with an `INITIAL_SESSION` event (session:
 * null, since there's no real session) shortly after subscribing, and that
 * callback's `syncSession('INITIAL_SESSION', null)` unconditionally reset
 * user/profile/accessToken back to signed-out — a race whose outcome
 * depended on ordering between two independently-scheduled microtask
 * chains. Confirmed directly (not just read): a Playwright run against the
 * real app flipped back to "Sign in to continue" moments after the e2e
 * branch had set the user (client/e2e/ghost-play-to-completion.spec.ts's
 * scoping work, 2026-09-11).
 *
 * The fix makes e2e-auth mode and the real-Supabase-session mode mutually
 * exclusive branches of the same effect: when readE2eDevAuth() returns
 * truthy, the effect returns immediately after setting state, before the
 * real session bootstrap or the onAuthStateChange subscription are ever
 * reached — so there is no listener left to race against.
 *
 * This test proves the fix at the mechanism level (the listener is never
 * attached, so it structurally cannot fire) rather than just re-asserting
 * "auth ends up correct", which a timing-dependent flake could still pass by
 * luck.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

const onAuthStateChangeSpy = vi.fn();
const getSessionMock = vi.fn();

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseConfigError: () => null,
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => {
        onAuthStateChangeSpy(...args);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

vi.mock('../lib/analytics', () => ({
  identifyUser: vi.fn(),
  resetAnalytics: vi.fn(),
  track: vi.fn(),
}));

const readE2eDevAuthMock = vi.fn();
vi.mock('./e2eDevAuth', () => ({
  readE2eDevAuth: () => readE2eDevAuthMock(),
}));

const { AuthProvider, useAuth } = await import('./useAuth');

function Probe() {
  const { user, loading } = useAuth();
  return (
    <div>
      <span data-testid="user-id">{user?.id ?? 'none'}</span>
      <span data-testid="loading">{String(loading)}</span>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('useAuth — e2e-dev-auth vs onAuthStateChange race', () => {
  beforeEach(() => {
    onAuthStateChangeSpy.mockClear();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: null } });
    readE2eDevAuthMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('never subscribes to onAuthStateChange when e2e auth is active, so its INITIAL_SESSION event cannot fire and clobber the user', async () => {
    const e2eUser = { id: 'e2e-user-1', aud: 'authenticated', role: 'authenticated' } as User;
    readE2eDevAuthMock.mockReturnValue({ user: e2eUser, token: 'e2e-daily-fritz' });

    renderProbe();

    // Set synchronously by the e2e branch — no need to wait.
    expect(screen.getByTestId('user-id').textContent).toBe('e2e-user-1');
    expect(screen.getByTestId('loading').textContent).toBe('false');

    // Give any stray microtasks / timers a chance to run. If the old code's
    // onAuthStateChange subscription still existed, this is where its
    // INITIAL_SESSION(null) callback would have fired and reset the user.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(onAuthStateChangeSpy).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('user-id').textContent).toBe('e2e-user-1');
  });

  it('still resolves a real signed-in user through onAuthStateChange when e2e auth is not active (normal path unchanged)', async () => {
    readE2eDevAuthMock.mockReturnValue(null);
    const realUser = { id: 'real-user-1', aud: 'authenticated', role: 'authenticated' } as User;

    renderProbe();

    await waitFor(() => expect(onAuthStateChangeSpy).toHaveBeenCalledTimes(1));
    const [callback] = onAuthStateChangeSpy.mock.calls[0] as [(event: string, session: unknown) => Promise<void>];

    await act(async () => {
      await callback('INITIAL_SESSION', { user: realUser, access_token: 'tok' });
    });

    expect(screen.getByTestId('user-id').textContent).toBe('real-user-1');
  });

  it("a null INITIAL_SESSION on the real path still signs the user out (that clobber is correct when it's the only session source)", async () => {
    readE2eDevAuthMock.mockReturnValue(null);

    renderProbe();

    await waitFor(() => expect(onAuthStateChangeSpy).toHaveBeenCalledTimes(1));
    const [callback] = onAuthStateChangeSpy.mock.calls[0] as [(event: string, session: unknown) => Promise<void>];

    await act(async () => {
      await callback('INITIAL_SESSION', null);
    });

    expect(screen.getByTestId('user-id').textContent).toBe('none');
  });
});
