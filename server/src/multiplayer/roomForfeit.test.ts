import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, setRoomRoster } from './roomSession';
import { applyActiveMatchForfeit } from './roomForfeit';
import { processRealtimeMultiplayerGame } from '../ranking/periodService';
import { insertRankedGameIdempotent } from '../ranking/insertRankedGameIdempotent';
import { supabaseFetch } from '../supabaseUtils';

vi.mock('../ranking/periodService', () => ({
  processRealtimeMultiplayerGame: vi.fn(async () => ({
    playerA: { delta: -10 },
    playerB: { delta: 10 },
  })),
}));

vi.mock('../ranking/insertRankedGameIdempotent', () => ({
  insertRankedGameIdempotent: vi.fn(async () => ({
    isNew: true,
    game: { id: 'game-123' },
  })),
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path) => {
    if (path.includes('/profiles?id=eq.')) {
      const match = path.match(/eq\.([^&]+)/);
      const userId = match ? match[1] : 'unknown';
      return [{ id: userId, glicko_rating: 1500, glicko_rd: 350, glicko_vol: 0.06 }];
    }
    return [];
  }),
}));

const persistRoomMatchLogMock = vi.fn(async () => undefined);

function makeIo() {
  const emit = vi.fn();
  return {
    to: vi.fn(() => ({ emit })),
    __emit: emit,
  } as any;
}

describe('applyActiveMatchForfeit', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    persistRoomMatchLogMock.mockClear();
    vi.mocked(processRealtimeMultiplayerGame).mockClear();
    vi.mocked(insertRankedGameIdempotent).mockClear();
    vi.mocked(supabaseFetch).mockClear();

    initRoomSession({} as any, {
      resolveSocketIdentity: async () => ({ username: 'Player', userId: 'u1' }),
      normalizeUsername: (value) => (typeof value === 'string' && value.trim() ? value.trim() : 'Guest'),
      normalizeUserId: (value) => (typeof value === 'string' && value.trim() ? value.trim() : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped',
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      persistRoomMatchLog: persistRoomMatchLogMock,
      onGameOver: () => null,
    });
  });

  it('returns null without mutating when the room is already abandoned', async () => {
    const roomCode = 'FORF1';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    joinRoom(roomCode, 'p2');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' },
      { id: 'p2', socketId: 'sock-p2', username: 'P2', userId: 'u2' },
    ]);
    const room = getRoom(roomCode);
    room.abandonedAt = new Date().toISOString();

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    const result = await applyActiveMatchForfeit(io, socket, roomCode, {
      id: 'p1',
      username: 'P1',
      userId: 'u1',
    });

    expect(result).toBeNull();
    expect(persistRoomMatchLogMock).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('does not trigger Glicko updates when max score is < 10', async () => {
    const roomCode = 'FORF2';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    joinRoom(roomCode, 'p2');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' },
      { id: 'p2', socketId: 'sock-p2', username: 'P2', userId: 'u2' },
    ]);

    const room = getRoom(roomCode);
    room.state = {
      config: { scoringMultiple: 5, winningScore: 60 },
      playerIds: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', hand: [], score: 5 },
        p2: { id: 'p2', hand: [], score: 0 },
      },
    } as any;

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    await applyActiveMatchForfeit(io, socket, roomCode, {
      id: 'p1',
      username: 'P1',
      userId: 'u1',
    });

    expect(processRealtimeMultiplayerGame).not.toHaveBeenCalled();
    expect(insertRankedGameIdempotent).not.toHaveBeenCalled();
  });

  it('triggers Glicko updates with scale 1.0 on manual forfeit when max score is >= 10', async () => {
    const roomCode = 'FORF3';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    joinRoom(roomCode, 'p2');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' },
      { id: 'p2', socketId: 'sock-p2', username: 'P2', userId: 'u2' },
    ]);

    const room = getRoom(roomCode);
    room.state = {
      config: { scoringMultiple: 5, winningScore: 60 },
      playerIds: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', hand: [], score: 15 },
        p2: { id: 'p2', hand: [], score: 20 },
      },
    } as any;

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    await applyActiveMatchForfeit(io, socket, roomCode, {
      id: 'p1',
      username: 'P1',
      userId: 'u1',
    }, 'manual');

    expect(processRealtimeMultiplayerGame).toHaveBeenCalledWith(
      expect.objectContaining({
        ratingScale: 1.0,
      })
    );
    expect(insertRankedGameIdempotent).toHaveBeenCalledTimes(2);

    // No score synthesis: loser p1's actual room.state score (15) and
    // winner p2's actual room.state score (20) are used as-is.
    expect(insertRankedGameIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: 'u1',
        opponentId: 'u2',
        playerScore: 15,
        opponentScore: 20,
      })
    );
  });

  it('triggers Glicko updates with scale 0.5 on disconnect timeout forfeit when max score is >= 10', async () => {
    const roomCode = 'FORF4';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    joinRoom(roomCode, 'p2');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' },
      { id: 'p2', socketId: 'sock-p2', username: 'P2', userId: 'u2' },
    ]);

    const room = getRoom(roomCode);
    room.state = {
      config: { scoringMultiple: 5, winningScore: 60 },
      playerIds: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', hand: [], score: 8 },
        p2: { id: 'p2', hand: [], score: 12 },
      },
    } as any;

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    await applyActiveMatchForfeit(io, socket, roomCode, {
      id: 'p1',
      username: 'P1',
      userId: 'u1',
    }, 'disconnect_timeout');

    expect(processRealtimeMultiplayerGame).toHaveBeenCalledWith(
      expect.objectContaining({
        ratingScale: 0.5,
      })
    );
  });

  it('never inflates a low winner score or clamps the loser score — writes room.state as-is even below the old 60-floor', async () => {
    const roomCode = 'FORF5';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    joinRoom(roomCode, 'p2');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' },
      { id: 'p2', socketId: 'sock-p2', username: 'P2', userId: 'u2' },
    ]);

    const room = getRoom(roomCode);
    room.state = {
      config: { scoringMultiple: 5, winningScore: 60 },
      playerIds: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', hand: [], score: 3 },
        p2: { id: 'p2', hand: [], score: 10 },
      },
    } as any;

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    await applyActiveMatchForfeit(io, socket, roomCode, {
      id: 'p1',
      username: 'P1',
      userId: 'u1',
    }, 'manual');

    // Old behavior would have written opponentScore: 60 (Math.max(60, 10))
    // and playerScore: min(3, 55) = 3. The winner's real score (10) is far
    // below the old synthesized floor of 60 — it must be written honestly.
    expect(insertRankedGameIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: 'u1',
        opponentId: 'u2',
        playerScore: 3,
        opponentScore: 10,
      })
    );
  });
});