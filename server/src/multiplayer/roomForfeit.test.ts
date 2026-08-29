import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, setRoomRoster } from './roomSession';
import { applyActiveMatchForfeit } from './roomForfeit';
import {
  resetLiveRoomPersistenceForTests,
  setLiveRoomPersistenceShuttingDown,
} from './roomLivePersistence';
import { processRealtimeMultiplayerGame } from '../ranking/periodService';
import { insertRankedGameIdempotent } from '../ranking/insertRankedGameIdempotent';
import { supabaseFetch } from '../supabaseUtils';

const applyMatchResultMock = vi.fn();
const fetchMatchByIdMock = vi.fn();
const emitMpAuthorityFunnelMock = vi.fn();

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

vi.mock('../scheduledTournament/persistence', () => ({
  fetchMatchById: (...args: unknown[]) => fetchMatchByIdMock(...args),
}));

vi.mock('../scheduledTournament/engine', () => ({
  applyMatchResult: (...args: unknown[]) => applyMatchResultMock(...args),
}));

vi.mock('./mpAuthorityTelemetry', () => ({
  emitMpAuthorityFunnel: (...args: unknown[]) => emitMpAuthorityFunnelMock(...args),
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
    resetLiveRoomPersistenceForTests();
    setLiveRoomPersistenceShuttingDown(true);
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

  afterEach(() => {
    resetLiveRoomPersistenceForTests();
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

  it('rates a forfeit below 10 points — there is no early-abandonment escape hatch', async () => {
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

    expect(insertRankedGameIdempotent).toHaveBeenCalledTimes(2);
    expect(processRealtimeMultiplayerGame).toHaveBeenCalledTimes(1);
    // p1 quit while ahead 5-0 and still takes the loss.
    expect(insertRankedGameIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'u1', outcome: 'loss' }),
    );
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


describe('tournament forfeit apply durability (G2)', () => {
  beforeEach(() => {
    resetLiveRoomPersistenceForTests();
    setLiveRoomPersistenceShuttingDown(true);
    resetRoomRuntimeForTests();
    persistRoomMatchLogMock.mockClear();
    applyMatchResultMock.mockReset();
    fetchMatchByIdMock.mockReset();
    emitMpAuthorityFunnelMock.mockClear();

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

  afterEach(() => {
    resetLiveRoomPersistenceForTests();
    vi.useRealTimers();
  });

  function seedTournamentRoom(roomCode: string) {
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'p1');
    joinRoom(roomCode, 'p2');
    setRoomRoster(roomCode, [
      { id: 'p1', socketId: 'sock-p1', username: 'P1', userId: 'u1' },
      { id: 'p2', socketId: 'sock-p2', username: 'P2', userId: 'u2' },
    ]);
    const room = getRoom(roomCode);
    room.scheduledTournamentId = 'tour-1';
    room.scheduledTournamentMatchId = 'match-1';
    room.config = { ...room.config, winningScore: 30 };
    room.state = {
      config: { scoringMultiple: 5, winningScore: 30 },
      playerIds: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', hand: [], score: 5 },
        p2: { id: 'p2', hand: [], score: 10 },
      },
      sequence: 4,
      gameOver: false,
    } as any;
    fetchMatchByIdMock.mockResolvedValue({
      id: 'match-1',
      tournament_id: 'tour-1',
      player1_id: 'u1',
      player2_id: 'u2',
    });
    return room;
  }

  it('forfeit + applyMatchResult succeeds → abandonedAt set, abandon emit, opponent winner', async () => {
    const room = seedTournamentRoom('TFOR1');
    applyMatchResultMock.mockResolvedValue(undefined);

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    const result = await applyActiveMatchForfeit(io, socket, 'TFOR1', {
      id: 'p1',
      username: 'P1',
      userId: 'u1',
    });

    expect(result).toEqual({ winnerUserId: 'u2' });
    expect(applyMatchResultMock).toHaveBeenCalledTimes(1);
    expect(applyMatchResultMock).toHaveBeenCalledWith(
      io,
      expect.objectContaining({
        matchId: 'match-1',
        winnerId: 'u2',
        winnerSource: 'forfeit',
        forfeitUserId: 'u1',
      }),
    );
    expect(room.abandonedAt).toEqual(expect.any(String));
    expect(room.tournamentForfeitApplyStatus).toBe('succeeded');
    expect(room.abandonedWinnerUserId).toBe('u2');
    expect(io.__emit).toHaveBeenCalledWith(
      'room:match_abandoned',
      expect.objectContaining({
        winnerId: 'u2',
        isTournament: true,
        scheduledTournamentMatchId: 'match-1',
      }),
    );
    expect(persistRoomMatchLogMock).toHaveBeenCalledWith(expect.anything(), 'abandoned');
  });

  it('forfeit + apply fails then succeeds on retry — no abandonedAt until success', async () => {
    vi.useFakeTimers();
    const room = seedTournamentRoom('TFOR2');
    applyMatchResultMock
      .mockRejectedValueOnce(new Error('db_blip'))
      .mockResolvedValue(undefined);

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    const pending = applyActiveMatchForfeit(io, socket, 'TFOR2', {
      id: 'p1',
      username: 'P1',
      userId: 'u1',
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(room.tournamentForfeitApplyStatus).toBe('pending');
    expect(room.abandonedAt).toBeUndefined();
    expect(io.__emit).not.toHaveBeenCalledWith('room:match_abandoned', expect.anything());

    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toEqual({ winnerUserId: 'u2' });
    expect(applyMatchResultMock).toHaveBeenCalledTimes(2);
    expect(room.abandonedAt).toEqual(expect.any(String));
    expect(room.tournamentForfeitApplyStatus).toBe('succeeded');
    expect(io.__emit).toHaveBeenCalledWith(
      'room:match_abandoned',
      expect.objectContaining({ winnerId: 'u2' }),
    );
  });

  it('forfeit + apply exhausts retries → terminal failed, not abandoned, no abandon emit', async () => {
    vi.useFakeTimers();
    const room = seedTournamentRoom('TFOR3');
    applyMatchResultMock.mockRejectedValue(new Error('db_down'));

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    const pending = applyActiveMatchForfeit(io, socket, 'TFOR3', {
      id: 'p1',
      username: 'P1',
      userId: 'u1',
    });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toBeNull();
    expect(applyMatchResultMock.mock.calls.length).toBe(4);
    expect(room.abandonedAt).toBeUndefined();
    expect(room.tournamentForfeitApplyStatus).toBe('failed');
    expect(persistRoomMatchLogMock).not.toHaveBeenCalled();
    expect(io.__emit).not.toHaveBeenCalledWith('room:match_abandoned', expect.anything());
    expect(io.__emit).toHaveBeenCalledWith(
      'match:result_persist_failed',
      expect.objectContaining({
        message: expect.stringContaining('tournament result'),
      }),
    );
    expect(emitMpAuthorityFunnelMock).toHaveBeenCalledWith(
      'private_game_over_persist_failed',
      expect.objectContaining({
        roomCode: 'TFOR3',
        extra: expect.objectContaining({ kind: 'tournament_forfeit_apply' }),
      }),
    );
  });

  it('while pending/retrying, abandonedAt stays unset and match_abandoned is not emitted', async () => {
    vi.useFakeTimers();
    const room = seedTournamentRoom('TFOR4');
    let resolveApply!: () => void;
    applyMatchResultMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveApply = resolve;
        }),
    );

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    const pending = applyActiveMatchForfeit(io, socket, 'TFOR4', {
      id: 'p1',
      username: 'P1',
      userId: 'u1',
    });

    await Promise.resolve();
    expect(room.tournamentForfeitApplyStatus).toBe('pending');
    expect(room.abandonedAt).toBeUndefined();
    expect(io.__emit).not.toHaveBeenCalledWith('room:match_abandoned', expect.anything());

    resolveApply();
    await vi.runAllTimersAsync();
    await pending;

    expect(room.abandonedAt).toEqual(expect.any(String));
    expect(room.tournamentForfeitApplyStatus).toBe('succeeded');
  });
});

describe('forfeit rating outcome is decided by who quit, not by the scoreboard', () => {
  beforeEach(() => {
    resetLiveRoomPersistenceForTests();
    setLiveRoomPersistenceShuttingDown(true);
    resetRoomRuntimeForTests();
    vi.mocked(processRealtimeMultiplayerGame).mockClear();
    vi.mocked(insertRankedGameIdempotent).mockClear();

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

  afterEach(() => {
    resetLiveRoomPersistenceForTests();
  });

  async function forfeitWithScores(
    roomCode: string,
    abandonerScore: number,
    opponentScore: number,
    reason: 'manual' | 'disconnect_timeout' = 'manual',
  ) {
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
        p1: { id: 'p1', hand: [], score: abandonerScore },
        p2: { id: 'p2', hand: [], score: opponentScore },
      },
    } as any;

    const io = makeIo();
    const socket = { id: 'sock-p1', data: { userId: 'u1' } } as any;
    return applyActiveMatchForfeit(
      io,
      socket,
      roomCode,
      { id: 'p1', username: 'P1', userId: 'u1' },
      reason,
    );
  }

  it('marks the abandoner as the loser when they quit while AHEAD on points', async () => {
    const result = await forfeitWithScores('FSIGN1', 40, 20);

    // Match history already had this right; the rating write now agrees with it.
    expect(result).toEqual({ winnerUserId: 'u2' });

    expect(insertRankedGameIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: 'u1',
        opponentId: 'u2',
        playerScore: 40,
        opponentScore: 20,
        outcome: 'loss',
      }),
    );
    expect(insertRankedGameIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: 'u2',
        opponentId: 'u1',
        playerScore: 20,
        opponentScore: 40,
        outcome: 'win',
      }),
    );
  });

  it('passes the outcomes through to the Glicko update, not just the inserted row', async () => {
    await forfeitWithScores('FSIGN2', 40, 20);

    expect(processRealtimeMultiplayerGame).toHaveBeenCalledWith(
      expect.objectContaining({
        playerAOutcome: 'loss',
        playerBOutcome: 'win',
      }),
    );
  });

  it('keeps the already-correct result when the abandoner quit while BEHIND', async () => {
    await forfeitWithScores('FSIGN3', 20, 40);

    expect(insertRankedGameIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'u1', outcome: 'loss' }),
    );
    expect(insertRankedGameIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'u2', outcome: 'win' }),
    );
  });

  it('marks the abandoner as the loser from a level scoreboard', async () => {
    await forfeitWithScores('FSIGN4', 30, 30);

    expect(insertRankedGameIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'u1', outcome: 'loss' }),
    );
    expect(insertRankedGameIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'u2', outcome: 'win' }),
    );
  });

  it('applies the same sign on a disconnect timeout, at half weight', async () => {
    await forfeitWithScores('FSIGN5', 55, 5, 'disconnect_timeout');

    expect(processRealtimeMultiplayerGame).toHaveBeenCalledWith(
      expect.objectContaining({
        ratingScale: 0.5,
        playerAOutcome: 'loss',
        playerBOutcome: 'win',
      }),
    );
  });

  it('orients the outcome by seat, not by argument order, when seat B abandons', async () => {
    const roomCode = 'FSIGN6';
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
        p1: { id: 'p1', hand: [], score: 10 },
        p2: { id: 'p2', hand: [], score: 45 },
      },
    } as any;

    const io = makeIo();
    const socket = { id: 'sock-p2', data: { userId: 'u2' } } as any;
    await applyActiveMatchForfeit(
      io,
      socket,
      roomCode,
      { id: 'p2', username: 'P2', userId: 'u2' },
      'manual',
    );

    // Seat A is p1 (the stayer) — playerA is the seat, not the abandoner.
    expect(processRealtimeMultiplayerGame).toHaveBeenCalledWith(
      expect.objectContaining({
        playerAOutcome: 'win',
        playerBOutcome: 'loss',
      }),
    );
    expect(insertRankedGameIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'u2', outcome: 'loss' }),
    );
  });
});
