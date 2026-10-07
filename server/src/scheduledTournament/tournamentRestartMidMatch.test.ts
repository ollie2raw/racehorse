/**
 * Reproduction: a server restart while a tournament match is in progress.
 *
 * Before the "restart" a real room plays a real game, which is then advanced
 * to scores 20-10 in hand 3 and written through the real live-session writer
 * (`persistLiveRoomSessionNow`). The restart clears everything a process
 * restart loses (rooms, rosters, reconnect seats, persistence caches). Then:
 *
 *   - control: the restore function (`ensureRoomHydrated`) alone brings back
 *     the persisted game, which shows the fake table below is faithful;
 *   - `tournament:attach_assigned_match`, with and without boot recovery
 *     (`recoverTournamentMatches`, which runs 2 s after a real boot) first,
 *     and with both players attaching;
 *   - the client's connection-recovery `room:join`, before and after boot
 *     recovery.
 *
 * Every case asserts the CORRECT behavior: the persisted scores and hand come
 * back and no new game is dealt.
 *
 * Faked: `supabaseFetch`, as an in-memory `room_live_sessions` table (the real
 * writer upserts into it, the real loader reads from it; every other path
 * answers []), and the scheduled-tournament row reads/writes in
 * `../scheduledTournament/persistence`. Everything else is real: rooms,
 * live-session serialization and validation, `applyLiveSessionRow`,
 * `dispatchTournamentMatch`, `recoverTournamentMatches` and the
 * `tournament:attach_assigned_match` handler.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.stubEnv('TOURNAMENTS_ENABLED', 'true'); });
afterAll(() => { vi.unstubAllEnvs(); });

const liveSessions = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const matchRows = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const tournamentRows = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('../supabaseUtils', () => ({
  isSupabaseTimeoutError: () => false,
  supabaseFetch: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path.startsWith('/rest/v1/room_live_sessions')) {
      if (method === 'POST') {
        for (const row of JSON.parse(init!.body!) as Array<Record<string, unknown>>) {
          liveSessions.set(String(row.room_code), structuredClone(row));
        }
        return [];
      }
      if (method === 'DELETE') {
        const code = decodeURIComponent(/room_code=eq\.([^&]+)/.exec(path)![1]);
        liveSessions.delete(code);
        return [];
      }
      const code = decodeURIComponent(/room_code=eq\.([^&]+)/.exec(path)![1]);
      const row = liveSessions.get(code);
      return row ? [structuredClone(row)] : [];
    }
    return [];
  }),
}));

vi.mock('../scheduledTournament/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scheduledTournament/persistence')>();
  return {
    ...actual,
    fetchMatchById: async (id: string) => structuredClone(matchRows.get(id) ?? null),
    fetchMatchByRoomCode: async (code: string) =>
      structuredClone([...matchRows.values()].find((m) => m.room_code === code) ?? null),
    fetchMatches: async (tournamentId: string) =>
      [...matchRows.values()].filter((m) => m.tournament_id === tournamentId).map((m) => structuredClone(m)),
    fetchTournamentById: async (id: string) => structuredClone(tournamentRows.get(id) ?? null),
    fetchTournamentsByStatus: async (statuses: string[]) =>
      [...tournamentRows.values()].filter((t) => statuses.includes(String(t.status))),
    updateMatch: async (id: string, patch: Record<string, unknown>) => {
      const row = matchRows.get(id);
      if (row) Object.assign(row, patch);
    },
  };
});

import {
  createReservedRoom,
  getRoom,
  joinRoom,
  peekRoom,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
  startGameUnlocked,
} from '../rooms';
import {
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from '../multiplayer/roomSession';
import { registerRoomSessionHandlers } from '../multiplayer/registerRoomSessionHandlers';
import {
  ensureRoomHydrated,
  persistLiveRoomSessionNow,
  resetLiveRoomPersistenceForTests,
} from '../multiplayer/roomLivePersistence';
import { recoverTournamentMatches } from './recovery';

const TOURNAMENT_ID = '9a000000-0000-4000-8000-000000000001';
const MATCH_ID = '9a000000-0000-4000-8000-000000000002';
const U1 = '9a000000-0000-4000-8000-0000000000a1';
const U2 = '9a000000-0000-4000-8000-0000000000a2';
const SEAT1 = 'seat-u1';
const SEAT2 = 'seat-u2';

function makeSocket(userId: string) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    id: `sock-${userId}`,
    data: { userId, username: `user-${userId.slice(-2)}` } as Record<string, unknown>,
    rooms: new Set<string>(),
    connected: true,
    on: (event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    join: (roomCode: string) => { socket.rooms.add(roomCode); },
    leave: (roomCode: string) => { socket.rooms.delete(roomCode); },
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  socket.rooms.add(socket.id);
  return { socket: socket as any, handlers };
}

function makeIo(sockets: any[] = []) {
  return {
    sockets: { sockets: new Map(sockets.map((s) => [s.id, s])), adapter: { rooms: new Map() } },
    to: () => ({ emit: vi.fn() }),
    emit: vi.fn(),
  } as any;
}

function initSession() {
  initRoomSession(
    makeIo(),
    {
      // room:join identity (production verifies the auth token); the payload's userId here.
      resolveSocketIdentity: async (config: { userId?: unknown }) => ({
        username: 'Player',
        userId: typeof config?.userId === 'string' ? config.userId : null,
      }),
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
    } as any,
  );
}

/** Everything a process restart loses: rooms, rosters, reconnect seats, persistence caches. */
function resetAll() {
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
}

let roomSeq = 0;

/**
 * Before the restart: a tournament room mid-game (20-10, hand 3), persisted
 * through the real live-session writer, with its rows in the fake stores.
 */
async function seedMatchInProgressThenRestart(): Promise<{ roomCode: string; matchSequence: number; matchId: string }> {
  roomSeq += 1;
  const roomCode = `TA${(0xb0000 + roomSeq).toString(16).toUpperCase()}R1M1`;
  const nowMs = Date.now();
  tournamentRows.set(TOURNAMENT_ID, {
    id: TOURNAMENT_ID,
    scheduled_start: new Date(nowMs - 10 * 60_000).toISOString(),
    registration_open_at: new Date(nowMs - 40 * 60_000).toISOString(),
    registration_close_at: new Date(nowMs - 12 * 60_000).toISOString(),
    status: 'in_progress',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: new Date(nowMs - 86_400_000).toISOString(),
  });
  const startedAt = new Date(nowMs - 8 * 60_000).toISOString();
  matchRows.set(MATCH_ID, {
    id: MATCH_ID,
    tournament_id: TOURNAMENT_ID,
    round: 1,
    match_number: 1,
    player1_id: U1,
    player2_id: U2,
    winner_id: null,
    room_code: roomCode,
    status: 'in_progress',
    ready_at: startedAt,
    ready_deadline_at: new Date(nowMs - 6 * 60_000).toISOString(),
    started_at: startedAt,
    completed_at: null,
    player1_joined_at: startedAt,
    player2_joined_at: startedAt,
    winner_source: null,
    status_reason: null,
    forfeit_user_id: null,
    no_show_user_id: null,
    bot_tier: null,
    player1_score: null,
    player2_score: null,
  });

  const room = createReservedRoom(roomCode, { winningScore: 30 });
  room.scheduledTournamentMatchId = MATCH_ID;
  room.scheduledTournamentId = TOURNAMENT_ID;
  joinRoom(roomCode, SEAT1);
  joinRoom(roomCode, SEAT2);
  const roster = [
    { id: SEAT1, socketId: '', username: 'u1', userId: U1 },
    { id: SEAT2, socketId: '', username: 'u2', userId: U2 },
  ];
  setRoomRoster(roomCode, roster);
  await startGameUnlocked(roomCode, makeIo());
  const live = getRoom(roomCode);
  // Mid-game: 20-10 in hand 3.
  live.state = {
    ...live.state!,
    handNumber: 3,
    players: {
      ...live.state!.players,
      [SEAT1]: { ...live.state!.players[SEAT1], score: 20 },
      [SEAT2]: { ...live.state!.players[SEAT2], score: 10 },
    },
  };
  const persisted = await persistLiveRoomSessionNow(
    live,
    roster.map((p) => ({ seatId: p.id, userId: p.userId, username: p.username })),
  );
  expect(persisted).toBe(true);
  const matchSequence = live.state!.sequence;

  // ── restart: every in-memory room and runtime cache is gone ──
  resetAll();
  initSession();
  expect(peekRoom(roomCode)).toBeUndefined();
  return { roomCode, matchSequence, matchId: MATCH_ID };
}

async function attachAs(userId: string, matchId: string) {
  const { socket, handlers } = makeSocket(userId);
  const io = makeIo([socket]);
  registerRoomSessionHandlers(io, socket);
  const ack = vi.fn();
  await handlers.get('tournament:attach_assigned_match')?.({ matchId }, ack);
  return ack.mock.calls[0]?.[0] as Record<string, any> | undefined;
}

/** The client's connection-recovery rejoin: `room:join` for the room it was in. */
async function roomJoinAs(userId: string, roomCode: string) {
  const { socket, handlers } = makeSocket(userId);
  const io = makeIo([socket]);
  registerRoomSessionHandlers(io, socket);
  const ack = vi.fn();
  await handlers.get('room:join')?.(roomCode, { username: 'Player', userId }, ack);
  return ack.mock.calls[0]?.[0] as Record<string, any> | undefined;
}

function expectRestored(roomCode: string, matchSequence: number, ack: Record<string, any> | undefined) {
  const state = peekRoom(roomCode)?.state ?? null;
  expect({
    ackOk: ack?.ok,
    handNumber: state?.handNumber ?? null,
    seat1Score: state?.players[SEAT1]?.score ?? null,
    seat2Score: state?.players[SEAT2]?.score ?? null,
    sequenceAtLeastPersisted: (state?.sequence ?? -1) >= matchSequence,
  }).toEqual({
    ackOk: true,
    handNumber: 3,
    seat1Score: 20,
    seat2Score: 10,
    sequenceAtLeastPersisted: true,
  });
}

describe('tournament match in progress across a server restart', () => {
  beforeEach(() => {
    liveSessions.clear();
    matchRows.clear();
    tournamentRows.clear();
    resetAll();
    initSession();
  });

  afterEach(() => {
    resetAll();
  });

  it('control: the restore function alone brings back the persisted game (fake table is faithful)', async () => {
    const { roomCode, matchSequence } = await seedMatchInProgressThenRestart();

    const hydrated = await ensureRoomHydrated(roomCode);

    expect(hydrated.kind).toBe('hydrated');
    expectRestored(roomCode, matchSequence, { ok: true });
  });

  it('attach after a restart (no boot recovery): the persisted game is restored', async () => {
    const { roomCode, matchSequence, matchId } = await seedMatchInProgressThenRestart();

    const ack = await attachAs(U1, matchId);

    expectRestored(roomCode, matchSequence, ack);
  });

  it('boot recovery then attach: the persisted game is restored', async () => {
    const { roomCode, matchSequence, matchId } = await seedMatchInProgressThenRestart();

    // As index.ts does 2 s after boot.
    await recoverTournamentMatches(makeIo());
    const ack = await attachAs(U1, matchId);

    expectRestored(roomCode, matchSequence, ack);
  });

  it('boot recovery then both players attach: the game continues at 20-10, not re-dealt at 0-0', async () => {
    const { roomCode, matchSequence, matchId } = await seedMatchInProgressThenRestart();

    await recoverTournamentMatches(makeIo());
    await attachAs(U1, matchId);
    const ack = await attachAs(U2, matchId);

    expectRestored(roomCode, matchSequence, ack);
  });

  it('client room:join BEFORE boot recovery runs: the persisted game is restored', async () => {
    const { roomCode, matchSequence } = await seedMatchInProgressThenRestart();

    const ack = await roomJoinAs(U1, roomCode);
    await recoverTournamentMatches(makeIo());

    expectRestored(roomCode, matchSequence, ack);
  });

  it('client room:join AFTER boot recovery runs: the persisted game is restored', async () => {
    const { roomCode, matchSequence } = await seedMatchInProgressThenRestart();

    await recoverTournamentMatches(makeIo());
    const ack = await roomJoinAs(U1, roomCode);

    expectRestored(roomCode, matchSequence, ack);
  });
});
