import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoom, resetRoomRuntimeForTests } from '../rooms';
import { resetRoomSessionStoresForTests, setRoomRoster } from '../multiplayer/roomSession';
import { registerFriendInviteHandlers } from './registerFriendInviteHandlers';

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
};

describe('registerFriendInviteHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
  });

  it('rejects an unauthenticated inviter', () => {
    const room = createRoom('seat-host');
    setRoomRoster(room.code, [{ id: 'seat-host', socketId: 'sock-host', username: 'Host', userId: USER_A }]);
    const { socket, handlers } = makeSocket(null);
    const { io, delivered } = makeIo();
    const socketsByUserId = new Map([[USER_B, new Set(['sock-target'])]]);

    registerFriendInviteHandlers(io, socket, socketsByUserId, deps);

    const ack = vi.fn();
    handlers.get('friend:invite')?.(
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

  it('rejects an authenticated non-room member', () => {
    const room = createRoom('seat-host');
    setRoomRoster(room.code, [{ id: 'seat-host', socketId: 'sock-host', username: 'Host', userId: USER_A }]);
    const { socket, handlers } = makeSocket(USER_C, 'Mallory');
    const { io, delivered } = makeIo();
    const socketsByUserId = new Map([[USER_B, new Set(['sock-target'])]]);

    registerFriendInviteHandlers(io, socket, socketsByUserId, deps);

    const ack = vi.fn();
    handlers.get('friend:invite')?.(
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

  it('rejects nonexistent rooms', () => {
    const { socket, handlers } = makeSocket(USER_A, 'Alice');
    const { io } = makeIo();
    const socketsByUserId = new Map([[USER_B, new Set(['sock-target'])]]);

    registerFriendInviteHandlers(io, socket, socketsByUserId, deps);

    const ack = vi.fn();
    handlers.get('friend:invite')?.(
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

  it('ignores spoofed sender fields and derives inviter identity from the authenticated room member', () => {
    const room = createRoom('seat-host');
    const { socket, handlers } = makeSocket(USER_A, 'Alice');
    setRoomRoster(room.code, [{ id: 'seat-host', socketId: socket.id, username: 'Alice', userId: USER_A }]);
    const { io, delivered } = makeIo();
    const socketsByUserId = new Map([[USER_B, new Set(['sock-target'])]]);

    registerFriendInviteHandlers(io, socket, socketsByUserId, deps);

    const ack = vi.fn();
    handlers.get('friend:invite')?.(
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

    expect(ack).toHaveBeenCalledWith({ ok: true, delivered: true, inviteId: 'invite-1' });
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
        },
      },
    ]);
  });
});
