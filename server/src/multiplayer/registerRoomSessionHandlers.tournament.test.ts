import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom } from '../rooms';
import { initRoomSession } from './roomSession';
import { registerRoomSessionHandlers } from './registerRoomSessionHandlers';

const fetchMatchByIdMock = vi.fn();
const updateMatchMock = vi.fn();
const dispatchTournamentMatchMock = vi.fn();

vi.mock('../scheduledTournament/persistence', () => ({
  fetchMatchById: (...args: unknown[]) => fetchMatchByIdMock(...args),
  updateMatch: (...args: unknown[]) => updateMatchMock(...args),
}));

vi.mock('../scheduledTournament/matchDispatch', () => ({
  dispatchTournamentMatch: (...args: unknown[]) => dispatchTournamentMatchMock(...args),
}));

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
});
