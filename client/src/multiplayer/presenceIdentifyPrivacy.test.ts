/**
 * Phase 4A.1: the name a socket identifies with is what opponents and
 * spectators see (the server copies it onto the room roster). It must be the
 * profile username, or Player while the profile has not loaded — never derived
 * from the account email. Drives the real connect handler through the socket
 * event bus and inspects the emitted presence:identify payload.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMultiplayerConnectionSocketHandlers } from './registerMultiplayerConnectionSocketHandlers';
import { interpretRawSocketEvent, resetSocketEventBusForTests } from './socketEventBus';

const EMAIL = 'jane.doe.private@example.com';
const LOCAL_PART = 'jane.doe.private';
const USER_ID = '7f3c2a10-9b8e-4d21-a5c4-0e1f2a3b4c5d';

/** Any property is another permissive stub; calling one does nothing. */
function stub(): any {
  const cache = new Map<PropertyKey, unknown>();
  const fn = () => undefined;
  return new Proxy(fn, {
    get: (_t, key) => {
      if (key === 'then') return undefined;
      if (!cache.has(key)) cache.set(key, stub());
      return cache.get(key);
    },
    apply: () => undefined,
  });
}

function connectWith(profileUsername: string | null) {
  const emitWithAck = vi.fn(async () => ({ ok: true }));
  const scope = new Proxy(
    {
      session: { dispatchSession: vi.fn(), sessionRef: { current: { context: { intentionalDisconnect: false } } } },
      auth: {
        authUserRef: { current: { id: USER_ID, email: EMAIL } },
        authProfileRef: { current: profileUsername === null ? null : { id: USER_ID, username: profileUsername } },
        authAccessTokenRef: { current: 'token' },
      },
      socket: { socketRef: { current: { connected: true, id: 'sock-1' } } },
      joinFlight: { pendingCreateOnConnectRef: { current: false } },
      config: { emitWithAck },
      ui: stub(),
    } as Record<string, unknown>,
    { get: (t, key) => (key in t ? t[key as string] : stub()) },
  );
  const unregister = registerMultiplayerConnectionSocketHandlers({
    getScope: () => scope as never,
    recoveryMachineRef: { current: null } as never,
    dispatchRecovery: vi.fn(),
    syncMachineToLegacy: vi.fn(),
    trySavedRoomAutoJoin: vi.fn(async () => undefined),
    recoverState: vi.fn(),
  });
  interpretRawSocketEvent('connect', undefined);
  return { emitWithAck, unregister };
}

async function identifyPayload(profileUsername: string | null) {
  const { emitWithAck, unregister } = connectWith(profileUsername);
  await vi.waitFor(() => expect(emitWithAck).toHaveBeenCalled());
  unregister();
  const call = emitWithAck.mock.calls.find((c) => (c as unknown[])[1] === 'presence:identify') as unknown[] | undefined;
  expect(call).toBeDefined();
  return call![2] as { userId: string; username: string };
}

afterEach(() => resetSocketEventBusForTests());

describe('presence:identify carries a public name only', () => {
  it('a loaded profile identifies with its username', async () => {
    const payload = await identifyPayload('racer_jane');
    expect(payload).toMatchObject({ userId: USER_ID, username: 'racer_jane' });
  });

  it('no profile yet: identifies as Player — no email, no local part, no user-id fragment', async () => {
    const payload = await identifyPayload(null);
    expect(payload.username).toBe('Player');
    const wire = JSON.stringify({ username: payload.username });
    expect(wire).not.toContain(LOCAL_PART);
    expect(wire).not.toContain('@example.com');
    expect(wire).not.toContain(USER_ID.slice(0, 8));
  });
});
