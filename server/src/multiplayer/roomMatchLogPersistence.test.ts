import { randomUUID } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import type { RoomMatchEvent } from '../roomEvents';
import { createReservedRoom, getRoom, resetRoomRuntimeForTests } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import {
  configureLiveRoomPersistence,
  loadLiveRoomSession,
  resetLiveRoomPersistenceForTests,
} from './roomLivePersistence';
import {
  getRoomMatchLogsPersistenceAvailability,
  persistRoomMatchLog,
  probeRoomMatchLogsTable,
  queryLatestPersistedRoomMatchLogByRoomCode,
  queryPersistedRoomMatchLog,
  resetRoomMatchLogPersistenceForTests,
} from './roomMatchLogPersistence';
import * as telemetry from './mpAuthorityTelemetry';
import { flushMpAuthorityEventPersistForTests } from './mpAuthorityEventStore';
import { getRoomRoster, resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

type LiveRow = Record<string, unknown>;
type ArchiveRow = Record<string, unknown>;

const persistenceStore = vi.hoisted(() => ({
  liveSessions: new Map<string, LiveRow>(),
  matchLogs: new Map<string, ArchiveRow>(),
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/room_match_logs') && init?.method === 'POST') {
      const rows = JSON.parse(String(init.body)) as ArchiveRow[];
      for (const row of rows) {
        persistenceStore.matchLogs.set(String(row.match_id), row);
      }
      return undefined;
    }

    if (path.includes('/room_match_logs') && (!init?.method || init.method === 'GET')) {
      const matchId = decodeURIComponent(path.match(/match_id=eq\.([^&]+)/)?.[1] ?? '');
      const row = persistenceStore.matchLogs.get(matchId);
      return row ? [row] : [];
    }

    if (path.includes('/room_live_sessions') && init?.method === 'POST') {
      const rows = JSON.parse(String(init.body)) as LiveRow[];
      for (const row of rows) {
        persistenceStore.liveSessions.set(String(row.room_code), row);
      }
      return undefined;
    }

    if (path.includes('/room_live_sessions') && init?.method === 'DELETE') {
      const roomCode = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '')
        .trim()
        .toUpperCase();
      persistenceStore.liveSessions.delete(roomCode);
      return undefined;
    }

    if (path.includes('/room_live_sessions') && (!init?.method || init.method === 'GET')) {
      const roomCode = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '')
        .trim()
        .toUpperCase();
      const row = persistenceStore.liveSessions.get(roomCode);
      return row ? [row] : [];
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
      'seat-a': { id: 'seat-a', hand: [t(6, 5), t(3, 1)], score: 60 },
      'seat-b': { id: 'seat-b', hand: [t(4, 4)], score: 42 },
    },
    board: null,
    boneyard: [t(6, 6), t(5, 4)],
    deadTiles: [t(0, 0), t(1, 1)],
    currentPlayerIndex: 0,
    handNumber: 3,
    handOpen: true,
    handOver: false,
    gameOver: true,
    winnerId: 'seat-a',
    consecutivePasses: 0,
    sequence: 21,
    ...overrides,
  };
}

function mkEvent(room: { code: string; matchId: string }, sequence = 1): RoomMatchEvent {
  return {
    id: randomUUID(),
    version: 1,
    matchId: room.matchId,
    roomCode: room.code,
    sequence,
    type: 'match_started',
    timestamp: new Date().toISOString(),
    handNumber: 1,
    stateSequence: 1,
    actorSocketId: 'sock-a',
    actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    payload: {},
  };
}

function seedTerminalRoom(roomCode = 'CLN001') {
  const room = createReservedRoom(roomCode, { winningScore: 60 });
  room.matchId = '11111111-1111-4111-8111-111111111111';
  room.players = ['seat-a', 'seat-b'];
  room.state = mkGameState();
  room.eventLogVersion = 1;
  room.eventSequence = 1;
  room.events = [mkEvent(room)];
  room.rankingOutcome = {
    glickoEligible: false,
    glickoApplied: false,
    skipReason: 'move_log_verification_failed',
  };

  setRoomRoster(roomCode, [
    {
      id: 'seat-a',
      socketId: 'sock-a',
      username: 'Alice',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    {
      id: 'seat-b',
      socketId: 'sock-b',
      username: 'Bob',
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ]);

  persistenceStore.liveSessions.set(roomCode, {
    room_code: roomCode,
    match_id: room.matchId,
    status: 'playing',
    source_type: 'private',
    game_state_sequence: 21,
  });

  return getRoom(roomCode);
}

describe('roomMatchLogPersistence terminal cleanup', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetLiveRoomPersistenceForTests();
    resetRoomMatchLogPersistenceForTests();
    persistenceStore.liveSessions.clear();
    persistenceStore.matchLogs.clear();
    vi.mocked(supabaseFetch).mockClear();

    configureLiveRoomPersistence({
      resolveRoster: (roomCode) =>
        getRoomRoster(roomCode).map((player) => ({
          seatId: player.id,
          userId: player.userId,
          username: player.username,
        })),
    });
  });

  it('after persistRoomMatchLog completes, archives terminal row and deletes room_live_sessions', async () => {
    const room = seedTerminalRoom('CLN001');
    const terminalLiveStatuses: string[] = [];

    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/room_live_sessions') && init?.method === 'POST') {
        const rows = JSON.parse(String(init.body)) as LiveRow[];
        for (const row of rows) {
          terminalLiveStatuses.push(String(row.status));
          persistenceStore.liveSessions.set(String(row.room_code), row);
        }
        return undefined;
      }
      if (path.includes('/room_match_logs') && init?.method === 'POST') {
        const rows = JSON.parse(String(init.body)) as ArchiveRow[];
        for (const row of rows) {
          persistenceStore.matchLogs.set(String(row.match_id), row);
        }
        return undefined;
      }
      if (path.includes('/room_live_sessions') && init?.method === 'DELETE') {
        const code = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '')
          .trim()
          .toUpperCase();
        persistenceStore.liveSessions.delete(code);
        return undefined;
      }
      if (path.includes('/room_match_logs') && (!init?.method || init.method === 'GET')) {
        const matchId = decodeURIComponent(path.match(/match_id=eq\.([^&]+)/)?.[1] ?? '');
        const row = persistenceStore.matchLogs.get(matchId);
        return row ? [row] : [];
      }
      if (path.includes('/room_live_sessions') && (!init?.method || init.method === 'GET')) {
        const code = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '')
          .trim()
          .toUpperCase();
        const row = persistenceStore.liveSessions.get(code);
        return row ? [row] : [];
      }
      if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
    });

    const emit = vi.spyOn(telemetry, 'emitMpAuthorityFunnel');
    await persistRoomMatchLog(room, 'completed');

    const archived = persistenceStore.matchLogs.get(room.matchId);
    expect(archived).toBeDefined();
    expect(archived?.status).toBe('completed');
    expect(archived?.room_code).toBe('CLN001');
    expect(archived?.summary).toMatchObject({
      rankingOutcome: {
        glickoEligible: false,
        glickoApplied: false,
        skipReason: 'move_log_verification_failed',
      },
    });
    expect(terminalLiveStatuses).toContain('game_over');
    expect(persistenceStore.liveSessions.has('CLN001')).toBe(false);
    expect(emit).toHaveBeenCalledWith('private_match_archived', expect.objectContaining({
      roomCode: 'CLN001',
      extra: expect.objectContaining({ status: 'completed' }),
    }));

    const loadedArchive = await queryPersistedRoomMatchLog(room.matchId);
    expect(loadedArchive?.status).toBe('completed');

    const loadedLive = await loadLiveRoomSession('CLN001');
    expect(loadedLive).toEqual({ kind: 'not_found' });
  });

  it('writes abandoned terminal live status before deleting on abandoned archive', async () => {
    const room = seedTerminalRoom('CLN002');
    room.state = mkGameState({ gameOver: false, handOver: true });
    room.abandonedAt = new Date().toISOString();
    room.abandonedByUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    room.abandonedReason = 'forfeit';

    const terminalLiveStatuses: string[] = [];

    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/room_match_logs') && init?.method === 'POST') {
        const rows = JSON.parse(String(init.body)) as ArchiveRow[];
        for (const row of rows) {
          persistenceStore.matchLogs.set(String(row.match_id), row);
        }
        return undefined;
      }
      if (path.includes('/room_live_sessions') && init?.method === 'POST') {
        const rows = JSON.parse(String(init.body)) as LiveRow[];
        for (const row of rows) {
          terminalLiveStatuses.push(String(row.status));
          persistenceStore.liveSessions.set(String(row.room_code), row);
        }
        return undefined;
      }
      if (path.includes('/room_live_sessions') && init?.method === 'DELETE') {
        const code = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '')
          .trim()
          .toUpperCase();
        persistenceStore.liveSessions.delete(code);
        return undefined;
      }
      if (path.includes('/room_match_logs') && (!init?.method || init.method === 'GET')) {
        const matchId = decodeURIComponent(path.match(/match_id=eq\.([^&]+)/)?.[1] ?? '');
        const row = persistenceStore.matchLogs.get(matchId);
        return row ? [row] : [];
      }
      if (path.includes('/room_live_sessions') && (!init?.method || init.method === 'GET')) {
        const code = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '')
          .trim()
          .toUpperCase();
        const row = persistenceStore.liveSessions.get(code);
        return row ? [row] : [];
      }
      if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
    });

    const emit = vi.spyOn(telemetry, 'emitMpAuthorityFunnel');
    await persistRoomMatchLog(room, 'abandoned');

    expect(persistenceStore.matchLogs.get(room.matchId)?.status).toBe('abandoned');
    expect(emit).toHaveBeenCalledWith('private_match_archived', expect.objectContaining({
      extra: expect.objectContaining({ status: 'abandoned' }),
    }));
    expect(terminalLiveStatuses).toContain('abandoned');
    expect(persistenceStore.liveSessions.has('CLN002')).toBe(false);
  });

  it('loads the latest archived terminal log by room code for offline room recovery', async () => {
    const room = seedTerminalRoom('CLN003');

    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/room_match_logs') && init?.method === 'POST') {
        const rows = JSON.parse(String(init.body)) as ArchiveRow[];
        for (const row of rows) {
          persistenceStore.matchLogs.set(String(row.match_id), row);
        }
        return undefined;
      }
      if (path.includes('/room_live_sessions') && init?.method === 'POST') {
        return undefined;
      }
      if (path.includes('/room_live_sessions') && init?.method === 'DELETE') {
        return undefined;
      }
      if (path.includes('/room_match_logs') && (!init?.method || init.method === 'GET')) {
        const roomCode = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '')
          .trim()
          .toUpperCase();
        const row = [...persistenceStore.matchLogs.values()].find(
          (candidate) => String(candidate.room_code).toUpperCase() === roomCode,
        );
        return row ? [row] : [];
      }
      if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
    });

    await persistRoomMatchLog(room, 'completed');

    const loadedArchive = await queryLatestPersistedRoomMatchLogByRoomCode('cln003');

    expect(loadedArchive?.match_id).toBe(room.matchId);
    expect(loadedArchive?.room_code).toBe('CLN003');
    expect(loadedArchive?.status).toBe('completed');
  });

  it('probeRoomMatchLogsTable sets availability true when table exists', async () => {
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/room_match_logs') && (!init?.method || init.method === 'GET')) {
        return [];
      }
      if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
    });

    const ok = await probeRoomMatchLogsTable();
    expect(ok).toBe(true);
    expect(getRoomMatchLogsPersistenceAvailability()).toBe(true);
  });

  it('probeRoomMatchLogsTable marks table unavailable on PGRST205', async () => {
    vi.mocked(supabaseFetch).mockRejectedValueOnce(
      new Error('Supabase request failed: 404 {"code":"PGRST205","message":"Could not find the table \'public.room_match_logs\'"}'),
    );

    const ok = await probeRoomMatchLogsTable();
    expect(ok).toBe(false);
    expect(getRoomMatchLogsPersistenceAvailability()).toBe(false);
  });

  it('archive still completes when mp.authority insert fails', async () => {
    const room = seedTerminalRoom('CLN004');
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/mp_authority_events')) {
        throw new Error('mp_authority_events down');
      }
      if (path.includes('/room_match_logs') && init?.method === 'POST') {
        const rows = JSON.parse(String(init.body)) as ArchiveRow[];
        for (const row of rows) {
          persistenceStore.matchLogs.set(String(row.match_id), row);
        }
        return undefined;
      }
      if (path.includes('/room_live_sessions')) return undefined;
      if (path.includes('/room_match_logs')) {
        const matchId = decodeURIComponent(path.match(/match_id=eq\.([^&]+)/)?.[1] ?? '');
        const row = persistenceStore.matchLogs.get(matchId);
        return row ? [row] : [];
      }
      throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
    });

    await expect(persistRoomMatchLog(room, 'completed')).resolves.toBeUndefined();
    await flushMpAuthorityEventPersistForTests();
    expect(persistenceStore.matchLogs.get(room.matchId)?.status).toBe('completed');
  });
});
