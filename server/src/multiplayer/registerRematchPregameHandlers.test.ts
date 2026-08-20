import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import {
  ensureSocketDataSeat,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';
import * as roomSession from './roomSession';
import { registerRematchPregameHandlers } from './registerRematchPregameHandlers';
import { comparePregameDrawTiles } from './preGameDraw';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';
import { supabaseFetch } from '../supabaseUtils';

async function flushPregameDrawHandler(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/room_live_sessions') && init?.method === 'POST') {
      return undefined;
    }
    if (path.includes('/room_command_receipts')) {
      return undefined;
    }
    if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
  }),
}));

function makeSocket(socketId: string, seatId: string, roomId?: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: socketId,
    data: { playerId: seatId, userId: 'u1', roomId } as Record<string, unknown>,
    rooms: new Set<string>([socketId]),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    join: (roomCode: string) => {
      socket.rooms.add(roomCode);
    },
    emit: vi.fn(),
  };
  return { socket: socket as any, handlers };
}

function makeIo(roomCode: string) {
  const emit = vi.fn();
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: vi.fn(() => ({ emit })),
    __emit: emit,
  } as any;
}

function seedGameOverRoom(roomCode: string) {
  createReservedRoom(roomCode, { winningScore: 30 });
  joinRoom(roomCode, 'p1');
  joinRoom(roomCode, 'p2');
  setRoomRoster(roomCode, [
    { id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' },
    { id: 'p2', socketId: 'sock-p2', username: 'P2', userId: 'u2' },
  ]);
  const room = getRoom(roomCode);
  room.state = {
    playerIds: ['p1', 'p2'],
    players: {
      p1: { hand: [], score: 30 },
      p2: { hand: [], score: 10 },
    },
    board: { mainLine: [], hubDoubles: [] },
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handOver: true,
    gameOver: true,
    handNumber: 5,
    sequence: 99,
    winnerId: 'p1',
    config: room.config,
  } as any;
  return room;
}

const handlerDeps = {
  resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
  normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
  normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => undefined,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  persistRoomMatchLog: async () => undefined,
};

function sessionIo() {
  return {
    sockets: { sockets: new Map() },
    to: vi.fn(() => ({ emit: vi.fn() })),
  } as any;
}

describe('registerRematchPregameHandlers', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetRoomGameplayLocksForTests();
    vi.mocked(supabaseFetch).mockClear();
    initRoomSession(sessionIo(), {
      ...handlerDeps,
      onGameOver: () => null,
    });
  });

  it('game:rematch rejects tournament rooms', async () => {
    const roomCode = 'RMT01';
    seedGameOverRoom(roomCode);
    const room = getRoom(roomCode);
    (room as any).config = { ...room.config, tournamentId: 'tour-1' };

    const io = makeIo(roomCode);
    const { socket, handlers } = makeSocket('sock-p1', 'p1');
    ensureSocketDataSeat(socket, 'p1');

    registerRematchPregameHandlers(io, socket, { handlerDeps });

    const cb = vi.fn();
    await handlers.get('game:rematch')?.(roomCode, cb);
    expect(cb).toHaveBeenCalledWith({
      ok: false,
      error: 'Rematch is unavailable in tournament rooms.',
    });
  });

  it('game:rematch rejects when game is not over', async () => {
    const roomCode = 'RMT02';
    seedGameOverRoom(roomCode);
    getRoom(roomCode).state!.gameOver = false;

    const io = makeIo(roomCode);
    const { socket, handlers } = makeSocket('sock-p1', 'p1');
    ensureSocketDataSeat(socket, 'p1');

    registerRematchPregameHandlers(io, socket, { handlerDeps });

    const cb = vi.fn();
    await handlers.get('game:rematch')?.(roomCode, cb);
    expect(cb).toHaveBeenCalledWith({
      ok: false,
      error: 'Rematch is only available after game over.',
    });
  });

  it('game:rematch emits game:rematch:started before broadcastStateUpdate when both ready', async () => {
    const roomCode = 'RMT03';
    seedGameOverRoom(roomCode);

    const order: string[] = [];
    const io = makeIo(roomCode);
    io.to = vi.fn(() => ({
      emit: (event: string) => {
        order.push(`io.emit:${event}`);
      },
    }));
    const broadcastSpy = vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {
      order.push('broadcastStateUpdate');
    });

    const { socket: socket1, handlers: handlers1 } = makeSocket('sock-p1', 'p1');
    const { socket: socket2, handlers: handlers2 } = makeSocket('sock-p2', 'p2');
    ensureSocketDataSeat(socket1, 'p1');
    ensureSocketDataSeat(socket2, 'p2');

    registerRematchPregameHandlers(io, socket1, { handlerDeps });
    registerRematchPregameHandlers(io, socket2, { handlerDeps });

    await handlers1.get('game:rematch')?.(roomCode, vi.fn());
    const cb2 = vi.fn();
    await handlers2.get('game:rematch')?.(roomCode, cb2);

    expect(cb2).toHaveBeenCalledWith(expect.objectContaining({ ok: true, started: true }));
    const rematchStartedIdx = order.indexOf('io.emit:game:rematch:started');
    const postRematchBroadcastIdx = order.indexOf('broadcastStateUpdate', rematchStartedIdx);
    expect(rematchStartedIdx).toBeGreaterThanOrEqual(0);
    expect(postRematchBroadcastIdx).toBeGreaterThan(rematchStartedIdx);
    broadcastSpy.mockRestore();
  });

  it('blocks rematch when room persistence is degraded', async () => {
    const roomCode = 'RMTDG';
    const room = seedGameOverRoom(roomCode);
    room.durability.status = 'degraded';

    const io = makeIo(roomCode);
    const { socket, handlers } = makeSocket('sock-p1', 'p1');
    ensureSocketDataSeat(socket, 'p1');

    registerRematchPregameHandlers(io, socket, { handlerDeps });

    const cb = vi.fn();
    await handlers.get('game:rematch')?.(roomCode, cb);
    expect(cb).toHaveBeenCalledWith({
      ok: false,
      error: 'rematch_blocked',
    });
  });

  it('game:pregame_draw_pick no-ops without slotId', () => {
    const roomCode = 'PGD01';
    seedGameOverRoom(roomCode);

    const io = makeIo(roomCode);
    const { socket, handlers } = makeSocket('sock-p1', 'p1', roomCode);
    ensureSocketDataSeat(socket, 'p1');

    registerRematchPregameHandlers(io, socket, { handlerDeps });

    expect(() => handlers.get('game:pregame_draw_pick')?.({})).not.toThrow();
    expect(getRoom(roomCode).preGameDraw).toBeUndefined();
  });

  it('game:pregame_draw_pick rejects duplicate pick per player', async () => {
    const broadcastSpy = vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});
    const roomCode = 'PGD02';
    seedGameOverRoom(roomCode);
    const room = getRoom(roomCode);
    room.preGameDraw = {
      phase: 'pick-player',
      tiles: [
        {
          id: 'slot-a',
          tile: { high: 6, low: 5 },
          revealed: false,
          outOfPlay: false,
          pickedBy: null,
        },
        {
          id: 'slot-b',
          tile: { high: 4, low: 3 },
          revealed: false,
          outOfPlay: false,
          pickedBy: null,
        },
      ],
      picks: { p1: null, p2: null },
      winnerId: null,
    };

    const io = makeIo(roomCode);
    const { socket, handlers } = makeSocket('sock-p1', 'p1', roomCode);
    ensureSocketDataSeat(socket, 'p1');
    socket.data.roomId = roomCode;

    registerRematchPregameHandlers(io, socket, { handlerDeps });

    await handlers.get('game:pregame_draw_pick')?.({ slotId: 'slot-a' });
    const picksAfterFirst = { ...getRoom(roomCode).preGameDraw!.picks };
    await handlers.get('game:pregame_draw_pick')?.({ slotId: 'slot-b' });
    expect(getRoom(roomCode).preGameDraw!.picks).toEqual(picksAfterFirst);
    broadcastSpy.mockRestore();
  });

  it('compares equal totals by the higher individual pip', () => {
    expect(comparePregameDrawTiles({ low: 2, high: 6 }, { low: 3, high: 5 })).toBeGreaterThan(0);
    expect(comparePregameDrawTiles({ low: 3, high: 5 }, { low: 2, high: 6 })).toBeLessThan(0);
  });

  it('does not substitute a different tile for a stale multiplayer pick', async () => {
    const broadcastSpy = vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});
    const roomCode = 'PGD03';
    seedGameOverRoom(roomCode);
    const room = getRoom(roomCode);
    room.preGameDraw = {
      phase: 'pick-player',
      tiles: [
        { id: 'slot-a', tile: { low: 2, high: 6 }, revealed: false, outOfPlay: false, pickedBy: null },
        { id: 'slot-b', tile: { low: 0, high: 0 }, revealed: false, outOfPlay: false, pickedBy: null },
      ],
      picks: { p1: null, p2: null },
      winnerId: null,
      remainingDeck: null,
    };

    const io = makeIo(roomCode);
    const { socket: socket1, handlers: handlers1 } = makeSocket('sock-p1', 'p1', roomCode);
    const { socket: socket2, handlers: handlers2 } = makeSocket('sock-p2', 'p2', roomCode);
    ensureSocketDataSeat(socket1, 'p1');
    ensureSocketDataSeat(socket2, 'p2');
    registerRematchPregameHandlers(io, socket1, { handlerDeps });
    registerRematchPregameHandlers(io, socket2, { handlerDeps });

    await handlers1.get('game:pregame_draw_pick')?.({ slotId: 'slot-a' });
    await flushPregameDrawHandler();
    const p1Pick = room.preGameDraw.picks.p1;
    await handlers2.get('game:pregame_draw_pick')?.({ slotId: 'slot-a' });
    await flushPregameDrawHandler();

    expect(room.preGameDraw.picks.p1).toEqual(p1Pick);
    expect(room.preGameDraw.picks.p2).toBeNull();
    expect(room.preGameDraw.tiles.find((tile) => tile.id === 'slot-b')?.revealed).toBe(false);
    broadcastSpy.mockRestore();
  });

  it('resolves a 6-2 versus 5-3 draw in favor of 6-2', async () => {
    const broadcastSpy = vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});
    const roomCode = 'PGD04';
    seedGameOverRoom(roomCode);
    const room = getRoom(roomCode);
    room.preGameDraw = {
      phase: 'pick-player',
      tiles: [
        { id: 'slot-a', tile: { low: 2, high: 6 }, revealed: false, outOfPlay: false, pickedBy: null },
        { id: 'slot-b', tile: { low: 3, high: 5 }, revealed: false, outOfPlay: false, pickedBy: null },
      ],
      picks: { p1: null, p2: null },
      winnerId: null,
      remainingDeck: null,
    };

    const io = makeIo(roomCode);
    const { socket: socket1, handlers: handlers1 } = makeSocket('sock-p1', 'p1', roomCode);
    const { socket: socket2, handlers: handlers2 } = makeSocket('sock-p2', 'p2', roomCode);
    ensureSocketDataSeat(socket1, 'p1');
    ensureSocketDataSeat(socket2, 'p2');
    registerRematchPregameHandlers(io, socket1, { handlerDeps });
    registerRematchPregameHandlers(io, socket2, { handlerDeps });

    await handlers1.get('game:pregame_draw_pick')?.({ slotId: 'slot-a' });
    await flushPregameDrawHandler();
    await handlers2.get('game:pregame_draw_pick')?.({ slotId: 'slot-b' });
    await flushPregameDrawHandler();

    expect(room.preGameDraw.winnerId).toBe('p1');
    expect(room.preGameDraw.phase).toBe('showing-reveal');
    broadcastSpy.mockRestore();
  });
});
