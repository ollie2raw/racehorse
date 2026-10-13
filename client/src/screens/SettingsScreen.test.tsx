// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The page renders GlobalNav directly now — it is no longer a hub page, so
// there is no HubViewportPage between them.
vi.mock('../components/GlobalNav', () => ({ GlobalNav: () => null }));

const { SettingsScreen } = await import('./SettingsScreen');

const authUser = { id: 'user-1', email: 'qa@racehorse.test' } as never;

describe('SettingsScreen', () => {
  it('names itself', () => {
    render(<SettingsScreen authUser={authUser} />);
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
  });

  it('leaves sign-out to the account menu instead of repeating it on the page', () => {
    render(<SettingsScreen authUser={authUser} onSignOut={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('asks a signed-out visitor to sign in instead of showing account controls', () => {
    // /settings is prerendered and directly linkable, so it has to render
    // something coherent before a session exists.
    const onOpenAuth = vi.fn();
    render(<SettingsScreen authUser={null} onOpenAuth={onOpenAuth} />);

    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(onOpenAuth).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['signed in', authUser],
    ['signed out', null],
  ])('links Privacy, Terms and Support in-app when %s', (_label, user) => {
    const onNavigate = vi.fn();
    render(<SettingsScreen authUser={user} onNavigate={onNavigate} />);
    expect(screen.getByRole('heading', { name: 'Legal and support' })).toBeTruthy();
    const privacy = screen.getByRole('link', { name: /Privacy Policy/ });
    const terms = screen.getByRole('link', { name: /Terms of Use/ });
    const support = screen.getByRole('link', { name: /^Support/ });
    expect([privacy, terms, support].map((link) => link.getAttribute('href'))).toEqual([
      '/privacy',
      '/terms',
      '/support',
    ]);
    fireEvent.click(support);
    expect(onNavigate).toHaveBeenCalledWith('support');
  });
});
