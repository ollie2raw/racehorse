import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom } from '../rooms';
import { initRoomSession } from './roomSession';
import { registerRoomSessionHandlers } from './registerRoomSessionHandlers';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async () => []),
}));

const fetchMatchByIdMock = vi.fn();
const updateMatchMock = vi.fn();
const fetchTournamentByIdMock = vi.fn();
vi.mock('../scheduledTournament/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scheduledTournament/persistence')>();
  return {
    ...actual,
    fetchMatchById: (...args: unknown[]) => fetchMatchByIdMock(...args),
    fetchTournamentById: (...args: unknown[]) => fetchTournamentByIdMock(...args),
    updateMatch: (...args: unknown[]) => updateMatchMock(...args),
  };
});

function makeSocket(userId: string | null) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    id: `sock-${userId ?? 'anon'}`,
    data: {
      userId,
      username: userId ? `user-${userId}` : undefined,
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
  return {
    sockets: { sockets: new Map([[socket.id, socket]]) },
    to: () => ({ emit: vi.fn() }),
  } as any;
}

describe('tournament:attach_assigned_match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        persistRoomMatchLog: async () => undefined,
        onGameOver: () => null,
        finalizeTournamentMatch: () => undefined,
      },
    );
  });

  it('rehydrates a missing reserved room from the DB room_code during attach', async () => {
    const roomCode = 'TREHY1';
    const matchRow = {
      id: 'm-rehydrate',
      tournament_id: 'tour-1',
      round: 1,
      match_number: 1,
      player1_id: 'u1',
      player2_id: 'u2',
      winner_id: null,
      room_code: roomCode,
      status: 'ready',
      ready_at: new Date('2026-05-16T00:00:00Z').toISOString(),
      ready_deadline_at: new Date('2026-05-16T00:02:00Z').toISOString(),
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
    };
    fetchMatchByIdMock.mockResolvedValue(matchRow);
    fetchTournamentByIdMock.mockResolvedValue({
      id: 'tour-1',
      status: 'in_progress',
      win_target: 30,
    });
    updateMatchMock.mockResolvedValue(undefined);

    const { socket, handlers } = makeSocket('u1');
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('tournament:attach_assigned_match')?.({ matchId: 'm-rehydrate' }, ack);

    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        matchId: 'm-rehydrate',
        roomCode,
      }),
    );
    expect(socket.rooms.has(roomCode)).toBe(true);
    expect(updateMatchMock).toHaveBeenCalledWith(
      'm-rehydrate',
      expect.objectContaining({ player1_joined_at: expect.any(String) }),
    );
  });

  it('allows an assigned player to attach successfully', async () => {
    const roomCode = 'TTACH1';
    createReservedRoom(roomCode, { winningScore: 30 });
    fetchMatchByIdMock.mockResolvedValue({
      id: 'm-1',
      tournament_id: 'tour-1',
      round: 1,
      match_number: 1,
      player1_id: 'u1',
      player2_id: 'u2',
      winner_id: null,
      room_code: roomCode,
      status: 'ready',
      ready_at: new Date('2026-05-16T00:00:00Z').toISOString(),
      ready_deadline_at: new Date('2026-05-16T00:02:00Z').toISOString(),
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
    updateMatchMock.mockResolvedValue(undefined);
    const { socket, handlers } = makeSocket('u1');
    const io = makeIo(socket);
    initRoomSession(io, {
      resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
      normalizeUsername: (value: unknown) => (typeof value === 'string' ? value : 'Guest'),
      normalizeUserId: (value: unknown) => (typeof value === 'string' ? value : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped',
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      maybeFinalizeTournamentMatch: () => undefined,
      persistRoomMatchLog: async () => undefined,
      onGameOver: () => null,
      finalizeTournamentMatch: () => undefined,
    });
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('tournament:attach_assigned_match')?.({ matchId: 'm-1' }, ack);

    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        matchId: 'm-1',
        tournamentId: 'tour-1',
        roomCode,
        you: expect.any(String),
        players: expect.any(Array),
        matchStarted: false,
      }),
    );
    expect(updateMatchMock).toHaveBeenCalledWith(
      'm-1',
      expect.objectContaining({ player1_joined_at: expect.any(String) }),
    );
    expect(socket.rooms.has(roomCode)).toBe(true);
  });

  it('rejects a wrong player with tournament_not_assigned', async () => {
    fetchMatchByIdMock.mockResolvedValue({
      id: 'm-1',
      tournament_id: 'tour-1',
      round: 1,
      match_number: 1,
      player1_id: 'u1',
      player2_id: 'u2',
      winner_id: null,
      room_code: 'TTACH2',
      status: 'ready',
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
    const { socket, handlers } = makeSocket('u9');
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('tournament:attach_assigned_match')?.({ matchId: 'm-1' }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'tournament_not_assigned' });
  });

  it('rejects an unauthenticated socket', async () => {
    const { socket, handlers } = makeSocket(null);
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('tournament:attach_assigned_match')?.({ matchId: 'm-1' }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'not_authenticated' });
  });

  it('allows attach when match status is in_progress and returns room join payload', async () => {
    const roomCode = 'TTACH3';
    const { startGame, getRoom, joinRoom } = await import('../rooms');
    const { seatSyntheticBotInRoom } = await import('./botSeating');
    createReservedRoom(roomCode, { winningScore: 30 });
    const room = getRoom(roomCode);
    room.scheduledTournamentMatchId = 'm-inprog';
    room.scheduledTournamentId = 'tour-1';
    seatSyntheticBotInRoom(roomCode, 'bot:fritz:tour-1:1', 'Fritz');
    joinRoom(roomCode, 'p1');
    const { setRoomRoster } = await import('./roomSession');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: '', username: 'human', userId: 'u1' },
      { id: 'bot:fritz:tour-1:1', socketId: '', username: 'Fritz', userId: null },
    ]);
    const { socket: botHostSocket } = makeSocket('u1');
    await startGame(roomCode, makeIo(botHostSocket) as any);

    fetchMatchByIdMock.mockResolvedValue({
      id: 'm-inprog',
      tournament_id: 'tour-1',
      round: 1,
      match_number: 1,
      player1_id: 'u1',
      player2_id: 'bot:fritz:tour-1:1',
      winner_id: null,
      room_code: roomCode,
      status: 'in_progress',
      ready_at: new Date('2026-05-16T00:00:00Z').toISOString(),
      ready_deadline_at: new Date('2026-05-16T00:02:00Z').toISOString(),
      started_at: new Date('2026-05-16T00:01:00Z').toISOString(),
      completed_at: null,
      player1_joined_at: new Date('2026-05-16T00:01:00Z').toISOString(),
      player2_joined_at: null,
      winner_source: null,
      status_reason: null,
      forfeit_user_id: null,
      no_show_user_id: null,
      bot_tier: 'standard',
      player1_score: null,
      player2_score: null,
    });
    updateMatchMock.mockResolvedValue(undefined);

    const { socket, handlers } = makeSocket('u1');
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('tournament:attach_assigned_match')?.({ matchId: 'm-inprog' }, ack);

    expect(ack).toHaveBeenCalledTimes(1);
    const body = ack.mock.calls[0]?.[0] as {
      ok: boolean;
      you?: string;
      state?: { players?: Record<string, { hand?: unknown[] }> };
      players?: unknown[];
      matchStarted?: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.matchStarted).toBe(true);
    expect(Array.isArray(body.players)).toBe(true);
    expect(typeof body.you).toBe('string');
    const handLen = body.you && body.state?.players?.[body.you]?.hand?.length;
    expect(typeof handLen).toBe('number');
    expect(handLen).toBeGreaterThan(0);
  });

  it('always invokes callback once on handler error', async () => {
    fetchMatchByIdMock.mockRejectedValue(new Error('db_down'));
    const { socket, handlers } = makeSocket('u1');
    const io = makeIo(socket);
    registerRoomSessionHandlers(io, socket);

    const ack = vi.fn();
    await handlers.get('tournament:attach_assigned_match')?.({ matchId: 'm-err' }, ack);

    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'db_down' });
  });
});
