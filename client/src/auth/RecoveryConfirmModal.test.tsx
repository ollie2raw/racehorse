// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSession = vi.fn();
const getUser = vi.fn();
vi.mock('../lib/supabase', () => ({ supabase: { auth: { setSession: (...a: unknown[]) => setSession(...a), getUser: (...a: unknown[]) => getUser(...a) } } }));
vi.mock('@sentry/react', () => ({ captureMessage: vi.fn() }));

const { consumeSupabaseRecoveryHash, declineRecoveryConfirmation } = await import('./recoveryHash');
const { default: RecoveryConfirmModal } = await import('./RecoveryConfirmModal');

describe('RecoveryConfirmModal', () => {
  beforeEach(() => {
    setSession.mockReset().mockResolvedValue({ error: null });
    getUser.mockReset().mockResolvedValue({ data: { user: { email: 'attacker@evil.test' } }, error: null });
    declineRecoveryConfirmation();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/#access_token=a&refresh_token=r&type=recovery');
  });

  it('renders nothing until an unsolicited link is held, names the account, and signs in only on Continue', async () => {
    const { container } = render(<RecoveryConfirmModal />);
    expect(container).toBeEmptyDOMElement();

    await act(async () => {
      await consumeSupabaseRecoveryHash();
    });
    expect(screen.getByText('attacker@evil.test')).toBeTruthy();
    expect(setSession).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue as attacker@evil.test/i }));
    });
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('Cancel discards the link without a session', async () => {
    const { container } = render(<RecoveryConfirmModal />);
    await act(async () => {
      await consumeSupabaseRecoveryHash();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });
    expect(setSession).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
