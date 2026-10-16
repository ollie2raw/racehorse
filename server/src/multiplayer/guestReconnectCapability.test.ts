import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGuestSeatIdentity, issueGuestReconnectCapability, verifyGuestReconnectCapability } from './guestReconnectCapability';

afterEach(() => vi.useRealTimers());

describe('guest reconnect capability (authorization capability, distinct from the visible guest id)', () => {
  const token = () => issueGuestReconnectCapability('ROOM1', 'seat-a', 'guest_abc');

  it('verifies only for the exact room + seat + guest id it was issued for', () => {
    const t = token();
    expect(verifyGuestReconnectCapability(t, 'ROOM1', 'seat-a', 'guest_abc')).toBe(true);
    expect(verifyGuestReconnectCapability(t, 'ROOM2', 'seat-a', 'guest_abc')).toBe(false); // wrong room
    expect(verifyGuestReconnectCapability(t, 'ROOM1', 'seat-b', 'guest_abc')).toBe(false); // wrong seat
    expect(verifyGuestReconnectCapability(t, 'ROOM1', 'seat-a', 'guest_other')).toBe(false); // another guest's visible id
  });

  it('rejects absent, malformed, tampered, truncated and over-long tokens', () => {
    const t = token();
    const [v, exp, sig] = t.split('.');
    for (const bad of [undefined, null, '', 'v1', 'v2.' + exp + '.' + sig, `v1.${exp}`, `v1.12.${sig}`, `${v}.${exp}.${sig!.slice(0, -2)}`, `${v}.${Number(exp) + 1}.${sig}`, 'x'.repeat(200), 42, {}]) {
      expect(verifyGuestReconnectCapability(bad, 'ROOM1', 'seat-a', 'guest_abc'), String(bad)).toBe(false);
    }
  });

  it('expires', () => {
    vi.useFakeTimers();
    const t = token();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);
    expect(verifyGuestReconnectCapability(t, 'ROOM1', 'seat-a', 'guest_abc')).toBe(false);
  });

  it('an account UUID is never a guest seat identity, so it cannot ride the guest-capability path', () => {
    expect(isGuestSeatIdentity('11111111-1111-4111-8111-111111111111')).toBe(false);
    expect(isGuestSeatIdentity('guest_abc')).toBe(true);
    expect(isGuestSeatIdentity(null)).toBe(true);
  });
});
