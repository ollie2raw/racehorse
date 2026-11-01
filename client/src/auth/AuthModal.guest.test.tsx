// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuthModal from './AuthModal';

afterEach(cleanup);

function renderModal(overrides: Partial<Parameters<typeof AuthModal>[0]> = {}) {
  const props = {
    open: true,
    supabaseEnabled: true,
    supabaseConfigError: null,
    onClose: vi.fn(),
    onSignIn: vi.fn(),
    onSignUp: vi.fn(),
    onResetPassword: vi.fn(),
    onOpenLegal: vi.fn(),
    ...overrides,
  };
  const view = render(<AuthModal {...props} />);
  return { props, ...view };
}

describe('AuthModal for a guest', () => {
  it('opens on Create account and says it keeps the games they have played', () => {
    renderModal({ isGuest: true });
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeTruthy();
    expect(screen.getByText('Create a free account and keep the games you have played.')).toBeTruthy();
  });

  it('is honest that signing in to an existing account replaces the guest session', () => {
    renderModal({ isGuest: true });
    fireEvent.click(screen.getByRole('button', { name: /Already have an account/ }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByText('Signing in replaces your guest session. Games you played as a guest stay with it.')).toBeTruthy();
  });

  it('reopens on Create account after being closed, not on whatever it was left on', () => {
    const { props, rerender } = renderModal({ isGuest: true });
    fireEvent.click(screen.getByRole('button', { name: /Already have an account/ }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();

    rerender(<AuthModal {...props} open={false} isGuest />);
    rerender(<AuthModal {...props} open isGuest />);
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeTruthy();
  });

  it('shows the confirmation message from the upgrade, so "your games are saved" reaches the person', async () => {
    const onSignUp = vi.fn().mockResolvedValue({
      error: null,
      pendingVerification: true,
      message: 'Check your email to finish creating your account. Your games are saved to it.',
    });
    renderModal({ isGuest: true, onSignUp });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('your_username'), { target: { value: 'domino_king' } });
    fireEvent.change(screen.getByPlaceholderText('Minimum 6 characters'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/Your games are saved to it\./)).toBeTruthy();
    expect(onSignUp).toHaveBeenCalledWith('me@example.com', 'password123', 'domino_king');
  });
});

describe('AuthModal for everyone else is unchanged', () => {
  it('opens on Sign in with the usual copy', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByText('Track your rating, friends, streaks, and leaderboard results.')).toBeTruthy();
  });

  it('keeps the usual Create account copy', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Need an account/ }));
    expect(screen.getByText('Create a free account to track your stats and compete on the leaderboard.')).toBeTruthy();
  });
});
