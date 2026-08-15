import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoom, resetRoomRuntimeForTests } from '../rooms';
import { resetRoomSessionStoresForTests, setRoomRoster } from '../multiplayer/roomSession';
import {
  deliverPendingMultiplayerInvites,
  registerFriendInviteHandlers,
} from './registerFriendInviteHandlers';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';

function makeSocket(userId: string | null, username = 'player') {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    id: `sock-${userId ?? 'anon'}`,
    data: {
      userId,
      username,
    } as Record<string, unknown>,
    on: (event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    emit: vi.fn(),
  };
  return { socket: socket as any, handlers };
}

function makeIo() {
  const delivered = new Map<string, Array<{ event: string; payload: unknown }>>();
  const io = {
    to: vi.fn((socketId: string) => ({
      emit: (event: string, payload: unknown) => {
        const existing = delivered.get(socketId) ?? [];
        existing.push({ event, payload });
        delivered.set(socketId, existing);
      },
    })),
  };
  return { io: io as any, delivered };
}

const deps = {
  normalizeUserId: (value: unknown) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  },
  normalizeUsername: (value: unknown) => {
    if (typeof value !== 'string') return 'player';
    const trimmed = value.trim();
    return trimmed || 'player';
  },
  isAuthenticatedUserId: (value: string | null | undefined) =>
    Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)),
  createInvite: vi.fn(async (params: {
    inviteId: string;
    senderUserId: string;
    recipientUserId: string;
    roomCode: string;
    inviterUsername: string;
    inviteUrl: string;
    matchSummary: string;
  }) => ({
    ...params,
    status: 'pending' as const,
    createdAt: '2026-08-06T00:00:00.000Z',
    expiresAt: '2026-08-06T00:05:00.000Z',
    deliveredAt: null,
    resolvedAt: null,
  })),
  resolveInvite: vi.fn(),
  markInviteDelivered: vi.fn(async () => undefined),
  durableInvitesEnabled: true,
};

describe('registerFriendInviteHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
  });

  it('rejects an unauthenticated inviter', async () => {
    const room = createRoom('seat-host');
    setRoomRoster(room.code, [{ id: 'seat-host', socketId: 'sock-host', username: 'Host', userId: USER_A }]);
    const { socket, handlers } = makeSocket(null);
    const { io, delivered } = makeIo();
    const socketsByUserId = new Map([[USER_B, new Set(['sock-target'])]]);

    registerFriendInviteHandlers(io, socket, socketsByUserId, deps);

    const ack = vi.fn();
    await handlers.get('friend:invite')?.(
      {
        toUserId: USER_B,
        roomCode: room.code,
        inviteUrl: 'https://example.com',
      },
      ack,
    );

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'not_authenticated' });
    expect(delivered.size).toBe(0);
  });

  it('rejects an authenticated non-room member', async () => {
    const room = createRoom('seat-host');
    setRoomRoster(room.code, [{ id: 'seat-host', socketId: 'sock-host', username: 'Host', userId: USER_A }]);
    const { socket, handlers } = makeSocket(USER_C, 'Mallory');
    const { io, delivered } = makeIo();
    const socketsByUserId = new Map([[USER_B, new Set(['sock-target'])]]);

    registerFriendInviteHandlers(io, socket, socketsByUserId, deps);

    const ack = vi.fn();
    await handlers.get('friend:invite')?.(
      {
        toUserId: USER_B,
        roomCode: room.code,
        inviteUrl: 'https://example.com',
      },
      ack,
    );

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'not_room_member' });
    expect(delivered.size).toBe(0);
  });

  it('rejects nonexistent rooms', async () => {
    const { socket, handlers } = makeSocket(USER_A, 'Alice');
    const { io } = makeIo();
    const socketsByUserId = new Map([[USER_B, new Set(['sock-target'])]]);

    registerFriendInviteHandlers(io, socket, socketsByUserId, deps);

    const ack = vi.fn();
    await handlers.get('friend:invite')?.(
      {
        toUserId: USER_B,
        roomCode: 'NOPE1',
        inviteUrl: 'https://example.com',
      },
      ack,
    );

    expect(socket.emit).toHaveBeenCalledWith('friend:invite:error', { ok: false, error: 'room_not_found' });
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'room_not_found' });
  });

  it('ignores spoofed sender fields and derives inviter identity from the authenticated room member', async () => {
    const room = createRoom('seat-host');
    const { socket, handlers } = makeSocket(USER_A, 'Alice');
    setRoomRoster(room.code, [{ id: 'seat-host', socketId: socket.id, username: 'Alice', userId: USER_A }]);
    const { io, delivered } = makeIo();
    const socketsByUserId = new Map([[USER_B, new Set(['sock-target'])]]);

    registerFriendInviteHandlers(io, socket, socketsByUserId, deps);

    const ack = vi.fn();
    await handlers.get('friend:invite')?.(
      {
        toUserId: USER_B,
        fromUserId: USER_C,
        fromUsername: 'Mallory',
        roomCode: room.code,
        inviteUrl: 'https://example.com/invite',
        inviteId: 'invite-1',
        matchSummary: 'Custom summary',
      },
      ack,
    );

    expect(ack).toHaveBeenCalledWith({
      ok: true,
      delivered: true,
      durable: true,
      inviteId: 'invite-1',
      expiresAt: '2026-08-06T00:05:00.000Z',
    });
    expect(delivered.get('sock-target')).toEqual([
      {
        event: 'friend:invited',
        payload: {
          inviteId: 'invite-1',
          fromUsername: 'Alice',
          fromUserId: USER_A,
          roomCode: room.code,
          inviteUrl: 'https://example.com/invite',
          matchSummary: 'Custom summary',
          expiresAt: '2026-08-06T00:05:00.000Z',
        },
      },
    ]);
  });

  it('persists an invite for an offline recipient and acknowledges durable delivery', async () => {
    const room = createRoom('seat-host');
    const { socket, handlers } = makeSocket(USER_A, 'Alice');
    setRoomRoster(room.code, [
      { id: 'seat-host', socketId: socket.id, username: 'Alice', userId: USER_A },
    ]);
    const { io, delivered } = makeIo();
    const createInvite = vi.fn(deps.createInvite);
    const ack = vi.fn();

    registerFriendInviteHandlers(io, socket, new Map(), { ...deps, createInvite });
    await handlers.get('friend:invite')?.(
      {
        toUserId: USER_B,
        roomCode: room.code,
        inviteUrl: 'https://example.com/invite',
        inviteId: 'offline-invite',
      },
      ack,
    );

    expect(createInvite).toHaveBeenCalledOnce();
    expect(delivered.size).toBe(0);
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        delivered: false,
        durable: true,
        inviteId: 'offline-invite',
      }),
    );
  });

  it('keeps the pre-migration invite path available while durable invites are disabled', async () => {
    const room = createRoom('seat-host');
    const { socket, handlers } = makeSocket(USER_A, 'Alice');
    setRoomRoster(room.code, [
      { id: 'seat-host', socketId: socket.id, username: 'Alice', userId: USER_A },
    ]);
    const { io } = makeIo();
    const createInvite = vi.fn(deps.createInvite);
    const ack = vi.fn();

    registerFriendInviteHandlers(io, socket, new Map(), {
      ...deps,
      createInvite,
      durableInvitesEnabled: false,
    });
    await handlers.get('friend:invite')?.(
      { toUserId: USER_B, roomCode: room.code, inviteId: 'legacy-invite' },
      ack,
    );

    expect(createInvite).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'recipient_unreachable' });
  });

  it('reports durable resolution failures without throwing from the socket handler', async () => {
    const { socket, handlers } = makeSocket(USER_B, 'Bob');
    const { io } = makeIo();
    const ack = vi.fn();

    registerFriendInviteHandlers(io, socket, new Map(), {
      ...deps,
      resolveInvite: vi.fn().mockRejectedValue(new Error('db_unavailable')),
    });
    await handlers.get('friend:invite:accept')?.({ inviteId: 'invite-1' }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'invite_persistence_failed' });
  });

  it('delivers a persisted offline invite when the recipient identifies after reconnect', async () => {
    const { socket } = makeSocket(USER_B, 'Bob');
    const { io, delivered } = makeIo();
    const markDelivered = vi.fn(async () => undefined);

    const count = await deliverPendingMultiplayerInvites(io, socket, USER_B, {
      listPending: vi.fn(async () => [
        {
          inviteId: 'offline-invite',
          senderUserId: USER_A,
          recipientUserId: USER_B,
          roomCode: 'ROOM1',
          inviterUsername: 'Alice',
          inviteUrl: 'https://example.com/ROOM1',
          matchSummary: '7-Tile · First to 60 · Untimed',
          status: 'pending',
          createdAt: '2026-08-06T00:00:00.000Z',
          expiresAt: '2026-08-06T00:05:00.000Z',
          deliveredAt: null,
          resolvedAt: null,
        },
      ]),
      markDelivered,
    });

    expect(count).toBe(1);
    expect(delivered.get(socket.id)).toEqual([
      {
        event: 'friend:invited',
        payload: expect.objectContaining({
          inviteId: 'offline-invite',
          fromUserId: USER_A,
          roomCode: 'ROOM1',
        }),
      },
    ]);
    expect(markDelivered).toHaveBeenCalledWith('offline-invite');
  });
});
