// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The header's username button carried a chevron but opened a modal, so the
 * one affordance that looked like a menu was the only one that wasn't. These
 * assertions pin the menu's contents and where each item goes.
 */

const mockAuth = vi.fn();
vi.mock('../auth/useAuth', () => ({ useAuth: () => mockAuth() }));
vi.mock('../friends/friendsApi', () => ({ fetchFriends: () => new Promise(() => {}) }));
vi.mock('./BrandLogo', () => ({ BrandLogo: () => null }));
vi.mock('./nav/AppBottomTabBar', () => ({ AppBottomTabBar: () => null }));

const { GlobalNav } = await import('./GlobalNav');

const signedIn = {
  user: { id: 'user-1', email: 'qa@racehorse.test' },
  profile: { id: 'user-1', username: 'oliver', glicko_rating: 1500 },
  loading: false,
};

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /account menu/i }));

describe('GlobalNav — account menu', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockAuth.mockReturnValue(signedIn);
  });

  it('keeps the menu closed until the username button is clicked', () => {
    render(<GlobalNav />);
    expect(screen.queryByRole('menu')).toBeNull();

    openMenu();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('offers profile, settings, and sign out', () => {
    render(<GlobalNav />);
    openMenu();

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Profile',
      'Settings',
      'Sign out',
    ]);
  });

  it('navigates to the profile and closes', () => {
    const onNavigate = vi.fn();
    render(<GlobalNav onNavigate={onNavigate} />);
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));

    expect(onNavigate).toHaveBeenCalledWith('stats');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('navigates to settings and closes', () => {
    const onNavigate = vi.fn();
    render(<GlobalNav onNavigate={onNavigate} />);
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));

    expect(onNavigate).toHaveBeenCalledWith('settings');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('signs out through the handler the app owns, not its own supabase call', () => {
    const onSignOut = vi.fn();
    render(<GlobalNav onSignOut={onSignOut} />);
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens auth instead of a menu when nobody is signed in', () => {
    mockAuth.mockReturnValue({ user: null, profile: null, loading: false });
    const onOpenAuth = vi.fn();
    render(<GlobalNav onOpenAuth={onOpenAuth} />);

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(onOpenAuth).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<GlobalNav />);
    openMenu();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when a click lands outside it', () => {
    render(<GlobalNav />);
    openMenu();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
