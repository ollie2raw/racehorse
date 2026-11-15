import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertTileCountInvariant, assertValidGameState, collectTileAccountingViolations } from '../game/invariants';
import { getRoom, peekRoom, resetLiveRoomPersistHookForTests, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';
import { registerRoomSessionHandlers } from './registerRoomSessionHandlers';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';
import { resetGameActionIdempotencyForTests } from './gameActionIdempotency';
import { ensureRoomHydrated, resetLiveRoomPersistenceForTests } from './roomLivePersistence';

/**
 * MP_HAND_BOUNDARY_FAST (docs: handBoundaryFast.ts). Real persistence against a fake database that can hold, fail and
 * count writes, run with LIVE_SESSION_LOG_ENTRIES off and on.
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
  const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', 'host-user');
  const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', 'guest-user');
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

describe.each([
  ['LIVE_SESSION_LOG_ENTRIES off', false],
  ['LIVE_SESSION_LOG_ENTRIES on', true],
])('MP_HAND_BOUNDARY_FAST (%s)', (_label, entriesOn) => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MP_HAND_BOUNDARY_FAST;
    if (entriesOn) process.env.LIVE_SESSION_LOG_ENTRIES = 'true';
    else delete process.env.LIVE_SESSION_LOG_ENTRIES;
    db.sessions.clear(); db.entries.clear(); db.writes.length = 0; db.gate = null; db.failNext = 0; db.latencyMs = 0;
    db.failMessage = 'Supabase request failed: 503 upstream';
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

  it('baseline (flag off): the second player waits for three sequential writes', async () => {
    const s = await setup();
    db.latencyMs = 120;
    const t0 = Date.now();
    const first = ready(s.hostHandlers, s.roomCode, s.handNumber);
    await settle(10);
    const second = await ready(s.guestHandlers, s.roomCode, s.handNumber);
    await first;
    expect(second).toMatchObject({ ok: true, started: true });
    expect(db.writes.map((w) => w.ev)).toEqual(['hand_ready', 'hand_ready', 'hand_started']);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3 * 120 - 30);
  });

  it('flag on: the ready marks are acknowledged without waiting for their write, and the second player waits for one write', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    db.latencyMs = 120;
    const t0 = Date.now();
    const firstAck = await ready(s.hostHandlers, s.roomCode, s.handNumber);
    expect(firstAck).toMatchObject({ ok: true, started: false, ignored: false });
    expect(Date.now() - t0).toBeLessThan(60); // no write was awaited
    const t1 = Date.now();
    const second = await ready(s.guestHandlers, s.roomCode, s.handNumber);
    const secondMs = Date.now() - t1;
    expect(second).toMatchObject({ ok: true, started: true });
    // The mark's debounce (75 ms) had not fired, so the new-hand write carried both marks: exactly one write, ~one latency.
    expect(db.writes.map((w) => w.ev)).toEqual(['hand_started']);
    expect(secondMs).toBeGreaterThanOrEqual(110);
    expect(secondMs).toBeLessThan(2 * 120);
    expect(db.writes[0]).toMatchObject({ hand: s.handNumber + 1, handOver: false });
  });

  it('flag on, a scheduled-tournament room: the marks are still awaited', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    getRoom(s.roomCode).scheduledTournamentId = 'tournament-1';
    db.latencyMs = 100;
    const t0 = Date.now();
    await ready(s.hostHandlers, s.roomCode, s.handNumber);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
    expect(db.writes.map((w) => w.ev)).toEqual(['hand_ready']);
  });

  it('flag on: the new hand is durable before it is broadcast', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    await ready(s.hostHandlers, s.roomCode, s.handNumber);
    const gate = holdWrites();
    s.hostSocket.emit.mockClear(); s.guestSocket.emit.mockClear();
    const second = ready(s.guestHandlers, s.roomCode, s.handNumber);
    await settle(200);
    // The write is held: nothing about the new hand may have reached either player yet.
    expect(lastState(s.hostSocket)?.state?.handNumber ?? s.handNumber).toBe(s.handNumber);
    expect(lastState(s.guestSocket)?.state?.handNumber ?? s.handNumber).toBe(s.handNumber);
    gate.release();
    expect(await second).toMatchObject({ started: true });
    expect(lastState(s.hostSocket).state.handNumber).toBe(s.handNumber + 1);
    expect(db.sessions.get(s.roomCode)!.game_state.handNumber).toBe(s.handNumber + 1);
  });

  it('flag on, two devices converge: both see the same new hand, same sequence, own hands only', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    const [a, b] = await Promise.all([
      ready(s.hostHandlers, s.roomCode, s.handNumber),
      ready(s.guestHandlers, s.roomCode, s.handNumber),
    ]);
    expect([a, b].filter((x) => x.started)).toHaveLength(1); // exactly one start, the other ack coalesces onto it
    await settle();
    const host = lastState(s.hostSocket).state; const guest = lastState(s.guestSocket).state;
    expect(host.handNumber).toBe(s.handNumber + 1);
    expect(guest.handNumber).toBe(host.handNumber);
    expect(guest.sequence).toBe(host.sequence);
    expect(host.handOver).toBe(false);
    expect(host.players[s.hostSeatId].hand).toHaveLength(7);
    expect(host.players[s.guestSeatId].hand).toHaveLength(0); // masked
    expect(guest.players[s.guestSeatId].hand).toHaveLength(7);
    const room = getRoom(s.roomCode);
    expect(room.events.filter((e) => e.type === 'hand_started')).toHaveLength(1);
    expect(collectTileAccountingViolations(room.state!)).toEqual([]);
  });

  it('flag on, rapid actions: duplicate taps and a late action around the boundary leave one clean start in order', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    const acks = await Promise.all([
      ready(s.hostHandlers, s.roomCode, s.handNumber),
      ready(s.hostHandlers, s.roomCode, s.handNumber),
      ready(s.guestHandlers, s.roomCode, s.handNumber),
      ready(s.guestHandlers, s.roomCode, s.handNumber),
    ]);
    expect(acks.filter((a) => a.started).length).toBeGreaterThanOrEqual(1);
    await settle();
    const room = getRoom(s.roomCode);
    expect(room.state!.handNumber).toBe(s.handNumber + 1);
    const types = room.events.map((e) => e.type);
    expect(types.filter((t) => t === 'hand_started')).toHaveLength(1);
    expect(types.filter((t) => t === 'hand_ready')).toHaveLength(2);
    const readyAt = types.lastIndexOf('hand_ready');
    expect(types.indexOf('hand_started')).toBeGreaterThan(readyAt);
    const seqs = room.events.map((e) => e.sequence);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(db.sessions.get(s.roomCode)!.game_state.handNumber).toBe(s.handNumber + 1);
    assertTileCountInvariant(room.state!, 'fast:rapid');
    assertValidGameState(room.state!, 'fast:rapid');
  });

  it('flag on, restart before the mark is persisted: the room comes back unchanged, same deal, no phantom readiness', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    const before = JSON.parse(JSON.stringify(db.sessions.get(s.roomCode)!.game_state));
    const gate = holdWrites();
    const ack = await ready(s.hostHandlers, s.roomCode, s.handNumber);
    expect(ack).toMatchObject({ ok: true, started: false });
    await settle(120); // the debounced write is in flight but held: it never lands
    resetRoomRuntimeForTests(); // the process dies here
    db.gate = null;
    gate.release();
    // Only what had landed survives: hand over, deal unchanged, nobody marked ready.
    const hydrated = await ensureRoomHydrated(s.roomCode);
    expect(hydrated.kind).toBe('hydrated');
    const room = peekRoom(s.roomCode)!;
    expect(room.state!.handOver).toBe(true);
    expect(room.state!.handNumber).toBe(s.handNumber);
    expect(JSON.parse(JSON.stringify(room.state))).toEqual(before);
    expect([...room.nextHandReady]).toEqual([]);
  });

  it('flag on, restart after the mark landed: readiness is restored; after the new hand landed: that hand and its deal', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    await ready(s.hostHandlers, s.roomCode, s.handNumber);
    await settle(200); // debounce fires and the write lands
    expect(db.writes.map((w) => w.ev)).toEqual(['hand_ready']);
    resetRoomRuntimeForTests();
    expect((await ensureRoomHydrated(s.roomCode)).kind).toBe('hydrated');
    expect([...peekRoom(s.roomCode)!.nextHandReady]).toEqual([s.hostSeatId]);
    resetRoomRuntimeForTests(); resetRoomSessionStoresForTests(); resetLiveRoomPersistHookForTests();

    // Same room, second player, new hand: restart after it and read it back.
    const t = await setup();
    await ready(t.hostHandlers, t.roomCode, t.handNumber);
    await ready(t.guestHandlers, t.roomCode, t.handNumber);
    const live = JSON.parse(JSON.stringify(getRoom(t.roomCode).state));
    resetRoomRuntimeForTests();
    expect((await ensureRoomHydrated(t.roomCode)).kind).toBe('hydrated');
    const room = peekRoom(t.roomCode)!;
    expect(JSON.parse(JSON.stringify(room.state))).toEqual(live);
    expect(room.state!.handNumber).toBe(t.handNumber + 1);
    expect([...room.nextHandReady]).toEqual([]);
    expect(room.events.filter((e) => e.type === 'hand_started')).toHaveLength(1);
  });

  it('flag on, a ready-mark write fails and the new-hand write succeeds: the hand starts and the room is healthy again', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    failPersists(1, entriesOn);
    const firstAck = await ready(s.hostHandlers, s.roomCode, s.handNumber);
    expect(firstAck).toMatchObject({ ok: true, started: false }); // acknowledged before the write
    await settle(250); // the debounced mark write runs and fails
    expect(getRoom(s.roomCode).durability.status).toBe('degraded');
    expect(db.writes).toEqual([]);
    const second = await ready(s.guestHandlers, s.roomCode, s.handNumber);
    expect(second).toMatchObject({ ok: true, started: true });
    const room = getRoom(s.roomCode);
    expect(room.durability.status).toBe('healthy');
    expect(room.state!.handNumber).toBe(s.handNumber + 1);
    expect(db.sessions.get(s.roomCode)!.game_state.handNumber).toBe(s.handNumber + 1);
  });

  it('flag off: the same failed mark write is still refused and rolled back (unchanged)', async () => {
    const s = await setup();
    failPersists(1, entriesOn);
    const ack = await ready(s.hostHandlers, s.roomCode, s.handNumber, 'off-fail-1');
    expect(ack).toMatchObject({ ok: false, uncertain: true });
    expect([...getRoom(s.roomCode).nextHandReady]).toEqual([]);
  });

  it('flag on, the new-hand write fails: rolled back with the marks restored, nothing broadcast, then a retry starts it', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    await ready(s.hostHandlers, s.roomCode, s.handNumber);
    s.hostSocket.emit.mockClear(); s.guestSocket.emit.mockClear();
    failPersists(1, entriesOn); // the new-hand write fails (the mark rode on it, so there is no separate mark write)
    const ack = await ready(s.guestHandlers, s.roomCode, s.handNumber, 'fast-fail-1');
    expect(ack).toMatchObject({ ok: false, uncertain: true });
    const room = getRoom(s.roomCode);
    expect(room.state!.handNumber).toBe(s.handNumber);
    expect(room.state!.handOver).toBe(true);
    expect(room.events.filter((e) => e.type === 'hand_started')).toHaveLength(0);
    expect(lastState(s.hostSocket)?.state?.handNumber ?? s.handNumber).toBe(s.handNumber);
    db.failNext = 0;
    const retry = await ready(s.guestHandlers, s.roomCode, s.handNumber, 'fast-fail-2');
    expect(retry).toMatchObject({ ok: true, started: true });
    expect(getRoom(s.roomCode).state!.handNumber).toBe(s.handNumber + 1);
  });

  it('flag on: a failed room (database fence) is never let through the new-hand gate', async () => {
    process.env.MP_HAND_BOUNDARY_FAST = 'true';
    const s = await setup();
    const room = getRoom(s.roomCode);
    room.durability = { ...room.durability, status: 'failed' };
    const ack = await ready(s.hostHandlers, s.roomCode, s.handNumber);
    expect(ack.ok).toBe(false);
    expect(room.nextHandReady.size).toBe(0);
  });

  it('flag unset: the default is the old behaviour (marks awaited)', async () => {
    const s = await setup();
    db.latencyMs = 100;
    const t0 = Date.now();
    await ready(s.hostHandlers, s.roomCode, s.handNumber);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
  });
});
