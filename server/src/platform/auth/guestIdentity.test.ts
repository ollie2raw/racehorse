import { describe, expect, it } from 'vitest';
import { normalizeUntrustedGuestId } from './guestIdentity';

describe('normalizeUntrustedGuestId', () => {
  it('accepts bounded client-generated guest identities', () => {
    expect(normalizeUntrustedGuestId(' guest_local_123 ')).toBe('guest_local_123');
    expect(normalizeUntrustedGuestId('guest_e2e_mp_host_a1b2c3d4')).toBe('guest_e2e_mp_host_a1b2c3d4');
  });

  it('rejects account-shaped and arbitrary client claims', () => {
    expect(normalizeUntrustedGuestId('11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(normalizeUntrustedGuestId('admin')).toBeNull();
    expect(normalizeUntrustedGuestId('guest-short')).toBeNull();
    expect(normalizeUntrustedGuestId(`guest_${'a'.repeat(97)}`)).toBeNull();
    expect(normalizeUntrustedGuestId(null)).toBeNull();
  });
});

