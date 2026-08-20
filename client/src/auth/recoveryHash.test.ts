// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSession = vi.fn();
const captureMessage = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: (...args: unknown[]) => setSession(...args),
    },
  },
}));

vi.mock('@sentry/react', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

const { parseSupabaseAuthHash, consumeSupabaseRecoveryHash, PASSWORD_RECOVERY_PENDING_KEY } =
  await import('./recoveryHash');

function recoveryHash(overrides: { access?: string; refresh?: string; type?: string } = {}): string {
  const access = overrides.access ?? 'access-token-value';
  const refresh = overrides.refresh ?? 'refresh-token-value';
  const type = overrides.type ?? 'recovery';
  return `#access_token=${access}&refresh_token=${refresh}&type=${type}`;
}

describe('parseSupabaseAuthHash', () => {
  it('parses recovery callback hashes', () => {
    expect(parseSupabaseAuthHash(recoveryHash())).toEqual({
      access_token: 'access-token-value',
      refresh_token: 'refresh-token-value',
      type: 'recovery',
    });
  });

  it('ignores legacy HashRouter paths', () => {
    expect(parseSupabaseAuthHash('#/play')).toBeNull();
  });
});

describe('consumeSupabaseRecoveryHash', () => {
  beforeEach(() => {
    setSession.mockReset();
    captureMessage.mockReset();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/reset-password');
  });

  it('clears the hash only after setSession succeeds', async () => {
    window.location.hash = recoveryHash();
    setSession.mockResolvedValue({ error: null });

    const ok = await consumeSupabaseRecoveryHash();

    expect(ok).toBe(true);
    expect(setSession).toHaveBeenCalledWith({
      access_token: 'access-token-value',
      refresh_token: 'refresh-token-value',
    });
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY)).toBe('1');
  });

  it('leaves the hash in place and reports when setSession fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.location.hash = recoveryHash({ access: 'access-abc', refresh: 'refresh-xyz' });
    setSession.mockResolvedValue({
      error: { message: 'Invalid Refresh Token', name: 'AuthApiError', status: 400 },
    });

    const ok = await consumeSupabaseRecoveryHash();

    expect(ok).toBe(false);
    expect(window.location.hash).toContain('access_token=access-abc');
    expect(window.sessionStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY)).toBeNull();
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('recovery hash setSession failed'),
      expect.objectContaining({
        level: 'error',
        tags: expect.objectContaining({ auth_alert: 'recovery_set_session_failed' }),
        extra: expect.objectContaining({
          auth_flow: 'password_recovery',
          hash_still_present: true,
          access_token_len: 'access-abc'.length,
          refresh_token_len: 'refresh-xyz'.length,
          error_status: 400,
        }),
      }),
    );
    expect(JSON.stringify(captureMessage.mock.calls[0])).not.toContain('access-abc');
    expect(JSON.stringify(captureMessage.mock.calls[0])).not.toContain('refresh-xyz');
    warn.mockRestore();
  });

  it('does not call setSession for non-recovery hashes', async () => {
    window.location.hash = recoveryHash({ type: 'signup' });
    const ok = await consumeSupabaseRecoveryHash();
    expect(ok).toBe(false);
    expect(setSession).not.toHaveBeenCalled();
  });
});
