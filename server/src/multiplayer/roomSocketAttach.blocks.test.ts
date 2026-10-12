/**
 * Blocks at the attach layer, where a NEW private-room seat is allocated.
 *
 * NEW seat across a block, or with block state unreadable → refused with the
 * same answer as a wrong code. Restoring a seat the player already holds →
 * always allowed (no block lookup at all), so a moderation outage can't strand
 * anyone mid-match. Rooms restored from persistence after a restart go through
 * the same check.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { blockStatusMock } = vi.hoisted(() => ({ blockStatusMock: vi.fn() }));
vi.mock('../moderation/blockStore', () => ({ blockStatus: blockStatusMock }));
vi.mock('../supabaseUtils', async () => {
  const actual = await vi.importActual<typeof import('../supabaseUtils')>('../supabaseUtils');
  return { ...actual, supabaseFetch: vi.fn(async () => []) };
});

import { createRoom, getRoom, resetRoomRuntimeForTests } from '../rooms';
import { getRoomRoster, initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';
import { createRoomSocketAttach } from './roomSocketAttach';
import * as livePersistence from './roomLivePersistence';
import * as matchTerminalJoin from './matchTerminalJoin';

const HOST = '11111111-1111-4111-8111-111111111111';
const JOINER = '22222222-2222-4222-8222-222222222222';

const handlerDeps = {
  resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
  normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
  normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => undefined,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  persistRoomMatchLog: async () => undefined,
};

function makeIo() {
  return { sockets: { sockets: new Map() }, to: vi.fn(() => ({ emit: vi.fn() })) } as any;
}

function makeSocket(socketId: string) {
  return {
    id: socketId,
    data: {} as Record<string, unknown>,
    rooms: new Set<string>([socketId]),
    leave: vi.fn(),
    join: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
  } as any;
}

function attachAs(socketId: string, roomCode: string, userId: string | null) {
  const { attachSocketToTrackedRoom } = createRoomSocketAttach({ io: makeIo(), socket: makeSocket(socketId), handlerDeps });
  return attachSocketToTrackedRoom({ roomCode, username: userId ? 'player' : 'Guest', userId, via: 'room:join', hydrateMatchmakingRoom: true });
}

function privateRoomWithHost(): string {
  const room = createRoom('seat-host');
  setRoomRoster(room.code, [{ id: 'seat-host', socketId: 'sock-host', username: 'host', userId: HOST }]);
  return room.code;
}

describe('new private-room seats and blocks (attach layer)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    initRoomSession(makeIo(), { ...handlerDeps, onGameOver: () => null });
    vi.spyOn(matchTerminalJoin, 'resolveArchivedTerminalJoin').mockResolvedValue(null);
    blockStatusMock.mockReset();
    blockStatusMock.mockResolvedValue('clear');
  });

  it('refuses a new seat across a block, like a wrong code, and allocates nothing', async () => {
    const code = privateRoomWithHost();
    blockStatusMock.mockResolvedValue('blocked');

    await expect(attachAs('sock-joiner', code, JOINER)).rejects.toThrow('Room not found.');
    expect(blockStatusMock).toHaveBeenCalledWith(JOINER, HOST, 'room:join');
    expect(getRoomRoster(code).map((p) => p.userId)).toEqual([HOST]);
  });

  it('fails closed: unreadable block state refuses the new seat too', async () => {
    const code = privateRoomWithHost();
    blockStatusMock.mockResolvedValue('unknown');

    await expect(attachAs('sock-joiner', code, JOINER)).rejects.toThrow('Room not found.');
  });

  it('seats an unrelated player normally', async () => {
    const code = privateRoomWithHost();

    const attached = await attachAs('sock-joiner', code, JOINER);

    expect(attached.room.code).toBe(code);
    expect(attached.roster.map((p) => p.userId)).toContain(JOINER);
  });

  it('restoring a seat the player already holds never consults blocks (moderation outage)', async () => {
    const code = privateRoomWithHost();
    setRoomRoster(code, [
      { id: 'seat-host', socketId: 'sock-host', username: 'host', userId: HOST },
      { id: 'seat-joiner', socketId: 'sock-old', username: 'joiner', userId: JOINER },
    ]);
    blockStatusMock.mockResolvedValue('unknown');

    const attached = await attachAs('sock-new-tab', code, JOINER);

    expect(attached.joinedPlayerSeatId).toBe('seat-joiner');
    expect(blockStatusMock).not.toHaveBeenCalled();
  });

  it('a room restored from persistence after a restart is checked like any other', async () => {
    // Simulate the restart path: the room is published by hydration with its
    // roster coming from the persisted live session, not the in-memory store.
    const room = createRoom('seat-host');
    const code = room.code;
    vi.spyOn(livePersistence, 'ensureRoomHydrated').mockResolvedValue({
      kind: 'hydrated',
      room,
      restoredRoster: [{ seatId: 'seat-host', username: 'host', userId: HOST }] as never,
      durabilityRecoverable: true,
    });
    blockStatusMock.mockResolvedValue('blocked');

    await expect(attachAs('sock-joiner', code, JOINER)).rejects.toThrow('Room not found.');
    expect(blockStatusMock).toHaveBeenCalledWith(JOINER, HOST, 'room:join');
  });

  it('guests and non-private rooms are not checked', async () => {
    const code = privateRoomWithHost();
    blockStatusMock.mockResolvedValue('blocked');
    await expect(attachAs('sock-guest', code, null)).resolves.toBeTruthy();

    const mmCode = privateRoomWithHost();
    getRoom(mmCode).matchmakingMatchId = 'mm-1';
    getRoom(mmCode).matchmakingParticipantUserIds = [HOST, JOINER] as never;
    await attachAs('sock-mm', mmCode, JOINER).catch(() => undefined);
    expect(blockStatusMock).not.toHaveBeenCalled();
  });
});
