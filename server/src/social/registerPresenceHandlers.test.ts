import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
import { supabaseFetch } from '../supabaseUtils';
import {
  addSocket,
  isOnline,
  resetPresenceRegistry,
  socketsByUserId as registrySockets,
} from './presenceRegistry';
import {
  createRemoveSocketPresence,
  emitPresenceUpdateToFriends,
  registerPresenceHandlers,
} from './registerPresenceHandlers';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';

const isUuidLike = (value: string | null | undefined): boolean =>
  Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );

const normalizeUserId = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

type HandlerMap = Record<string, (...args: unknown[]) => unknown>;

function createSocketStub(overrides: { id?: string; data?: Record<string, unknown> } = {}): Socket {
  return {
    id: overrides.id ?? 'sock-1',
    data: overrides.data ?? {},
    on: vi.fn(),
  } as unknown as Socket;
}

function captureHandlers(socket: Socket): HandlerMap {
  const handlers: HandlerMap = {};
  vi.mocked(socket.on).mockImplementation((event: string, handler: (...args: unknown[]) => unknown) => {
    handlers[event] = handler;
    return socket;
  });
  return handlers;
}

/** Collects every presence:update emitted, with the socket it went to. */
function createIo() {
  const emitted: Array<{ socketId: string; event: string; payload: unknown }> = [];
  const io = {
    to: vi.fn((socketId: string) => ({
      emit: (event: string, payload: unknown) => { emitted.push({ socketId, event, payload }); },
    })),
  } as unknown as Server;
  return { io, emitted };
}

beforeEach(() => {
  resetPresenceRegistry();
  vi.mocked(supabaseFetch).mockReset();
  vi.mocked(supabaseFetch).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetPresenceRegistry();
});

describe('createRemoveSocketPresence', () => {
  it('reports the last socket leaving, not every socket leaving', () => {
    addSocket(USER_A, 'sock-1');
    addSocket(USER_A, 'sock-2');

    const first = createRemoveSocketPresence(
      createSocketStub({ id: 'sock-1', data: { userId: USER_A } }),
      registrySockets,
      normalizeUserId,
    );
    expect(first()).toBe(false);
    expect(isOnline(USER_A)).toBe(true);

    const second = createRemoveSocketPresence(
      createSocketStub({ id: 'sock-2', data: { userId: USER_A } }),
      registrySockets,
      normalizeUserId,
    );
    expect(second()).toBe(true);
    expect(isOnline(USER_A)).toBe(false);
  });
});

describe('registerPresenceHandlers', () => {
  it('presence:identify registers the socket and announces the user online', async () => {
    const socket = createSocketStub({ id: 'sock-a' });
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const { io } = createIo();

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId: registrySockets,
      resolveSocketIdentity: vi.fn().mockResolvedValue({ username: 'Alice', userId: USER_A }),
      normalizeUserId,
      isUuidLike,
    });

    await handlers['presence:identify']({ username: 'Alice' }, cb);

    expect(cb).toHaveBeenCalledWith({ ok: true });
    expect(socket.data.userId).toBe(USER_A);
    expect(isOnline(USER_A)).toBe(true);
  });

  it('re-identifying an already-online user does not re-announce them', async () => {
    const { io } = createIo();
    const identify = async (socketId: string) => {
      const socket = createSocketStub({ id: socketId });
      const handlers = captureHandlers(socket);
      registerPresenceHandlers(socket, {
        io,
        socketsByUserId: registrySockets,
        resolveSocketIdentity: vi.fn().mockResolvedValue({ username: 'Alice', userId: USER_A }),
        normalizeUserId,
        isUuidLike,
      });
      await handlers['presence:identify']({}, vi.fn());
    };

    await identify('sock-a');
    const afterFirst = vi.mocked(supabaseFetch).mock.calls.length;

    // Reconnect / token rotation: same user, second socket.
    await identify('sock-b');

    // The friends lookup that backs the broadcast did not run again.
    expect(vi.mocked(supabaseFetch).mock.calls.length).toBe(afterFirst);
  });

  it('presence:identify returns ok:false when identity has no userId', async () => {
    const socket = createSocketStub();
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const { io } = createIo();

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId: registrySockets,
      resolveSocketIdentity: vi.fn().mockResolvedValue({ username: 'Guest', userId: null }),
      normalizeUserId,
      isUuidLike,
    });

    await handlers['presence:identify']({}, cb);

    expect(cb).toHaveBeenCalledWith({ ok: false });
    expect(registrySockets.size).toBe(0);
  });

  it('presence:identify returns ok:false when resolveSocketIdentity throws', async () => {
    const socket = createSocketStub();
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const { io } = createIo();

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId: registrySockets,
      resolveSocketIdentity: vi.fn().mockRejectedValue(new Error('auth_failed')),
      normalizeUserId,
      isUuidLike,
    });

    await handlers['presence:identify']({}, cb);

    expect(cb).toHaveBeenCalledWith({ ok: false });
  });

  it('presence:online returns only user ids with connected sockets', () => {
    addSocket(USER_A, 'sock-a');
    addSocket(USER_B, 'sock-b');
    const socket = createSocketStub();
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const { io } = createIo();

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId: registrySockets,
      resolveSocketIdentity: vi.fn(),
      normalizeUserId,
      isUuidLike,
    });

    handlers['presence:online']([USER_A, USER_C, 'not-a-uuid'], cb);

    expect(cb).toHaveBeenCalledWith({ ok: true, onlineUserIds: [USER_A] });
  });

  it('does NOT mark a user offline while another of their tabs is still connected', async () => {
    // Two tabs for the same user.
    addSocket(USER_A, 'sock-a');
    addSocket(USER_A, 'sock-b');
    // USER_B is a friend with a live socket, so any broadcast would reach them.
    addSocket(USER_B, 'sock-friend');
    vi.mocked(supabaseFetch).mockResolvedValue([{ user_id: USER_A, friend_user_id: USER_B }]);

    const { io, emitted } = createIo();
    const { handlePresenceDisconnect } = registerPresenceHandlers(
      createSocketStub({ id: 'sock-a', data: { userId: USER_A } }),
      {
        io,
        socketsByUserId: registrySockets,
        resolveSocketIdentity: vi.fn(),
        normalizeUserId,
        isUuidLike,
      },
    );

    handlePresenceDisconnect();
    await Promise.resolve();
    await Promise.resolve();

    expect(isOnline(USER_A)).toBe(true);
    expect(emitted.filter((e) => e.event === 'presence:update')).toHaveLength(0);
  });

  it('marks a user offline once their last socket disconnects', async () => {
    addSocket(USER_A, 'sock-a');
    addSocket(USER_B, 'sock-friend');
    vi.mocked(supabaseFetch).mockResolvedValue([{ user_id: USER_A, friend_user_id: USER_B }]);

    const { io, emitted } = createIo();
    const { handlePresenceDisconnect } = registerPresenceHandlers(
      createSocketStub({ id: 'sock-a', data: { userId: USER_A } }),
      {
        io,
        socketsByUserId: registrySockets,
        resolveSocketIdentity: vi.fn(),
        normalizeUserId,
        isUuidLike,
      },
    );

    handlePresenceDisconnect();
    await Promise.resolve();
    await Promise.resolve();

    expect(isOnline(USER_A)).toBe(false);
    expect(emitted).toContainEqual({
      socketId: 'sock-friend',
      event: 'presence:update',
      payload: { userId: USER_A, status: 'offline' },
    });
  });
});

describe('emitPresenceUpdateToFriends', () => {
  it('emits presence:update only to connected friend sockets', async () => {
    addSocket(USER_B, 'sock-friend');
    const { io, emitted } = createIo();

    vi.mocked(supabaseFetch).mockResolvedValue([
      { user_id: USER_A, friend_user_id: USER_B },
      { user_id: USER_A, friend_user_id: USER_C },
    ]);

    emitPresenceUpdateToFriends({ io, socketsByUserId: registrySockets }, USER_A, 'online');
    await Promise.resolve();
    await Promise.resolve();

    expect(emitted).toEqual([
      { socketId: 'sock-friend', event: 'presence:update', payload: { userId: USER_A, status: 'online' } },
    ]);
    expect(supabaseFetch).toHaveBeenCalledWith(
      `/rest/v1/friends?or=(user_id.eq.${encodeURIComponent(USER_A)},friend_user_id.eq.${encodeURIComponent(USER_A)})&status=eq.accepted&select=user_id,friend_user_id`,
    );
  });
});
