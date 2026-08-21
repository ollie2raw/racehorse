// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthModal from './AuthModal';

describe('AuthModal — timeout-path error vs happy-path close', () => {
  const onClose = vi.fn();
  const onSignIn = vi.fn();
  const onSignUp = vi.fn();
  const onResetPassword = vi.fn();

  beforeEach(() => {
    onClose.mockReset();
    onSignIn.mockReset();
    onSignUp.mockReset();
    onResetPassword.mockReset();
  });

  function renderOpen() {
    return render(
      <AuthModal
        open
        supabaseEnabled
        supabaseConfigError={null}
        onClose={onClose}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        onResetPassword={onResetPassword}
      />,
    );
  }

  async function fillAndSubmitSignIn() {
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'attempt@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Minimum 6 characters'), {
      target: { value: 'password1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  it('1. timeout-path error (stale session) keeps modal open — no false success close', async () => {
    onSignIn.mockResolvedValue({ error: 'Request timed out. Try again.' });
    renderOpen();
    await fillAndSubmitSignIn();

    await waitFor(() => {
      expect(screen.getByText('Request timed out. Try again.')).toBeTruthy();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSignIn).toHaveBeenCalledWith('attempt@example.com', 'password1');
  });

  it('4. non-timeout happy path still closes the modal', async () => {
    onSignIn.mockResolvedValue({ error: null });
    renderOpen();
    await fillAndSubmitSignIn();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/timed out/i)).toBeNull();
  });
});
