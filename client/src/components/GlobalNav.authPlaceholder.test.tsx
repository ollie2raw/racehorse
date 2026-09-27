// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The shell only renders stat blocks for a known signed-in principal. */

const mockAuth = vi.fn();
vi.mock('../auth/useAuth', () => ({ useAuth: () => mockAuth() }));
vi.mock('../friends/friendsApi', () => ({ fetchFriends: () => new Promise(() => {}) }));
vi.mock('./BrandLogo', () => ({ BrandLogo: () => null }));

const { GlobalNav } = await import('./GlobalNav');

const statValues = () =>
  Array.from(document.querySelectorAll('.rh-nav-stat-value')).map((el) => el.textContent?.trim());

const user = { id: 'user-1', email: 'qa@racehorse.test' } as never;

describe('GlobalNav — auth placeholder', () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  it('does not invent signed-out stats while the session is still restoring', () => {
    mockAuth.mockReturnValue({ user: null, profile: null, loading: true });
    render(<GlobalNav />);

    expect(statValues()).toEqual([]);
    expect(screen.queryByText('—')).toBeNull();
  });

  it('shows account access with no empty stat placeholders once signed out', () => {
    mockAuth.mockReturnValue({ user: null, profile: null, loading: false });
    render(<GlobalNav />);

    expect(statValues()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
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
    // The shell remains mounted across routes. The cache still protects the
    // HUD during a transient auth refresh while `user` is briefly null.
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
