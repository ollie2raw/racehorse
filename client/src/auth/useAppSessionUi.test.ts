/**
 * Regression tests for useAppSessionUi.
 *
 * Written BEFORE extraction from App.tsx so that the same behavioral contract
 * is enforced before and after the code moves. Each describe section maps to a
 * specific behavior chunk currently living in App.tsx.
 *
 * None of these tests require Supabase credentials — all auth state is passed
 * as params; the only external dependency is fetchGhostProfileSummary, which
 * is mocked at the module level.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { UserProfile } from './useAuth';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../ghost/api', () => ({
  fetchGhostProfileSummary: vi.fn().mockResolvedValue({
    ghostRating: 0,
    gamesPlayed: 0,
    avgScore: null,
    recentScores: [],
    paddingGames: 0,
    compositeLog: null,
    styleProfile: null,
  }),
}));

// Import after mocks
const { useAppSessionUi } = await import('./useAppSessionUi');
const { fetchGhostProfileSummary } = await import('../ghost/api');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeShowToast() {
  return vi.fn<(msg: string, duration?: number) => void>();
}

function makeUser(overrides: Partial<{ id: string; email: string }> = {}) {
  return { id: 'user-123', email: 'test@example.com', ...overrides } as { id: string; email: string };
}

function makeProfile(username = 'real_username'): UserProfile {
  return { id: 'user-123', username };
}

type Params = Parameters<typeof useAppSessionUi>[0];

function defaultParams(overrides: Partial<Params> = {}): Params {
  return {
    authUser: null,
    authProfile: null,
    authLoading: false,
    justVerified: false,
    showToast: makeShowToast(),
    ...overrides,
  };
}

// ── 1. Initial state ──────────────────────────────────────────────────────────

describe('useAppSessionUi — initial state', () => {
  it('starts with all modal state closed and ghost profile null', () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams(),
    });

    expect(result.current.ghostProfile).toBeNull();
    expect(result.current.ghostOpponentName).toBe('Ghost');
    expect(result.current.ghostOpponentUserId).toBeNull();
    expect(result.current.authModalOpen).toBe(false);
    expect(result.current.usernameModalOpen).toBe(false);
    expect(result.current.signingOut).toBe(false);
    expect(result.current.weeklyStatsOpen).toBe(false);
  });

  it('exposes setters for all modal state', () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams(),
    });

    expect(typeof result.current.setAuthModalOpen).toBe('function');
    expect(typeof result.current.setUsernameModalOpen).toBe('function');
    expect(typeof result.current.setSigningOut).toBe('function');
    expect(typeof result.current.setWeeklyStatsOpen).toBe('function');
    expect(typeof result.current.setOnboardingDismissed).toBe('function');
    expect(typeof result.current.setGhostOpponentName).toBe('function');
    expect(typeof result.current.setGhostOpponentUserId).toBe('function');
  });
});

// ── 2. Ghost profile fetch lifecycle ─────────────────────────────────────────

const defaultGhostSummary = {
  ghostRating: 0,
  gamesPlayed: 0,
  avgScore: null,
  recentScores: [] as number[],
  paddingGames: 0,
  compositeLog: null,
  styleProfile: null,
};

describe('useAppSessionUi — ghost profile fetch', () => {
  beforeEach(() => {
    vi.mocked(fetchGhostProfileSummary).mockReset();
    vi.mocked(fetchGhostProfileSummary).mockResolvedValue(defaultGhostSummary);
  });

  it('does not fetch when authUser is null', () => {
    renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({ authUser: null }),
    });

    expect(fetchGhostProfileSummary).not.toHaveBeenCalled();
  });

  it('fetches ghost profile when authUser is present', async () => {
    const summary = { ...defaultGhostSummary, ghostRating: 1200, gamesPlayed: 5 };
    vi.mocked(fetchGhostProfileSummary).mockResolvedValue(summary);

    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({ authUser: makeUser() }),
    });

    expect(fetchGhostProfileSummary).toHaveBeenCalledWith('user-123');

    await waitFor(() => {
      expect(result.current.ghostProfile).toEqual(summary);
    });
  });

  it('sets ghostProfile to null when authUser is cleared', async () => {
    const summary = { ...defaultGhostSummary, ghostRating: 900, gamesPlayed: 2 };
    vi.mocked(fetchGhostProfileSummary).mockResolvedValue(summary);

    const { result, rerender } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({ authUser: makeUser() }),
    });

    await waitFor(() => {
      expect(result.current.ghostProfile).not.toBeNull();
    });

    act(() => {
      rerender(defaultParams({ authUser: null }));
    });

    expect(result.current.ghostProfile).toBeNull();
  });

  it('sets ghostProfile to null when fetch fails', async () => {
    vi.mocked(fetchGhostProfileSummary).mockRejectedValue(new Error('network error'));

    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({ authUser: makeUser() }),
    });

    await waitFor(() => {
      // After rejection, ghostProfile stays null (was never set)
      expect(result.current.ghostProfile).toBeNull();
      expect(fetchGhostProfileSummary).toHaveBeenCalled();
    });
  });

  it('cancels in-flight fetch when authUser changes', async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstFetch = new Promise((resolve) => { resolveFirst = resolve; });
    vi.mocked(fetchGhostProfileSummary)
      .mockReturnValueOnce(firstFetch as ReturnType<typeof fetchGhostProfileSummary>)
      .mockResolvedValueOnce({ ...defaultGhostSummary, ghostRating: 500, gamesPlayed: 1 });

    const { result, rerender } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({ authUser: makeUser({ id: 'user-A' }) }),
    });

    // Change user before first fetch resolves
    act(() => {
      rerender(defaultParams({ authUser: makeUser({ id: 'user-B' }) }));
    });

    // Now resolve the first fetch — it should be ignored (stale)
    const staleData = { ...defaultGhostSummary, ghostRating: 9999, gamesPlayed: 99 };
    act(() => { resolveFirst(staleData); });

    await waitFor(() => {
      // Should have fetched for user-B
      expect(fetchGhostProfileSummary).toHaveBeenCalledWith('user-B');
      // Stale result from user-A should NOT have been applied
      expect(result.current.ghostProfile?.ghostRating).not.toBe(9999);
    });
  });
});

// ── 3. needsUsernameOnboarding derivation ────────────────────────────────────

describe('useAppSessionUi — needsUsernameOnboarding', () => {
  it('is false when authUser is null', () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({ authUser: null, authProfile: null }),
    });
    expect(result.current.needsUsernameOnboarding).toBe(false);
  });

  it('is false while authLoading is true', () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({
        authUser: makeUser(),
        authProfile: makeProfile('user_abc123'),
        authLoading: true,
      }),
    });
    expect(result.current.needsUsernameOnboarding).toBe(false);
  });

  it('is false when authProfile is null (not yet loaded)', () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({
        authUser: makeUser(),
        authProfile: null,
        authLoading: false,
      }),
    });
    expect(result.current.needsUsernameOnboarding).toBe(false);
  });

  it('is true when user has a temporary username (user_ prefix)', () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({
        authUser: makeUser(),
        authProfile: makeProfile('user_abc12345'),
        authLoading: false,
      }),
    });
    expect(result.current.needsUsernameOnboarding).toBe(true);
  });

  it('is false when user has set a real username', () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({
        authUser: makeUser(),
        authProfile: makeProfile('dominoes_king'),
        authLoading: false,
      }),
    });
    expect(result.current.needsUsernameOnboarding).toBe(false);
  });

  it('updates reactively when authProfile changes', () => {
    const { result, rerender } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({
        authUser: makeUser(),
        authProfile: makeProfile('user_tmp123'),
        authLoading: false,
      }),
    });

    expect(result.current.needsUsernameOnboarding).toBe(true);

    act(() => {
      rerender(defaultParams({
        authUser: makeUser(),
        authProfile: makeProfile('chosen_handle'),
        authLoading: false,
      }));
    });

    expect(result.current.needsUsernameOnboarding).toBe(false);
  });
});

// ── 4. onboardingDismissed localStorage behavior ──────────────────────────────

describe('useAppSessionUi — onboardingDismissed', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts false when no localStorage entry exists', () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.onboardingDismissed).toBe(false);
  });

  it('starts true when localStorage has a recent dismissal', () => {
    localStorage.setItem('username_onboarding_dismissed', Date.now().toString());

    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.onboardingDismissed).toBe(true);
  });

  it('starts false when localStorage has an expired (>24h) dismissal', () => {
    const expired = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    localStorage.setItem('username_onboarding_dismissed', expired.toString());

    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.onboardingDismissed).toBe(false);
  });

  it('can be set to true via setOnboardingDismissed', () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams(),
    });

    act(() => { result.current.setOnboardingDismissed(true); });

    expect(result.current.onboardingDismissed).toBe(true);
  });
});

// ── 5. welcomeOpen first-visit logic ─────────────────────────────────────────

describe('useAppSessionUi — welcomeOpen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens welcome modal on first visit (no hasSeenWelcome key)', async () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams(),
    });

    await waitFor(() => {
      expect(result.current.welcomeOpen).toBe(true);
    });
  });

  it('does not open welcome modal when hasSeenWelcome is set', async () => {
    localStorage.setItem('hasSeenWelcome', 'true');

    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams(),
    });

    // Give the effect time to run
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.welcomeOpen).toBe(false);
  });

  it('can be closed via setWelcomeOpen', async () => {
    const { result } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams(),
    });

    await waitFor(() => expect(result.current.welcomeOpen).toBe(true));

    act(() => { result.current.setWelcomeOpen(false); });

    expect(result.current.welcomeOpen).toBe(false);
  });
});

// ── 6. justVerified toast ────────────────────────────────────────────────────

describe('useAppSessionUi — justVerified toast', () => {
  it('shows verified toast when justVerified is true', () => {
    const showToast = makeShowToast();
    renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({ justVerified: true, showToast }),
    });

    expect(showToast).toHaveBeenCalledWith(
      '✓ Email verified! Welcome to Racehorse Dominoes.',
      5000,
    );
  });

  it('does not show verified toast when justVerified is false', () => {
    const showToast = makeShowToast();
    renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({ justVerified: false, showToast }),
    });

    expect(showToast).not.toHaveBeenCalledWith(
      expect.stringContaining('Email verified'),
      expect.anything(),
    );
  });

  it('shows toast when justVerified transitions from false to true', () => {
    const showToast = makeShowToast();
    const { rerender } = renderHook((p: Params) => useAppSessionUi(p), {
      initialProps: defaultParams({ justVerified: false, showToast }),
    });

    expect(showToast).not.toHaveBeenCalled();

    act(() => {
      rerender(defaultParams({ justVerified: true, showToast }));
    });

    expect(showToast).toHaveBeenCalledWith(
      '✓ Email verified! Welcome to Racehorse Dominoes.',
      5000,
    );
  });
});
