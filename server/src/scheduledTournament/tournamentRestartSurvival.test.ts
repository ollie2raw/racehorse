/**
 * Tournament rooms across a server restart: restore-or-create in
 * `dispatchTournamentMatch` (via `restoreOrCreateTournamentRoom`) and the
 * live-session overwrite guard.
 *
 * A restart is simulated the way tournamentRestartMidMatch.test.ts does it:
 * a real game is played to a known point, written through the real
 * live-session writer, and then every in-memory store a process restart loses
 * is cleared.
 *
 * Faked: `supabaseFetch`, as an in-memory `room_live_sessions` table (with a
 * read counter and an outage switch), and the scheduled-tournament reads and
 * writes in `./persistence`, with match completion running through the
 * in-memory port of `complete_tournament_match`. Everything else is real.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.stubEnv('TOURNAMENTS_ENABLED', 'true'); });
afterAll(() => { vi.unstubAllEnvs(); });

type Row = Record<string, any>;
const db = vi.hoisted(() => ({
  liveSessions: new Map<string, Record<string, unknown>>(),
  liveSessionReads: 0,
  liveSessionsDown: false,
  matches: new Map<string, Record<string, any>>(),
  tournaments: new Map<string, Record<string, any>>(),
  regs: [] as Array<Record<string, any>>,
}));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
  writeMatchActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../stats/matchLog', () => ({ appendMatch: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../multiplayer/gameOverPersistPolicy', async () => {
  const actual = await vi.importActual<typeof import('../multiplayer/gameOverPersistPolicy')>(
    '../multiplayer/gameOverPersistPolicy',
  );
  return { ...actual, GAME_OVER_PERSIST_RETRY_DELAYS_MS: [0, 0, 0, 0] };
});

vi.mock('../supabaseUtils', () => ({
  isSupabaseTimeoutError: () => false,
  supabaseFetch: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path.startsWith('/rest/v1/room_live_sessions')) {
      if (db.liveSessionsDown) throw new Error('fetch failed: connect ECONNREFUSED');
      if (method === 'POST') {
        for (const row of JSON.parse(init!.body!) as Array<Record<string, unknown>>) {
          db.liveSessions.set(String(row.room_code), structuredClone(row));
        }
        return [];
      }
      const code = decodeURIComponent(/room_code=eq\.([^&]+)/.exec(path)![1]);
      if (method === 'DELETE') {
        db.liveSessions.delete(code);
        return [];
      }
      db.liveSessionReads += 1;
      const row = db.liveSessions.get(code);
      return row ? [structuredClone(row)] : [];
    }
    return [];
  }),
}));

vi.mock('./persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./persistence')>();
  const { inMemoryMatchRpcForArrayStore } = await vi.importActual<
    typeof import('./inMemoryMatchRpc.testkit')
  >('./inMemoryMatchRpc.testkit');
  const rpc = () =>
    inMemoryMatchRpcForArrayStore({
      get tournament() {
        return [...db.tournaments.values()][0] as any;
      },
      get matches() {
        return [...db.matches.values()] as any;
      },
      get regs() {
        return db.regs as any;
      },
    });
  return {
    ...actual,
    fetchMatchById: async (id: string) => structuredClone(db.matches.get(id) ?? null),
    fetchMatchByRoomCode: async (code: string) =>
      structuredClone([...db.matches.values()].find((m) => m.room_code === code) ?? null),
    fetchMatches: async (tournamentId: string) =>
      [...db.matches.values()].filter((m) => m.tournament_id === tournamentId).map((m) => structuredClone(m)),
    fetchTournamentById: async (id: string) => structuredClone(db.tournaments.get(id) ?? null),
    fetchTournamentsByStatus: async (statuses: string[]) =>
      [...db.tournaments.values()].filter((t) => statuses.includes(String(t.status))).map((t) => structuredClone(t)),
    fetchRegistrations: async () => structuredClone(db.regs),
    fetchRegistrationsWithProfile: async () => [],
    updateMatch: async (id: string, patch: Record<string, unknown>) => {
      const row = db.matches.get(id);
      if (row) Object.assign(row, patch);
    },
    completeTournamentMatch: (params: Parameters<typeof actual.completeTournamentMatch>[0]) =>
      rpc().completeTournamentMatch(params),
    promoteTournamentMatch: (...args: Parameters<typeof actual.promoteTournamentMatch>) =>
      rpc().promoteTournamentMatch(...args),
  };
});

import type { Server } from 'socket.io';
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
  getRoomRoster,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
  type GameOverPersistInput,
} from '../multiplayer/roomSession';
import { registerRoomSessionHandlers } from '../multiplayer/registerRoomSessionHandlers';
import { seatSyntheticBotInRoom } from '../multiplayer/botSeating';
import {
  deleteLiveRoomSession,
  finalizeAndDeleteLiveRoomSession,
  loadLiveRoomSession,
  persistLiveRoomSessionNow,
  resetLiveRoomPersistenceForTests,
} from '../multiplayer/roomLivePersistence';
import { createGameOverPersistScheduler } from '../realtime/gameOverPersistence';
import { recoverTournamentMatches } from './recovery';
import { reconcileExpiredReadyMatches } from './engine';
import { dispatchTournamentMatch } from './matchDispatch';

const T = '7b000000-0000-4000-8000-000000000001';
const U1 = '7b000000-0000-4000-8000-0000000000a1';
const U2 = '7b000000-0000-4000-8000-0000000000a2';
const BOT = `bot:fritz:${T}:8`;

let seq = 0;
let socketSeq = 0;

function makeSocket(userId: string) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    id: `sock-${userId}-${++socketSeq}`,
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

/** Everything a process restart loses. */
function restart() {
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initSession();
}

function baseMatch(id: string, roomCode: string, partial: Row = {}): Row {
  return {
    id,
    tournament_id: T,
    round: 1,
    match_number: 1,
    player1_id: U1,
    player2_id: U2,
    winner_id: null,
    room_code: roomCode,
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
    ...partial,
  };
}

type Seeded = {
  roomCode: string;
  matchId: string;
  sf1Id: string;
  seats: Record<string, string>;
  storedMatchId: string;
};

/**
 * A tournament match with its room, seated in `joinOrder` the way production
 * seats it (bots at dispatch, humans on attach). With `played`, a game is
 * started and advanced to 20-10 in hand 3, then persisted; without it, nothing
 * is persisted. Then the process "restarts".
 */
async function seed(opts: {
  matchStatus?: 'ready' | 'in_progress' | 'completed';
  joinOrder?: string[];
  player2?: string;
  played?: boolean;
  matchPatch?: Row;
}): Promise<Seeded> {
  seq += 1;
  const roomCode = `TC${(0xc0000 + seq).toString(16).toUpperCase()}R1M1`;
  const matchId = `7b000000-0000-4000-8000-${String(100000000000 + seq)}`;
  const nowMs = Date.now();
  const player2 = opts.player2 ?? U2;
  db.tournaments.set(T, {
    id: T,
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
  db.matches.set(matchId, baseMatch(matchId, roomCode, {
    player2_id: player2,
    bot_tier: player2 === BOT ? 'standard' : null,
    status: opts.matchStatus ?? 'in_progress',
    ready_at: startedAt,
    ready_deadline_at: new Date(nowMs + 60_000).toISOString(),
    started_at: opts.matchStatus === 'ready' ? null : startedAt,
    player1_joined_at: startedAt,
    player2_joined_at: player2 === BOT ? null : startedAt,
    ...opts.matchPatch,
  }));
  db.matches.set(`sf1-${seq}`, baseMatch(`sf1-${seq}`, '', {
    round: 2, match_number: 1, player1_id: null, player2_id: null, status: 'waiting',
  }));
  db.regs = [
    { id: 'r1', tournament_id: T, user_id: U1, registered_at: startedAt, seed: 1, placement: null, status: 'active' },
    ...(player2 === BOT ? [] : [{ id: 'r2', tournament_id: T, user_id: U2, registered_at: startedAt, seed: 2, placement: null, status: 'active' }]),
  ];

  const room = createReservedRoom(roomCode, { winningScore: 30 });
  room.scheduledTournamentMatchId = matchId;
  room.scheduledTournamentId = T;
  const seats: Record<string, string> = {};
  for (const player of opts.joinOrder ?? [U1, player2]) {
    if (player === BOT) {
      seatSyntheticBotInRoom(roomCode, BOT, 'Fritz');
      seats[BOT] = BOT;
    } else {
      const seatId = `seat-${player.slice(-2)}-${seq}`;
      joinRoom(roomCode, seatId);
      setRoomRoster(roomCode, [
        ...getRoomRoster(roomCode),
        { id: seatId, socketId: '', username: `u${player.slice(-1)}`, userId: player },
      ]);
      seats[player] = seatId;
    }
  }
  if (opts.played !== false) {
    await startGameUnlocked(roomCode, makeIo());
    const live = getRoom(roomCode);
    const [s1, s2] = [seats[U1], seats[player2]];
    live.state = {
      ...live.state!,
      handNumber: 3,
      players: {
        ...live.state!.players,
        [s1]: { ...live.state!.players[s1], score: 20 },
        [s2]: { ...live.state!.players[s2], score: 10 },
      },
    };
    const ok = await persistLiveRoomSessionNow(
      live,
      getRoomRoster(roomCode).map((p) => ({ seatId: p.id, userId: p.userId, username: p.username })),
    );
    expect(ok).toBe(true);
  }
  const storedMatchId = String(db.liveSessions.get(roomCode)?.match_id ?? '');
  restart();
  db.liveSessionReads = 0;
  expect(peekRoom(roomCode)).toBeUndefined();
  return { roomCode, matchId, sf1Id: `sf1-${seq}`, seats, storedMatchId };
}

async function attach(userId: string, matchId: string) {
  const { socket, handlers } = makeSocket(userId);
  registerRoomSessionHandlers(makeIo([socket]), socket);
  const ack = vi.fn();
  await handlers.get('tournament:attach_assigned_match')?.({ matchId }, ack);
  return ack.mock.calls[0]?.[0] as Record<string, any>;
}

/** The game in memory for this room: hand and each player's score, keyed by player id. */
function game(roomCode: string, seats: Record<string, string>) {
  const state = peekRoom(roomCode)?.state;
  if (!state) return null;
  return {
    handNumber: state.handNumber,
    scores: Object.fromEntries(Object.entries(seats).map(([player, seat]) => [player, state.players[seat]?.score ?? null])),
    playerIds: [...state.playerIds].sort(),
  };
}

const RESTORED = (seats: Record<string, string>, p2: string) => ({
  handNumber: 3,
  scores: { [U1]: 20, [p2]: 10 },
  playerIds: Object.values(seats).sort(),
});

describe('tournament rooms survive a server restart', () => {
  beforeEach(() => {
    db.liveSessions.clear();
    db.matches.clear();
    db.tournaments.clear();
    db.regs = [];
    db.liveSessionReads = 0;
    db.liveSessionsDown = false;
    restart();
  });
  afterEach(() => {
    restart();
  });

  it('one player reattaches: the stored game is restored and they get their seat back', async () => {
    const s = await seed({});

    const ack = await attach(U1, s.matchId);

    expect(ack).toMatchObject({ ok: true, you: s.seats[U1], matchStarted: true });
    expect(game(s.roomCode, s.seats)).toEqual(RESTORED(s.seats, U2));
  });

  it('both players reattach one after the other: the game continues, no new deal', async () => {
    const s = await seed({});

    const a1 = await attach(U1, s.matchId);
    const a2 = await attach(U2, s.matchId);

    expect([a1.you, a2.you]).toEqual([s.seats[U1], s.seats[U2]]);
    expect(game(s.roomCode, s.seats)).toEqual(RESTORED(s.seats, U2));
    expect(getRoom(s.roomCode).matchId).toBe(s.storedMatchId);
  });

  it('both players reattach concurrently: one restore, one room, both seats back', async () => {
    const s = await seed({});

    const [a1, a2] = await Promise.all([attach(U1, s.matchId), attach(U2, s.matchId)]);

    expect([a1.ok, a2.ok]).toEqual([true, true]);
    expect([a1.you, a2.you]).toEqual([s.seats[U1], s.seats[U2]]);
    expect(db.liveSessionReads).toBe(1);
    expect(game(s.roomCode, s.seats)).toEqual(RESTORED(s.seats, U2));
  });

  it('boot recovery restores the stored game; it never creates an empty room over it', async () => {
    const s = await seed({});

    await recoverTournamentMatches(makeIo());

    expect(game(s.roomCode, s.seats)).toEqual(RESTORED(s.seats, U2));
    expect(db.liveSessions.get(s.roomCode)?.match_id).toBe(s.storedMatchId);
  });

  it('boot recovery and a scheduler tick run concurrently: one restore, one room', async () => {
    // A match the scheduler still sees as ready (the restart fell between the
    // game starting and its in_progress write), past its deadline, both joined.
    const s = await seed({
      matchStatus: 'ready',
      matchPatch: { ready_deadline_at: new Date(Date.now() - 60_000).toISOString() },
    });
    const io = makeIo();

    await Promise.all([
      recoverTournamentMatches(io),
      reconcileExpiredReadyMatches(io, new Date(), undefined, [structuredClone(db.tournaments.get(T)!) as any]),
    ]);

    expect(db.liveSessionReads).toBe(1);
    expect(game(s.roomCode, s.seats)).toEqual(RESTORED(s.seats, U2));
    expect(db.matches.get(s.matchId)).toMatchObject({ winner_id: null });
    expect(db.matches.get(s.matchId)?.status).not.toBe('completed');
  });

  it('scheduler no-show reconciler, room missing: restores the stored game rather than re-dealing', async () => {
    const s = await seed({
      matchStatus: 'ready',
      matchPatch: { ready_deadline_at: new Date(Date.now() - 60_000).toISOString() },
    });

    await reconcileExpiredReadyMatches(makeIo(), new Date(), undefined, [structuredClone(db.tournaments.get(T)!) as any]);

    expect(game(s.roomCode, s.seats)).toEqual(RESTORED(s.seats, U2));
    expect(db.matches.get(s.matchId)).toMatchObject({
      winner_id: null,
      status_reason: 'room_rehydrated_deadline_extended',
    });
    expect(Date.parse(db.matches.get(s.matchId)!.ready_deadline_at)).toBeGreaterThan(Date.now());
  });

  it('a ready match that never started still re-dispatches normally: fresh room, match_ready, deadline kept', async () => {
    const s = await seed({ matchStatus: 'ready', played: false });
    const deadline = db.matches.get(s.matchId)!.ready_deadline_at;
    const { socket } = makeSocket(U1);
    const io = makeIo([socket]);

    await recoverTournamentMatches(io);

    const room = peekRoom(s.roomCode);
    expect(room).toBeDefined();
    expect(room!.state).toBeNull();
    expect(room!.scheduledTournamentMatchId).toBe(s.matchId);
    expect(socket.emit).toHaveBeenCalledWith('tournament:match_ready', expect.objectContaining({ matchId: s.matchId }));
    expect(db.matches.get(s.matchId)!.ready_deadline_at).toBe(deadline);
  });

  it('no stored session: dispatch creates a fresh room as before', async () => {
    const s = await seed({ played: false });

    const result = await dispatchTournamentMatch(makeIo(), s.matchId, { reason: 'repair' });

    expect(result.roomCode).toBe(s.roomCode);
    expect(peekRoom(s.roomCode)?.state).toBeNull();
    expect(db.liveSessionReads).toBe(1);
  });

  it('a completed match with a stale stored session is not resurrected', async () => {
    const s = await seed({});
    Object.assign(db.matches.get(s.matchId)!, {
      status: 'completed', winner_id: U1, completed_at: new Date().toISOString(),
    });

    await recoverTournamentMatches(makeIo());
    await expect(dispatchTournamentMatch(makeIo(), s.matchId, { reason: 'repair' })).rejects.toThrow('match_invalid_state');
    const ack = await attach(U1, s.matchId);

    expect(ack).toMatchObject({ ok: false, error: 'match_completed' });
    expect(peekRoom(s.roomCode)).toBeUndefined();
    expect(db.liveSessionReads).toBe(0);
  });

  it('the live-session store is unreachable: dispatch fails loudly and creates no room', async () => {
    const s = await seed({});
    db.liveSessionsDown = true;

    await expect(dispatchTournamentMatch(makeIo(), s.matchId, { reason: 'repair' })).rejects.toThrow('room_persistence_unavailable');

    expect(peekRoom(s.roomCode)).toBeUndefined();
  });

  it('overwrite guard: a room for another match cannot replace or delete a stored game in progress', async () => {
    const s = await seed({});
    const loaded = await loadLiveRoomSession(s.roomCode);
    expect(loaded.kind).toBe('found');

    // An empty room for the same code, as the pre-fix dispatch made, then a new deal.
    const intruder = createReservedRoom(s.roomCode, { winningScore: 30 });
    intruder.scheduledTournamentMatchId = s.matchId;
    intruder.scheduledTournamentId = T;
    joinRoom(s.roomCode, 'seat-x1');
    joinRoom(s.roomCode, 'seat-x2');
    const roster = [
      { seatId: 'seat-x1', userId: U1, username: 'x1' },
      { seatId: 'seat-x2', userId: U2, username: 'x2' },
    ];
    setRoomRoster(s.roomCode, roster.map((r) => ({ id: r.seatId, socketId: '', username: r.username, userId: r.userId })));

    // The new deal's own save is refused, so the deal itself fails...
    await expect(startGameUnlocked(s.roomCode, makeIo())).rejects.toThrow("couldn't be saved");
    // ...and a direct write or a finalize-and-delete is refused too.
    expect(await persistLiveRoomSessionNow(getRoom(s.roomCode), roster)).toBe(false);
    await finalizeAndDeleteLiveRoomSession(getRoom(s.roomCode), 'abandoned');
    const stored = db.liveSessions.get(s.roomCode) as Row;
    expect(stored.match_id).toBe(s.storedMatchId);
    expect(stored.game_state.handNumber).toBe(3);

    // Only an explicit reset lifts it.
    await deleteLiveRoomSession(s.roomCode);
    expect(await persistLiveRoomSessionNow(getRoom(s.roomCode), roster)).toBe(true);
    expect(db.liveSessions.get(s.roomCode)?.match_id).toBe(getRoom(s.roomCode).matchId);
  });

  describe.each([
    { order: 'Fritz seated first', joinOrder: [BOT, U1] },
    { order: 'Fritz seated second', joinOrder: [U1, BOT] },
  ])('restored human-vs-Fritz game finished after the restart ($order)', ({ joinOrder }) => {
    it.each([
      { who: 'human wins', winner: U1, loser: BOT },
      { who: 'Fritz wins', winner: BOT, loser: U1 },
    ])('$who: result recorded on the right row slots and the winner advances', async ({ winner, loser }) => {
      const s = await seed({ player2: BOT, joinOrder });
      await recoverTournamentMatches(makeIo());
      await attach(U1, s.matchId);
      expect(game(s.roomCode, s.seats)).toEqual(RESTORED(s.seats, BOT));

      // Finish the restored game and hand it to game over as broadcastStateUpdate does.
      const room = getRoom(s.roomCode);
      room.state = {
        ...room.state!,
        gameOver: true,
        winnerId: s.seats[winner],
        players: {
          ...room.state!.players,
          [s.seats[winner]]: { ...room.state!.players[s.seats[winner]], score: 33 },
          [s.seats[loser]]: { ...room.state!.players[s.seats[loser]], score: 21 },
        },
      };
      const byId = new Map(getRoomRoster(s.roomCode).map((p) => [p.id, p]));
      const [aId, bId] = room.state.playerIds;
      const input: GameOverPersistInput = {
        room,
        sourceMatchId: room.matchId,
        cfg: room.config as any,
        aId,
        bId,
        a: byId.get(aId)!,
        b: byId.get(bId)!,
        scoreA: room.state.players[aId].score,
        scoreB: room.state.players[bId].score,
        winnerSeatId: s.seats[winner],
      };

      const outcome = await createGameOverPersistScheduler(makeIo() as Server)(input)();

      expect(outcome).toBe('succeeded');
      expect(db.matches.get(s.matchId)).toMatchObject({
        status: 'completed',
        winner_id: winner,
        player1_score: winner === U1 ? 33 : 21,
        player2_score: winner === BOT ? 33 : 21,
      });
      expect(db.matches.get(s.sf1Id)?.player1_id).toBe(winner);
    });
  });
});
