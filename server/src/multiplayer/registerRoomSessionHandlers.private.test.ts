import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
} from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';
import { registerRoomSessionHandlers } from './registerRoomSessionHandlers';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';
import { resetLiveRoomPersistenceForTests } from './roomLivePersistence';
import { resetGameActionIdempotencyForTests } from './gameActionIdempotency';

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
    leave: (roomCode: string) => {
      socket.rooms.delete(roomCode);
    },
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  socket.rooms.add(socket.id);
  return { socket: socket as any, handlers };
}

function makeIoRoomTarget() {
  const emit = vi.fn();
  return {
    emit,
    except: vi.fn(() => ({ emit: vi.fn() })),
  };
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
    to: vi.fn(() => makeIoRoomTarget()),
  } as any;
}

function latestStateUpdate(socket: { emit: ReturnType<typeof vi.fn> }) {
  const updates = socket.emit.mock.calls.filter(([event]) => event === 'state:update');
  return updates[updates.length - 1]?.[1] ?? null;
}

async function startPrivateMatch(
  io: any,
  hostHandlers: Map<string, (...args: any[]) => void>,
  guestHandlers: Map<string, (...args: any[]) => void>,
  hostSocket: any,
  guestSocket: any,
) {
  const hostAck = vi.fn();
  await hostHandlers.get('room:create')?.({ username: 'Host', userId: 'host-user', skipPregameDraw: true }, hostAck);
  expect(hostAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  const roomCode = hostAck.mock.calls[0][0].roomCode as string;
  const hostSeatId = hostAck.mock.calls[0][0].you as string;

  io.sockets.adapter.rooms.set(roomCode, new Set([hostSocket.id, guestSocket.id]));

  const guestJoinAck = vi.fn();
  await guestHandlers.get('room:join')?.(roomCode, { username: 'Guest', userId: 'guest-user' }, guestJoinAck);
  expect(guestJoinAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  const guestSeatId = guestJoinAck.mock.calls[0][0].you as string;

  setRoomRoster(roomCode, [
    { id: hostSeatId, socketId: hostSocket.id, username: 'Host', userId: 'host-user' },
    { id: guestSeatId, socketId: guestSocket.id, username: 'Guest', userId: 'guest-user' },
  ]);

  await guestHandlers.get('player:ready')?.(roomCode, vi.fn());

  hostSocket.emit.mockClear();
  guestSocket.emit.mockClear();

  const startAck = vi.fn();
  await hostHandlers.get('game:start')?.(roomCode, startAck);
  expect(startAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));

  return { roomCode, hostSeatId, guestSeatId };
}

async function findPlayMoveForCurrentTurn(
  roomCode: string,
  hostSeatId: string,
  hostHandlers: Map<string, (...args: any[]) => void>,
  guestHandlers: Map<string, (...args: any[]) => void>,
) {
  for (let step = 0; step < 24; step += 1) {
    const room = getRoom(roomCode);
    const currentId = room.state!.playerIds[room.state!.currentPlayerIndex];
    const activeHandlers = currentId === hostSeatId ? hostHandlers : guestHandlers;
    const legalMoves = getRoomLegalMoves(roomCode, currentId);
    const playMove = legalMoves.find((move) => move.type === 'play' && move.tile);
    if (playMove) {
      return { currentId, activeHandlers, playMove };
    }
    if (getRoomCanDraw(roomCode, currentId)) {
      const ack = vi.fn();
      await activeHandlers.get('game:action')?.(
        roomCode,
        { type: 'DRAW', requestId: `setup-draw-${step}` },
        ack,
      );
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      continue;
    }
    if (legalMoves.some((move) => move.type === 'pass')) {
      const ack = vi.fn();
      await activeHandlers.get('game:action')?.(
        roomCode,
        { type: 'PASS', requestId: `setup-pass-${step}` },
        ack,
      );
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      continue;
    }
    break;
  }
  throw new Error('Could not reach a playable move for concurrent serialization test');
}

describe('private room happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGameActionIdempotencyForTests();
    resetLiveRoomPersistenceForTests();
    resetLiveRoomPersistHookForTests();
    resetRoomGameplayLocksForTests();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
  });

  it('create → join → start → legal move syncs; wrong-turn move rejected', async () => {
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

    const room = getRoom(roomCode);
    expect(room.state).not.toBeNull();

    const hostUpdate = latestStateUpdate(hostSocket);
    const guestUpdate = latestStateUpdate(guestSocket);
    expect(hostUpdate?.state?.players?.[hostSeatId]?.hand?.length).toBeGreaterThan(0);
    expect(hostUpdate?.state?.players?.[guestSeatId]?.hand).toEqual([]);
    expect(guestUpdate?.state?.players?.[guestSeatId]?.hand?.length).toBeGreaterThan(0);
    expect(guestUpdate?.state?.players?.[hostSeatId]?.hand).toEqual([]);

    const { currentId, activeHandlers, playMove } = await findPlayMoveForCurrentTurn(
      roomCode,
      hostSeatId,
      hostHandlers,
      guestHandlers,
    );
    const inactiveHandlers = currentId === hostSeatId ? guestHandlers : hostHandlers;

    const wrongTurnAck = vi.fn();
    await inactiveHandlers.get('game:action')?.(
      roomCode,
      {
        type: 'MOVE',
        requestId: 'wrong-turn-move',
        move: { tile: playMove!.tile, position: playMove!.position },
      },
      wrongTurnAck,
    );
    expect(wrongTurnAck).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));

    const beforeSequence = room.state!.sequence;
    const moveAck = vi.fn();
    await activeHandlers.get('game:action')?.(
      roomCode,
      {
        type: 'MOVE',
        requestId: 'accepted-move',
        move: { tile: playMove!.tile, position: playMove!.position },
      },
      moveAck,
    );
    expect(moveAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(getRoom(roomCode).state!.sequence).toBeGreaterThan(beforeSequence);

    const hostAfter = latestStateUpdate(hostSocket);
    const guestAfter = latestStateUpdate(guestSocket);
    expect(hostAfter?.state?.sequence).toBe(getRoom(roomCode).state!.sequence);
    expect(guestAfter?.state?.sequence).toBe(getRoom(roomCode).state!.sequence);
    expect(hostAfter?.state?.players?.[guestSeatId]?.hand).toEqual([]);
    expect(guestAfter?.state?.players?.[hostSeatId]?.hand).toEqual([]);
  });

  it('serializes concurrent game:action requests for the same room', async () => {
    const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', 'host-user');
    const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', 'guest-user');

    const io = makeTwoPlayerIo(hostSocket, guestSocket, 'PENDING');
    initRoomSession(io, sessionDeps);
    registerRoomSessionHandlers(io, hostSocket);
    registerRoomSessionHandlers(io, guestSocket);

    const { roomCode, hostSeatId } = await startPrivateMatch(
      io,
      hostHandlers,
      guestHandlers,
      hostSocket,
      guestSocket,
    );

    const { activeHandlers, playMove } = await findPlayMoveForCurrentTurn(
      roomCode,
      hostSeatId,
      hostHandlers,
      guestHandlers,
    );

    const beforeSequence = getRoom(roomCode).state!.sequence;
    const ack1 = vi.fn();
    const ack2 = vi.fn();
    const payload1 = {
      type: 'MOVE',
      requestId: 'concurrent-move-1',
      move: { tile: playMove!.tile, position: playMove!.position },
    };
    const payload2 = {
      type: 'MOVE',
      requestId: 'concurrent-move-2',
      move: { tile: playMove!.tile, position: playMove!.position },
    };

    await Promise.all([
      activeHandlers.get('game:action')?.(roomCode, payload1, ack1),
      activeHandlers.get('game:action')?.(roomCode, payload2, ack2),
    ]);

    const results = [ack1.mock.calls[0]?.[0], ack2.mock.calls[0]?.[0]];
    const okCount = results.filter((r) => r?.ok === true).length;
    const failCount = results.filter((r) => r?.ok === false).length;
    expect(okCount).toBe(1);
    expect(failCount).toBe(1);

    const success = results.find((r) => r?.ok === true);
    expect(typeof success?.sequence).toBe('number');
    expect(success!.sequence).toBeGreaterThan(beforeSequence);
    expect(getRoom(roomCode).state!.sequence).toBe(success!.sequence);
  });
});
