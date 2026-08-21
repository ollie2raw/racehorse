/**
 * M4 — matchmaking shell seating ACL at the attach layer.
 *
 * Two doors into a live MM room shell: hydrating it from the DB after a
 * restart, and joining one that is already in memory. Both must admit only the
 * two players the match was created for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import {
  getRoomRoster,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';
import { createRoomSocketAttach } from './roomSocketAttach';
import * as livePersistence from './roomLivePersistence';
import * as matchTerminalJoin from './matchTerminalJoin';

function makeSocket(socketId: string) {
  return {
    id: socketId,
    data: {} as Record<string, unknown>,
    rooms: new Set<string>([socketId]),
    leave: vi.fn(),
    join: vi.fn(),
    emit: vi.fn(),
  } as any;
}

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

describe('matchmaking shell seat ACL (M4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    initRoomSession(makeIo(), { ...handlerDeps, onGameOver: () => null });
    vi.spyOn(matchTerminalJoin, 'resolveArchivedTerminalJoin').mockResolvedValue(null);
  });

  it('rejects a non-participant hydrating a live MM shell', async () => {
    const io = makeIo();
    const socket = makeSocket('sock-stranger');
    vi.spyOn(livePersistence, 'ensureRoomHydrated').mockResolvedValue({ kind: 'not_found' });
    const hydrate = vi.fn(async () => ({
      kind: 'forbidden' as const,
      matchmakingMatchId: 'mm-match-1',
    }));

    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io,
      socket,
      handlerDeps: { ...handlerDeps, tryHydrateMatchmakingRoomShell: hydrate },
    });

    await expect(
      attachSocketToTrackedRoom({
        roomCode: 'MMACL9',
        username: 'Stranger',
        userId: 'user-stranger',
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      }),
    ).rejects.toThrow('not_match_participant');

    // The connecting identity is what the hydrate path checks against.
    expect(hydrate).toHaveBeenCalledWith('MMACL9', 'user-stranger');
    expect(getRoomRoster('MMACL9')).toEqual([]);
  });

  it('seats an assigned participant normally', async () => {
    const io = makeIo();
    const socket = makeSocket('sock-a');
    vi.spyOn(livePersistence, 'ensureRoomHydrated').mockResolvedValue({ kind: 'not_found' });
    const hydrate = vi.fn(async (roomCode: string) => {
      const room = createReservedRoom(roomCode, { winningScore: 60 });
      room.matchmakingMatchId = 'mm-match-2';
      room.matchmakingParticipantUserIds = ['user-a', 'user-b'];
      return { kind: 'shell_only' as const, room, matchmakingMatchId: 'mm-match-2' };
    });

    const { attachSocketToTrackedRoom } = createRoomSocketAttach({
      io,
      socket,
      handlerDeps: { ...handlerDeps, tryHydrateMatchmakingRoomShell: hydrate },
    });

    const attached = await attachSocketToTrackedRoom({
      roomCode: 'MMACL8',
      username: 'PlayerA',
      userId: 'user-a',
      via: 'room:join',
      hydrateMatchmakingRoom: true,
    });

    expect(attached.room.code).toBe('MMACL8');
    expect(getRoomRoster('MMACL8').some((p) => p.userId === 'user-a')).toBe(true);
  });

  it('rejects a non-participant joining an MM shell that is already in memory', async () => {
    const roomCode = 'MMACL7';
    const room = createReservedRoom(roomCode, { winningScore: 60 });
    room.matchmakingMatchId = 'mm-match-3';
    room.matchmakingParticipantUserIds = ['user-a', 'user-b'];
    joinRoom(roomCode, 'p1');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-a', username: 'PlayerA', userId: 'user-a' },
    ]);
    vi.spyOn(livePersistence, 'ensureRoomHydrated').mockResolvedValue({
      kind: 'already_in_memory',
    } as any);

    const io = makeIo();
    const socket = makeSocket('sock-stranger-2');
    const { attachSocketToTrackedRoom } = createRoomSocketAttach({ io, socket, handlerDeps });

    await expect(
      attachSocketToTrackedRoom({
        roomCode,
        username: 'Stranger',
        userId: 'user-stranger',
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      }),
    ).rejects.toThrow('not_match_participant');

    // Second seat is still open for the player it belongs to.
    expect(getRoomRoster(roomCode).map((p) => p.userId)).toEqual(['user-a']);
  });

  it('leaves non-matchmaking rooms unrestricted', async () => {
    const roomCode = 'PRIV11';
    createReservedRoom(roomCode, { winningScore: 60 });
    joinRoom(roomCode, 'p1');
    setRoomRoster(roomCode, [{ id: 'p1', socketId: 'sock-h', username: 'Host', userId: 'user-h' }]);
    vi.spyOn(livePersistence, 'ensureRoomHydrated').mockResolvedValue({
      kind: 'already_in_memory',
    } as any);

    const io = makeIo();
    const socket = makeSocket('sock-guest');
    const { attachSocketToTrackedRoom } = createRoomSocketAttach({ io, socket, handlerDeps });

    const attached = await attachSocketToTrackedRoom({
      roomCode,
      username: 'Guest',
      userId: 'user-guest',
      via: 'room:join',
      hydrateMatchmakingRoom: false,
    });

    expect(attached.room.code).toBe(roomCode);
  });
});
