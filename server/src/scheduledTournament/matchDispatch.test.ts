import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allHumanPlayersJoined, dispatchTournamentMatch, humanJoinedAt } from './matchDispatch';
import type { EnginePersistence } from './persistenceInterface';
import type { MatchRow, RegistrationRow, ScheduledTournamentRow } from './types';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string) => {
    if (path.startsWith('/rest/v1/profiles')) {
      return [
        { id: 'u1', username: 'alpha' },
        { id: 'u2', username: 'bravo' },
      ];
    }
    return [];
  }),
}));

const { seatSyntheticBotInRoomMock } = vi.hoisted(() => ({
  seatSyntheticBotInRoomMock: vi.fn(),
}));
vi.mock('../multiplayer/botSeating', () => ({
  seatSyntheticBotInRoom: (...args: unknown[]) => seatSyntheticBotInRoomMock(...args),
}));

vi.mock('../multiplayer/roomSession', () => ({
  broadcastStateUpdate: vi.fn(),
}));

function makeTournament(): ScheduledTournamentRow {
  return {
    id: 'tour-1',
    scheduled_start: new Date('2026-05-15T00:00:00Z').toISOString(),
    registration_open_at: new Date('2026-05-14T23:30:00Z').toISOString(),
    registration_close_at: new Date('2026-05-14T23:58:00Z').toISOString(),
    status: 'in_progress',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: new Date('2026-05-01T00:00:00Z').toISOString(),
  };
}

function makeMatch(): MatchRow {
  return {
    id: 'm-1',
    tournament_id: 'tour-1',
    round: 1,
    match_number: 1,
    player1_id: 'u1',
    player2_id: 'u2',
    winner_id: null,
    room_code: null,
    status: 'waiting',
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
  };
}

function makePersistence(match: MatchRow): { persistence: EnginePersistence; store: { match: MatchRow; rooms: Map<string, any> } } {
  const store = {
    match: { ...match },
    rooms: new Map<string, any>(),
  };
  const persistence: EnginePersistence = {
    fetchTournamentById: async () => makeTournament(),
    fetchRegistrations: async () => [] as RegistrationRow[],
    fetchRegistrationsWithProfile: async () => [],
    fetchMatches: async () => [{ ...store.match }],
    fetchMatchById: async (id) => (id === store.match.id ? { ...store.match } : null),
    fetchMatchByRoomCode: async (roomCode) =>
      store.match.room_code === roomCode ? { ...store.match } : null,
    insertMatch: vi.fn(async () => ({ ...store.match })),
    updateMatch: async (id, patch) => {
      if (id !== store.match.id) return;
      Object.assign(store.match, patch);
    },
    completeTournamentMatch: async () => {
      throw new Error('completeTournamentMatch not exercised by matchDispatch.test');
    },
    promoteTournamentMatch: async () => {
      throw new Error('promoteTournamentMatch not exercised by matchDispatch.test');
    },
    updateRegistrationPlacement: vi.fn(),
    updateRegistrationStatus: vi.fn(),
    updateTournamentStatus: vi.fn(),
    createReservedRoom: vi.fn((code: string) => {
      const room = store.rooms.get(code) ?? { code, players: [] };
      store.rooms.set(code, room);
      return room;
    }),
    getRoom: vi.fn((code: string) => {
      const room = store.rooms.get(code);
      if (!room) throw new Error('not_found');
      return room;
    }),
  };
  return { persistence, store };
}

function makeIo() {
  const emitted: Array<{ socketId: string; event: string; payload: unknown }> = [];
  const socket1 = {
    id: 's1',
    data: { userId: 'u1' },
    emit: (event: string, payload: unknown) => emitted.push({ socketId: 's1', event, payload }),
  };
  const socket2 = {
    id: 's2',
    data: { userId: 'u2' },
    emit: (event: string, payload: unknown) => emitted.push({ socketId: 's2', event, payload }),
  };
  const socket3 = {
    id: 's3',
    data: { userId: 'u3' },
    emit: (event: string, payload: unknown) => emitted.push({ socketId: 's3', event, payload }),
  };
  const sockets = new Map<string, any>([
    [socket1.id, socket1],
    [socket2.id, socket2],
    [socket3.id, socket3],
  ]);
  return {
    io: { sockets: { sockets } } as any,
    emitted,
  };
}

describe('tournament match lifecycle helpers', () => {
  it('treats bot joined_at as absent for human attach checks', () => {
    const match = makeMatch();
    match.player2_id = 'bot:fritz:tour-1:1';
    match.player2_joined_at = '2026-05-16T00:00:00Z';
    expect(humanJoinedAt(match, 'u1')).toBeNull();
    expect(allHumanPlayersJoined(match)).toBe(false);
    match.player1_joined_at = '2026-05-16T00:01:00Z';
    expect(allHumanPlayersJoined(match)).toBe(true);
  });
});

describe('dispatchTournamentMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates one room and marks the match ready', async () => {
    const { persistence, store } = makePersistence(makeMatch());
    const { io, emitted } = makeIo();

    const result = await dispatchTournamentMatch(io, 'm-1', {}, persistence);

    expect(result.ok).toBe(true);
    expect(store.rooms.size).toBe(1);
    expect(store.match.status).toBe('ready');
    expect(store.match.room_code).toBeTruthy();
    expect(store.match.ready_at).toBeTruthy();
    expect(store.match.ready_deadline_at).toBeTruthy();
    expect(emitted.filter((entry) => entry.event === 'tournament:match_ready')).toHaveLength(2);
    expect(emitted[0]?.payload).toEqual(
      expect.objectContaining({
        matchId: 'm-1',
      }),
    );
    expect((emitted[0]?.payload as Record<string, unknown>).roomCode).toEqual(store.match.room_code);
  });

  it('is idempotent and reuses the existing room for an already-ready match', async () => {
    const baseMatch = makeMatch();
    baseMatch.status = 'ready';
    baseMatch.room_code = 'TTOUR1R1M1';
    baseMatch.ready_at = new Date('2026-05-16T00:00:00Z').toISOString();
    baseMatch.ready_deadline_at = new Date('2026-05-16T00:02:00Z').toISOString();
    const { persistence, store } = makePersistence(baseMatch);
    store.rooms.set('TTOUR1R1M1', { code: 'TTOUR1R1M1', players: [] });
    const { io, emitted } = makeIo();

    const result = await dispatchTournamentMatch(io, 'm-1', {}, persistence);

    expect(result.reusedExistingRoom).toBe(true);
    expect((persistence.createReservedRoom as any).mock.calls).toHaveLength(0);
    expect(store.rooms.size).toBe(1);
    expect(emitted.filter((entry) => entry.event === 'tournament:match_ready')).toHaveLength(0);
  });

  it('seats a Fritz bot and emits match_ready only to the human socket', async () => {
    const match = makeMatch();
    match.player2_id = 'bot:fritz:tour-1:1';
    match.bot_tier = 'elite';
    const { persistence, store } = makePersistence(match);
    const { io, emitted } = makeIo();

    const result = await dispatchTournamentMatch(io, 'm-1', {}, persistence);

    expect(result.ok).toBe(true);
    expect(seatSyntheticBotInRoomMock).toHaveBeenCalledWith(
      expect.any(String),
      'bot:fritz:tour-1:1',
      'Elite Fritz',
    );
    expect(store.match.player2_joined_at).toBeNull();
    expect(store.match.status).toBe('ready');
    const readyEvents = emitted.filter((entry) => entry.event === 'tournament:match_ready');
    expect(readyEvents).toHaveLength(1);
    expect(readyEvents[0].socketId).toBe('s1');
    expect(readyEvents[0].payload).toEqual(
      expect.objectContaining({
        roomCode: store.match.room_code,
        opponentId: 'bot:fritz:tour-1:1',
        opponentUsername: 'Elite Fritz',
        matchStatus: 'ready',
      }),
    );
  });
});
