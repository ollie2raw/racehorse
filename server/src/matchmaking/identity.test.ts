import { describe, expect, it } from 'vitest';
import { resolveQueueIdentity } from './index';

const validUserId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '33333333-3333-4333-8333-333333333333';

function socketWithData(data: Record<string, unknown>) {
  return { data } as any;
}

describe('resolveQueueIdentity', () => {
  it('uses authenticated socket identity instead of trusting the payload', () => {
    const identity = resolveQueueIdentity(
      socketWithData({ userId: validUserId, username: 'verified_player' }),
      { userId: validUserId, username: 'payload_player' },
    );

    expect(identity).toEqual({
      ok: true,
      userId: validUserId,
      username: 'verified_player',
      authenticated: true,
    });
  });

  it('rejects authenticated queue userId spoofing', () => {
    const identity = resolveQueueIdentity(
      socketWithData({ userId: validUserId, username: 'verified_player' }),
      { userId: otherUserId, username: 'payload_player' },
    );

    expect(identity).toEqual({ ok: false, error: 'user_mismatch' });
  });

  it('rejects unauthenticated UUID queue identities', () => {
    const identity = resolveQueueIdentity(socketWithData({}), {
      userId: validUserId,
      username: 'payload_player',
    });

    expect(identity).toEqual({ ok: false, error: 'not_authenticated' });
  });

  it('allows non-UUID guest identities as unranked queue identities', () => {
    const identity = resolveQueueIdentity(socketWithData({}), {
      userId: 'guest_local_123',
      username: 'Guest',
    });

    expect(identity).toEqual({
      ok: true,
      userId: 'guest_local_123',
      username: 'Guest',
      authenticated: false,
    });
  });
});

