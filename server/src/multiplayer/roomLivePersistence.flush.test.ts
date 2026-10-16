import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import type { Room } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { createInitialRoomDurabilityState } from './roomDurability';
import {
  flushAllPendingLiveSessions,
  flushScheduledLiveRoomPersistence,
  getLiveRoomDurabilityState,
  persistLiveRoomSessionNow,
  resetLiveRoomPersistenceForTests,
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
    // A booted process already holds its writer epoch (allocated when persistence is configured).
    setLiveRoomWriterEpochForTests(7);
    persistenceStore.liveSessions.clear();
    persistenceStore.persistCalls = 0;
    persistenceStore.persistedSequences = [];
    vi.mocked(supabaseFetch).mockClear();
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

    await expect(persist).resolves.toEqual({ flushedRoomCodes: ['EVENT1'] });
    expect(persistenceStore.persistCalls).toBe(2);
    expect(persistenceStore.liveSessions.get('EVENT1')?.last_event_sequence).toBe(1);
    expect(getLiveRoomDurabilityState(room).status).toBe('healthy');
  });
});

describe('BRIDGE writer epoch (the only change relative to 3ccd6ff8)', () => {
  type Call = { path: string; method?: string; body?: unknown };
  let calls: Call[];
  const record = (path: string, init?: RequestInit) => { calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }); };
  const shellOfFirstPost = () => (calls.find((c) => c.path.includes('/room_live_sessions') && c.method === 'POST')?.body as Array<{ room_shell: Record<string, unknown> }> | undefined)?.[0]?.room_shell;

  beforeEach(() => { vi.useFakeTimers(); resetLiveRoomPersistenceForTests(); calls = []; vi.mocked(supabaseFetch).mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allocates the epoch once at boot (configureLiveRoomPersistence) and stamps every snapshot', async () => {
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      record(path, init);
      return (path.includes('/rpc/next_room_writer_epoch') ? 41 : undefined) as never;
    });
    configureLiveRoomPersistence({ resolveRoster: () => roster });
    await settleLiveRoomWriterEpoch();
    expect(await persistLiveRoomSessionNow(mkRoom({ code: 'EPOCH1' }), roster)).toBe(true);
    expect(await persistLiveRoomSessionNow(mkRoom({ code: 'EPOCH1' }), roster)).toBe(true);
    expect(calls.filter((c) => c.path.includes('next_room_writer_epoch'))).toHaveLength(1);
    expect(shellOfFirstPost()?.writerEpoch).toBe(41);
  });

  it('a schema without the epoch RPC behaves exactly like canonical BRIDGE: no epoch in the shell, writes succeed, allocation retried later', async () => {
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      record(path, init);
      if (path.includes('/rpc/next_room_writer_epoch')) throw new Error('Supabase request failed: 404 {"code":"PGRST202"}');
      return undefined as never;
    });
    expect(await persistLiveRoomSessionNow(mkRoom({ code: 'LEGACY1' }), roster)).toBe(true);
    expect(shellOfFirstPost()).toBeTruthy();
    expect(shellOfFirstPost()).not.toHaveProperty('writerEpoch');
    await persistLiveRoomSessionNow(mkRoom({ code: 'LEGACY1' }), roster);
    expect(calls.filter((c) => c.path.includes('next_room_writer_epoch'))).toHaveLength(1);   // not hammered inside the retry window
    await vi.advanceTimersByTimeAsync(6_000);
    await persistLiveRoomSessionNow(mkRoom({ code: 'LEGACY1' }), roster);
    expect(calls.filter((c) => c.path.includes('next_room_writer_epoch'))).toHaveLength(2);
  });

  it('a boot allocation that fails is still retried inside the boot window (schema-cache lag right after the migration)', async () => {
    let healthy = false;
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      record(path, init);
      if (path.includes('/rpc/next_room_writer_epoch')) {
        if (!healthy) throw new Error('Supabase request failed: 404 {"code":"PGRST202"}');
        return 63 as never;
      }
      return undefined as never;
    });
    configureLiveRoomPersistence({ resolveRoster: () => roster });
    await settleLiveRoomWriterEpoch();
    await persistLiveRoomSessionNow(mkRoom({ code: 'WIN1' }), roster);
    expect(shellOfFirstPost()).not.toHaveProperty('writerEpoch');
    healthy = true;
    await vi.advanceTimersByTimeAsync(6_000);
    calls.length = 0;
    await persistLiveRoomSessionNow(mkRoom({ code: 'WIN1' }), roster);
    expect(shellOfFirstPost()?.writerEpoch).toBe(63);
  });

  it('after the boot window a process that never obtained an epoch NEVER takes a late one: it would outrank processes that booted since', async () => {
    let healthy = false;
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      record(path, init);
      if (path.includes('/rpc/next_room_writer_epoch')) {
        if (!healthy) throw new Error('boom');
        return 99 as never;
      }
      return undefined as never;
    });
    configureLiveRoomPersistence({ resolveRoster: () => roster });
    await settleLiveRoomWriterEpoch();
    await vi.advanceTimersByTimeAsync(61_000);
    healthy = true;                                   // the RPC works again, but the window is over
    calls.length = 0;
    for (let i = 0; i < 3; i += 1) {
      await persistLiveRoomSessionNow(mkRoom({ code: 'LATE1' }), roster);
      await vi.advanceTimersByTimeAsync(6_000);
    }
    expect(calls.filter((c) => c.path.includes('next_room_writer_epoch'))).toHaveLength(0);
    expect(shellOfFirstPost()).toBeTruthy();
    expect(shellOfFirstPost()).not.toHaveProperty('writerEpoch');   // legacy 0, never a guessed positive epoch
  });

  it('adds no asynchronous gap before the snapshot is built once the epoch is known', async () => {
    setLiveRoomWriterEpochForTests(9);
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => { record(path, init); return undefined as never; });
    const room = mkRoom({ code: 'GAP1' });
    const pending = persistLiveRoomSessionNow(room, roster);
    room.state = { ...room.state!, sequence: 99 } as typeof room.state;
    await pending;
    const row = (calls.find((c) => c.method === 'POST')?.body as Array<{ game_state_sequence: number }>)[0]!;
    expect(row.game_state_sequence).toBe(14);
  });
});
