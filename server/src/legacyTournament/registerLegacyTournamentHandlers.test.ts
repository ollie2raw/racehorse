import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
import type { Tournament } from '../tournament/tournament';
import { initStandings } from '../tournament/tournament';
import {
  __legacyTournamentTestUtils,
  registerLegacyTournamentHandlers,
} from './registerLegacyTournamentHandlers';

const {
  createEmitTournament,
  createStartNextMatch,
  createMaybeFinalizeTournamentMatch,
  getLegacyTournamentStorage,
} = __legacyTournamentTestUtils;

const allocatePlayerSeatIdMock = vi.fn();
const joinSocketToRoomMock = vi.fn();
const setRoomRosterMock = vi.fn();
const createRoomMock = vi.fn();
const joinRoomMock = vi.fn();

vi.mock('../rooms', () => ({
  createRoom: (...args: unknown[]) => createRoomMock(...args),
  joinRoom: (...args: unknown[]) => joinRoomMock(...args),
}));

vi.mock('../multiplayer/roomSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../multiplayer/roomSession')>();
  return {
    ...actual,
    allocatePlayerSeatId: () => allocatePlayerSeatIdMock(),
    joinSocketToRoom: (...args: unknown[]) => joinSocketToRoomMock(...args),
    setRoomRoster: (...args: unknown[]) => setRoomRosterMock(...args),
  };
});

type HandlerMap = Record<string, (...args: unknown[]) => void>;

function createIoStub(): {
  io: Server;
  tournEmit: ReturnType<typeof vi.fn>;
  roomEmit: ReturnType<typeof vi.fn>;
} {
  const tournEmit = vi.fn();
  const roomEmit = vi.fn();
  const io = {
    to: vi.fn((target: string) => ({
      emit: target.startsWith('tourn:') ? tournEmit : roomEmit,
    })),
  } as unknown as Server;
  return { io, tournEmit, roomEmit };
}

function createSocketStub(overrides: {
  id?: string;
  data?: Record<string, unknown>;
  join?: ReturnType<typeof vi.fn>;
} = {}): { socket: Socket; handlers: HandlerMap; join: ReturnType<typeof vi.fn> } {
  const handlers: HandlerMap = {};
  const join = overrides.join ?? vi.fn();
  const socket = {
    id: overrides.id ?? 'sock-host',
    data: overrides.data ?? {},
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    join,
  } as unknown as Socket;
  return { socket, handlers, join };
}

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  const players = overrides.players ?? [
    { socketId: 'sock-a', username: 'Alice', userId: 'u1' },
    { socketId: 'sock-b', username: 'Bob', userId: 'u2' },
  ];
  return {
    id: 't-1',
    lobbyCode: 'ABCD',
    hostSocketId: 'sock-host',
    status: 'running',
    players,
    matches: [],
    currentMatchIndex: 0,
    standings: initStandings(players),
    activeMatchId: null,
    activeRoomCode: null,
    ...overrides,
  };
}

describe('createEmitTournament', () => {
  it('emits tournament:state with sorted standings and nullable active fields', () => {
    const { io, tournEmit } = createIoStub();
    const emitTournament = createEmitTournament(io);
    const t = makeTournament({
      activeMatchId: 'm-1',
      activeRoomCode: 'ROOM1',
      standings: {
        'sock-b': {
          socketId: 'sock-b',
          username: 'Bob',
          played: 1,
          wins: 1,
          losses: 0,
          pointsFor: 30,
          pointsAgainst: 10,
        },
        'sock-a': {
          socketId: 'sock-a',
          username: 'Alice',
          played: 1,
          wins: 0,
          losses: 1,
          pointsFor: 10,
          pointsAgainst: 30,
        },
      },
    });

    emitTournament(t);

    expect(io.to).toHaveBeenCalledWith('tourn:t-1');
    expect(tournEmit).toHaveBeenCalledWith('tournament:state', {
      id: 't-1',
      hostSocketId: 'sock-host',
      lobbyCode: 'ABCD',
      status: 'running',
      players: t.players,
      matches: t.matches,
      currentMatchIndex: 0,
      activeMatchId: 'm-1',
      activeRoomCode: 'ROOM1',
      standings: [
        expect.objectContaining({ socketId: 'sock-b', wins: 1 }),
        expect.objectContaining({ socketId: 'sock-a', wins: 0 }),
      ],
    });
  });
});

describe('createStartNextMatch', () => {
  beforeEach(() => {
    allocatePlayerSeatIdMock.mockReset();
    allocatePlayerSeatIdMock.mockReturnValueOnce('seat-a').mockReturnValueOnce('seat-b');
    createRoomMock.mockReset();
    createRoomMock.mockReturnValue({ code: 'ROOM99', config: {} });
    joinRoomMock.mockReset();
    joinSocketToRoomMock.mockReset();
    setRoomRosterMock.mockReset();
  });

  it('marks tournament complete when all matches are done', () => {
    const { io, tournEmit } = createIoStub();
    const emitTournament = vi.fn();
    const startNextMatch = createStartNextMatch(io, emitTournament);
    const t = makeTournament({
      matches: [{ id: 'm-done', a: 'sock-a', b: 'sock-b', status: 'done' }],
      currentMatchIndex: 0,
    });

    startNextMatch(t);

    expect(t.status).toBe('complete');
    expect(t.activeMatchId).toBeNull();
    expect(t.activeRoomCode).toBeNull();
    expect(emitTournament).toHaveBeenCalledWith(t);
    expect(createRoomMock).not.toHaveBeenCalled();
    expect(tournEmit).not.toHaveBeenCalled();
  });

  it('activates the next pending match and creates a room with tournament metadata', () => {
    const { io, tournEmit, roomEmit } = createIoStub();
    const emitTournament = vi.fn();
    const startNextMatch = createStartNextMatch(io, emitTournament);
    const t = makeTournament({
      matches: [{ id: 'm-1', a: 'sock-a', b: 'sock-b', status: 'pending' }],
      currentMatchIndex: 0,
    });

    startNextMatch(t);

    expect(t.activeMatchId).toBe('m-1');
    expect(t.activeRoomCode).toBe('ROOM99');
    expect(t.matches[0].status).toBe('active');
    expect(t.matches[0].roomCode).toBe('ROOM99');
    expect(createRoomMock).toHaveBeenCalledWith('seat-a', expect.objectContaining({
      winningScore: 30,
      tournamentId: 't-1',
      tournamentMatchId: 'm-1',
      tournamentMode: 'round_robin',
    }));
    expect(joinRoomMock).toHaveBeenCalledWith('ROOM99', 'seat-b');
    expect(joinSocketToRoomMock).toHaveBeenCalledWith('sock-a', 'ROOM99', ['tourn:']);
    expect(joinSocketToRoomMock).toHaveBeenCalledWith('sock-b', 'ROOM99', ['tourn:']);
    expect(setRoomRosterMock).toHaveBeenCalledWith('ROOM99', [
      { id: 'seat-a', socketId: 'sock-a', username: 'Alice', userId: 'u1' },
      { id: 'seat-b', socketId: 'sock-b', username: 'Bob', userId: 'u2' },
    ]);
    expect(roomEmit).toHaveBeenCalledWith('room:update', expect.any(Object));
    expect(tournEmit).toHaveBeenCalledWith('tournament:match:assigned', expect.objectContaining({
      matchId: 'm-1',
      roomCode: 'ROOM99',
      a: 'sock-a',
      b: 'sock-b',
    }));
    expect(emitTournament).toHaveBeenCalledWith(t);
  });
});

describe('createMaybeFinalizeTournamentMatch', () => {
  it('ignores stale gameOver when activeMatchId differs from reported match', () => {
    const { tournamentsById } = getLegacyTournamentStorage();
    tournamentsById.clear();
    const t = makeTournament({
      activeMatchId: 'm-active',
      matches: [{ id: 'm-stale', a: 'sock-a', b: 'sock-b', status: 'pending' }],
    });
    tournamentsById.set('t-1', t);

    const emitTournament = vi.fn();
    const startNextMatch = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const maybeFinalize = createMaybeFinalizeTournamentMatch(tournamentsById, emitTournament, startNextMatch);

    maybeFinalize({
      state: { gameOver: true, players: { 'sock-a': { score: 30 }, 'sock-b': { score: 10 } } },
      config: { tournamentId: 't-1', tournamentMatchId: 'm-stale' },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[tournament] ignoring stale gameOver for non-active match',
      expect.objectContaining({
        tournamentId: 't-1',
        activeMatchId: 'm-active',
        reportedMatchId: 'm-stale',
      }),
    );
    expect(emitTournament).not.toHaveBeenCalled();
    expect(startNextMatch).not.toHaveBeenCalled();
    expect(t.matches[0].status).toBe('pending');
    warnSpy.mockRestore();
  });

  it('applies result and advances when gameOver matches the active match', () => {
    const { tournamentsById } = getLegacyTournamentStorage();
    tournamentsById.clear();
    const t = makeTournament({
      activeMatchId: 'm-1',
      matches: [{ id: 'm-1', a: 'sock-a', b: 'sock-b', status: 'active' }],
    });
    tournamentsById.set('t-1', t);

    const emitTournament = vi.fn();
    const startNextMatch = vi.fn();
    const maybeFinalize = createMaybeFinalizeTournamentMatch(tournamentsById, emitTournament, startNextMatch);

    maybeFinalize({
      state: { gameOver: true, players: { 'sock-a': { score: 30 }, 'sock-b': { score: 12 } } },
      config: { tournamentId: 't-1', tournamentMatchId: 'm-1' },
    });

    expect(t.matches[0].status).toBe('done');
    expect(t.matches[0].winner).toBe('sock-a');
    expect(t.currentMatchIndex).toBe(1);
    expect(t.activeMatchId).toBeNull();
    expect(t.activeRoomCode).toBeNull();
    expect(emitTournament).toHaveBeenCalledWith(t);
    expect(startNextMatch).toHaveBeenCalledWith(t);
  });
});

describe('registerLegacyTournamentHandlers', () => {
  beforeEach(() => {
    delete (globalThis as any).__tournamentsById;
    delete (globalThis as any).__tournamentsByCode;
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).__tournamentsById;
    delete (globalThis as any).__tournamentsByCode;
  });

  const deps = {
    normalizeUsername: (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : 'Guest'),
    normalizeUserId: (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null),
  };

  it('tournament:create acks ok and joins the tournament room', () => {
    const { io } = createIoStub();
    const { socket, handlers, join } = createSocketStub({ id: 'sock-host' });
    const cb = vi.fn();
    registerLegacyTournamentHandlers(socket, { io, ...deps });

    handlers['tournament:create']({ username: 'Host', userId: 'u-host' }, cb);

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: true, lobbyCode: expect.any(String) }));
    expect(join).toHaveBeenCalledWith(expect.stringMatching(/^tourn:/));
    expect(socket.data.tournamentId).toBeDefined();
  });

  it('tournament:join rejects unknown lobby codes', () => {
    const { io } = createIoStub();
    const { socket, handlers } = createSocketStub();
    const cb = vi.fn();
    registerLegacyTournamentHandlers(socket, { io, ...deps });

    handlers['tournament:join']('NOPE', { username: 'Guest' }, cb);

    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'not_found' });
  });

  it('tournament:add_bot and tournament:remove_bot return bots_disabled', () => {
    const { io } = createIoStub();
    const { socket, handlers } = createSocketStub();
    const addCb = vi.fn();
    const removeCb = vi.fn();
    registerLegacyTournamentHandlers(socket, { io, ...deps });

    handlers['tournament:add_bot']({}, addCb);
    handlers['tournament:remove_bot']({}, removeCb);

    expect(addCb).toHaveBeenCalledWith({ ok: false, error: 'bots_disabled' });
    expect(removeCb).toHaveBeenCalledWith({ ok: false, error: 'bots_disabled' });
  });

  it('tournament:start rejects non-host sockets', () => {
    const { io } = createIoStub();
    const { tournamentsById } = getLegacyTournamentStorage();
    const t = makeTournament({ status: 'lobby', hostSocketId: 'sock-host' });
    tournamentsById.set('t-1', t);

    const { socket, handlers } = createSocketStub({
      id: 'sock-guest',
      data: { tournamentId: 't-1' },
    });
    const cb = vi.fn();
    registerLegacyTournamentHandlers(socket, { io, ...deps });

    handlers['tournament:start'](cb);

    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'not_host' });
  });

  it('returns maybeFinalizeTournamentMatch for hook assignment', () => {
    const { io } = createIoStub();
    const { socket } = createSocketStub();
    const hook = registerLegacyTournamentHandlers(socket, { io, ...deps });
    expect(typeof hook).toBe('function');
  });
});