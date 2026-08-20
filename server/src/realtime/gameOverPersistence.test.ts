import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import type { Room } from '../rooms';
import type { GameOverPersistInput } from '../multiplayer/roomSession';
import { createInitialRoomDurabilityState } from '../multiplayer/roomDurability';

const {
  applyTournamentGameOverFromRoomMock,
  findTournamentMatchByRoomMock,
  getPendingFritzMatchContextMock,
  resolvePendingFritzMatchMock,
  appendMatchMock,
  writeMatchActivityMock,
  recordPublicOnlineMatchMock,
  supabaseFetchMock,
  insertRankedGameIdempotentMock,
  completeGhostGameMock,
  processRealtimeMultiplayerGameMock,
  recordMatchEndMock,
  recordLeagueLiveResultMock,
  isRankedGameSourceColumnsEnabledMock,
  logWarnMock,
  verifyPlayerMoveLogMock,
  emitMpAuthorityFunnelMock,
} = vi.hoisted(() => ({
  applyTournamentGameOverFromRoomMock: vi.fn(),
  findTournamentMatchByRoomMock: vi.fn(),
  getPendingFritzMatchContextMock: vi.fn(),
  resolvePendingFritzMatchMock: vi.fn(),
  appendMatchMock: vi.fn(),
  writeMatchActivityMock: vi.fn(),
  recordPublicOnlineMatchMock: vi.fn(),
  supabaseFetchMock: vi.fn(),
  insertRankedGameIdempotentMock: vi.fn(),
  completeGhostGameMock: vi.fn(),
  processRealtimeMultiplayerGameMock: vi.fn(),
  recordMatchEndMock: vi.fn(),
  recordLeagueLiveResultMock: vi.fn(),
  isRankedGameSourceColumnsEnabledMock: vi.fn(),
  logWarnMock: vi.fn(),
  verifyPlayerMoveLogMock: vi.fn(),
  emitMpAuthorityFunnelMock: vi.fn(),
}));

vi.mock('../ghost/verifier', () => ({
  verifyPlayerMoveLog: (...args: unknown[]) => verifyPlayerMoveLogMock(...args),
}));

vi.mock('../scheduledTournament', () => ({
  applyTournamentGameOverFromRoom: (...args: unknown[]) => applyTournamentGameOverFromRoomMock(...args),
  findTournamentMatchByRoom: (...args: unknown[]) => findTournamentMatchByRoomMock(...args),
}));

vi.mock('../shared/fritzMatchLifecycle', () => ({
  getPendingFritzMatchContext: (...args: unknown[]) => getPendingFritzMatchContextMock(...args),
  resolvePendingFritzMatch: (...args: unknown[]) => resolvePendingFritzMatchMock(...args),
  formatFritzActivityOpponentLabel: (tier: string) => `Fritz (${tier})`,
}));

vi.mock('../stats/matchLog', () => ({
  appendMatch: (...args: unknown[]) => appendMatchMock(...args),
}));

vi.mock('../social/activityWriter', () => ({
  writeMatchActivity: (...args: unknown[]) => writeMatchActivityMock(...args),
}));

vi.mock('../stats/recordPublicMatch', () => ({
  recordPublicOnlineMatch: (...args: unknown[]) => recordPublicOnlineMatchMock(...args),
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => supabaseFetchMock(...args),
}));

vi.mock('../ranking/insertRankedGameIdempotent', () => ({
  insertRankedGameIdempotent: (...args: unknown[]) => insertRankedGameIdempotentMock(...args),
}));

vi.mock('../ghost/service', () => ({
  completeGhostGame: (...args: unknown[]) => completeGhostGameMock(...args),
}));

vi.mock('../ranking/periodService', () => ({
  processRealtimeMultiplayerGame: (...args: unknown[]) => processRealtimeMultiplayerGameMock(...args),
}));

vi.mock('../matchmaking/persistence', () => ({
  recordMatchEnd: (...args: unknown[]) => recordMatchEndMock(...args),
}));

vi.mock('../league/results', () => ({
  recordLeagueLiveResult: (...args: unknown[]) => recordLeagueLiveResultMock(...args),
}));

vi.mock('../ranking/rankedGamePayload', () => ({
  isRankedGameSourceColumnsEnabled: () => isRankedGameSourceColumnsEnabledMock(),
}));

vi.mock('../logger', () => ({
  childLogger: () => ({ warn: logWarnMock, error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../multiplayer/mpAuthorityTelemetry', () => ({
  emitMpAuthorityFunnel: (...args: unknown[]) => emitMpAuthorityFunnelMock(...args),
}));

import { createGameOverPersistScheduler } from './gameOverPersistence';

const io = {} as Server;
const schedule = createGameOverPersistScheduler(io);

function buildInput(overrides: Partial<GameOverPersistInput> & { room?: Partial<Room> } = {}): GameOverPersistInput {
  const { room: roomOverrides, ...restOverrides } = overrides;
  const a = { id: 'seat-a', userId: 'user-a', username: 'A', socketId: 'sock-a' };
  const b = { id: 'seat-b', userId: 'user-b', username: 'B', socketId: 'sock-b' };
  const room = {
    code: 'ROOM1',
    players: ['seat-a', 'seat-b'],
    state: null,
    config: {},
    asyncStateVersion: 0,
    nextHandReady: new Set<string>(),
    rematchReady: new Set<string>(),
    matchStartReady: new Set<string>(),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
    matchId: 'match-1',
    matchLogged: false,
    leadTracker: null,
    eventLogVersion: 1 as const,
    eventSequence: 0,
    events: [],
    ...roomOverrides,
  } as Room;
  room.durability =
    roomOverrides?.durability ??
    createInitialRoomDurabilityState({
      asyncStateVersion: room.asyncStateVersion,
      state: room.state,
      eventSequence: room.eventSequence,
    });

  return {
    room,
    sourceMatchId: 'match-1',
    cfg: {},
    aId: 'seat-a',
    bId: 'seat-b',
    a,
    b,
    scoreA: 30,
    scoreB: 10,
    winnerSeatId: 'seat-a',
    ...restOverrides,
  };
}

async function runPersist(input: GameOverPersistInput): Promise<void> {
  const runner = schedule(input);
  await runner();
}

describe('createGameOverPersistScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyTournamentGameOverFromRoomMock.mockResolvedValue(false);
    findTournamentMatchByRoomMock.mockResolvedValue(null);
    getPendingFritzMatchContextMock.mockReturnValue(null);
    resolvePendingFritzMatchMock.mockResolvedValue(undefined);
    appendMatchMock.mockResolvedValue(undefined);
    writeMatchActivityMock.mockResolvedValue(undefined);
    isRankedGameSourceColumnsEnabledMock.mockReturnValue(true);
    supabaseFetchMock.mockResolvedValue([]);
    insertRankedGameIdempotentMock.mockResolvedValue({ isNew: false, game: null });
    verifyPlayerMoveLogMock.mockReturnValue({ ok: true });
    processRealtimeMultiplayerGameMock.mockResolvedValue({ playerA: { delta: 1 }, playerB: { delta: -1 } });
    recordLeagueLiveResultMock.mockResolvedValue(undefined);
  });

  it('short-circuits when applyTournamentGameOverFromRoom returns true', async () => {
    applyTournamentGameOverFromRoomMock.mockResolvedValue(true);
    await runPersist(buildInput());

    expect(applyTournamentGameOverFromRoomMock).toHaveBeenCalledTimes(1);
    expect(findTournamentMatchByRoomMock).not.toHaveBeenCalled();
    expect(appendMatchMock).not.toHaveBeenCalled();
    expect(resolvePendingFritzMatchMock).not.toHaveBeenCalled();
  });

  it('returns early for scheduledTournamentMatchId without downstream persist', async () => {
    applyTournamentGameOverFromRoomMock.mockResolvedValue(false);

    await runPersist(buildInput({
      room: { scheduledTournamentMatchId: 'sched-match-1' },
    }));

    expect(appendMatchMock).not.toHaveBeenCalled();
    expect(logWarnMock).not.toHaveBeenCalled();
  });

  it('warns on scheduledTournamentMatchId when winnerUserId is missing', async () => {
    await runPersist(buildInput({
      room: { scheduledTournamentMatchId: 'sched-match-1' },
      winnerSeatId: 'seat-unknown',
    }));

    expect(logWarnMock).toHaveBeenCalledWith(
      { roomCode: 'ROOM1', matchId: 'sched-match-1' },
      'missing winner user id',
    );
    expect(appendMatchMock).not.toHaveBeenCalled();
  });

  it('returns early when findTournamentMatchByRoom finds a match', async () => {
    findTournamentMatchByRoomMock.mockResolvedValue({ id: 'tour-match-9' });

    await runPersist(buildInput());

    expect(findTournamentMatchByRoomMock).toHaveBeenCalledWith('ROOM1');
    expect(appendMatchMock).not.toHaveBeenCalled();
    expect(logWarnMock).not.toHaveBeenCalled();
  });

  it('warns on findTournamentMatchByRoom path when winnerUserId is missing', async () => {
    findTournamentMatchByRoomMock.mockResolvedValue({ id: 'tour-match-9' });

    await runPersist(buildInput({ winnerSeatId: 'seat-unknown' }));

    expect(logWarnMock).toHaveBeenCalledWith(
      { roomCode: 'ROOM1', matchId: 'tour-match-9' },
      'missing winner user id',
    );
    expect(appendMatchMock).not.toHaveBeenCalled();
  });

  it('awaits resolvePendingFritzMatch before appendMatch when Fritz context exists', async () => {
    const callOrder: string[] = [];
    getPendingFritzMatchContextMock.mockImplementation(() => {
      callOrder.push('getPendingFritz');
      return { realPlayer: { id: 'seat-a', userId: 'user-a', username: 'A', socketId: 'sock-a' }, fritzTier: 'elite' };
    });
    resolvePendingFritzMatchMock.mockImplementation(async () => {
      callOrder.push('resolvePendingFritz');
    });
    appendMatchMock.mockImplementation(async () => {
      callOrder.push('appendMatch');
    });

    await runPersist(buildInput());

    expect(resolvePendingFritzMatchMock).toHaveBeenCalledWith('ROOM1');
    expect(callOrder.indexOf('resolvePendingFritz')).toBeLessThan(callOrder.indexOf('appendMatch'));
    expect(appendMatchMock).toHaveBeenCalled();
  });

  it('calls processRealtimeMultiplayerGame when both ranked inserts are new', async () => {
    const profileA = { id: 'user-a', glicko_rating: 1500, glicko_rd: 200 };
    const profileB = { id: 'user-b', glicko_rating: 1500, glicko_rd: 200 };
    const gameA = { id: 'g-a', player_id: 'user-a', opponent_id: 'user-b', player_score: 30, opponent_score: 10, played_at: 't' };
    const gameB = { id: 'g-b', player_id: 'user-b', opponent_id: 'user-a', player_score: 10, opponent_score: 30, played_at: 't' };

    supabaseFetchMock.mockImplementation(async (path: string) => {
      if (path.includes('/rest/v1/profiles?id=eq.user-a')) return [profileA];
      if (path.includes('/rest/v1/profiles?id=eq.user-b')) return [profileB];
      return [];
    });
    insertRankedGameIdempotentMock
      .mockResolvedValueOnce({ isNew: true, game: gameA })
      .mockResolvedValueOnce({ isNew: true, game: gameB });

    await runPersist(buildInput());

    expect(processRealtimeMultiplayerGameMock).toHaveBeenCalledWith({
      playerAProfile: profileA,
      playerBProfile: profileB,
      playerAGame: gameA,
      playerBGame: gameB,
    });
  });

  it('skips processRealtimeMultiplayerGame with warn when either insert is not new', async () => {
    const profileA = { id: 'user-a', glicko_rating: 1500, glicko_rd: 200 };
    const profileB = { id: 'user-b', glicko_rating: 1500, glicko_rd: 200 };
    const gameA = { id: 'g-a', player_id: 'user-a', opponent_id: 'user-b', player_score: 30, opponent_score: 10, played_at: 't' };

    supabaseFetchMock.mockImplementation(async (path: string) => {
      if (path.includes('/rest/v1/profiles?id=eq.user-a')) return [profileA];
      if (path.includes('/rest/v1/profiles?id=eq.user-b')) return [profileB];
      return [];
    });
    insertRankedGameIdempotentMock
      .mockResolvedValueOnce({ isNew: true, game: gameA })
      .mockResolvedValueOnce({ isNew: false, game: null });

    await runPersist(buildInput());

    expect(processRealtimeMultiplayerGameMock).not.toHaveBeenCalled();
    expect(logWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hasPlayerAProfile: true,
        hasPlayerBProfile: true,
        playerAIsNew: true,
        playerBIsNew: false,
        sourceMatchId: 'match-1',
      }),
      'Skipping real-time update — duplicate or missing ranked insert',
    );
  });

  it('calls recordLeagueLiveResult when fixture is active and player mapping is complete', async () => {
    supabaseFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/rest/v1/fixtures')) {
        return [{
          id: 'fixture-1',
          status: 'active',
          home_member_id: 'home-m',
          away_member_id: 'away-m',
          live_room_code: 'ROOM1',
        }];
      }
      if (path.startsWith('/rest/v1/league_members')) {
        return [
          { id: 'home-m', player_user_id: 'user-a' },
          { id: 'away-m', player_user_id: 'user-b' },
        ];
      }
      return [];
    });

    await runPersist(buildInput());

    expect(recordLeagueLiveResultMock).toHaveBeenCalledWith({
      fixtureId: 'fixture-1',
      playerMemberId: 'home-m',
      opponentMemberId: 'away-m',
      homeScore: 30,
      awayScore: 10,
      sourceUserId: 'user-a',
      roomCode: 'ROOM1',
      metadata: { via: 'live-room-auto-finalize' },
    });
  });

  it('skips recordLeagueLiveResult with warn when player mapping is incomplete', async () => {
    supabaseFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/rest/v1/fixtures')) {
        return [{
          id: 'fixture-1',
          status: 'active',
          home_member_id: 'home-m',
          away_member_id: 'away-m',
          live_room_code: 'ROOM1',
        }];
      }
      if (path.startsWith('/rest/v1/league_members')) {
        return [{ id: 'home-m', player_user_id: 'user-a' }];
      }
      return [];
    });

    await runPersist(buildInput());

    expect(recordLeagueLiveResultMock).not.toHaveBeenCalled();
    expect(logWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fixtureId: 'fixture-1',
        hasHomeMember: true,
        hasAwayMember: false,
        hasHomePlayer: true,
        hasAwayPlayer: false,
      }),
      'Skipping live fixture finalization — player mapping missing',
    );
  });

  it('swallows awaited errors with outer log.warn and does not propagate', async () => {
    const boom = new Error('append failed');
    appendMatchMock.mockRejectedValue(boom);

    await expect(runPersist(buildInput())).resolves.toBeUndefined();

    expect(logWarnMock).toHaveBeenCalledWith({ err: boom }, 'ranking/match logging failed');
  });

  describe('live in-room Fritz completion — the category-1 side door', () => {
    function buildFritzInput(overrides: Partial<GameOverPersistInput> & { room?: Partial<Room> } = {}) {
      const a = { id: 'seat-a', userId: 'user-a', username: 'A', socketId: 'sock-a' };
      const b = { id: 'bot:fritz:elite', userId: null, username: 'Fritz', socketId: '' };
      return buildInput({
        a,
        b,
        aId: 'seat-a',
        bId: 'bot:fritz:elite',
        room: { ghostMoveLogs: { 'seat-a': [{ some: 'entry' }] as any } },
        ...overrides,
      });
    }

    it('does not double-insert a ranked_games row for the Fritz seat — completeGhostGame is the sole authoritative Glicko write for that seat', async () => {
      // insertRankedGameIdempotent's dedup key is (player_id, source_match_id)
      // only, not source_type. This loop's unconditional insert used
      // sourceType 'live_room' with room.state's unverified score, then
      // completeGhostGame's own insert (sourceType 'verified_single_player',
      // same matchId) ran moments later and immediately called
      // processRatingPeriod(userId) — whose query
      // (ranked_games?player_id=eq...&rating_after=is.null) has no sourceType
      // filter, so it would pick up and apply BOTH rows' scores as separate
      // Glicko deltas for the same real match.
      supabaseFetchMock.mockResolvedValue([{ id: 'user-a', glicko_rating: 1500, glicko_rd: 200 }]);
      verifyPlayerMoveLogMock.mockReturnValue({ ok: true });

      await runPersist(buildFritzInput());

      expect(insertRankedGameIdempotentMock).not.toHaveBeenCalled();
      expect(completeGhostGameMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-a', applyGlicko: true }),
      );
    });

    it('is the function that determines the final Glicko input for a Fritz completion: verifyPlayerMoveLog gates completeGhostGame.applyGlicko', async () => {
      supabaseFetchMock.mockResolvedValue([{ id: 'user-a', glicko_rating: 1500, glicko_rd: 200 }]);
      verifyPlayerMoveLogMock.mockReturnValue({ ok: true });

      await runPersist(buildFritzInput());

      expect(verifyPlayerMoveLogMock).toHaveBeenCalledWith([{ some: 'entry' }]);
      expect(completeGhostGameMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-a', applyGlicko: true }),
      );
    });

    it('closes the side door: an unverifiable in-room Fritz move log still completes the match but writes no Glicko', async () => {
      supabaseFetchMock.mockResolvedValue([{ id: 'user-a', glicko_rating: 1500, glicko_rd: 200 }]);
      verifyPlayerMoveLogMock.mockReturnValue({ ok: false, reason: 'fabricated board_state', entryIndex: 0 });

      await runPersist(buildFritzInput());

      expect(completeGhostGameMock).toHaveBeenCalledWith(
        expect.objectContaining({ applyGlicko: false }),
      );
      expect(logWarnMock).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'fabricated board_state', entryIndex: 0 }),
        'fritz in-room move log failed verification — recording without Glicko',
      );
      expect(emitMpAuthorityFunnelMock).toHaveBeenCalledWith(
        'private_move_log_verification_failed',
        expect.objectContaining({
          roomCode: 'ROOM1',
          seatId: 'seat-a',
          failureCode: 'move_log_verification_failed',
          extra: expect.objectContaining({
            sourceMatchId: 'match-1',
            reason: 'fabricated board_state',
            entryIndex: 0,
          }),
        }),
      );
    });
  });

  describe('human live-room completion — verify-first Glicko gate', () => {
    const logA = [{ turn: 1, board_state: 'board:empty', tile_played: '3|3' }] as any;
    const logB = [{ turn: 2, board_state: 'board:empty', tile_played: '4|4' }] as any;

    function buildHumanInput(overrides: Partial<GameOverPersistInput> & { room?: Partial<Room> } = {}) {
      const { room: roomOverrides, ...restOverrides } = overrides;
      return buildInput({
        room: {
          ghostMoveLogs: {
            'seat-a': logA,
            'seat-b': logB,
          },
          ...roomOverrides,
        },
        ...restOverrides,
      });
    }

    function mockHumanProfilesAndInserts() {
      const profileA = { id: 'user-a', glicko_rating: 1500, glicko_rd: 200 };
      const profileB = { id: 'user-b', glicko_rating: 1500, glicko_rd: 200 };
      const gameA = { id: 'g-a', player_id: 'user-a', opponent_id: 'user-b', player_score: 30, opponent_score: 10, played_at: 't' };
      const gameB = { id: 'g-b', player_id: 'user-b', opponent_id: 'user-a', player_score: 10, opponent_score: 30, played_at: 't' };

      supabaseFetchMock.mockImplementation(async (path: string) => {
        if (path.includes('/rest/v1/profiles?id=eq.user-a')) return [profileA];
        if (path.includes('/rest/v1/profiles?id=eq.user-b')) return [profileB];
        return [];
      });
      insertRankedGameIdempotentMock
        .mockResolvedValueOnce({ isNew: true, game: gameA })
        .mockResolvedValueOnce({ isNew: true, game: gameB });

      return { profileA, profileB, gameA, gameB };
    }

    it('verifies both logs before ranked insert and applies Glicko when both pass', async () => {
      verifyPlayerMoveLogMock.mockReturnValue({ ok: true });
      const { profileA, profileB, gameA, gameB } = mockHumanProfilesAndInserts();

      await runPersist(buildHumanInput());

      expect(verifyPlayerMoveLogMock).toHaveBeenCalledWith(logA);
      expect(verifyPlayerMoveLogMock).toHaveBeenCalledWith(logB);
      expect(insertRankedGameIdempotentMock).toHaveBeenCalledTimes(2);
      expect(processRealtimeMultiplayerGameMock).toHaveBeenCalledWith({
        playerAProfile: profileA,
        playerBProfile: profileB,
        playerAGame: gameA,
        playerBGame: gameB,
      });
      expect(completeGhostGameMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-a', applyGlicko: undefined }),
      );
      expect(completeGhostGameMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-b', applyGlicko: undefined }),
      );
    });

    it('does not insert ranked_games or apply Glicko when either log fails verification', async () => {
      verifyPlayerMoveLogMock
        .mockReturnValueOnce({ ok: true })
        .mockReturnValueOnce({ ok: false, reason: 'fabricated board_state', entryIndex: 0 });
      mockHumanProfilesAndInserts();

      await runPersist(buildHumanInput());

      expect(insertRankedGameIdempotentMock).not.toHaveBeenCalled();
      expect(processRealtimeMultiplayerGameMock).not.toHaveBeenCalled();
      expect(logWarnMock).toHaveBeenCalledWith(
        expect.objectContaining({
          roomCode: 'ROOM1',
          sourceMatchId: 'match-1',
          seatId: 'seat-b',
          reason: 'fabricated board_state',
          entryIndex: 0,
        }),
        'human live-room move log failed verification — recording without Glicko',
      );
      expect(emitMpAuthorityFunnelMock).toHaveBeenCalledWith(
        'private_move_log_verification_failed',
        expect.objectContaining({
          roomCode: 'ROOM1',
          seatId: 'seat-b',
          failureCode: 'move_log_verification_failed',
          extra: expect.objectContaining({
            sourceMatchId: 'match-1',
            reason: 'fabricated board_state',
            entryIndex: 0,
          }),
        }),
      );
      expect(completeGhostGameMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-a', applyGlicko: false }),
      );
      expect(completeGhostGameMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-b', applyGlicko: false }),
      );
    });

    it('allows Glicko when one seat has an empty log and the other verifies', async () => {
      verifyPlayerMoveLogMock.mockReturnValue({ ok: true });
      const { profileA, profileB, gameA, gameB } = mockHumanProfilesAndInserts();

      await runPersist(
        buildHumanInput({
          room: {
            ghostMoveLogs: {
              'seat-a': logA,
              'seat-b': [],
            },
          },
        }),
      );

      expect(verifyPlayerMoveLogMock).toHaveBeenCalledTimes(1);
      expect(verifyPlayerMoveLogMock).toHaveBeenCalledWith(logA);
      expect(insertRankedGameIdempotentMock).toHaveBeenCalledTimes(2);
      expect(processRealtimeMultiplayerGameMock).toHaveBeenCalledWith({
        playerAProfile: profileA,
        playerBProfile: profileB,
        playerAGame: gameA,
        playerBGame: gameB,
      });
    });
  });
});
