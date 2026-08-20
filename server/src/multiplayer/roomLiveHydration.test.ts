import { randomUUID } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import {
  createReservedRoom,
  peekRoom,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
} from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { applyLiveSessionRow } from './applyLiveSessionRoom';
import * as livePersistence from './roomLivePersistence';
import {
  buildLiveSessionRow,
  getLiveRoomDurabilityState,
  isLiveRoomDurablyRecoverable,
  resetLiveRoomPersistenceForTests,
  type LiveRosterEntry,
} from './roomLivePersistence';
import { getRoomRoster, resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

type RawLiveRow = Record<string, unknown>;

const persistenceStore = vi.hoisted(() => ({
  liveSessions: new Map<string, RawLiveRow>(),
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/room_live_sessions') && (!init?.method || init.method === 'GET')) {
      const roomCode = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '')
        .trim()
        .toUpperCase();
      const row = persistenceStore.liveSessions.get(roomCode);
      return row ? [row] : [];
    }
    if (path.includes('/room_command_receipts') && (!init?.method || init.method === 'GET')) {
      return [];
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

const roster: LiveRosterEntry[] = [
  { seatId: 'seat-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'Alice' },
  { seatId: 'seat-b', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'Bob' },
];

function seedPersistedActiveRoom(roomCode = 'RST001'): RawLiveRow {
  const room = createReservedRoom(roomCode, { winningScore: 60 });
  room.matchId = randomUUID();
  room.players = ['seat-a', 'seat-b'];
  room.state = mkGameState();
  setRoomRoster(roomCode, [
    { id: 'seat-a', socketId: 'sock-a', username: 'Alice', userId: roster[0]!.userId },
    { id: 'seat-b', socketId: 'sock-b', username: 'Bob', userId: roster[1]!.userId },
  ]);
  return buildLiveSessionRow(room, roster) as unknown as RawLiveRow;
}

describe('room live session restart hydration', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetLiveRoomPersistenceForTests();
    resetLiveRoomPersistHookForTests();
    persistenceStore.liveSessions.clear();
    vi.restoreAllMocks();
    vi.mocked(supabaseFetch).mockClear();
  });

  it('restores a valid persisted active room with healthy durability', async () => {
    const row = seedPersistedActiveRoom('RST001');
    expect((row.game_state as GameState)?.boneyard).toEqual([
      { low: 6, high: 6 },
      { low: 4, high: 5 },
      { low: 0, high: 1 },
    ]);

    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    persistenceStore.liveSessions.set('RST001', row);
    expect(peekRoom('RST001')).toBeUndefined();

    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const hydrated = await livePersistence.ensureRoomHydrated('RST001');
    expect(hydrated.kind).toBe('hydrated');
    if (hydrated.kind !== 'hydrated') return;

    expect(hydrated.room.state?.boneyard).toEqual((row.game_state as GameState).boneyard);
    expect(hydrated.room.state?.sequence).toBe(14);
    expect(hydrated.restoredRoster).toEqual(roster);
    expect(getLiveRoomDurabilityState(hydrated.room)).toMatchObject({
      status: 'healthy',
      targetVersion: {
        asyncStateVersion: hydrated.room.asyncStateVersion,
        stateSequence: 14,
        eventSequence: hydrated.room.eventSequence,
      },
      persistedVersion: {
        asyncStateVersion: hydrated.room.asyncStateVersion,
        stateSequence: 14,
        eventSequence: hydrated.room.eventSequence,
      },
    });
    expect(isLiveRoomDurablyRecoverable(hydrated.room)).toBe(true);
    expect(info).toHaveBeenCalledWith(
      '[mp.authority]',
      expect.stringContaining('"event":"private_reconnect_hydrated"'),
    );
  });

  it('returns already_in_memory without querying persistence', async () => {
    const room = createReservedRoom('RST003', { winningScore: 60 });
    room.players = ['seat-a', 'seat-b'];
    room.state = mkGameState();

    const hydrated = await livePersistence.ensureRoomHydrated('RST003');
    expect(hydrated).toMatchObject({
      kind: 'already_in_memory',
      room,
      restoredRoster: [],
    });
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it('classifies persistence outage distinctly from not_found', async () => {
    vi.mocked(supabaseFetch).mockRejectedValueOnce(new Error('timeout'));

    await expect(livePersistence.ensureRoomHydrated('RST404')).resolves.toEqual({
      kind: 'persistence_unavailable',
      error: 'timeout',
    });
  });

  it('rejects malformed snapshots as snapshot_invalid', async () => {
    const row = seedPersistedActiveRoom('BAD001');
    (row as any).game_state = 'not-an-object';
    persistenceStore.liveSessions.set('BAD001', row);
    resetRoomRuntimeForTests();

    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const hydrated = await livePersistence.ensureRoomHydrated('BAD001');
    expect(hydrated).toEqual({
      kind: 'snapshot_invalid',
      error: 'snapshot_missing_game_state',
    });
    expect(info).toHaveBeenCalledWith(
      '[mp.authority]',
      expect.stringContaining('"event":"private_durability_failed"'),
    );
    expect(info).toHaveBeenCalledWith(
      '[mp.authority]',
      expect.stringContaining('"hydrationKind":"snapshot_invalid"'),
    );
    expect(peekRoom('BAD001')).toBeUndefined();
  });

  it('rejects roster-less active snapshots', async () => {
    const row = seedPersistedActiveRoom('BADROST');
    row.roster = [];
    persistenceStore.liveSessions.set('BADROST', row);
    resetRoomRuntimeForTests();

    await expect(livePersistence.ensureRoomHydrated('BADROST')).resolves.toEqual({
      kind: 'snapshot_invalid',
      error: 'snapshot_missing_roster',
    });
    expect(peekRoom('BADROST')).toBeUndefined();
  });

  it('rejects room-code mismatch snapshots', async () => {
    const row = seedPersistedActiveRoom('MISM01');
    row.room_code = 'OTHER1';
    persistenceStore.liveSessions.set('MISM01', row);
    resetRoomRuntimeForTests();

    await expect(livePersistence.ensureRoomHydrated('MISM01')).resolves.toEqual({
      kind: 'snapshot_invalid',
      error: 'snapshot_room_code_mismatch',
    });
    expect(peekRoom('MISM01')).toBeUndefined();
  });

  it('rejects invalid state and event sequences', async () => {
    const row = seedPersistedActiveRoom('SEQ001');
    row.game_state_sequence = 999;
    persistenceStore.liveSessions.set('SEQ001', row);
    resetRoomRuntimeForTests();

    await expect(livePersistence.ensureRoomHydrated('SEQ001')).resolves.toEqual({
      kind: 'snapshot_stale',
      error: 'snapshot_state_sequence_mismatch',
    });
    expect(peekRoom('SEQ001')).toBeUndefined();
  });

  it('does not revive terminal snapshots as active hydration', async () => {
    const row = seedPersistedActiveRoom('TERM01');
    row.status = 'game_over';
    persistenceStore.liveSessions.set('TERM01', row);
    resetRoomRuntimeForTests();

    await expect(livePersistence.ensureRoomHydrated('TERM01')).resolves.toEqual({
      kind: 'snapshot_stale',
      error: 'snapshot_terminal',
    });
    expect(peekRoom('TERM01')).toBeUndefined();
  });

  it('classifies shell-only live rows explicitly', async () => {
    const row = seedPersistedActiveRoom('MMSHELL');
    row.room_code = 'MMSHELL';
    row.source_type = 'matchmaking';
    row.status = 'lobby';
    row.game_state = null;
    row.game_state_sequence = 0;
    persistenceStore.liveSessions.set('MMSHELL', row);
    resetRoomRuntimeForTests();

    await expect(livePersistence.ensureRoomHydrated('MMSHELL')).resolves.toEqual({
      kind: 'shell_only',
    });
    expect(peekRoom('MMSHELL')).toBeUndefined();
  });

  it('rejects active snapshots with unknown freshness as snapshot_freshness_unknown', async () => {
    const row = seedPersistedActiveRoom('FENCE1');
    row.room_shell.durabilityCommit = null;
    persistenceStore.liveSessions.set('FENCE1', row);
    resetRoomRuntimeForTests();

    await expect(livePersistence.ensureRoomHydrated('FENCE1')).resolves.toEqual({
      kind: 'snapshot_freshness_unknown',
      error: 'snapshot_missing_commit_fence',
    });
    expect(peekRoom('FENCE1')).toBeUndefined();
  });

  it('rejects stale commit fences even when the structural snapshot looks valid', async () => {
    const row = seedPersistedActiveRoom('FENCE2');
    row.room_shell.durabilityCommit = {
      ...row.room_shell.durabilityCommit!,
      stateSequence: 13,
    };
    persistenceStore.liveSessions.set('FENCE2', row);
    resetRoomRuntimeForTests();

    await expect(livePersistence.ensureRoomHydrated('FENCE2')).resolves.toEqual({
      kind: 'snapshot_stale',
      error: 'snapshot_commit_fence_mismatch',
    });
    expect(peekRoom('FENCE2')).toBeUndefined();
  });

  it('concurrent hydration attempts converge on one room instance', async () => {
    const row = seedPersistedActiveRoom('RACE01');
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(supabaseFetch).mockImplementationOnce(async (path: string) => {
      const roomCode = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '')
        .trim()
        .toUpperCase();
      await gate;
      const stored = persistenceStore.liveSessions.get(roomCode);
      return stored ? [stored] : [];
    });
    persistenceStore.liveSessions.set('RACE01', row);

    const first = livePersistence.ensureRoomHydrated('RACE01');
    const second = livePersistence.ensureRoomHydrated('RACE01');
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(a.kind).toBe('hydrated');
    expect(b.kind).toBe('hydrated');
    if (a.kind !== 'hydrated' || b.kind !== 'hydrated') return;
    expect(a.room).toBe(b.room);
  });

  it('failed first attempt does not poison later successful retry', async () => {
    vi.mocked(supabaseFetch)
      .mockRejectedValueOnce(new Error('db_down'))
      .mockImplementationOnce(async (path: string) => {
        const roomCode = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '')
          .trim()
          .toUpperCase();
        const stored = persistenceStore.liveSessions.get(roomCode);
        return stored ? [stored] : [];
      });
    persistenceStore.liveSessions.set('RETRY1', seedPersistedActiveRoom('RETRY1'));
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();

    const first = await livePersistence.ensureRoomHydrated('RETRY1');
    expect(first).toEqual({ kind: 'persistence_unavailable', error: 'db_down' });
    expect(peekRoom('RETRY1')).toBeUndefined();

    const second = await livePersistence.ensureRoomHydrated('RETRY1');
    expect(second.kind).toBe('hydrated');
    if (second.kind !== 'hydrated') return;
    expect(second.room.state?.sequence).toBe(14);
  });

  it('applyLiveSessionRow cleanup is atomic on mid-apply failure', async () => {
    const row = seedPersistedActiveRoom('APPLY1') as any;
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    Object.defineProperty(row, 'events', {
      configurable: true,
      get() {
        throw new Error('boom');
      },
    });

    const applied = applyLiveSessionRow(row);
    expect(applied).toBeNull();
    expect(peekRoom('APPLY1')).toBeUndefined();
  });

  it('restored roster can still be installed after a successful hydration', async () => {
    const row = seedPersistedActiveRoom('RSTSET');
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    persistenceStore.liveSessions.set('RSTSET', row);

    const hydrated = await livePersistence.ensureRoomHydrated('RSTSET');
    expect(hydrated.kind).toBe('hydrated');
    if (hydrated.kind !== 'hydrated') return;

    setRoomRoster(
      'RSTSET',
      hydrated.restoredRoster.map((entry) => ({
        id: entry.seatId,
        socketId: '',
        username: entry.username,
        userId: entry.userId,
      })),
    );

    const restoredRoster = getRoomRoster('RSTSET');
    expect(restoredRoster).toHaveLength(2);
    expect(restoredRoster[0]).toMatchObject({
      id: 'seat-a',
      username: 'Alice',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });
});
