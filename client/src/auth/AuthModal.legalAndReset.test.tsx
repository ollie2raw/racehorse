// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuthModal from './AuthModal';
import { AUTH_RATE_LIMITED_MESSAGE, PASSWORD_RESET_SENT_MESSAGE } from './authErrors';

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
  render(<AuthModal {...props} />);
  return props;
}

describe('AuthModal — sign-up legal line', () => {
  it('is absent on sign in and present, unobtrusively, on create account', () => {
    renderModal();
    expect(screen.queryByText(/By creating an account you agree/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Need an account/ }));
    expect(screen.getByText(/By creating an account you agree to the/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
    // A sentence, not a gate: no checkbox to tick before creating the account.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('closes the modal and opens the page in-app', () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Need an account/ }));
    fireEvent.click(screen.getByRole('link', { name: 'Terms' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onOpenLegal).toHaveBeenCalledWith('terms');
  });
});

describe('AuthModal — password reset states', () => {
  function requestReset() {
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'who@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
  }

  it('shows the neutral sent message (with the finish-on-the-web hint from useAuth)', async () => {
    const message = `${PASSWORD_RESET_SENT_MESSAGE} Open the link on this device; after you set a new password, return to the app and sign in.`;
    const props = renderModal({ onResetPassword: vi.fn().mockResolvedValue({ error: null, message }) });
    requestReset();
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(props.onResetPassword).toHaveBeenCalledWith('who@example.com');
    expect(screen.getByRole('button', { name: /Reset email sent/ })).toBeTruthy();
  });

  it('falls back to the neutral message when none is returned', async () => {
    renderModal({ onResetPassword: vi.fn().mockResolvedValue({ error: null }) });
    requestReset();
    await waitFor(() => expect(screen.getByText(PASSWORD_RESET_SENT_MESSAGE)).toBeTruthy());
  });

  it('shows the rate-limited state and lets the player try again later', async () => {
    renderModal({ onResetPassword: vi.fn().mockResolvedValue({ error: AUTH_RATE_LIMITED_MESSAGE }) });
    requestReset();
    await waitFor(() => expect(screen.getByText(AUTH_RATE_LIMITED_MESSAGE)).toBeTruthy());
    // Not marked as sent, so the button is still there for a later retry.
    expect((screen.getByRole('button', { name: 'Forgot password?' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks for the email first instead of sending an empty request', () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByText('Enter your email above first.')).toBeTruthy();
    expect(props.onResetPassword).not.toHaveBeenCalled();
  });
});
