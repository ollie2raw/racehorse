/**
 * Step 5 — System 2 (multiplayer rooms) invariant harness (HARDENING_PLAN.md §2.6).
 *
 * Analogous to System 1's PR-F (`concurrencyRecoveryHarness.test.ts`) +
 * PR-E helper: it proves the *observable consequences* of the MP-INV-* rules,
 * with each test naming the invariant and the exact assertion that maps to its
 * stated rule.
 *
 * SCOPE this pass (per the human): the invariants whose enforcement CHANGED
 * this session and now needs proof —
 *   - MP-INV-6  — spectator gating (shipped as MP-G3)
 *   - MP-INV-15 — idempotent game-over side-effects (shipped as MP-G4 + MP-G6)
 * plus a focused check of MP-INV-1..3 (seat / identity binding), which were
 * already solid but are the load-bearing base for everything else.
 *
 * SCOPE BOUNDARY (same spirit as PR-F): everything here runs in-process against
 * `mpSideEffectStore.testkit.ts` — a faithful JS port of the unique
 * constraints / conditional PATCH the two 2026-09-01 MP-G4 migrations add. A
 * green run proves the Node-side idempotency logic; the Postgres partial unique
 * indexes themselves were verified separately (pg16 apply + prod insert/DELETE
 * round-trip, changelog 2026-09-01). No local-pg16 script is needed this pass —
 * nothing here depends on real row locking (single-instance deployment, §2.1.1).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// mocks — keep the four real side-effect helpers, replace only their sinks +
// the deep game-over deps (mirrors gameOverPersistence.test.ts, inverted).
// ---------------------------------------------------------------------------

const capturedLogs: Array<{ msg?: string; [k: string]: unknown }> = [];

vi.mock('./mpSideEffectStore.testkit', async (orig) => orig()); // identity — keep the singleton

vi.mock('../supabaseUtils', async () => {
  const { mpTestStore } = await import('./mpSideEffectStore.testkit');
  return { supabaseFetch: (...a: unknown[]) => (mpTestStore.supabaseFetch as (...x: unknown[]) => unknown)(...a) };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: typeof import('node:fs') };
  const { mpTestStore } = await import('./mpSideEffectStore.testkit');
  const isMatchLog = (p: unknown) => typeof p === 'string' && p.endsWith('matches.jsonl');
  return {
    default: {
      ...actual.default,
      promises: {
        ...actual.default.promises,
        mkdir: (async (p: string, o: unknown) =>
          isMatchLog(p) ? undefined : actual.default.promises.mkdir(p, o as never)) as never,
        appendFile: (async (p: string, data: string, o: unknown) =>
          isMatchLog(p)
            ? mpTestStore.fs.promises.appendFile(p, data)
            : actual.default.promises.appendFile(p, data, o as never)) as never,
        readFile: (async (p: string, o: unknown) =>
          isMatchLog(p)
            ? mpTestStore.fs.promises.readFile()
            : actual.default.promises.readFile(p, o as never)) as never,
      },
    },
  };
});

const completeGhostGameMock = vi.fn();
vi.mock('../ghost/service', () => ({ completeGhostGame: (...a: unknown[]) => completeGhostGameMock(...a) }));
vi.mock('../ghost/verifier', () => ({ verifyPlayerMoveLog: vi.fn(() => ({ ok: true })) }));
vi.mock('../ranking/periodService', () => ({ processRealtimeMultiplayerGame: vi.fn(async () => ({ playerA: { delta: 1 }, playerB: { delta: -1 } })) }));
vi.mock('../ranking/insertRankedGameIdempotent', () => ({
  insertRankedGameIdempotent: vi.fn(async () => ({ isNew: false, game: null })),
}));
vi.mock('../scheduledTournament', () => ({
  applyTournamentGameOverFromRoom: vi.fn(async () => false),
  findTournamentMatchByRoom: vi.fn(async () => null),
}));
vi.mock('../shared/fritzMatchLifecycle', () => ({
  getPendingFritzMatchContext: vi.fn(() => null),
  resolvePendingFritzMatch: vi.fn(async () => undefined),
  formatFritzActivityOpponentLabel: (t: string) => `Fritz (${t})`,
}));
vi.mock('./mpAuthorityTelemetry', () => ({ emitMpAuthorityFunnel: vi.fn(), resolveMpAuthoritySourceType: () => 'private' }));
vi.mock('../logger', () => ({
  childLogger: () => ({
    info: (o: unknown, m: string) => capturedLogs.push({ msg: m, ...(o as object) }),
    warn: (o: unknown, m: string) => capturedLogs.push({ msg: m, ...(o as object) }),
    error: (o: unknown, m: string) => capturedLogs.push({ msg: m, ...(o as object) }),
    debug: () => {},
  }),
  logger: { child: () => ({}) },
}));

import type { Server } from 'socket.io';
import { mpTestStore, resetMpTestStore } from './mpSideEffectStore.testkit';
import { appendMatch } from '../stats/matchLog';
import { recordPublicOnlineMatch } from '../stats/recordPublicMatch';
import { writeMatchActivity } from '../social/activityWriter';
import { recordMatchEnd } from '../matchmaking/persistence';
import { createGameOverPersistScheduler } from '../realtime/gameOverPersistence';
import type { GameOverPersistInput } from './roomSession';
import { createInitialRoomDurabilityState } from './roomDurability';
import type { Room } from '../rooms';
import {
  createReservedRoom,
  getRoom,
  joinRoom,
  resetRoomRuntimeForTests,
} from '../rooms';
import {
  initRoomSession,
  migrateRoomSeat,
  resetRoomSessionStoresForTests,
  resolveActorSeatId,
  setRoomRoster,
} from './roomSession';
import { registerRoomSpectateHandlers } from './registerRoomSpectateHandlers';

const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;

beforeEach(() => {
  vi.clearAllMocks();
  capturedLogs.length = 0;
  resetMpTestStore();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  completeGhostGameMock.mockResolvedValue(undefined);
});

// ===========================================================================
// MP-INV-6 — Spectators see only masked state, and only where spectating is
// allowed.  Rule (§2.2): a spectator socket must be authenticated; a private
// room is not spectatable unless it opted in (`config.spectatable`);
// matchmaking / scheduled-tournament / legacy-league rooms are spectatable.
// Enforced by: registerRoomSpectateHandlers.ts (MP-G3).
// ===========================================================================

describe('MP-INV-6 — spectate gating (MP-G3)', () => {
  function wireSpectate(userId: string | null) {
    const leaveExistingSocketRooms = vi.fn(async () => undefined);
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const socket = {
      id: `sock-${userId ?? 'anon'}`,
      data: {} as Record<string, unknown>,
      rooms: new Set<string>(),
      on: (e: string, h: (...a: unknown[]) => unknown) => { handlers.set(e, h); return socket; },
      join: vi.fn((c: string) => socket.rooms.add(c)),
      emit: vi.fn(),
    };
    initRoomSession(io, {
      resolveSocketIdentity: async () => ({ username: 'Spec', userId }),
      normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
      normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped',
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      persistRoomMatchLog: async () => undefined,
      onGameOver: () => null,
    } as never);
    registerRoomSpectateHandlers(socket as never, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'Spec', userId }),
      } as never,
      leaveExistingSocketRooms,
    });
    return { socket, ack: vi.fn(), spectate: handlers.get('room:spectate')!, leaveExistingSocketRooms };
  }

  it('rejects an unauthenticated spectator BEFORE any room state is touched', async () => {
    const roomCode = 'MMSPEC1';
    createReservedRoom(roomCode);
    getRoom(roomCode).matchmakingMatchId = 'mm-x'; // a room that WOULD be spectatable
    joinRoom(roomCode, 'p1');
    const { ack, spectate, socket, leaveExistingSocketRooms } = wireSpectate(null);

    await spectate(roomCode, {}, ack);

    // MP-INV-6 rule "a spectator socket must be authenticated":
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'auth_required' });
    // "...BEFORE any room state is touched" — the auth check runs ahead of the
    // socket join AND ahead of leaveExistingSocketRooms (which detaches the
    // socket from its current room):
    expect(socket.join).not.toHaveBeenCalled();
    expect(leaveExistingSocketRooms).not.toHaveBeenCalled();
    expect(socket.rooms.has(roomCode)).toBe(false);
  });

  it('blocks an authenticated spectator on a PRIVATE room (not opted in)', async () => {
    const roomCode = 'PRIV1';
    createReservedRoom(roomCode); // no matchmaking / tournament markers ⇒ roomKind = 'private'
    joinRoom(roomCode, 'p1');
    const { ack, spectate, socket } = wireSpectate('spec-1');

    await spectate(roomCode, {}, ack);

    // MP-INV-6 rule "a private room is not spectatable without opt-in":
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'not_spectatable' });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('allows a private room that opted in via config.spectatable', async () => {
    const roomCode = 'PRIVOPT1';
    createReservedRoom(roomCode);
    getRoom(roomCode).config.spectatable = true;
    joinRoom(roomCode, 'p1');
    setRoomRoster(roomCode, [{ id: 'p1', socketId: 's', username: 'P1', userId: 'u1' }]);
    const { ack, spectate, socket } = wireSpectate('spec-2');

    await spectate(roomCode, {}, ack);

    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true, roomCode }));
    expect(socket.join).toHaveBeenCalledWith(roomCode);
  });

  it.each([
    ['matchmaking', (r: Room) => { r.matchmakingMatchId = 'mm-1'; }],
    ['scheduled_tournament', (r: Room) => { r.scheduledTournamentMatchId = 'stm-1'; }],
    ['legacy_league', (r: Room) => { r.config.tournamentId = 'league-1'; }],
  ])('still allows spectating a %s room (authenticated)', async (_kind, mark) => {
    const roomCode = 'KIND1';
    createReservedRoom(roomCode);
    mark(getRoom(roomCode));
    joinRoom(roomCode, 'p1');
    setRoomRoster(roomCode, [{ id: 'p1', socketId: 's', username: 'P1', userId: 'u1' }]);
    const { ack, spectate } = wireSpectate('spec-3');

    await spectate(roomCode, {}, ack);

    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true, roomCode }));
  });
});

// ===========================================================================
// MP-INV-15 — Each downstream sink receives a match's result at most once.
// Rule (§2.2): the game-over side-effect sequence is retried as a whole up to
// 4×; every sink it touches must be idempotent on the match's sourceMatchId so
// a retry after a partial failure does not double-apply.
// Enforced by: appendMatch (dedup on id), recordPublicOnlineMatch
// (matches_room_match_id_uidx + ignore-duplicates), writeMatchActivity
// (activity_feed.dedupe_key + ignore-duplicates), recordMatchEnd (conditional
// PATCH status=eq.in_progress).  MP-G4 + MP-G6.
// ===========================================================================

const SRC = 'match-src-1';

/** The pre-ranked side-effect tail of §2.1.6, run exactly as persistGameOverOnce runs it. */
async function runSideEffectTail(): Promise<void> {
  await appendMatch({
    id: SRC,
    endedAtMs: Date.now(),
    roomCode: 'ROOM1',
    a: { seatId: 'seat-a', userId: 'user-a', username: 'A' },
    b: { seatId: 'seat-b', userId: 'user-b', username: 'B' },
    scoreA: 30,
    scoreB: 10,
    winnerSeatId: 'seat-a',
    pointDiff: 20,
  });
  await writeMatchActivity({
    winnerUserId: 'user-a',
    loserUserId: 'user-b',
    winnerUsername: 'A',
    loserUsername: 'B',
    mode: 'online',
    winnerScore: 30,
    loserScore: 10,
    sourceMatchId: SRC,
  });
  await recordPublicOnlineMatch({
    roomCode: 'ROOM1',
    roomMatchId: SRC,
    winnerUserId: 'user-a',
    loserUserId: 'user-b',
    winnerScore: 30,
    loserScore: 10,
  });
}

describe('MP-INV-15 — idempotent game-over side-effects (MP-G4)', () => {
  it('running the side-effect tail TWICE with the same sourceMatchId writes each sink exactly once', async () => {
    await runSideEffectTail();
    await runSideEffectTail(); // the retry / duplicate-dispatch

    const s = mpTestStore;
    // appendMatch — one jsonl line (dedup on id):
    expect(s.jsonlLines).toHaveLength(1);
    expect(s.jsonlLines[0].id).toBe(SRC);
    // recordPublicOnlineMatch — one matches row (matches_room_match_id_uidx):
    expect(s.matches).toHaveLength(1);
    expect((s.matches[0].metadata as Record<string, unknown>).roomMatchId).toBe(SRC);
    // writeMatchActivity — exactly 2 rows (winner + loser), NOT 4
    // (activity_feed_dedupe_key_uidx on `${SRC}:${userId}:${type}`):
    expect(s.activityFeed).toHaveLength(2);
    expect(s.activityFeed.map((r) => r.dedupe_key).sort()).toEqual([
      `${SRC}:user-a:win`,
      `${SRC}:user-b:loss`,
    ]);
  });

  it('the REAL persistGameOverOnce retry loop (attempt 1 fails late, attempt 2 succeeds) still writes each sink once', { timeout: 15000 }, async () => {
    // Real timers — one retry (~400 ms real delay before attempt 1 succeeds).
    // completeGhostGame runs AFTER appendMatch / writeMatchActivity /
    // recordPublicOnlineMatch — a throw here forces the scheduler to retry the
    // whole sequence from step 1 (§2.1.6).
    completeGhostGameMock.mockRejectedValueOnce(new Error('transient')).mockResolvedValue(undefined);

    const a = { id: 'seat-a', userId: 'user-a', username: 'A', socketId: 'sa' };
    const b = { id: 'seat-b', userId: 'user-b', username: 'B', socketId: 'sb' };
    const room = {
      code: 'ROOM1', players: ['seat-a', 'seat-b'], state: null, config: {},
      asyncStateVersion: 0, nextHandReady: new Set<string>(), rematchReady: new Set<string>(),
      matchStartReady: new Set<string>(), lastHandEndedNotifiedHand: null, lastHandEndedAtMs: null,
      lastBroadcastScores: {}, ghostMoveLogs: { 'seat-a': [{ x: 1 }], 'seat-b': [{ x: 1 }] },
      ghostTurnIndex: 0, matchId: SRC, matchLogged: false, leadTracker: null,
      eventLogVersion: 1 as const, eventSequence: 0, events: [],
    } as unknown as Room;
    room.durability = createInitialRoomDurabilityState({
      asyncStateVersion: 0, state: null, eventSequence: 0,
    });
    const input: GameOverPersistInput = {
      room, sourceMatchId: SRC, cfg: {}, aId: 'seat-a', bId: 'seat-b', a, b,
      scoreA: 30, scoreB: 10, winnerSeatId: 'seat-a',
    };

    const outcome = await createGameOverPersistScheduler(io)(input)();

    expect(outcome).toBe('succeeded');
    expect(completeGhostGameMock.mock.calls.length).toBeGreaterThanOrEqual(2); // it retried
    const s = mpTestStore;
    // ...yet each sink was written exactly once despite steps 4/5/6 re-running:
    expect(s.jsonlLines).toHaveLength(1);
    expect(s.matches).toHaveLength(1);
    expect(s.activityFeed).toHaveLength(2);
  });

  it('recordMatchEnd is first-terminal-wins: a second terminal call cannot overwrite the recorded winner', async () => {
    mpTestStore.seedMatchmakingMatch('mm-1', 'in_progress');

    // game-over lands first
    await recordMatchEnd({
      matchId: 'mm-1', status: 'completed', winnerId: 'user-a',
      playerARatingChange: 12, playerBRatingChange: -12,
    });
    // then a late forfeit for the same match (MP-2 window)
    await recordMatchEnd({
      matchId: 'mm-1', status: 'forfeit', winnerId: 'user-b',
      playerARatingChange: 6, playerBRatingChange: -6,
    });

    const row = mpTestStore.matchmakingMatches.get('mm-1')!;
    // conditional PATCH `?status=eq.in_progress` ⇒ the SECOND call matched 0 rows:
    expect(row.status).toBe('completed');
    expect(row.winner_id).toBe('user-a');
    expect(row.player_a_rating_change).toBe(12);
  });

  it('a sim match is never written to matchmaking_matches (unchanged by MP-G4)', async () => {
    mpTestStore.seedMatchmakingMatch('sim-1', 'in_progress');
    await recordMatchEnd({
      matchId: 'sim-1', status: 'completed', winnerId: null,
      playerARatingChange: null, playerBRatingChange: null, isSim: true,
    });
    expect(mpTestStore.matchmakingMatches.get('sim-1')!.status).toBe('in_progress');
  });

  // MP-INV-15's fourth sink — the `room_command_receipts` idempotency of a
  // replayed `game:action` — is proven in gameActionIdempotency.test.ts /
  // roomCommandReceiptStore.test.ts / actionReceiptDurability.test.ts. MP-G6
  // (2026-09-01) applied the backing table to prod so that path is no longer
  // degraded to the embedded snapshot only.
});

// ===========================================================================
// MP-INV-1..3 — seat / identity binding.
//   1: one seat is owned by exactly one live socket; a gameplay actor is
//      re-derived from CURRENT roster ownership.
//   2: a seat's identity is fixed for the match — a different userId is never
//      seated into an occupied seat.
//   3: room.players has ≤ 2 entries; the cap is allocation-time and permanent;
//      reconnect / migration never grows it.
// ===========================================================================

describe('MP-INV-1..3 — seat / identity binding', () => {
  it('MP-INV-1: after a seat migrates to a new socket, the stale socket cannot act', () => {
    const roomCode = 'SEAT1';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'seat-a');
    joinRoom(roomCode, 'seat-b');
    setRoomRoster(roomCode, [
      { id: 'seat-a', socketId: 'sock-old', username: 'A', userId: 'u1' },
      { id: 'seat-b', socketId: 'sock-b', username: 'B', userId: 'u2' },
    ]);

    // u1 reconnects on a new tab — roster ownership moves BEFORE old teardown:
    migrateRoomSeat(roomCode, 'seat-a', 'sock-new');

    const newSock = { id: 'sock-new', data: { playerId: 'seat-a' } } as never;
    const staleSock = { id: 'sock-old', data: { playerId: 'seat-a' } } as never;

    // rule: the actor is re-derived from CURRENT roster ownership —
    expect(resolveActorSeatId(roomCode, newSock)).toBe('seat-a');
    // ...and the stale socket carrying the same cached playerId is rejected:
    expect(() => resolveActorSeatId(roomCode, staleSock)).toThrow('Player seat not found for socket.');
  });

  it('MP-INV-3: a redundant reconnect for the same identity does NOT grow room.players', () => {
    const roomCode = 'SEAT2';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'seat-a');
    joinRoom(roomCode, 'seat-b');
    setRoomRoster(roomCode, [
      { id: 'seat-a', socketId: 'sock-a1', username: 'A', userId: 'u1' },
      { id: 'seat-b', socketId: 'sock-b', username: 'B', userId: 'u2' },
    ]);
    expect(getRoom(roomCode).players).toHaveLength(2);

    // two more reconnects for u1 (duplicate tabs) — each only moves ownership:
    migrateRoomSeat(roomCode, 'seat-a', 'sock-a2');
    migrateRoomSeat(roomCode, 'seat-a', 'sock-a3');

    expect(getRoom(roomCode).players).toEqual(['seat-a', 'seat-b']);
  });

  it('MP-INV-2/3: a third distinct identity cannot take a seat in a full room', () => {
    const roomCode = 'SEAT3';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'seat-a');
    joinRoom(roomCode, 'seat-b');

    // allocation-time cap — a new seat for a third player is rejected:
    expect(() => joinRoom(roomCode, 'seat-c')).toThrow('Room is full (v1 supports 2 players).');
    expect(getRoom(roomCode).players).toHaveLength(2);
  });
});
