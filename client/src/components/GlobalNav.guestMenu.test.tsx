// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guest play (docs/guest-play-design.md): a guest is an anonymous Supabase user whose profile handle is a placeholder
 * ("user_ab12cd34"). The nav must not show that handle, must offer making an account instead of "Profile" and "Sign out",
 * and must ask twice before leaving, because leaving throws the games away. None of it appears with the flag off.
 */

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock('../config/guestPlayFeature', () => ({ isGuestPlayEnabled: () => flag.enabled }));

const mockAuth = vi.fn();
vi.mock('../auth/useAuth', () => ({ useAuth: () => mockAuth() }));
vi.mock('../friends/friendsApi', () => ({ fetchFriends: () => new Promise(() => {}) }));
vi.mock('./BrandLogo', () => ({ BrandLogo: () => null }));
vi.mock('./nav/AppBottomTabBar', () => ({ AppBottomTabBar: () => null }));

const { GlobalNav } = await import('./GlobalNav');

const guestAuth = {
  user: { id: 'guest-1', email: '', is_anonymous: true },
  profile: { id: 'guest-1', username: 'user_ab12cd34' },
  loading: false,
};
const accountAuth = {
  user: { id: 'user-1', email: 'qa@racehorse.test', is_anonymous: false },
  profile: { id: 'user-1', username: 'oliver', glicko_rating: 1500 },
  loading: false,
};

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
const items = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

beforeEach(() => {
  flag.enabled = true;
  mockAuth.mockReset();
  mockAuth.mockReturnValue(guestAuth);
});
afterEach(cleanup);

describe('GlobalNav for a guest', () => {
  it('calls them Guest, never by the placeholder handle', () => {
    render(<GlobalNav />);
    const trigger = screen.getByRole('button', { name: /account menu/i });
    expect(trigger).toHaveTextContent('Guest');
    expect(trigger).toHaveTextContent('G');
    expect(trigger.textContent).not.toContain('user_ab12cd34');
  });

  it('offers creating an account first, and leaving the session last, with no Profile or Sign out', () => {
    render(<GlobalNav />);
    openMenu();
    expect(items()).toEqual(['Create account', 'My games', 'Settings', 'Privacy', 'Terms', 'Support', 'Leave guest session']);
  });

  it('Create account opens the sign-up dialog and closes the menu', () => {
    const onOpenAuth = vi.fn();
    render(<GlobalNav onOpenAuth={onOpenAuth} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create account' }));
    expect(onOpenAuth).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('asks before leaving: the first tap only asks, the second leaves', () => {
    const onSignOut = vi.fn();
    render(<GlobalNav onSignOut={onSignOut} />);
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave guest session' }));
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(items().at(-1)).toBe('Leave and lose these games?');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave and lose these games?' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('starts the question over when the menu is closed and opened again', () => {
    const onSignOut = vi.fn();
    render(<GlobalNav onSignOut={onSignOut} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave guest session' }));
    expect(items().at(-1)).toBe('Leave and lose these games?');

    openMenu(); // close
    openMenu(); // open again
    expect(items().at(-1)).toBe('Leave guest session');
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('navigation items still navigate', () => {
    const onNavigate = vi.fn();
    render(<GlobalNav onNavigate={onNavigate} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My games' }));
    expect(onNavigate).toHaveBeenCalledWith('games');
  });
});

describe('GlobalNav is unchanged for everyone else', () => {
  it('a signed-in account sees the normal menu and its own handle, flag on', () => {
    mockAuth.mockReturnValue(accountAuth);
    render(<GlobalNav />);
    expect(screen.getByRole('button', { name: /account menu/i })).toHaveTextContent('oliver');
    openMenu();
    expect(items()).toEqual(['Profile', 'My games', 'Settings', 'Privacy', 'Terms', 'Support', 'Sign out']);
  });

  it('an anonymous session gets NO guest wording while the flag is off', () => {
    flag.enabled = false;
    render(<GlobalNav />);
    expect(screen.getByRole('button', { name: /account menu/i })).not.toHaveTextContent('Guest');
    openMenu();
    expect(items()).toContain('Sign out');
    expect(items()).not.toContain('Leave guest session');
  });
});
