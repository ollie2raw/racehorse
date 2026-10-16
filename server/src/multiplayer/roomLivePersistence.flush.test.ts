import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import type { Room } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { createInitialRoomDurabilityState } from './roomDurability';
import {
  ensureRoomHydrated,
  flushAllPendingLiveSessions,
  flushScheduledLiveRoomPersistence,
  getLiveRoomDurabilityState,
  persistLiveRoomSessionNow,
  resetLiveRoomPersistenceForTests,
  markLiveRoomSessionRestoreIntent,
  schedulePersistLiveRoomSession,
  setLiveRoomWriterEpochForTests,
  settleLiveRoomWriterEpoch,
  configureLiveRoomPersistence,
} from './roomLivePersistence';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

const persistenceStore = vi.hoisted(() => ({
  liveSessions: new Map<string, Record<string, unknown>>(),
  persistCalls: 0,
  persistedSequences: [] as number[],
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/room_live_sessions') && init?.method === 'POST') {
      persistenceStore.persistCalls += 1;
      const rows = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
      for (const row of rows) {
        persistenceStore.persistedSequences.push(Number(row.game_state_sequence));
        persistenceStore.liveSessions.set(String(row.room_code), row);
      }
      return undefined;
    }
    if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
  }),
}));

function mkGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    config: {
      maxPips: 6,
      tilesPerPlayer: 7,
      deadTileCount: 2,
      scoringMultiple: 5,
      blockedHandRule: 'lowestPips',
      endHandBonus: 'sumOpponentPenalties',
      winningScore: 60,
    },
    playerIds: ['seat-a', 'seat-b'],
    players: {
      'seat-a': { id: 'seat-a', hand: [t(6, 5), t(3, 1)], score: 12 },
      'seat-b': { id: 'seat-b', hand: [t(4, 4), t(2, 0)], score: 8 },
    },
    board: null,
    boneyard: [t(6, 6), t(5, 4), t(1, 0)],
    deadTiles: [t(0, 0), t(1, 1)],
    currentPlayerIndex: 0,
    handNumber: 2,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 14,
    ...overrides,
  };
}

function mkRoom(overrides: Partial<Room> = {}): Room {
  const room = {
    code: 'FLUSH1',
    players: ['seat-a', 'seat-b'],
    state: mkGameState(),
    config: { winningScore: 60 },
    asyncStateVersion: 3,
    nextHandReady: new Set(),
    rematchReady: new Set(),
    matchStartReady: new Set(),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
    matchId: '11111111-1111-4111-8111-111111111111',
    matchLogged: false,
    leadTracker: null,
    eventLogVersion: 1,
    eventSequence: 0,
    events: [],
    ...overrides,
  } as Room;
  room.durability =
    overrides.durability ??
    createInitialRoomDurabilityState({
      asyncStateVersion: room.asyncStateVersion,
      state: room.state,
      eventSequence: room.eventSequence,
    });
  return room;
}

const roster = [
  { seatId: 'seat-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'A' },
  { seatId: 'seat-b', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'B' },
];

describe('roomLivePersistence flush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetLiveRoomPersistenceForTests();
    // A booted process already holds its writer epoch (allocated when persistence is configured); these tests are about the
    // steady-state persist sequence, so the boot-time epoch request is not part of the mocked call order.
    setLiveRoomWriterEpochForTests(7);
    persistenceStore.liveSessions.clear();
    persistenceStore.persistCalls = 0;
    persistenceStore.persistedSequences = [];
    vi.mocked(supabaseFetch).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushScheduledLiveRoomPersistence completes a queued debounce write', async () => {
    const room = mkRoom();
    schedulePersistLiveRoomSession(room, roster);
    expect(persistenceStore.persistCalls).toBe(0);

    const flushPromise = flushScheduledLiveRoomPersistence();
    await flushPromise;

    expect(persistenceStore.persistCalls).toBe(1);
    expect(persistenceStore.liveSessions.get('FLUSH1')?.game_state_sequence).toBe(14);
  });

  it('flushAllPendingLiveSessions flushes dirty pending rooms', async () => {
    const room = mkRoom({ code: 'DIRTY1' });
    schedulePersistLiveRoomSession(room, roster);

    const result = await flushAllPendingLiveSessions({ timeoutMs: 1_000 });

    expect(result.timedOut).toBe(false);
    expect(result.flushedRoomCodes).toEqual(['DIRTY1']);
    expect(persistenceStore.persistCalls).toBe(1);
    expect(persistenceStore.liveSessions.get('DIRTY1')).toBeTruthy();
  });

  it('flushAllPendingLiveSessions continues after persistence timeout', async () => {
    let releasePersist!: () => void;
    const persistGate = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });

    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/room_live_sessions') && init?.method === 'POST') {
        persistenceStore.persistCalls += 1;
        await persistGate;
        return undefined;
      }
      if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
    });

    const room = mkRoom({ code: 'HANG1' });
    schedulePersistLiveRoomSession(room, roster);

    const flushPromise = flushAllPendingLiveSessions({ timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await flushPromise;

    expect(result.timedOut).toBe(true);
    expect(result.flushedRoomCodes).toEqual([]);
    releasePersist();
  });

  it('reports a failed dirty snapshot instead of claiming a successful drain', async () => {
    vi.mocked(supabaseFetch).mockImplementationOnce(async () => { throw new Error('database unavailable'); });
    schedulePersistLiveRoomSession(mkRoom({ code: 'FAILED' }), roster);
    const result = await flushAllPendingLiveSessions({ timeoutMs: 1000 });
    expect(result.failedRoomCodes).toEqual(['FAILED']);
    expect(result.timedOut).toBe(false);
  });

  it('refuses a durable terminal snapshot after restart (completion gap evidence)', async () => {
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/room_live_sessions') && init?.method === 'POST') {
        for (const row of JSON.parse(String(init.body))) persistenceStore.liveSessions.set(row.room_code, row);
        return undefined;
      }
      if (path.includes('/mp_authority_events')) return undefined;
      throw new Error(`unexpected persist request: ${path}`);
    });
    const room = mkRoom({ code: 'TERMGAP', state: mkGameState({ gameOver: true, winnerId: 'seat-a' }) });
    await persistLiveRoomSessionNow(room, roster);
    const row = structuredClone(persistenceStore.liveSessions.get(room.code)!);
    expect(row.status).toBe('game_over');
    expect((row.room_shell as Record<string, unknown>).matchLogged).toBe(false);
    resetLiveRoomPersistenceForTests();
    vi.mocked(supabaseFetch).mockImplementation(async (path: string) => {
      if (path.includes('/room_live_sessions?')) return [row];
      if (path.includes('/mp_authority_events')) return undefined;
      throw new Error(`unexpected recovery request: ${path}`);
    });
    const result = await ensureRoomHydrated(room.code);
    expect(result).toEqual({ kind: 'snapshot_stale', error: 'snapshot_terminal' });
  });

  it('coalesces duplicate in-flight writes for the same room', async () => {
    const room = mkRoom({ code: 'DEDUP1' });
    await Promise.all([
      persistLiveRoomSessionNow(room, roster),
      persistLiveRoomSessionNow(room, roster),
    ]);

    expect(persistenceStore.persistCalls).toBe(1);
  });

  it('commits the newest room fence after an older write is already in flight', async () => {
    let releaseFirstPersist!: () => void;
    const firstPersistGate = new Promise<void>((resolve) => {
      releaseFirstPersist = resolve;
    });
    let isFirstPersist = true;

    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/room_live_sessions') && init?.method === 'POST') {
        persistenceStore.persistCalls += 1;
        if (isFirstPersist) {
          isFirstPersist = false;
          await firstPersistGate;
        }
        const rows = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
        for (const row of rows) {
          persistenceStore.persistedSequences.push(Number(row.game_state_sequence));
          persistenceStore.liveSessions.set(String(row.room_code), row);
        }
        return undefined;
      }
      if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
    });

    const room = mkRoom({ code: 'LATEST1' });
    const firstPersist = persistLiveRoomSessionNow(room, roster);
    await Promise.resolve();

    room.state = mkGameState({ sequence: 15 });
    room.eventSequence = 3;
    schedulePersistLiveRoomSession(room, roster);
    const latestPersist = persistLiveRoomSessionNow(room, roster);

    releaseFirstPersist();
    await expect(firstPersist).resolves.toBe(true);
    await expect(latestPersist).resolves.toBe(true);

    expect(persistenceStore.persistCalls).toBe(2);
    expect(persistenceStore.persistedSequences).toEqual([14, 15]);
    expect(persistenceStore.liveSessions.get('LATEST1')?.game_state_sequence).toBe(15);
    expect(getLiveRoomDurabilityState(room).status).toBe('healthy');
  });

  it('refreshes a stale target fence instead of retrying forever after an untracked event mutation', async () => {
    let releaseFirstPersist!: () => void;
    const firstPersistGate = new Promise<void>((resolve) => {
      releaseFirstPersist = resolve;
    });
    let signalFirstPersistStarted!: () => void;
    const firstPersistStarted = new Promise<void>((resolve) => {
      signalFirstPersistStarted = resolve;
    });
    let isFirstPersist = true;

    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/room_live_sessions') && init?.method === 'POST') {
        persistenceStore.persistCalls += 1;
        if (isFirstPersist) {
          isFirstPersist = false;
          signalFirstPersistStarted();
          await firstPersistGate;
        }
        const rows = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
        for (const row of rows) {
          persistenceStore.liveSessions.set(String(row.room_code), row);
        }
        return undefined;
      }
      if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
    });

    const room = mkRoom({ code: 'EVENT1' });
    schedulePersistLiveRoomSession(room, roster);
    const persist = flushScheduledLiveRoomPersistence('EVENT1');
    await firstPersistStarted;

    // Reproduces DRAW/PASS previously appending events after the persistence
    // hook had captured its target durability fence.
    room.eventSequence = 1;
    releaseFirstPersist();

    await expect(persist).resolves.toEqual({ flushedRoomCodes: ['EVENT1'], failedRoomCodes: [] });
    expect(persistenceStore.persistCalls).toBe(2);
    expect(persistenceStore.liveSessions.get('EVENT1')?.last_event_sequence).toBe(1);
    expect(getLiveRoomDurabilityState(room).status).toBe('healthy');
  });
});

describe('roomLivePersistence database-fence client behaviour', () => {
  type Call = { path: string; method?: string; body?: Record<string, unknown> };
  let calls: Call[];
  const parse = (init?: RequestInit) => (init?.body ? JSON.parse(String(init.body)) : undefined);
  const record = (path: string, init?: RequestInit) => { calls.push({ path, method: init?.method, body: parse(init) }); };
  const persistedShell = (): Record<string, unknown> | undefined => {
    const post = calls.find((c) => c.path.includes('/room_live_sessions') && c.method === 'POST');
    return ((post?.body as unknown as Array<{ room_shell: Record<string, unknown> }> | undefined)?.[0]?.room_shell);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    resetLiveRoomPersistenceForTests();
    calls = [];
    vi.mocked(supabaseFetch).mockReset();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('allocates the writer epoch at boot (configureLiveRoomPersistence), once, and stamps it on every snapshot', async () => {
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      record(path, init);
      if (path.includes('/rpc/next_room_writer_epoch')) return 41 as never;
      return undefined as never;
    });
    configureLiveRoomPersistence({ resolveRoster: () => roster });
    await settleLiveRoomWriterEpoch();
    expect(await persistLiveRoomSessionNow(mkRoom({ code: 'EPOCH1' }), roster)).toBe(true);
    expect(await persistLiveRoomSessionNow(mkRoom({ code: 'EPOCH1' }), roster)).toBe(true);
    expect(calls.filter((c) => c.path.includes('next_room_writer_epoch'))).toHaveLength(1);
    expect(persistedShell()?.writerEpoch).toBe(41);
  });

  it('a failed boot allocation fixes the process at legacy epoch 0 for its whole lifetime: it never turns into a later, positive epoch', async () => {
    let rpcHealthy = false;
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      record(path, init);
      if (path.includes('/rpc/next_room_writer_epoch')) {
        if (!rpcHealthy) throw new Error('Supabase request failed: 404 {"code":"PGRST202"}');
        return 99 as never;
      }
      return undefined as never;
    });
    configureLiveRoomPersistence({ resolveRoster: () => roster });          // boot: the single allocation attempt fails
    await settleLiveRoomWriterEpoch();
    expect(await persistLiveRoomSessionNow(mkRoom({ code: 'LEGACY1' }), roster)).toBe(true);
    expect(persistedShell()).toBeTruthy();
    expect(persistedShell()).not.toHaveProperty('writerEpoch');
    rpcHealthy = true;                                                       // the database recovers...
    for (let minute = 0; minute < 15; minute += 1) {                         // ...and far longer than any former window passes
      await vi.advanceTimersByTimeAsync(60_000);
      await persistLiveRoomSessionNow(mkRoom({ code: 'LEGACY1' }), roster);
    }
    expect(calls.filter((c) => c.path.includes('next_room_writer_epoch'))).toHaveLength(1);   // no retry, no storm
    const posts = calls.filter((c) => c.path.includes('/room_live_sessions') && c.method === 'POST');
    expect(posts.length).toBeGreaterThan(1);
    for (const post of posts) expect((post.body as unknown as Array<{ room_shell: Record<string, unknown> }>)[0]!.room_shell).not.toHaveProperty('writerEpoch');
  });

  it('a successful boot allocation is the identity for the whole lifetime: every snapshot carries it and the RPC is never called again', async () => {
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      record(path, init);
      return (path.includes('/rpc/next_room_writer_epoch') ? 55 : undefined) as never;
    });
    configureLiveRoomPersistence({ resolveRoster: () => roster });
    await settleLiveRoomWriterEpoch();
    for (let i = 0; i < 5; i += 1) {
      await persistLiveRoomSessionNow(mkRoom({ code: `LIFE${i}` }), roster);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    }
    expect(calls.filter((c) => c.path.includes('next_room_writer_epoch'))).toHaveLength(1);
    const posts = calls.filter((c) => c.path.includes('/room_live_sessions') && c.method === 'POST');
    expect(posts).toHaveLength(5);
    for (const post of posts) expect((post.body as unknown as Array<{ room_shell: Record<string, unknown> }>)[0]!.room_shell.writerEpoch).toBe(55);
  });

  it('a persist issued while the boot allocation is still running waits for it: nothing is ever written under a provisional identity', async () => {
    let release!: (epoch: number) => void;
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      record(path, init);
      if (path.includes('/rpc/next_room_writer_epoch')) return new Promise<number>((resolve) => { release = resolve; }) as never;
      return undefined as never;
    });
    configureLiveRoomPersistence({ resolveRoster: () => roster });
    const pending = persistLiveRoomSessionNow(mkRoom({ code: 'WAIT1' }), roster);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.some((c) => c.path.includes('/room_live_sessions'))).toBe(false);      // not written yet
    release(77);
    await pending;
    expect(persistedShell()?.writerEpoch).toBe(77);
  });

  it('a persist never starts an allocation itself: only the boot configure can fix the identity', async () => {
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => { record(path, init); return 12 as never; });
    await persistLiveRoomSessionNow(mkRoom({ code: 'NOBOOT1' }), roster);
    await persistLiveRoomSessionNow(mkRoom({ code: 'NOBOOT1' }), roster);
    expect(calls.filter((c) => c.path.includes('next_room_writer_epoch'))).toHaveLength(0);
    expect(persistedShell()).not.toHaveProperty('writerEpoch');
  });

  it('adds no asynchronous gap before the snapshot is built once the epoch is known (snapshot stays at its fence)', async () => {
    setLiveRoomWriterEpochForTests(9);
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => { record(path, init); return undefined as never; });
    const room = mkRoom({ code: 'GAP1' });
    const pending = persistLiveRoomSessionNow(room, roster);
    room.state = { ...room.state!, sequence: 99 } as typeof room.state;   // mutated in the same tick, after the call
    await pending;
    const row = (calls.find((c) => c.method === 'POST')?.body as unknown as Array<{ game_state_sequence: number }>)[0]!;
    expect(row.game_state_sequence).toBe(14);
  });

  it.each([
    ['room_live_session_stale_write'], ['room_live_session_stale_writer'], ['room_live_session_stale_generation'],
    ['room_live_session_retired_match'], ['room_live_session_terminal_regression'], ['room_live_session_owes_completion'],
  ])('a database fence refusal (%s) is a terminal FAILED durability state, not a retried degraded one', async (code) => {
    setLiveRoomWriterEpochForTests(9);
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      record(path, init);
      throw new Error(`Supabase request failed: 400 {"code":"P0001","message":"${code}: room X"}`);
    });
    const room = mkRoom({ code: 'FENCE1' });
    expect(await persistLiveRoomSessionNow(room, roster)).toBe(false);
    expect(getLiveRoomDurabilityState(room).status).toBe('failed');
    expect(String(getLiveRoomDurabilityState(room).lastError)).toBe(code);
    expect(calls.filter((c) => c.path.includes('/room_live_sessions'))).toHaveLength(1);   // no retry storm
  });

  it('restore intent re-creates the row through the RPC with p_restore=true and is consumed on success', async () => {
    setLiveRoomWriterEpochForTests(9);
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => { record(path, init); return undefined as never; });
    const room = mkRoom({ code: 'RESTORE1' });
    markLiveRoomSessionRestoreIntent('restore1');
    expect(await persistLiveRoomSessionNow(room, roster)).toBe(true);
    const rpc = calls.find((c) => c.path.includes('/rpc/persist_room_live_session'));
    expect(rpc?.body).toMatchObject({ p_restore: true, p_entries: [] });
    expect((rpc?.body as { p_session: { room_shell: { writerEpoch: number } } }).p_session.room_shell.writerEpoch).toBe(9);
    calls = [];
    expect(await persistLiveRoomSessionNow(mkRoom({ code: 'RESTORE1' }), roster)).toBe(true);   // intent consumed: ordinary write
    expect(calls.some((c) => c.path.includes('/rpc/persist_room_live_session'))).toBe(false);
  });

  it('restore intent against a schema that predates p_restore falls back to the ordinary row write', async () => {
    setLiveRoomWriterEpochForTests(9);
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      record(path, init);
      if (path.includes('/rpc/persist_room_live_session')) throw new Error('Supabase request failed: 404 {"code":"PGRST202"}');
      return undefined as never;
    });
    markLiveRoomSessionRestoreIntent('RESTORE2');
    expect(await persistLiveRoomSessionNow(mkRoom({ code: 'RESTORE2' }), roster)).toBe(true);
    expect(calls.some((c) => c.path.includes('/room_live_sessions') && c.method === 'POST')).toBe(true);
  });
});
