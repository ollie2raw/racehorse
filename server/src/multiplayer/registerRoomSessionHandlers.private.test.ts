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

  it('does not let a third socket take a connected guest seat using its public guest id', async () => {
    const { socket: host, handlers: hostHandlers } = makeSocket('Host', 'guest_host');
    const { socket: guest, handlers: guestHandlers } = makeSocket('Guest', 'guest_victim');
    const { socket: attacker, handlers: attackerHandlers } = makeSocket('Attacker', 'guest_attacker');
    const io = makeTwoPlayerIo(host, guest, 'PENDING');
    io.sockets.sockets.set(attacker.id, attacker);
    initRoomSession(io, sessionDeps);
    for (const socket of [host, guest, attacker]) registerRoomSessionHandlers(io, socket);

    const createAck = vi.fn();
    await hostHandlers.get('room:create')?.({ username: 'Host', userId: 'guest_host' }, createAck);
    const roomCode = createAck.mock.calls[0][0].roomCode as string;
    const guestAck = vi.fn();
    await guestHandlers.get('room:join')?.(roomCode, { username: 'Guest', userId: 'guest_victim' }, guestAck);
    expect(guestAck.mock.calls[0][0].players).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: 'guest_victim' })]),
    );

    const attackAck = vi.fn();
    await attackerHandlers.get('room:join')?.(
      roomCode,
      { username: 'Guest', userId: 'guest_victim' },
      attackAck,
    );
    expect(attackAck.mock.calls[0][0].ok).toBe(false);
    expect(guest.disconnect).not.toHaveBeenCalled();

    const reconnectToken = guestAck.mock.calls[0][0].guestReconnectToken as string;
    expect(reconnectToken).toMatch(/^v1\./);
    expect(guestAck.mock.calls[0][0].players).not.toContainEqual(
      expect.objectContaining({ guestReconnectToken: reconnectToken }),
    );
    const legitimateAck = vi.fn();
    await attackerHandlers.get('room:join')?.(
      roomCode,
      { username: 'Guest', userId: 'guest_victim', guestReconnectToken: reconnectToken },
      legitimateAck,
    );
    expect(legitimateAck.mock.calls[0][0]).toMatchObject({ ok: true, you: guestAck.mock.calls[0][0].you });
    expect(guest.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not accept another room guest capability for the same visible guest id', async () => {
    const hostA = makeSocket('HostA', 'guest_host_a');
    const guestA = makeSocket('GuestA', 'guest_shared');
    const hostB = makeSocket('HostB', 'guest_host_b');
    const guestB = makeSocket('GuestB', 'guest_shared');
    const attacker = makeSocket('Attacker', 'guest_attacker');
    const io = makeTwoPlayerIo(hostA.socket, guestA.socket, 'PENDING');
    for (const member of [hostB, guestB, attacker]) io.sockets.sockets.set(member.socket.id, member.socket);
    initRoomSession(io, sessionDeps);
    for (const member of [hostA, guestA, hostB, guestB, attacker]) {
      registerRoomSessionHandlers(io, member.socket);
    }
    const createA = vi.fn();
    await hostA.handlers.get('room:create')?.({ username: 'HostA', userId: 'guest_host_a' }, createA);
    const roomA = createA.mock.calls[0][0].roomCode as string;
    const joinA = vi.fn();
    await guestA.handlers.get('room:join')?.(roomA, { username: 'Guest', userId: 'guest_shared' }, joinA);
    expect(joinA.mock.calls[0][0].ok).toBe(true);

    const createB = vi.fn();
    await hostB.handlers.get('room:create')?.({ username: 'HostB', userId: 'guest_host_b' }, createB);
    const roomB = createB.mock.calls[0][0].roomCode as string;
    const joinB = vi.fn();
    await guestB.handlers.get('room:join')?.(roomB, { username: 'Guest', userId: 'guest_shared' }, joinB);
    expect(joinB.mock.calls[0][0].ok).toBe(true);

    const attack = vi.fn();
    await attacker.handlers.get('room:join')?.(roomB, {
      username: 'Guest', userId: 'guest_shared',
      guestReconnectToken: joinA.mock.calls[0][0].guestReconnectToken,
    }, attack);
    expect(attack.mock.calls[0][0].ok).toBe(false);
    expect(guestB.socket.disconnect).not.toHaveBeenCalled();
  });

  it('keeps authenticated account seat attachment independent of guest capabilities', async () => {
    const accountId = '3b5daa8a-4780-429a-87b9-90e387704eaa';
    const host = makeSocket('Host', 'guest_host');
    const account = makeSocket('Account', accountId);
    const secondTab = makeSocket('SecondTab', accountId);
    const io = makeTwoPlayerIo(host.socket, account.socket, 'PENDING');
    io.sockets.sockets.set(secondTab.socket.id, secondTab.socket);
    initRoomSession(io, sessionDeps);
    for (const member of [host, account, secondTab]) registerRoomSessionHandlers(io, member.socket);
    const create = vi.fn();
    await host.handlers.get('room:create')?.({ username: 'Host', userId: 'guest_host' }, create);
    const code = create.mock.calls[0][0].roomCode as string;
    const join = vi.fn();
    await account.handlers.get('room:join')?.(code, { username: 'Account', userId: accountId }, join);
    expect(join.mock.calls[0][0].guestReconnectToken).toBeUndefined();
    const reconnect = vi.fn();
    await secondTab.handlers.get('room:join')?.(code, { username: 'Account', userId: accountId }, reconnect);
    expect(reconnect.mock.calls[0][0]).toMatchObject({ ok: true, you: join.mock.calls[0][0].you });
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
