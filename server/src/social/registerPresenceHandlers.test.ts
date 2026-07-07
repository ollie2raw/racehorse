import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
import { supabaseFetch } from '../supabaseUtils';
import * as presence from './presence';
import {
  createRemoveSocketPresence,
  emitPresenceUpdateToFriends,
  registerPresenceHandlers,
} from './registerPresenceHandlers';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

vi.mock('./presence', () => ({
  upsertPresence: vi.fn().mockResolvedValue(undefined),
}));

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';

const isUuidLike = (value: string | null | undefined): boolean =>
  Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );

type HandlerMap = Record<string, (...args: unknown[]) => unknown>;

function createSocketStub(overrides: {
  id?: string;
  data?: Record<string, unknown>;
} = {}): Socket {
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

describe('createRemoveSocketPresence', () => {
  const normalizeUserId = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  it('removes socket id and deletes map entry when last socket for user disconnects', () => {
    const socketsByUserId = new Map<string, Set<string>>([[USER_A, new Set(['sock-1', 'sock-2'])]]);
    const socket = createSocketStub({ id: 'sock-1', data: { userId: USER_A } });
    const remove = createRemoveSocketPresence(socket, socketsByUserId, normalizeUserId);

    remove();

    expect(socketsByUserId.get(USER_A)?.has('sock-1')).toBe(false);
    expect(socketsByUserId.get(USER_A)?.has('sock-2')).toBe(true);

    const socket2 = createSocketStub({ id: 'sock-2', data: { userId: USER_A } });
    createRemoveSocketPresence(socket2, socketsByUserId, normalizeUserId)();

    expect(socketsByUserId.has(USER_A)).toBe(false);
  });
});

describe('registerPresenceHandlers', () => {
  const normalizeUserId = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('presence:identify registers socket and upserts online presence on success', async () => {
    const socketsByUserId = new Map<string, Set<string>>();
    const socket = createSocketStub({ id: 'sock-a' });
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const resolveSocketIdentity = vi.fn().mockResolvedValue({ username: 'Alice', userId: USER_A });
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId,
      resolveSocketIdentity,
      normalizeUserId,
      isUuidLike,
    });

    await handlers['presence:identify']({ username: 'Alice' }, cb);

    expect(cb).toHaveBeenCalledWith({ ok: true });
    expect(socket.data.userId).toBe(USER_A);
    expect(socketsByUserId.get(USER_A)?.has('sock-a')).toBe(true);
    expect(presence.upsertPresence).toHaveBeenCalledWith(USER_A, 'online');
  });

  it('presence:identify returns ok:false when identity has no userId', async () => {
    const socketsByUserId = new Map<string, Set<string>>();
    const socket = createSocketStub();
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId,
      resolveSocketIdentity: vi.fn().mockResolvedValue({ username: 'Guest', userId: null }),
      normalizeUserId,
      isUuidLike,
    });

    await handlers['presence:identify']({}, cb);

    expect(cb).toHaveBeenCalledWith({ ok: false });
    expect(socketsByUserId.size).toBe(0);
  });

  it('presence:identify returns ok:false when resolveSocketIdentity throws', async () => {
    const socketsByUserId = new Map<string, Set<string>>();
    const socket = createSocketStub();
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId,
      resolveSocketIdentity: vi.fn().mockRejectedValue(new Error('auth_failed')),
      normalizeUserId,
      isUuidLike,
    });

    await handlers['presence:identify']({}, cb);

    expect(cb).toHaveBeenCalledWith({ ok: false });
  });

  it('presence:online returns only user ids with connected sockets', () => {
    const socketsByUserId = new Map<string, Set<string>>([
      [USER_A, new Set(['sock-a'])],
      [USER_B, new Set(['sock-b'])],
    ]);
    const socket = createSocketStub();
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId,
      resolveSocketIdentity: vi.fn(),
      normalizeUserId,
      isUuidLike,
    });

    handlers['presence:online']([USER_A, USER_C, 'not-a-uuid'], cb);

    expect(cb).toHaveBeenCalledWith({ ok: true, onlineUserIds: [USER_A] });
  });

  it('handlePresenceDisconnect removes socket and upserts offline for uuid users', () => {
    const socketsByUserId = new Map<string, Set<string>>([[USER_A, new Set(['sock-a'])]]);
    const socket = createSocketStub({ id: 'sock-a', data: { userId: USER_A } });
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    vi.mocked(supabaseFetch).mockResolvedValue([]);

    const { handlePresenceDisconnect } = registerPresenceHandlers(socket, {
      io,
      socketsByUserId,
      resolveSocketIdentity: vi.fn(),
      normalizeUserId,
      isUuidLike,
    });

    handlePresenceDisconnect();

    expect(socketsByUserId.has(USER_A)).toBe(false);
    expect(presence.upsertPresence).toHaveBeenCalledWith(USER_A, 'offline');
  });
});

describe('emitPresenceUpdateToFriends', () => {
  beforeEach(() => {
    vi.mocked(supabaseFetch).mockReset();
  });

  it('emits presence:update only to connected friend sockets', async () => {
    const friendEmit = vi.fn();
    const io = {
      to: vi.fn((socketId: string) => ({
        emit: socketId === 'sock-friend' ? friendEmit : vi.fn(),
      })),
    } as unknown as Server;
    const socketsByUserId = new Map<string, Set<string>>([[USER_B, new Set(['sock-friend'])]]);

    vi.mocked(supabaseFetch).mockResolvedValue([
      { user_id: USER_A, friend_user_id: USER_B },
      { user_id: USER_A, friend_user_id: USER_C },
    ]);

    emitPresenceUpdateToFriends({ io, socketsByUserId }, USER_A, 'online');
    await Promise.resolve();
    await Promise.resolve();

    expect(friendEmit).toHaveBeenCalledWith('presence:update', { userId: USER_A, status: 'online' });
    expect(io.to).toHaveBeenCalledTimes(1);
    expect(io.to).toHaveBeenCalledWith('sock-friend');
    expect(supabaseFetch).toHaveBeenCalledWith(
      `/rest/v1/friends?or=(user_id.eq.${encodeURIComponent(USER_A)},friend_user_id.eq.${encodeURIComponent(USER_A)})&status=eq.accepted&select=user_id,friend_user_id`,
    );
  });
});