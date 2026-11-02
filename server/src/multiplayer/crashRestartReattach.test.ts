import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as engine from '../game/engine';
import { createInitialState, startNewHand } from '../game/engine';
import type { GameState } from '../game/types';
import * as rooms from '../rooms';
import { createReservedRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { createHydratedRoomDurabilityState, captureRoomDurabilityFence } from './roomDurability';
import * as livePersistence from './roomLivePersistence';
import { initRoomSession, resetRoomSessionStoresForTests } from './roomSession';
import { DISCONNECT_GRACE_MS, hasActiveDisconnectGraceForSeat, resetDisconnectGraceForTests } from './disconnectGrace';
import { createRoomSocketAttach } from './roomSocketAttach';

/**
 * A server crash mid-hand (roadmap 3.6). Every socket dies with the process, and nothing fires a disconnect event for anyone: the room comes back
 * only when a client re-joins and it is rehydrated from room_live_sessions. If the player whose turn it is never returns, the match must still end
 * the way it would after an ordinary disconnect (a grace period, an automatic move, then a forfeit). Before this, no timer was armed for a seat that
 * simply never came back, so the room waited forever.
 */

// Real UUIDs: anything else is treated as a guest seat, which would need a reconnect token and is a different path.
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** A real hand dealt by the engine, with the given seat on turn (so the board, hands and legal moves are the genuine shapes). */
function midHand(onTurnSeat: 'seat-a' | 'seat-b'): GameState {
  return startNewHand(createInitialState(['seat-a', 'seat-b']), undefined, onTurnSeat);
}

const handlerDeps = {
  resolveSocketIdentity: async () => ({ username: 'A', userId: USER_A }),
  normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
  normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => undefined,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  persistRoomMatchLog: async () => undefined,
};

function makeSocket(id: string) {
  return { id, data: {} as Record<string, unknown>, rooms: new Set<string>([id]), leave: vi.fn(), join: vi.fn(), emit: vi.fn() } as any;
}

/** What a restarted process has: the rebuilt room, and a roster whose seats have no socket. */
function restartedRoom(roomCode: string, onTurnSeat: 'seat-a' | 'seat-b') {
  const room = createReservedRoom(roomCode);
  joinRoom(roomCode, 'seat-a');
  joinRoom(roomCode, 'seat-b');
  room.players = ['seat-a', 'seat-b'];
  room.state = midHand(onTurnSeat);
  room.disconnectExpiries = {};
  room.durability = createHydratedRoomDurabilityState(room, captureRoomDurabilityFence(room));
  const restoredRoster = [
    { seatId: 'seat-a', username: 'A', userId: USER_A },
    { seatId: 'seat-b', username: 'B', userId: USER_B },
  ];
  // The first attach after a restart rebuilds the room from the database; once it is in memory every later attach finds it there.
  vi.spyOn(livePersistence, 'ensureRoomHydrated')
    .mockResolvedValueOnce({ kind: 'hydrated', room, restoredRoster, durabilityRecoverable: true } as never)
    .mockResolvedValue({ kind: 'already_in_memory', room, restoredRoster: [], durabilityRecoverable: true } as never);
  return room;
}

async function reconnectAs(roomCode: string, seatUserId: string, io: any) {
  const socket = makeSocket(`sock-${seatUserId}`);
  const { attachSocketToTrackedRoom } = createRoomSocketAttach({
    io,
    socket,
    handlerDeps: { ...handlerDeps, resolveSocketIdentity: async () => ({ username: seatUserId === USER_A ? 'A' : 'B', userId: seatUserId }) },
  });
  return attachSocketToTrackedRoom({ roomCode, username: seatUserId === USER_A ? 'A' : 'B', userId: seatUserId, via: 'room:join', hydrateMatchmakingRoom: true });
}

describe('after a server restart, a rehydrated mid-hand room', () => {
  // adapter.rooms is what broadcastStateUpdate reads to find who is in a room (nobody is, in these tests).
  const io = { sockets: { sockets: new Map(), adapter: { rooms: new Map() } }, to: vi.fn(() => ({ emit: vi.fn() })) } as any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetDisconnectGraceForTests();
    initRoomSession(io, { ...handlerDeps, onGameOver: () => null });
  });
  afterEach(() => {
    resetDisconnectGraceForTests();
    vi.useRealTimers();
  });

  it('starts the grace period for the seat that never came back, so a missing player cannot freeze the match', async () => {
    restartedRoom('CRASH1', 'seat-b');
    const joined = await reconnectAs('CRASH1', USER_A, io);
    expect(joined.joinedPlayerSeatId).toBe('seat-a');

    expect(hasActiveDisconnectGraceForSeat('CRASH1', 'seat-b')).toBe(true);
  });

  it('does not leave a grace timer running for the player who did reconnect', async () => {
    restartedRoom('CRASH2', 'seat-b');
    await reconnectAs('CRASH2', USER_A, io);
    expect(hasActiveDisconnectGraceForSeat('CRASH2', 'seat-a')).toBe(false);
  });

  it('stops the timer for a seat that does come back in time, so a slow second player is not forfeited', async () => {
    restartedRoom('CRASH3', 'seat-b');
    await reconnectAs('CRASH3', USER_A, io);
    expect(hasActiveDisconnectGraceForSeat('CRASH3', 'seat-b')).toBe(true);

    await vi.advanceTimersByTimeAsync(Math.floor(DISCONNECT_GRACE_MS / 2));
    await reconnectAs('CRASH3', USER_B, io);
    expect(hasActiveDisconnectGraceForSeat('CRASH3', 'seat-b')).toBe(false);
    expect(hasActiveDisconnectGraceForSeat('CRASH3', 'seat-a')).toBe(false);
  });

  it('acts for a seat that never returns once the grace period ends, so the match does not freeze', async () => {
    const actSpy = vi.spyOn(rooms, 'act').mockImplementation((async (code: string) => {
      const room = rooms.getRoom(code);
      if (room.state) room.state = { ...room.state, sequence: room.state.sequence + 1 };
      return { room, forcedDrawAnimation: undefined };
    }) as never);
    vi.spyOn(engine, 'getLegalMoves').mockReturnValue([{ type: 'pass' } as never]);
    vi.spyOn(engine, 'canDraw').mockReturnValue(false);
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({ flushedRoomCodes: ['CRASH4'] } as never);
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockReturnValue(true);

    restartedRoom('CRASH4', 'seat-b'); // seat-b is on turn and never comes back
    await reconnectAs('CRASH4', USER_A, io);
    expect(actSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    expect(actSpy).toHaveBeenCalledWith('CRASH4', 'seat-b', { type: 'PASS' }, io, expect.any(Function));
    expect(hasActiveDisconnectGraceForSeat('CRASH4', 'seat-b')).toBe(false);
  });

  it('leaves a seat that is NOT on turn waiting without acting for it, as an ordinary disconnect does', async () => {
    const actSpy = vi.spyOn(rooms, 'act').mockImplementation((async () => ({ room: undefined })) as never);
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({ flushedRoomCodes: ['CRASH5'] } as never);
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockReturnValue(true);

    restartedRoom('CRASH5', 'seat-a'); // seat-a is on turn and is the one who comes back; seat-b has nothing to do
    await reconnectAs('CRASH5', USER_A, io);
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

    expect(actSpy).not.toHaveBeenCalledWith('CRASH5', 'seat-b', expect.anything(), expect.anything(), expect.anything());
  });
});
