import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, setRoomRoster } from './roomSession';
import { registerRoomSessionHandlers } from './registerRoomSessionHandlers';

const fetchMatchByIdMock = vi.fn();
const applyMatchResultMock = vi.fn();
const recordMatchEndMock = vi.fn();
const persistRoomMatchLogMock = vi.fn(async () => undefined);

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async () => []),
}));

vi.mock('../scheduledTournament/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scheduledTournament/persistence')>();
  return {
    ...actual,
    fetchMatchById: (...args: unknown[]) => fetchMatchByIdMock(...args),
    updateMatch: vi.fn(),
  };
});

vi.mock('../scheduledTournament/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scheduledTournament/engine')>();
  return {
    ...actual,
    applyMatchResult: (...args: unknown[]) => applyMatchResultMock(...args),
  };
});

vi.mock('../matchmaking/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../matchmaking/persistence')>();
  return {
    ...actual,
    recordMatchEnd: (...args: unknown[]) => recordMatchEndMock(...args),
  };
});

function makeSocket(userId: string | null, username = 'Player') {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    id: `sock-${userId ?? 'anon'}`,
    data: {
      userId,
      username: userId ? username : undefined,
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

function makeIo(socket: any) {
  const emit = vi.fn();
  return {
    sockets: { sockets: new Map([[socket.id, socket]]) },
    to: vi.fn(() => ({ emit })),
    __emit: emit,
  } as any;
}

function seedCasualRoom(roomCode: string) {
  createReservedRoom(roomCode, { winningScore: 30 });
  joinRoom(roomCode, 'p1');
  joinRoom(roomCode, 'p2');
  setRoomRoster(roomCode, [
    { id: 'p1', socketId: 'sock-u1', username: 'ollie', userId: 'u1' },
    { id: 'p2', socketId: 'sock-u2', username: 'rival', userId: 'u2' },
  ]);
  const room = getRoom(roomCode);
  room.matchmakingMatchId = 'mm-1';
  return room;
}

function seedActiveMidGameRoom(roomCode: string) {
  const room = seedCasualRoom(roomCode);
  room.state = {
    playerIds: ['p1', 'p2'],
    players: {
      p1: { hand: [{ high: 6, low: 6 }], score: 0 },
      p2: { hand: [{ high: 5, low: 5 }], score: 0 },
    },
    board: { tiles: [], leftEnd: null, rightEnd: null },
    boneyard: [],
    currentPlayerIndex: 0,
    handOver: false,
    gameOver: false,
    handNumber: 1,
    sequence: 1,
    winnerId: null,
    config: room.config,
  } as any;
  return room;
}

function initAbandonTestSession() {
  initRoomSession(
    { sockets: { sockets: new Map() } } as any,
    {
      resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
      normalizeUsername: (value: unknown) => (typeof value === 'string' ? value : 'Guest'),
      normalizeUserId: (value: unknown) => (typeof value === 'string' ? value : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped',
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      maybeFinalizeTournamentMatch: () => undefined,
      persistRoomMatchLog: persistRoomMatchLogMock,
      onGameOver: () => null,
      finalizeTournamentMatch: () => undefined,
    },
  );
}

describe('room:abandon_match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRoomRuntimeForTests();
    initAbandonTestSession();
  });

  it('rejects an unauthenticated user', async () => {
    const { socket, handlers } = makeSocket(null);
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('room:abandon_match')?.({ roomCode: 'ROOM1' }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'not_authenticated' });
  });

  it('rejects a non-player', async () => {
    seedCasualRoom('ABANDON1');
    const { socket, handlers } = makeSocket('u9');
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('room:abandon_match')?.({ roomCode: 'ABANDON1' }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'not_player' });
  });

  it('marks a casual room abandoned, notifies opponent, and rejects rejoin', async () => {
    seedCasualRoom('ABANDON2');
    const { socket, handlers } = makeSocket('u1', 'ollie');
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('room:abandon_match')?.({ roomCode: 'ABANDON2' }, ack);

    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, roomCode: 'ABANDON2', winnerId: 'u2' }),
    );
    expect(recordMatchEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'mm-1',
        status: 'forfeit',
        winnerId: 'u2',
      }),
    );
    expect(io.__emit).toHaveBeenCalledWith(
      'room:match_abandoned',
      expect.objectContaining({
        roomCode: 'ABANDON2',
        abandonedUserId: 'u1',
        winnerId: 'u2',
      }),
    );
    expect(getRoom('ABANDON2').abandonedAt).toEqual(expect.any(String));

    const { socket: rejoinSocket, handlers: rejoinHandlers } = makeSocket('u1', 'ollie');
    const rejoinIo = makeIo(rejoinSocket);
    registerRoomSessionHandlers(rejoinIo, rejoinSocket);
    const rejoinAck = vi.fn();
    await rejoinHandlers.get('room:join')?.('ABANDON2', { username: 'ollie', userId: 'u1' }, rejoinAck);
    expect(rejoinAck).toHaveBeenCalledWith({ ok: false, error: 'match_abandoned' });
  });

  it('forfeits a scheduled tournament match through applyMatchResult', async () => {
    const room = seedCasualRoom('ABANDON3');
    room.scheduledTournamentId = 'tour-1';
    room.scheduledTournamentMatchId = 'match-1';
    fetchMatchByIdMock.mockResolvedValue({
      id: 'match-1',
      tournament_id: 'tour-1',
      round: 1,
      match_number: 1,
      player1_id: 'u1',
      player2_id: 'u2',
      winner_id: null,
      room_code: 'ABANDON3',
      status: 'in_progress',
      ready_at: null,
      ready_deadline_at: null,
      started_at: null,
      completed_at: null,
      player1_joined_at: null,
      player2_joined_at: null,
      winner_source: null,
      status_reason: null,
      forfeit_user_id: null,
      no_show_user_id: null,
      bot_tier: null,
      player1_score: null,
      player2_score: null,
    });

    const { socket, handlers } = makeSocket('u1', 'ollie');
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('room:abandon_match')?.({ roomCode: 'ABANDON3' }, ack);

    expect(applyMatchResultMock).toHaveBeenCalledWith(
      io,
      expect.objectContaining({
        matchId: 'match-1',
        winnerId: 'u2',
        winnerSource: 'forfeit',
        statusReason: 'player1_forfeit',
        forfeitUserId: 'u1',
      }),
    );
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, isTournament: true, tournamentId: 'tour-1' }),
    );
  });
});

describe('room:leave mid-match auto-forfeit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRoomRuntimeForTests();
    initAbandonTestSession();
  });

  it('sets abandonedAt and emits room:match_abandoned when leaving during active game', async () => {
    const roomCode = 'LEAVE1';
    seedActiveMidGameRoom(roomCode);
    const { socket, handlers } = makeSocket('u1', 'ollie');
    socket.join(roomCode);
    socket.data.roomId = roomCode;
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('room:leave')?.(roomCode, ack);

    expect(ack).toHaveBeenCalledWith({ ok: true, roomCode });
    expect(getRoom(roomCode).abandonedAt).toEqual(expect.any(String));
    expect(persistRoomMatchLogMock).toHaveBeenCalledWith(expect.anything(), 'abandoned');
    expect(io.__emit).toHaveBeenCalledWith(
      'room:match_abandoned',
      expect.objectContaining({
        roomCode,
        abandonedUserId: 'u1',
        winnerId: 'u2',
      }),
    );
    expect(recordMatchEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'mm-1',
        status: 'forfeit',
        winnerId: 'u2',
      }),
    );
  });

  it('does not forfeit when leaveTrackedRoom is called with preserveSeat during active game', async () => {
    const roomCode = 'LEAVE2';
    seedActiveMidGameRoom(roomCode);
    const { socket } = makeSocket('u1', 'ollie');
    socket.join(roomCode);
    socket.data.roomId = roomCode;
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const leaveTrackedRoom = (socket as any).__leaveTrackedRoom as (
      roomCode: string,
      options?: { preserveSeat?: boolean },
    ) => Promise<void>;
    await leaveTrackedRoom(roomCode, { preserveSeat: true });

    expect(getRoom(roomCode).abandonedAt).toBeUndefined();
    expect(persistRoomMatchLogMock).not.toHaveBeenCalled();
    expect(io.__emit).not.toHaveBeenCalledWith('room:match_abandoned', expect.anything());
    expect(getRoom(roomCode).players).toContain('p1');
  });

  it('does not forfeit lobby room:leave when room.state is null', async () => {
    const roomCode = 'LEAVE3';
    seedCasualRoom(roomCode);
    const { socket, handlers } = makeSocket('u1', 'ollie');
    socket.join(roomCode);
    socket.data.roomId = roomCode;
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('room:leave')?.(roomCode, ack);

    expect(ack).toHaveBeenCalledWith({ ok: true, roomCode });
    expect(getRoom(roomCode).abandonedAt).toBeUndefined();
    expect(persistRoomMatchLogMock).not.toHaveBeenCalled();
    expect(io.__emit).not.toHaveBeenCalledWith('room:match_abandoned', expect.anything());
    expect(getRoom(roomCode).players).not.toContain('p1');
  });
});
