import { beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ on: true }));
vi.mock('../config/guestPlayFeature', () => ({ isGuestPlayEnabled: () => flag.on }));

import { ensureGuestBeforePlay } from './guestStart';

beforeEach(() => {
  flag.on = true;
});

describe('ensureGuestBeforePlay', () => {
  it('creates a guest session for a visitor with none', async () => {
    const ensure = vi.fn().mockResolvedValue({ error: null });
    await ensureGuestBeforePlay(false, ensure);
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('leaves a signed-in player (or a guest already signed in) alone', async () => {
    const ensure = vi.fn().mockResolvedValue({ error: null });
    await ensureGuestBeforePlay(true, ensure);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('does nothing with the flag off, or when guest play is not wired', async () => {
    const ensure = vi.fn().mockResolvedValue({ error: null });
    flag.on = false;
    await ensureGuestBeforePlay(false, ensure);
    expect(ensure).not.toHaveBeenCalled();
    flag.on = true;
    await expect(ensureGuestBeforePlay(false, undefined)).resolves.toBeUndefined();
  });

  it('never blocks play: a failed or throwing session still resolves', async () => {
    await expect(ensureGuestBeforePlay(false, vi.fn().mockResolvedValue({ error: 'offline' }))).resolves.toBeUndefined();
    await expect(ensureGuestBeforePlay(false, vi.fn().mockRejectedValue(new Error('boom')))).resolves.toBeUndefined();
  });

  it('waits for the session before resolving, so the match starts with it', async () => {
    let finish!: () => void;
    const ensure = vi.fn(() => new Promise<{ error: null }>((resolve) => { finish = () => resolve({ error: null }); }));
    let done = false;
    const pending = ensureGuestBeforePlay(false, ensure).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await pending;
    expect(done).toBe(true);
  });
});
