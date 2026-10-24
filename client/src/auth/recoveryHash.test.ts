// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSession = vi.fn();
const getUser = vi.fn();
const captureMessage = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: (...args: unknown[]) => setSession(...args),
      getUser: (...args: unknown[]) => getUser(...args),
    },
  },
}));

vi.mock('@sentry/react', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

const {
  parseSupabaseAuthHash,
  consumeSupabaseRecoveryHash,
  PASSWORD_RECOVERY_PENDING_KEY,
  PASSWORD_RESET_REQUEST_KEY,
  rememberPasswordResetRequest,
  getRecoveryConfirmation,
  acceptRecoveryConfirmation,
  declineRecoveryConfirmation,
} = await import('./recoveryHash');

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
    getUser.mockReset();
    captureMessage.mockReset();
    declineRecoveryConfirmation();
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/reset-password');
    // default: the auth server vouches for these tokens as user@example.com, and this browser asked for that reset
    getUser.mockResolvedValue({ data: { user: { email: 'User@Example.com' } }, error: null });
    rememberPasswordResetRequest('user@example.com');
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

  it('does not call setSession for non-recovery hashes, and scrubs their tokens from the URL', async () => {
    window.location.hash = recoveryHash({ type: 'signup' });
    const ok = await consumeSupabaseRecoveryHash();
    expect(ok).toBe(false);
    expect(setSession).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('access_token');
    expect(window.location.pathname).toBe('/reset-password');
  });

  it('scrubs token query parameters but keeps unrelated ones and the path', async () => {
    window.history.replaceState(null, '', '/reset-password?ref=mail&access_token=leak&refresh_token=leak2');
    await consumeSupabaseRecoveryHash();
    expect(window.location.search).toBe('?ref=mail');
  });

  it('leaves legacy #/route hashes alone', async () => {
    window.history.replaceState(null, '', '/x#/play');
    await consumeSupabaseRecoveryHash();
    expect(window.location.hash).toBe('#/play');
  });

  describe('attacker-crafted recovery link (login CSRF / session fixation)', () => {
    it('does NOT sign the browser in when it did not request that reset: holds for confirmation and clears the URL', async () => {
      window.localStorage.clear(); // victim never asked for a reset here
      getUser.mockResolvedValue({ data: { user: { email: 'attacker@evil.test' } }, error: null });
      window.location.hash = recoveryHash({ access: 'attacker-access', refresh: 'attacker-refresh' });

      const ok = await consumeSupabaseRecoveryHash();

      expect(ok).toBe(false);
      expect(setSession).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY)).toBeNull();
      expect(window.location.hash).toBe('');
      expect(getRecoveryConfirmation()).toEqual({ email: 'attacker@evil.test' });
      expect(JSON.stringify(getRecoveryConfirmation())).not.toContain('attacker-access');
    });

    it('a reset requested for a DIFFERENT email in this browser does not whitelist the link', async () => {
      getUser.mockResolvedValue({ data: { user: { email: 'attacker@evil.test' } }, error: null });
      window.location.hash = recoveryHash();
      await consumeSupabaseRecoveryHash();
      expect(setSession).not.toHaveBeenCalled();
      expect(getRecoveryConfirmation()?.email).toBe('attacker@evil.test');
    });

    it('an expired request marker (over an hour old) does not count', async () => {
      window.localStorage.setItem(PASSWORD_RESET_REQUEST_KEY, JSON.stringify({ email: 'user@example.com', at: Date.now() - 61 * 60 * 1000 }));
      window.location.hash = recoveryHash();
      await consumeSupabaseRecoveryHash();
      expect(setSession).not.toHaveBeenCalled();
      expect(getRecoveryConfirmation()?.email).toBe('user@example.com');
    });

    it('confirming signs in with the held tokens exactly once; declining discards them', async () => {
      window.localStorage.clear();
      setSession.mockResolvedValue({ error: null });
      window.location.hash = recoveryHash({ access: 'a1', refresh: 'r1' });
      await consumeSupabaseRecoveryHash();

      expect(await acceptRecoveryConfirmation()).toBe(true);
      expect(setSession).toHaveBeenCalledTimes(1);
      expect(setSession).toHaveBeenCalledWith({ access_token: 'a1', refresh_token: 'r1' });
      expect(window.sessionStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY)).toBe('1');
      expect(getRecoveryConfirmation()).toBeNull();
      expect(await acceptRecoveryConfirmation()).toBe(false);

      setSession.mockClear();
      window.location.hash = recoveryHash({ access: 'a2', refresh: 'r2' });
      await consumeSupabaseRecoveryHash();
      declineRecoveryConfirmation();
      expect(await acceptRecoveryConfirmation()).toBe(false);
      expect(setSession).not.toHaveBeenCalled();
    });

    it('a forged/expired/revoked token set is rejected before setSession and scrubbed', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT', status: 401 } });
      window.location.hash = recoveryHash();
      expect(await consumeSupabaseRecoveryHash()).toBe(false);
      expect(setSession).not.toHaveBeenCalled();
      expect(getRecoveryConfirmation()).toBeNull();
      expect(window.location.hash).toBe('');
      warn.mockRestore();
    });

    it('a transient verification failure keeps the link for a refresh retry and signs nothing in', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      getUser.mockRejectedValue(new Error('network down'));
      window.location.hash = recoveryHash({ access: 'keep-me' });
      expect(await consumeSupabaseRecoveryHash()).toBe(false);
      expect(setSession).not.toHaveBeenCalled();
      expect(window.location.hash).toContain('keep-me');
      warn.mockRestore();
    });

    it('the legitimate same-browser flow is unchanged: no prompt, request marker spent', async () => {
      setSession.mockResolvedValue({ error: null });
      window.location.hash = recoveryHash();
      expect(await consumeSupabaseRecoveryHash()).toBe(true);
      expect(getRecoveryConfirmation()).toBeNull();
      expect(window.localStorage.getItem(PASSWORD_RESET_REQUEST_KEY)).toBeNull();
    });
  });
});
