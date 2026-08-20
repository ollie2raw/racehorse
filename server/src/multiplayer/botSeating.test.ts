import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReservedRoom,
  deleteRoom,
  getRoom,
  joinRoom,
  startGame,
} from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import {
  broadcastStateUpdate,
  getRoomRoster,
  initRoomSession,
  setRoomRoster,
} from './roomSession';
import { seatSyntheticBotInRoom } from './botSeating';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/room_live_sessions') && init?.method === 'POST') {
      return undefined;
    }
    if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
  }),
}));

function makeIo() {
  return {
    sockets: {
      sockets: new Map(),
      adapter: { rooms: new Map() },
    },
    to: () => ({
      emit: vi.fn(),
      except: () => ({ emit: vi.fn() }),
    }),
  } as any;
}

function initTestRoomSession(io = makeIo()) {
  initRoomSession(io, {
    resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
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
  });
}

describe('seatSyntheticBotInRoom', () => {
  afterEach(() => {
    deleteRoom('BOTSEAT1');
    deleteRoom('BOTTURN1');
    vi.mocked(supabaseFetch).mockClear();
    vi.useRealTimers();
  });

  it('is idempotent and preserves existing human roster rows', () => {
    const room = createReservedRoom('BOTSEAT1');
    joinRoom(room.code, 'human-1');
    setRoomRoster(room.code, [
      { id: 'human-1', socketId: 'sock-human', username: 'Human', userId: 'u1' },
    ]);

    seatSyntheticBotInRoom(room.code, 'bot:fritz:tour-1:1', 'Fritz');
    seatSyntheticBotInRoom(room.code, 'bot:fritz:tour-1:1', 'Fritz');

    expect(room.players).toEqual(['human-1', 'bot:fritz:tour-1:1']);
    expect(getRoomRoster(room.code)).toEqual([
      { id: 'human-1', socketId: 'sock-human', username: 'Human', userId: 'u1' },
      {
        id: 'bot:fritz:tour-1:1',
        socketId: '',
        username: 'Fritz',
        userId: null,
      },
    ]);
    expect(room.matchStartReady.has('bot:fritz:tour-1:1')).toBe(true);
  });
});

describe('synthetic Fritz turn driver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initTestRoomSession();
  });

  afterEach(() => {
    deleteRoom('BOTTURN1');
    vi.useRealTimers();
  });

  it('fires after game start when the current player is Fritz', async () => {
    const room = createReservedRoom('BOTTURN1', { winningScore: 30 });
    seatSyntheticBotInRoom(room.code, 'bot:fritz:tour-1:1', 'Fritz');
    joinRoom(room.code, 'human-1');
    await startGame(room.code, makeIo());

    const started = getRoom(room.code);
    if (started.state) {
      started.state.currentPlayerIndex = started.state.playerIds.indexOf('bot:fritz:tour-1:1');
    }
    const beforeSequence = started.state?.sequence ?? 0;

    broadcastStateUpdate(room.code);
    await vi.advanceTimersByTimeAsync(1600);

    expect(getRoom(room.code).state?.sequence).toBeGreaterThan(beforeSequence);
  });
});
