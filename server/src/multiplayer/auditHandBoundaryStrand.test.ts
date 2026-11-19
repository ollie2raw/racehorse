import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertTileCountInvariant, assertValidGameState } from '../game/invariants';
import { getRoom, resetLiveRoomPersistHookForTests, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';
import { registerRoomSessionHandlers } from './registerRoomSessionHandlers';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';
import { resetGameActionIdempotencyForTests } from './gameActionIdempotency';
import { resetLiveRoomPersistenceForTests } from './roomLivePersistence';

/**
 * AUDIT 2026-11-17 (docs/audit-parts/B-multiplayer.md), tests-only reproductions. No production code is changed.
 *
 * B1: MP_HAND_BOUNDARY_FAST. The first player's ready-mark write is debounced; when it is still in flight as the second
 *     player readies, the new-hand flush joins that in-flight write (persistLiveRoomSessionNow returns it). If THAT write
 *     fails, the new hand is rolled back and the second player gets { ok:false, uncertain:true }. The room is left
 *     hand-over with both seats ready and no advance scheduled: only a further hand:ready starts the hand. The client
 *     (useHandRevealSequence.ts:191-195) treats ANY resolved ack as acknowledged, so it never sends one on the same
 *     connection: the room waits until a reconnect.
 *
 * B2: a new-hand write that COMMITS but whose response is lost (timeout) is reported as a failure; the room is rolled back
 *     in memory and the rollback's own debounced persist carries a LOWER (sequence, event) tuple, which the monotonic
 *     fence (2026-10-16_room_live_session_*_fence.sql) refuses -> durability 'failed' -> new_hand / gameplay / reconnect
 *     all blocked for the rest of the process. With LIVE_SESSION_LOG_ENTRIES on, #518's same-persist full-row fallback
 *     re-writes the same snapshot and the room survives (shown as the contrast case).
 */
const db = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, any>>(),
  entries: new Map<string, { stream: string; idx: number; entry: any }>(),
  writes: [] as Array<{ ev: string | null; hand: number | null }>,
  gate: null as null | { promise: Promise<void>; release: () => void },
  failNext: 0,
  /** The next N session writes LAND, then throw a timeout (response lost). */
  landThenTimeoutNext: 0,
  /** Emulate the monotonic fence trigger: refuse a lower (game_state_sequence, last_event_sequence) for the same match. */
  fence: false,
}));

function lastEventType(row: Record<string, any>, entries: Array<{ stream: string; entry: any }> = []): string | null {
  const evs = Array.isArray(row.events) ? row.events : [];
  const e = evs.length ? evs[evs.length - 1] : entries.filter((x) => x.stream === 'events').at(-1)?.entry;
  return e?.type ?? null;
}

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const isRpc = path === '/rest/v1/rpc/persist_room_live_session';
    if ((isRpc || path.startsWith('/rest/v1/room_live_sessions?on_conflict')) && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      const row = isRpc ? body.p_session : body[0];
      const entries = isRpc ? (body.p_entries as Array<{ stream: string; idx: number; entry: any }>) : [];
      if (db.gate) await db.gate.promise;
      if (db.failNext > 0) {
        db.failNext -= 1;
        throw new Error('Supabase request failed: 503 upstream');
      }
      const stored = db.sessions.get(String(row.room_code));
      if (db.fence && stored && stored.match_id === row.match_id) {
        const o = [Number(stored.game_state_sequence ?? 0), Number(stored.last_event_sequence ?? 0)];
        const n = [Number(row.game_state_sequence ?? 0), Number(row.last_event_sequence ?? 0)];
        if (n[0] < o[0] || (n[0] === o[0] && n[1] < o[1])) {
          throw new Error(`Supabase request failed: 400 {"code":"P0001","message":"room_live_session_stale_write: room ${row.room_code} stored (${o}) incoming (${n})"}`);
        }
      }
      db.writes.push({ ev: lastEventType(row, entries), hand: row.game_state?.handNumber ?? null });
      db.sessions.set(String(row.room_code), row);
      for (const e of entries) db.entries.set(`${row.room_code}|${e.stream}|${e.idx}`, { ...e });
      if (db.landThenTimeoutNext > 0) {
        db.landThenTimeoutNext -= 1;
        throw new Error(`Supabase request timed out after 15000ms: ${path}`);
      }
      return undefined;
    }
    if (path.startsWith('/rest/v1/room_live_sessions') && method === 'GET') {
      const code = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '');
      const row = db.sessions.get(code);
      return row ? [structuredClone(row)] : [];
    }
    return [];
  }),
}));

const sessionDeps = {
  resolveSocketIdentity: async (config: { username?: string; userId?: string | null }) => ({
    username: typeof config.username === 'string' ? config.username : 'Guest',
    userId: typeof config.userId === 'string' ? config.userId : null,
  }),
  normalizeUsername: (value: unknown) => (typeof value === 'string' ? value : 'Guest'),
  normalizeUserId: (value: unknown) => (typeof value === 'string' ? value : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => undefined,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  maybeFinalizeTournamentMatch: () => undefined,
  persistRoomMatchLog: async () => undefined,
  onGameOver: () => null,
  finalizeTournamentMatch: () => undefined,
};

function makeSocket(label: string, userId: string) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    id: `sock-${label}`,
    data: { userId, username: label } as Record<string, unknown>,
    rooms: new Set<string>(),
    connected: true,
    on: (event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    join: (roomCode: string) => {
      socket.rooms.add(roomCode);
    },
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  socket.rooms.add(socket.id);
  return { socket: socket as any, handlers };
}

function makeTwoPlayerIo(hostSocket: any, guestSocket: any) {
  return {
    sockets: {
      sockets: new Map([
        [hostSocket.id, hostSocket],
        [guestSocket.id, guestSocket],
      ]),
      adapter: { rooms: new Map<string, Set<string>>() },
    },
    to: vi.fn(() => ({ emit: vi.fn(), except: vi.fn(() => ({ emit: vi.fn() })) })),
  } as any;
}

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', 'host-user');
  const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', 'guest-user');
  const io = makeTwoPlayerIo(hostSocket, guestSocket);
  initRoomSession(io, sessionDeps);
  registerRoomSessionHandlers(io, hostSocket);
  registerRoomSessionHandlers(io, guestSocket);
  const hostAck = vi.fn();
  await hostHandlers.get('room:create')?.({ username: 'Host', userId: 'host-user' }, hostAck);
  const roomCode = hostAck.mock.calls[0][0].roomCode as string;
  const hostSeatId = hostAck.mock.calls[0][0].you as string;
  io.sockets.adapter.rooms.set(roomCode, new Set([hostSocket.id, guestSocket.id]));
  const guestJoinAck = vi.fn();
  await guestHandlers.get('room:join')?.(roomCode, { username: 'Guest', userId: 'guest-user' }, guestJoinAck);
  const guestSeatId = guestJoinAck.mock.calls[0][0].you as string;
  setRoomRoster(roomCode, [
    { id: hostSeatId, socketId: hostSocket.id, username: 'Host', userId: 'host-user' },
    { id: guestSeatId, socketId: guestSocket.id, username: 'Guest', userId: 'guest-user' },
  ]);
  await guestHandlers.get('player:ready')?.(roomCode, vi.fn());
  const startAck = vi.fn();
  await hostHandlers.get('game:start')?.(roomCode, startAck);
  expect(startAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  const room = getRoom(roomCode);
  room.preGameDraw = null;
  // A real hand end bumps the sequence; emulate it so the hand-over snapshot is a strictly newer tuple.
  room.state = { ...room.state!, handOver: true, sequence: (room.state!.sequence ?? 0) + 1 };
  room.lastHandEndedAtMs = Date.now() - 10_000;
  room.nextHandReady.clear();
  assertTileCountInvariant(room.state, 'audit:setup');
  assertValidGameState(room.state, 'audit:setup');
  room.asyncStateVersion += 1;
  // Persist the hand-over state through the normal hook.
  (await import('./roomLivePersistence')).schedulePersistLiveRoomSessionForRoom(room);
  await settle();
  db.writes.length = 0;
  return { hostHandlers, guestHandlers, roomCode, hostSeatId, guestSeatId, handNumber: room.state.handNumber };
}

const ready = (handlers: Map<string, (...a: any[]) => void>, roomCode: string, handNumber: number, requestId: string) =>
  new Promise<any>((resolve) => {
    void handlers.get('hand:ready')?.(roomCode, { handNumber, requestId }, (ack: any) => resolve(ack));
  });

function holdWrites() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  db.gate = { promise, release: () => { db.gate = null; release(); } };
  return db.gate;
}

function reset(entriesOn: boolean) {
  vi.clearAllMocks();
  delete process.env.MP_HAND_BOUNDARY_FAST;
  if (entriesOn) process.env.LIVE_SESSION_LOG_ENTRIES = 'true';
  else delete process.env.LIVE_SESSION_LOG_ENTRIES;
  db.sessions.clear(); db.entries.clear(); db.writes.length = 0; db.gate = null;
  db.failNext = 0; db.landThenTimeoutNext = 0; db.fence = false;
  resetLiveRoomPersistenceForTests();
  resetGameActionIdempotencyForTests();
  resetRoomGameplayLocksForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  resetLiveRoomPersistHookForTests();
}

afterEach(() => {
  delete process.env.MP_HAND_BOUNDARY_FAST;
  delete process.env.LIVE_SESSION_LOG_ENTRIES;
});

describe.each([
  ['LIVE_SESSION_LOG_ENTRIES off', false],
  ['LIVE_SESSION_LOG_ENTRIES on', true],
])('AUDIT B1 MP_HAND_BOUNDARY_FAST: a failing in-flight mark write fails the new hand and leaves an un-advanced room (%s)', (_l, entriesOn) => {
  beforeEach(() => reset(entriesOn));

  it('second player gets uncertain; the room stays hand-over with both seats ready and nothing scheduled', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    const gate = holdWrites();
    const first = await ready(s.hostHandlers, s.roomCode, s.handNumber, 'host-1');
    expect(first).toMatchObject({ ok: true, started: false }); // acked before durable (by design)
    await settle(120); // the 75 ms debounce fires; the mark write is now IN FLIGHT (held)
    db.failNext = entriesOn ? 2 : 1; // that in-flight write fails (RPC + #518 full-row fallback when entries are on)
    const secondP = ready(s.guestHandlers, s.roomCode, s.handNumber, 'guest-1');
    await settle(20);
    gate.release();
    const second = await secondP;

    // The new-hand flush joined the failing in-flight mark write and never wrote the new hand itself.
    expect(second).toMatchObject({ ok: false, uncertain: true, started: false });
    await settle(250); // the rollback's own debounced persist runs (and succeeds)
    const room = getRoom(s.roomCode);
    expect(room.durability.status).toBe('healthy');
    expect(room.state!.handOver).toBe(true);
    expect(room.state!.handNumber).toBe(s.handNumber);
    expect([...room.nextHandReady].sort()).toEqual([s.hostSeatId, s.guestSeatId].sort());
    // Nothing on the server will start this hand: no advance is scheduled, no timer exists for private rooms.
    await settle(300);
    expect(getRoom(s.roomCode).state!.handNumber).toBe(s.handNumber);
    expect(db.writes.some((w) => w.ev === 'hand_started')).toBe(false);

    // Only a further hand:ready (new request id) recovers it -- which the client does not send on the same connection
    // because it treats { ok:false, uncertain:true } as acknowledged (see client auditHandReadyAck.test.tsx).
    const retry = await ready(s.guestHandlers, s.roomCode, s.handNumber, 'guest-2');
    expect(retry).toMatchObject({ ok: true, started: true });
  });
});

describe.each([
  ['flag off, entries off: the lost response is the 2nd ready-mark write', false, false],
  ['flag on (fast), entries off: the lost response is the new-hand write', true, false],
  ['flag on (fast), entries on: #518 fallback rewrites the same snapshot (contrast)', true, true],
  ['flag off, entries on: #518 fallback rewrites the same snapshot (contrast)', false, true],
])('AUDIT B2 a lifecycle write that commits but whose response is lost (%s)', (_l, fast, entriesOn) => {
  beforeEach(() => reset(entriesOn));

  it('entries off: rolled back in memory, the rollback persist is fenced, the room is failed for good; entries on: survives', async () => {
    if (fast) process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    db.fence = true;
    const first = await ready(s.hostHandlers, s.roomCode, s.handNumber, 'host-1');
    expect(first).toMatchObject({ ok: true });
    // Fast mode: let the host's debounced mark write land first, so the ONLY next write is the new-hand write.
    // (If the lost response hits the in-flight mark write instead, the room heals: see the report, B2 notes.)
    await settle(200);
    db.landThenTimeoutNext = 1; // the next session write commits, but the server sees a timeout
    const second = await ready(s.guestHandlers, s.roomCode, s.handNumber, 'guest-1');
    await settle(250);
    const room = getRoom(s.roomCode);
    if (entriesOn) {
      expect(second).toMatchObject({ ok: true, started: true });
      expect(room.durability.status).toBe('healthy');
      return;
    }
    expect(second).toMatchObject({ ok: false, uncertain: true });
    const stored = db.sessions.get(s.roomCode)!;
    expect(lastEventType(stored)).toBe(fast ? 'hand_started' : 'hand_ready');
    // The database is AHEAD of memory (memory rolled back); the rollback's own write had a lower tuple and was refused.
    expect(stored.last_event_sequence).toBeGreaterThan(room.eventSequence);
    expect(room.state!.handOver).toBe(true);
    expect(room.durability.status).toBe('failed');
    expect(room.durability.lastError).toMatch(/room_live_session_stale_write/);
    // A retry can no longer start the hand: stranded until the room leaves memory (restart / eviction).
    const retry = await ready(s.guestHandlers, s.roomCode, s.handNumber, 'guest-2');
    expect(retry).toMatchObject({ ok: false, error: 'new_hand_blocked' });
  });
});
