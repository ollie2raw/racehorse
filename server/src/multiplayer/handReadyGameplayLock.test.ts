import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertTileCountInvariant,
  assertValidGameState,
  collectTileAccountingViolations,
} from '../game/invariants';
import { getRoom, getRoomCanDraw, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';
import { registerRoomSessionHandlers } from './registerRoomSessionHandlers';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async () => []),
}));

const sessionDeps = {
  resolveSocketIdentity: async (config: { username?: string; userId?: string | null }) => ({
    username: typeof config.username === 'string' ? config.username : 'Guest',
    userId: typeof config.userId === 'string' ? config.userId : null,
  }),
  normalizeUsername: (value: unknown) => (typeof value === 'string' ? value : 'Guest'),
  normalizeUserId: (value: unknown) => (typeof value === 'string' ? value : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => undefined,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  maybeFinalizeTournamentMatch: () => undefined,
  persistRoomMatchLog: async () => undefined,
  onGameOver: () => null,
  finalizeTournamentMatch: () => undefined,
};

function makeSocket(label: string, userId: string) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    id: `sock-${label}`,
    data: {
      userId,
      username: label,
    } as Record<string, unknown>,
    rooms: new Set<string>(),
    connected: true,
    on: (event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    join: (roomCode: string) => {
      socket.rooms.add(roomCode);
    },
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  socket.rooms.add(socket.id);
  return { socket: socket as any, handlers };
}

function makeTwoPlayerIo(hostSocket: any, guestSocket: any, roomCode: string) {
  const roomMembers = new Set([hostSocket.id, guestSocket.id]);
  return {
    sockets: {
      sockets: new Map([
        [hostSocket.id, hostSocket],
        [guestSocket.id, guestSocket],
      ]),
      adapter: {
        rooms: new Map<string, Set<string>>([[roomCode, roomMembers]]),
      },
    },
    to: vi.fn(() => ({
      emit: vi.fn(),
      except: vi.fn(() => ({ emit: vi.fn() })),
    })),
  } as any;
}

async function startPrivateMatch(
  io: any,
  hostHandlers: Map<string, (...args: any[]) => void>,
  guestHandlers: Map<string, (...args: any[]) => void>,
  hostSocket: any,
  guestSocket: any,
) {
  const hostAck = vi.fn();
  await hostHandlers.get('room:create')?.({ username: 'Host', userId: 'host-user' }, hostAck);
  const roomCode = hostAck.mock.calls[0][0].roomCode as string;
  const hostSeatId = hostAck.mock.calls[0][0].you as string;

  io.sockets.adapter.rooms.set(roomCode, new Set([hostSocket.id, guestSocket.id]));

  const guestJoinAck = vi.fn();
  await guestHandlers.get('room:join')?.(roomCode, { username: 'Guest', userId: 'guest-user' }, guestJoinAck);
  const guestSeatId = guestJoinAck.mock.calls[0][0].you as string;

  setRoomRoster(roomCode, [
    { id: hostSeatId, socketId: hostSocket.id, username: 'Host', userId: 'host-user' },
    { id: guestSeatId, socketId: guestSocket.id, username: 'Guest', userId: 'guest-user' },
  ]);

  await guestHandlers.get('player:ready')?.(roomCode, vi.fn());
  const startAck = vi.fn();
  await hostHandlers.get('game:start')?.(roomCode, startAck);
  expect(startAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));

  return { roomCode, hostSeatId, guestSeatId };
}

/** End the current hand for hand:ready tests; skip MIN_HAND_OVER_MS delay in nextHand advance. */
function armHandOverForReadyTest(roomCode: string) {
  const room = getRoom(roomCode);
  if (!room.state) throw new Error('expected in-progress state');
  room.preGameDraw = null;
  room.state = { ...room.state, handOver: true };
  room.lastHandEndedAtMs = Date.now() - 10_000;
  room.nextHandReady.clear();
  assertTileCountInvariant(room.state, 'handReadyGameplayLock.test:setup');
  assertValidGameState(room.state, 'handReadyGameplayLock.test:setup');
}

describe('hand:ready gameplay lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRoomGameplayLocksForTests();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
  });

  it('does not corrupt state when a late game:action races hand:ready at hand boundary', async () => {
    const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', 'host-user');
    const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', 'guest-user');

    const io = makeTwoPlayerIo(hostSocket, guestSocket, 'PENDING');
    initRoomSession(io, sessionDeps);
    registerRoomSessionHandlers(io, hostSocket);
    registerRoomSessionHandlers(io, guestSocket);

    const { roomCode, hostSeatId, guestSeatId } = await startPrivateMatch(
      io,
      hostHandlers,
      guestHandlers,
      hostSocket,
      guestSocket,
    );

    armHandOverForReadyTest(roomCode);

    const roomBefore = getRoom(roomCode);
    const handNumberBefore = roomBefore.state!.handNumber;
    const currentId = roomBefore.state!.playerIds[roomBefore.state!.currentPlayerIndex];
    const currentHandlers = currentId === hostSeatId ? hostHandlers : guestHandlers;

    const lateAction =
      getRoomCanDraw(roomCode, currentId)
        ? ({ type: 'DRAW', requestId: 'late-draw-at-hand-boundary' } as const)
        : ({ type: 'PASS' } as const);

    const lateActionAck = vi.fn();
    const hostReadyAck = vi.fn();
    const guestReadyAck = vi.fn();

    await Promise.all([
      currentHandlers.get('game:action')?.(roomCode, lateAction, lateActionAck),
      hostHandlers.get('hand:ready')?.(roomCode, handNumberBefore, hostReadyAck),
      guestHandlers.get('hand:ready')?.(roomCode, handNumberBefore, guestReadyAck),
    ]);

    await vi.waitFor(
      () => {
        const room = getRoom(roomCode);
        return Boolean(room.state && (!room.state.handOver || room.state.handNumber > handNumberBefore));
      },
      { timeout: 2_000, interval: 20 },
    );

    const roomAfter = getRoom(roomCode);
    expect(roomAfter.state).not.toBeNull();
    assertTileCountInvariant(roomAfter.state!, 'handReadyGameplayLock.test:after-race');
    assertValidGameState(roomAfter.state!, 'handReadyGameplayLock.test:after-race');
    expect(collectTileAccountingViolations(roomAfter.state!)).toEqual([]);

    const lateResult = lateActionAck.mock.calls[0]?.[0];
    expect(lateResult).toEqual(expect.objectContaining({ ok: expect.any(Boolean) }));

    const readyResults = [hostReadyAck.mock.calls[0]?.[0], guestReadyAck.mock.calls[0]?.[0]];
    expect(readyResults.every((r) => r?.ok !== false || r?.ignored === true)).toBe(true);

    expect(roomAfter.state!.handNumber).toBe(handNumberBefore + 1);
    expect(roomAfter.state!.handOver).toBe(false);
  });

  it('prevents duplicate hand:ready from the same player before other player is ready', async () => {
    const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', 'host-user');
    const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', 'guest-user');

    const io = makeTwoPlayerIo(hostSocket, guestSocket, 'PENDING');
    initRoomSession(io, sessionDeps);
    registerRoomSessionHandlers(io, hostSocket);
    registerRoomSessionHandlers(io, guestSocket);

    const { roomCode } = await startPrivateMatch(
      io,
      hostHandlers,
      guestHandlers,
      hostSocket,
      guestSocket,
    );

    armHandOverForReadyTest(roomCode);

    const room = getRoom(roomCode);
    const handNumberBefore = room.state!.handNumber;

    const firstAck = vi.fn();
    await hostHandlers.get('hand:ready')?.(roomCode, handNumberBefore, firstAck);
    expect(firstAck).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, started: false, ignored: false }),
    );

    // Count hand_ready events in room.events
    const initialReadyEventsCount = room.events.filter((e) => e.type === 'hand_ready').length;
    expect(initialReadyEventsCount).toBe(1);

    // Duplicate call
    const secondAck = vi.fn();
    await hostHandlers.get('hand:ready')?.(roomCode, handNumberBefore, secondAck);
    expect(secondAck).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'stale_or_duplicate_hand_ready', ignored: true }),
    );

    // Verify event count is still 1
    const finalReadyEventsCount = room.events.filter((e) => e.type === 'hand_ready').length;
    expect(finalReadyEventsCount).toBe(1);
  });

  it('handles concurrent duplicate hand:ready calls through lock serialization', async () => {
    const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', 'host-user');
    const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', 'guest-user');

    const io = makeTwoPlayerIo(hostSocket, guestSocket, 'PENDING');
    initRoomSession(io, sessionDeps);
    registerRoomSessionHandlers(io, hostSocket);
    registerRoomSessionHandlers(io, guestSocket);

    const { roomCode } = await startPrivateMatch(
      io,
      hostHandlers,
      guestHandlers,
      hostSocket,
      guestSocket,
    );

    armHandOverForReadyTest(roomCode);

    const room = getRoom(roomCode);
    const handNumberBefore = room.state!.handNumber;

    const firstAck = vi.fn();
    const secondAck = vi.fn();

    // Call hand:ready concurrently
    await Promise.all([
      hostHandlers.get('hand:ready')?.(roomCode, handNumberBefore, firstAck),
      hostHandlers.get('hand:ready')?.(roomCode, handNumberBefore, secondAck),
    ]);

    // One should succeed, one should be ignored
    const firstCallResult = firstAck.mock.calls[0]?.[0];
    const secondCallResult = secondAck.mock.calls[0]?.[0];

    const succeeded = [firstCallResult, secondCallResult].filter((r) => r?.ok === true);
    const ignored = [firstCallResult, secondCallResult].filter((r) => r?.ignored === true);

    expect(succeeded.length).toBe(1);
    expect(ignored.length).toBe(1);

    // Verify only one event is appended
    const readyEventsCount = room.events.filter((e) => e.type === 'hand_ready').length;
    expect(readyEventsCount).toBe(1);
  });

  it('allows different players to mark ready and start next hand', async () => {
    const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', 'host-user');
    const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', 'guest-user');

    const io = makeTwoPlayerIo(hostSocket, guestSocket, 'PENDING');
    initRoomSession(io, sessionDeps);
    registerRoomSessionHandlers(io, hostSocket);
    registerRoomSessionHandlers(io, guestSocket);

    const { roomCode } = await startPrivateMatch(
      io,
      hostHandlers,
      guestHandlers,
      hostSocket,
      guestSocket,
    );

    armHandOverForReadyTest(roomCode);

    const room = getRoom(roomCode);
    const handNumberBefore = room.state!.handNumber;

    const hostAck = vi.fn();
    await hostHandlers.get('hand:ready')?.(roomCode, handNumberBefore, hostAck);
    expect(hostAck).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, started: false, ignored: false }),
    );

    const guestAck = vi.fn();
    await guestHandlers.get('hand:ready')?.(roomCode, handNumberBefore, guestAck);
    expect(guestAck).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, ignored: false }),
    );

    await vi.waitFor(
      () => {
        const r = getRoom(roomCode);
        return Boolean(r.state && r.state.handNumber > handNumberBefore);
      },
      { timeout: 2000, interval: 50 },
    );

    const finalRoom = getRoom(roomCode);
    expect(finalRoom.state!.handNumber).toBe(handNumberBefore + 1);
    expect(finalRoom.state!.handOver).toBe(false);
  });

  it('preserves invalid/stale hand:ready behavior', async () => {
    const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', 'host-user');
    const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', 'guest-user');

    const io = makeTwoPlayerIo(hostSocket, guestSocket, 'PENDING');
    initRoomSession(io, sessionDeps);
    registerRoomSessionHandlers(io, hostSocket);
    registerRoomSessionHandlers(io, guestSocket);

    const { roomCode } = await startPrivateMatch(
      io,
      hostHandlers,
      guestHandlers,
      hostSocket,
      guestSocket,
    );

    armHandOverForReadyTest(roomCode);

    const room = getRoom(roomCode);
    const handNumberBefore = room.state!.handNumber;

    const staleAck = vi.fn();
    // Send wrong hand number
    await hostHandlers.get('hand:ready')?.(roomCode, handNumberBefore - 1, staleAck);
    expect(staleAck).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, ignored: true, error: 'stale_or_duplicate_hand_ready' }),
    );

    // Verify no event is added
    const readyEventsCount = room.events.filter((e) => e.type === 'hand_ready').length;
    expect(readyEventsCount).toBe(0);
  });
});
