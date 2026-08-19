// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression cover for the header HUD rendering a bare "—" for a signed-in user.
 *
 * "—" is the *signed-out* glyph and "…" is the *unresolved* glyph. Restoring a
 * Supabase session is async, so a signed-in user renders with `user === null`
 * for the whole bootstrap window. Deriving the placeholder from `!user` alone
 * conflates the two and showed real logged-in accounts the signed-out glyph —
 * on a phone (slow network, stalled token refresh) for seconds or indefinitely.
 */

const mockAuth = vi.fn();
vi.mock('../auth/useAuth', () => ({ useAuth: () => mockAuth() }));
vi.mock('../friends/friendsApi', () => ({ fetchFriends: () => new Promise(() => {}) }));
vi.mock('./BrandLogo', () => ({ BrandLogo: () => null }));
vi.mock('./nav/AppBottomTabBar', () => ({ AppBottomTabBar: () => null }));

const { GlobalNav } = await import('./GlobalNav');

const statValues = () =>
  Array.from(document.querySelectorAll('.rh-nav-stat-value')).map((el) => el.textContent?.trim());

const user = { id: 'user-1', email: 'qa@racehorse.test' } as never;

describe('GlobalNav — auth placeholder', () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  it('shows the unresolved glyph, never the signed-out glyph, while the session is still restoring', () => {
    mockAuth.mockReturnValue({ user: null, profile: null, loading: true });
    render(<GlobalNav />);

    expect(statValues()).toEqual(['…', '…']);
    expect(screen.queryByText('—')).toBeNull();
  });

  it('shows the signed-out glyph only once auth has settled with no user', () => {
    mockAuth.mockReturnValue({ user: null, profile: null, loading: false });
    render(<GlobalNav />);

    expect(statValues()).toEqual(['—', '—']);
  });

  it('renders the real rating once the profile resolves', () => {
    mockAuth.mockReturnValue({
      user,
      profile: { id: 'user-1', username: 'qa', glicko_rating: 1287.4 },
      loading: false,
    });
    render(<GlobalNav />);

    expect(statValues()[0]).toBe('1,287');
  });

  it('does not fall back to the signed-out glyph while a signed-in profile is still loading', () => {
    // A user the module-scope HUD cache has never seen, so there is no
    // last-known rating to fall back on and the unresolved glyph is correct.
    mockAuth.mockReturnValue({
      user: { id: 'user-never-seen', email: 'other@racehorse.test' } as never,
      profile: null,
      loading: false,
    });
    render(<GlobalNav />);

    expect(statValues()[0]).toBe('…');
  });

  it('reuses the last known rating for the same user instead of flashing a placeholder', () => {
    // Each route mounts its own GlobalNav with its own useAuth(), so a
    // navigation re-runs the whole session bootstrap. The cache is what keeps
    // the HUD stable across that, including while `user` is briefly null.
    mockAuth.mockReturnValue({
      user,
      profile: { id: 'user-1', username: 'qa', glicko_rating: 1287.4 },
      loading: false,
    });
    render(<GlobalNav />);

    mockAuth.mockReturnValue({ user: null, profile: null, loading: true });
    render(<GlobalNav />);

    expect(statValues().at(-2)).toBe('1,287');
  });
});
