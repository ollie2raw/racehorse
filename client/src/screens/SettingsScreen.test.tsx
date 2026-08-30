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

  it('signs out through the app handler', () => {
    const onSignOut = vi.fn();
    render(<SettingsScreen authUser={authUser} onSignOut={onSignOut} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
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
});
