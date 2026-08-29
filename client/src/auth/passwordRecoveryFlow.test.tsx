// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Settings gained a signed-in password change. The emailed recovery link is a
 * different entry point — it is what a locked-out user has — and it has to keep
 * working on its own terms: opened by `passwordRecoveryPending`, not by a
 * session the user cannot get.
 */

vi.mock('../multiplayer/FriendInvitePopupBridge', () => ({ FriendInvitePopupBridge: () => null }));

const { AuthModalsLayer } = await import('../AppOverlays');

const baseProps = {
  authModalOpen: false,
  supabaseEnabled: true,
  supabaseConfigError: null,
  onAuthModalClose: vi.fn(),
  onSignIn: vi.fn(),
  onSignUp: vi.fn(),
  onResetPassword: vi.fn(),
  onUpdatePassword: vi.fn(() => Promise.resolve({ error: null })),
  onPasswordRecoveryClose: vi.fn(),
  usernameModalOpen: false,
  currentUsername: null,
  onUsernameSave: vi.fn(() => Promise.resolve({ error: null })),
  onUsernameClose: vi.fn(),
  onUsernameSignOut: vi.fn(),
  signingOut: false,
};

type LayerProps = import('../AppOverlays').AuthModalsLayerProps;

const renderLayer = (overrides: Partial<LayerProps>) =>
  render(<AuthModalsLayer {...({ ...baseProps, ...overrides } as LayerProps)} />);

describe('recovery-link password flow', () => {
  it('stays closed when no recovery is pending', async () => {
    renderLayer({ passwordRecoveryPending: false });
    await waitFor(() => expect(screen.queryByText('Set a new password')).toBeNull());
  });

  it('opens on the recovery marker alone', async () => {
    renderLayer({ passwordRecoveryPending: true });
    expect(await screen.findByText('Set a new password')).toBeTruthy();
  });

  it('still submits a new password through the same handler Settings uses', async () => {
    const onUpdatePassword = vi.fn(() => Promise.resolve({ error: null }));
    renderLayer({ passwordRecoveryPending: true, onUpdatePassword });

    const password = await screen.findByLabelText('New password');
    fireEvent.change(password, { target: { value: 'correct-horse' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct-horse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => expect(onUpdatePassword).toHaveBeenCalledWith('correct-horse'));
  });

  it('applies the same mismatch rule the Settings page applies', async () => {
    const onUpdatePassword = vi.fn(() => Promise.resolve({ error: null }));
    renderLayer({ passwordRecoveryPending: true, onUpdatePassword });

    const password = await screen.findByLabelText('New password');
    fireEvent.change(password, { target: { value: 'correct-horse' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct-hoarse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();
    expect(onUpdatePassword).not.toHaveBeenCalled();
  });

  it('says why a too-short password is refused instead of silently disabling', async () => {
    // The modal used to gate this behind a disabled button with no message,
    // while Settings explains it — the same rule has to say the same thing.
    const onUpdatePassword = vi.fn(() => Promise.resolve({ error: null }));
    renderLayer({ passwordRecoveryPending: true, onUpdatePassword });

    const password = await screen.findByLabelText('New password');
    fireEvent.change(password, { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Password must be at least 6 characters.')).toBeTruthy();
    expect(onUpdatePassword).not.toHaveBeenCalled();
  });
});
