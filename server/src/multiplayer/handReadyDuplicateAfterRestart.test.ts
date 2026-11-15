import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertTileCountInvariant, assertValidGameState, collectTileAccountingViolations } from '../game/invariants';
import { getRoom, peekRoom, resetLiveRoomPersistHookForTests, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';
import { registerRoomSessionHandlers } from './registerRoomSessionHandlers';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';
import { resetGameActionIdempotencyForTests } from './gameActionIdempotency';
import { ensureRoomHydrated, resetLiveRoomPersistenceForTests } from './roomLivePersistence';

/**
 * A duplicate hand:ready after a server restart and reconnect (the client now resends an acknowledged hand:ready on a new connection):
 * the server must neither start a hand twice nor fail. Real persistence against a fake database; restart = drop the in-memory rooms,
 * rejoin, rehydrate from what had landed.
 */
type Write = { kind: 'row' | 'rpc'; ev: string | null; hand: number | null; handOver: boolean | null; ready: number; at: number };
const db = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, any>>(),
  entries: new Map<string, { stream: string; idx: number; entry: any }>(),
  writes: [] as Array<Write>,
  /** While set, session writes wait for release() before they land. */
  gate: null as null | { promise: Promise<void>; release: () => void },
  /** Fail the next N session writes with a 503. */
  failNext: 0,
  failMessage: 'Supabase request failed: 503 upstream',
  /** Every session write waits this long (a slow database). */
  latencyMs: 0,
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
      if (db.latencyMs) await new Promise((r) => setTimeout(r, db.latencyMs));
      if (db.failNext > 0) {
        db.failNext -= 1;
        throw new Error(db.failMessage);
      }
      db.writes.push({
        kind: isRpc ? 'rpc' : 'row',
        ev: lastEventType(row, entries),
        hand: row.game_state?.handNumber ?? null,
        handOver: row.game_state?.handOver ?? null,
        ready: Array.isArray(row.room_shell?.nextHandReady) ? row.room_shell.nextHandReady.length : 0,
        at: Date.now(),
      });
      db.sessions.set(String(row.room_code), row);
      for (const e of entries) db.entries.set(`${row.room_code}|${e.stream}|${e.idx}`, { ...e });
      return undefined;
    }
    if (path.startsWith('/rest/v1/room_live_sessions') && method === 'GET') {
      const code = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '');
      const row = db.sessions.get(code);
      return row ? [structuredClone(row)] : [];
    }
    if (path.startsWith('/rest/v1/room_live_session_entries') && method === 'GET') {
      const code = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '');
      const params = new URL(path, 'https://local.invalid').searchParams;
      const bounds = [...(params.get('or') ?? '').matchAll(/stream\.eq\."([^"]+)",idx\.lt\.(\d+)/g)];
      const after = (params.get('and') ?? '').match(/stream\.gt\."([^"]+)".*idx\.gt\.(\d+)/);
      return [...db.entries.entries()]
        .filter(([key]) => key.startsWith(`${code}|`))
        .map(([, value]) => structuredClone(value))
        .filter((e) => bounds.length === 0 || bounds.some((b) => e.stream === b[1] && e.idx < Number(b[2])))
        .filter((e) => !after || e.stream > after[1]! || (e.stream === after[1] && e.idx > Number(after[2])))
        .sort((a, b) => a.stream.localeCompare(b.stream) || a.idx - b.idx)
        .slice(0, Math.min(1000, Number(params.get('limit') ?? 1000)));
    }
    if (path.includes('/room_command_receipts') && method === 'GET') return [];
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
    data: {
      userId,
      username: label,
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
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  socket.rooms.add(socket.id);
  return { socket: socket as any, handlers };
}

function makeTwoPlayerIo(hostSocket: any, guestSocket: any, roomCode: string) {
  const roomMembers = new Set([hostSocket.id, guestSocket.id]);
  return {
    sockets: {
      sockets: new Map([
        [hostSocket.id, hostSocket],
        [guestSocket.id, guestSocket],
      ]),
      adapter: {
        rooms: new Map<string, Set<string>>([[roomCode, roomMembers]]),
      },
    },
    to: vi.fn(() => ({
      emit: vi.fn(),
      except: vi.fn(() => ({ emit: vi.fn() })),
    })),
  } as any;
}

async function startPrivateMatch(
  io: any,
  hostHandlers: Map<string, (...args: any[]) => void>,
  guestHandlers: Map<string, (...args: any[]) => void>,
  hostSocket: any,
  guestSocket: any,
) {
  const hostAck = vi.fn();
  await hostHandlers.get('room:create')?.({ username: 'Host', userId: '11111111-1111-4111-8111-111111111111' }, hostAck);
  const roomCode = hostAck.mock.calls[0][0].roomCode as string;
  const hostSeatId = hostAck.mock.calls[0][0].you as string;

  io.sockets.adapter.rooms.set(roomCode, new Set([hostSocket.id, guestSocket.id]));

  const guestJoinAck = vi.fn();
  await guestHandlers.get('room:join')?.(roomCode, { username: 'Guest', userId: '22222222-2222-4222-8222-222222222222' }, guestJoinAck);
  const guestSeatId = guestJoinAck.mock.calls[0][0].you as string;

  setRoomRoster(roomCode, [
    { id: hostSeatId, socketId: hostSocket.id, username: 'Host', userId: '11111111-1111-4111-8111-111111111111' },
    { id: guestSeatId, socketId: guestSocket.id, username: 'Guest', userId: '22222222-2222-4222-8222-222222222222' },
  ]);

  await guestHandlers.get('player:ready')?.(roomCode, vi.fn());
  const startAck = vi.fn();
  await hostHandlers.get('game:start')?.(roomCode, startAck);
  expect(startAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));

  return { roomCode, hostSeatId, guestSeatId };
}

/** End the current hand for hand:ready tests; skip MIN_HAND_OVER_MS delay in nextHand advance. */
function armHandOverForReadyTest(roomCode: string) {
  const room = getRoom(roomCode);
  if (!room.state) throw new Error('expected in-progress state');
  room.preGameDraw = null;
  room.state = { ...room.state, handOver: true };
  room.lastHandEndedAtMs = Date.now() - 10_000;
  room.nextHandReady.clear();
  assertTileCountInvariant(room.state, 'handReadyGameplayLock.test:setup');
  assertValidGameState(room.state, 'handReadyGameplayLock.test:setup');
}


function holdWrites() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  db.gate = { promise, release: () => { db.gate = null; release(); } };
  return db.gate;
}

/** Make the next n persists fail. With entries mode on, one persist is two attempts: the RPC, then the whole-row fallback. */
const failPersists = (n: number, entriesOn: boolean) => { db.failNext = entriesOn ? 2 * n : n; };

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function setup(code: string | null = null) {
  const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', '11111111-1111-4111-8111-111111111111');
  const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', '22222222-2222-4222-8222-222222222222');
  const io = makeTwoPlayerIo(hostSocket, guestSocket, 'PENDING');
  initRoomSession(io, sessionDeps);
  registerRoomSessionHandlers(io, hostSocket);
  registerRoomSessionHandlers(io, guestSocket);
  const match = await startPrivateMatch(io, hostHandlers, guestHandlers, hostSocket, guestSocket);
  armHandOverForReadyTest(match.roomCode);
  await settle(); // the match start and the hand-over arming are persisted before the test measures
  db.writes.length = 0;
  return { io, hostSocket, guestSocket, hostHandlers, guestHandlers, ...match, handNumber: getRoom(match.roomCode).state!.handNumber };
}

const ready = (handlers: Map<string, (...a: any[]) => void>, roomCode: string, handNumber: number, requestId?: string) =>
  new Promise<any>((resolve) => {
    void handlers.get('hand:ready')?.(roomCode, requestId ? { handNumber, requestId } : handNumber, (ack: any) => resolve(ack));
  });

function lastState(socket: { emit: ReturnType<typeof vi.fn> }) {
  const calls = socket.emit.mock.calls.filter(([event]: [string]) => event === 'state:update');
  return calls[calls.length - 1]?.[1] ?? null;
}


/** A new process: nothing in memory, new sockets, both players rejoin (which rehydrates the room from the database). */
async function restartAndReconnect(roomCode: string) {
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  resetRoomGameplayLocksForTests();
  resetGameActionIdempotencyForTests();
  resetLiveRoomPersistHookForTests();
  resetLiveRoomPersistenceForTests();
  const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', '11111111-1111-4111-8111-111111111111');
  const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', '22222222-2222-4222-8222-222222222222');
  const io = makeTwoPlayerIo(hostSocket, guestSocket, roomCode);
  initRoomSession(io, sessionDeps);
  registerRoomSessionHandlers(io, hostSocket);
  registerRoomSessionHandlers(io, guestSocket);
  const hostAck = vi.fn();
  await hostHandlers.get('room:join')?.(roomCode, { username: 'Host', userId: '11111111-1111-4111-8111-111111111111' }, hostAck);
  const guestAck = vi.fn();
  await guestHandlers.get('room:join')?.(roomCode, { username: 'Guest', userId: '22222222-2222-4222-8222-222222222222' }, guestAck);
  expect(hostAck.mock.calls[0]?.[0]).toMatchObject({ ok: true });
  expect(guestAck.mock.calls[0]?.[0]).toMatchObject({ ok: true });
  return { hostHandlers, guestHandlers, hostSocket, guestSocket, hostSeatId: hostAck.mock.calls[0][0].you as string, guestSeatId: guestAck.mock.calls[0][0].you as string };
}

const DUPLICATE = { ok: false, ignored: true, error: 'stale_or_duplicate_hand_ready' };

describe.each([
  ['flag off, LIVE_SESSION_LOG_ENTRIES off', false, false],
  ['MP_HAND_BOUNDARY_FAST on, LIVE_SESSION_LOG_ENTRIES off', true, false],
  ['MP_HAND_BOUNDARY_FAST on, LIVE_SESSION_LOG_ENTRIES on', true, true],
])('duplicate hand:ready after a restart and reconnect (%s)', (_label, fast, entriesOn) => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (fast) process.env.MP_HAND_BOUNDARY_FAST = 'true'; else delete process.env.MP_HAND_BOUNDARY_FAST;
    if (entriesOn) process.env.LIVE_SESSION_LOG_ENTRIES = 'true'; else delete process.env.LIVE_SESSION_LOG_ENTRIES;
    db.sessions.clear(); db.entries.clear(); db.writes.length = 0; db.gate = null; db.failNext = 0; db.latencyMs = 0;
    resetLiveRoomPersistenceForTests();
    resetGameActionIdempotencyForTests();
    resetRoomGameplayLocksForTests();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetLiveRoomPersistHookForTests();
  });
  afterEach(() => {
    delete process.env.MP_HAND_BOUNDARY_FAST;
    delete process.env.LIVE_SESSION_LOG_ENTRIES;
  });

  it('the hand had started before the restart: a resent hand:ready for the old hand is ignored, no second hand, no error', async () => {
    const s = await setup();
    await ready(s.hostHandlers, s.roomCode, s.handNumber);
    await ready(s.guestHandlers, s.roomCode, s.handNumber);
    await settle();
    expect(db.sessions.get(s.roomCode)!.game_state.handNumber).toBe(s.handNumber + 1);
    const c = await restartAndReconnect(s.roomCode);
    const before = JSON.parse(JSON.stringify(getRoom(s.roomCode).state));
    const acks = await Promise.all([
      ready(c.hostHandlers, s.roomCode, s.handNumber, 'dup-host-1'),
      ready(c.guestHandlers, s.roomCode, s.handNumber, 'dup-guest-1'),
    ]);
    for (const ack of acks) expect(ack).toMatchObject(DUPLICATE);
    await settle();
    const room = getRoom(s.roomCode);
    expect(JSON.parse(JSON.stringify(room.state))).toEqual(before);
    expect(room.state!.handNumber).toBe(s.handNumber + 1);
    expect(room.events.filter((e) => e.type === 'hand_started')).toHaveLength(1);
    expect(db.writes.filter((w) => w.ev === 'hand_started' && w.hand === s.handNumber + 2)).toEqual([]);
  });

  it('the first mark had landed: the resend is ignored as a duplicate, then the second player starts exactly one hand', async () => {
    const s = await setup();
    await ready(s.hostHandlers, s.roomCode, s.handNumber);
    await settle(250); // the mark is durable (flag on: after its debounce)
    expect(db.sessions.get(s.roomCode)!.room_shell.nextHandReady ?? []).toHaveLength(1);
    const c = await restartAndReconnect(s.roomCode);
    expect([...getRoom(s.roomCode).nextHandReady]).toEqual([c.hostSeatId]);

    const dup = await ready(c.hostHandlers, s.roomCode, s.handNumber, 'dup-host-2'); // the client resends after reconnecting
    expect(dup).toMatchObject(DUPLICATE);
    expect(getRoom(s.roomCode).state!.handNumber).toBe(s.handNumber);
    expect([...getRoom(s.roomCode).nextHandReady]).toEqual([c.hostSeatId]);

    const start = await ready(c.guestHandlers, s.roomCode, s.handNumber, 'guest-2');
    expect(start).toMatchObject({ ok: true, started: true });
    await settle();
    const room = getRoom(s.roomCode);
    expect(room.state!.handNumber).toBe(s.handNumber + 1);
    expect(room.events.filter((e) => e.type === 'hand_started')).toHaveLength(1);
    // and one more resend after the start is still just ignored
    expect(await ready(c.hostHandlers, s.roomCode, s.handNumber, 'dup-host-3')).toMatchObject(DUPLICATE);
    expect(getRoom(s.roomCode).state!.handNumber).toBe(s.handNumber + 1);
  });

  it.skipIf(!fast)('the acknowledged mark was lost in the restart (flag on): the resend is a fresh mark, and the hand still starts once', async () => {
    const s = await setup();
    const gate = holdWrites(); // the mark's write never lands before the process dies
    const ack = await ready(s.hostHandlers, s.roomCode, s.handNumber);
    expect(ack).toMatchObject({ ok: true, started: false });
    await settle(120);
    const c = await restartAndReconnect(s.roomCode); // the in-memory mark is gone
    db.gate = null; gate.release();
    expect(getRoom(s.roomCode).state!.handOver).toBe(true);
    expect([...getRoom(s.roomCode).nextHandReady]).toEqual([]);

    const resend = await ready(c.hostHandlers, s.roomCode, s.handNumber, 'resend-host');
    expect(resend).toMatchObject({ ok: true, started: false, ignored: false }); // not an error, not a start
    const start = await ready(c.guestHandlers, s.roomCode, s.handNumber, 'resend-guest');
    expect(start).toMatchObject({ ok: true, started: true });
    await settle();
    const room = getRoom(s.roomCode);
    expect(room.state!.handNumber).toBe(s.handNumber + 1);
    expect(room.events.filter((e) => e.type === 'hand_started')).toHaveLength(1);
    expect(room.events.filter((e) => e.type === 'hand_ready' && (e.payload as { playerSeatId?: string }).playerSeatId === c.hostSeatId).length).toBeLessThanOrEqual(2);
    expect(db.sessions.get(s.roomCode)!.game_state.handNumber).toBe(s.handNumber + 1);
  });

  it('both players resend at once after the restart: one start, both acks ok', async () => {
    const s = await setup();
    const c = await restartAndReconnect(s.roomCode);
    const acks = await Promise.all([
      ready(c.hostHandlers, s.roomCode, s.handNumber, 'both-host'),
      ready(c.guestHandlers, s.roomCode, s.handNumber, 'both-guest'),
    ]);
    expect(acks.every((a) => a.ok === true || a.ignored === true)).toBe(true);
    expect(acks.some((a) => a.error && a.error !== 'stale_or_duplicate_hand_ready')).toBe(false);
    await settle();
    const room = getRoom(s.roomCode);
    expect(room.state!.handNumber).toBe(s.handNumber + 1);
    expect(room.events.filter((e) => e.type === 'hand_started')).toHaveLength(1);
  });

  it('a resend with the same request id (a retried ack) replays the original answer instead of acting again', async () => {
    const s = await setup();
    const first = await ready(s.hostHandlers, s.roomCode, s.handNumber, 'same-id');
    const again = await ready(s.hostHandlers, s.roomCode, s.handNumber, 'same-id');
    expect(first).toMatchObject({ ok: true, started: false });
    expect(again).toMatchObject({ ok: true }); // the receipt's answer, not a second action
    expect(getRoom(s.roomCode).events.filter((e) => e.type === 'hand_ready')).toHaveLength(1);
  });
});
