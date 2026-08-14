/**
 * End-to-end log sequence for one human + Fritz bot QF match (dispatch → attach).
 * Run: npm run test --prefix server -- src/scheduledTournament/tournamentHumanBotFlow.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, getRoom } from '../rooms';
import type { EnginePersistence } from './persistenceInterface';
import type { MatchRow, RegistrationRow, ScheduledTournamentRow } from './types';

const { matchStoreRef, updateMatchMock, capturedLogs } = vi.hoisted(() => ({
  matchStoreRef: { current: null as MatchRow | null },
  updateMatchMock: vi.fn(),
  capturedLogs: [] as Array<{ context: string; msg: string; [k: string]: unknown }>,
}));

vi.mock('../logger', () => ({
  childLogger: (context: string) => ({
    info: (obj: unknown, msg: string) => { capturedLogs.push({ context, msg, ...(typeof obj === 'object' && obj !== null ? obj : {}) }); },
    debug: (obj: unknown, msg: string) => { capturedLogs.push({ context, msg, ...(typeof obj === 'object' && obj !== null ? obj : {}) }); },
    warn: (obj: unknown, msg: string) => { capturedLogs.push({ context, msg, ...(typeof obj === 'object' && obj !== null ? obj : {}) }); },
    error: (obj: unknown, msg: string) => { capturedLogs.push({ context, msg, ...(typeof obj === 'object' && obj !== null ? obj : {}) }); },
  }),
  logger: { child: () => ({}) },
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string) => {
    if (path.includes('scheduled_tournament_matches')) {
      return matchStoreRef.current ? [matchStoreRef.current] : [];
    }
    return [];
  }),
}));

vi.mock('../scheduledTournament/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scheduledTournament/persistence')>();
  return {
    ...actual,
    fetchMatchById: vi.fn(async (id: string) =>
      matchStoreRef.current?.id === id ? { ...matchStoreRef.current } : null,
    ),
    updateMatch: (...args: unknown[]) => updateMatchMock(...args),
  };
});

import { initRoomSession } from '../multiplayer/roomSession';
import { registerRoomSessionHandlers } from '../multiplayer/registerRoomSessionHandlers';
import { dispatchTournamentMatch } from './matchDispatch';

function captureTournamentLogs() {
  capturedLogs.length = 0;
  const toLine = (e: (typeof capturedLogs)[0]) => `[${e.context}] ${e.msg}`;
  const lines = {
    some: (fn: (l: string) => boolean) => capturedLogs.some((e) => fn(toLine(e))),
    filter: (fn: (l: string) => boolean) => capturedLogs.filter((e) => fn(toLine(e))).map(toLine),
  };
  return { lines, restore: () => {} };
}

function makeHumanVsBotPersistence(): {
  persistence: EnginePersistence;
  match: MatchRow;
  humanUserId: string;
} {
  const humanUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tournamentId = '128fffff-ffff-4fff-8fff-ffffffffffff';
  const match: MatchRow = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    tournament_id: tournamentId,
    round: 1,
    match_number: 1,
    player1_id: humanUserId,
    player2_id: `bot:fritz:${tournamentId}:1`,
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
    bot_tier: 'elite',
    player1_score: null,
    player2_score: null,
  };
  const tournament: ScheduledTournamentRow = {
    id: tournamentId,
    scheduled_start: new Date('2026-05-16T01:00:00Z').toISOString(),
    registration_open_at: new Date('2026-05-16T00:30:00Z').toISOString(),
    registration_close_at: new Date('2026-05-16T00:58:00Z').toISOString(),
    status: 'in_progress',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: new Date('2026-05-01T00:00:00Z').toISOString(),
  };
  const store = {
    match: { ...match },
    tournament,
    rooms: new Map<string, { code: string; players: string[]; state?: unknown }>(),
  };
  const persistence: EnginePersistence = {
    fetchTournamentById: async () => ({ ...store.tournament }),
    fetchRegistrations: async () => [] as RegistrationRow[],
    fetchRegistrationsWithProfile: async () => [],
    fetchMatches: async () => [{ ...store.match }],
    fetchMatchById: async (id) => (id === store.match.id ? { ...store.match } : null),
    fetchMatchByRoomCode: async (roomCode) =>
      store.match.room_code === roomCode ? { ...store.match } : null,
    insertMatch: vi.fn(),
    updateMatch: async (id, patch) => {
      if (id === store.match.id) Object.assign(store.match, patch);
    },
    updateRegistrationPlacement: vi.fn(),
    updateRegistrationStatus: vi.fn(),
    updateTournamentStatus: vi.fn(),
    createReservedRoom: (code: string, opts?: { winningScore?: number }) => {
      const room = createReservedRoom(code, opts ?? { winningScore: 30 });
      store.rooms.set(code, room);
      return room;
    },
    getRoom: (code: string) => getRoom(code),
  };
  matchStoreRef.current = store.match;
  updateMatchMock.mockImplementation(async (id: string, patch: Partial<MatchRow>) => {
    if (id === store.match.id) {
      Object.assign(store.match, patch);
      matchStoreRef.current = store.match;
    }
  });

  return { persistence, match: store.match, humanUserId };
}

function makeHumanSocket(userId: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: `sock-${userId.slice(0, 8)}`,
    data: { userId, username: 'human-test' } as Record<string, unknown>,
    rooms: new Set<string>(),
    connected: true,
    on: (event: string, handler: (...args: unknown[]) => void) => {
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
  return { socket: socket as never, handlers };
}

describe('tournament human+bot runtime log sequence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints the expected server log order for dispatch then attach', async () => {
    const { lines, restore } = captureTournamentLogs();
    const { persistence, match, humanUserId } = makeHumanVsBotPersistence();
    const { socket, handlers } = makeHumanSocket(humanUserId);
    const adapterRooms = new Map<string, Set<string>>();
    const io = {
      sockets: {
        sockets: new Map([[socket.id, socket]]),
        adapter: { rooms: adapterRooms },
      },
      to: () => ({ emit: vi.fn() }),
    } as never;
    const joinOrig = socket.join.bind(socket);
    socket.join = (roomCode: string) => {
      joinOrig(roomCode);
      adapterRooms.set(roomCode, new Set([socket.id]));
    };

    initRoomSession(io, {
      resolveSocketIdentity: async () => ({ username: 'human-test', userId: humanUserId }),
      normalizeUsername: (v) => (typeof v === 'string' ? v : 'human-test'),
      normalizeUserId: (v) => (typeof v === 'string' ? v : null),
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

    await dispatchTournamentMatch(io, match.id, { reason: 'bracket_generated' }, persistence);

    const clientLogs: string[] = [];
    const logClient = (line: string, payload?: unknown) => {
      clientLogs.push(payload !== undefined ? `${line} ${JSON.stringify(payload)}` : line);
    };

    const refreshed = await persistence.fetchMatchById(match.id);
    logClient('[tournament] match_ready received', {
      matchId: match.id,
      tournamentId: match.tournament_id,
      roomCode: refreshed?.room_code,
      matchStatus: 'ready',
    });

    logClient('[tournament] attach assigned match start', { matchId: match.id });

    const ack = vi.fn();
    await handlers.get('tournament:attach_assigned_match')?.({ matchId: match.id }, ack);

    const ackArg = ack.mock.calls[0]?.[0] as { ok: boolean; roomCode?: string; error?: string };
    if (ackArg?.ok) {
      logClient('[tournament] attach assigned match success', {
        matchId: match.id,
        roomCode: ackArg.roomCode,
      });
      logClient('[tournament] switching to multiplayer', {
        matchId: match.id,
        roomCode: ackArg.roomCode,
      });
    }

    restore();

    const serverTournamentLines = lines.filter((l) =>
      /\[(?:tournament|multiplayer):(?:tournament-)?(?:dispatch|attach|match|match_ready)\]/.test(l),
    );

    // eslint-disable-next-line no-console
    console.log('\n=== SERVER LOG SEQUENCE (1 human + bot) ===');
    for (const line of serverTournamentLines) {
      // eslint-disable-next-line no-console
      console.log(line);
    }
    // eslint-disable-next-line no-console
    console.log('\n=== CLIENT LOG SEQUENCE (simulated) ===');
    for (const line of clientLogs) {
      // eslint-disable-next-line no-console
      console.log(line);
    }

    expect(ackArg?.ok, ackArg?.error ?? 'attach failed').toBe(true);

    expect(serverTournamentLines.some((l) => l.includes('match ready'))).toBe(true);
    expect(serverTournamentLines.some((l) => l.includes('request'))).toBe(true);
    expect(serverTournamentLines.some((l) => l.includes('ack/success') || l.includes('accepted'))).toBe(true);
    expect(serverTournamentLines.some((l) => l.includes('promoted in_progress'))).toBe(true);
    expect(serverTournamentLines.some((l) => l.includes('match_ready skipped') || l.includes('skipped'))).toBe(false);
  });

  it('logs match_ready skipped when no human socket is connected at dispatch', async () => {
    const { lines, restore } = captureTournamentLogs();
    const { persistence, match } = makeHumanVsBotPersistence();
    const io = { sockets: { sockets: new Map() } } as never;

    await dispatchTournamentMatch(io, match.id, { reason: 'bracket_generated' }, persistence);
    restore();

    expect(lines.some((l) => l.includes('skipped'))).toBe(true);
  });
});
