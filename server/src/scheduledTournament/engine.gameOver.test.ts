import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
}));

const sentryCaptureMessage = vi.fn();
vi.mock('@sentry/node', () => ({
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
}));

import { applyTournamentGameOverFromRoom } from './engine';
import type { EnginePersistence } from './persistenceInterface';
import { inMemoryMatchRpcForArrayStore } from './inMemoryMatchRpc.testkit';
import type { MatchRow, ScheduledTournamentRow } from './types';

function makeIoMock() {
  return {
    emit: vi.fn(),
    sockets: { sockets: new Map() },
  } as unknown as import('socket.io').Server;
}

function makeGameOverPersistence(match: MatchRow): EnginePersistence {
  const tournament: ScheduledTournamentRow = {
    id: match.tournament_id,
    scheduled_start: new Date('2026-05-16T00:00:00Z').toISOString(),
    registration_open_at: new Date('2026-05-15T23:30:00Z').toISOString(),
    registration_close_at: new Date('2026-05-15T23:58:00Z').toISOString(),
    status: 'in_progress',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: new Date().toISOString(),
  };
  const store = {
    tournament,
    matches: [match],
    regs: [] as import('./types').RegistrationRow[],
  };

  return {
    fetchTournamentById: async (id) => (id === tournament.id ? tournament : null),
    fetchMatches: async () => store.matches,
    fetchMatchById: async (id) => store.matches.find((m) => m.id === id) ?? null,
    updateMatch: async (id, patch) => {
      const row = store.matches.find((m) => m.id === id);
      if (row) Object.assign(row, patch);
    },
    ...inMemoryMatchRpcForArrayStore(store),
    updateRegistrationStatus: async () => {},
    updateTournamentStatus: async () => {},
    insertMatch: async () => {
      throw new Error('not expected');
    },
    fetchRegistrations: async () => store.regs,
    fetchRegistrationsWithProfile: async () => [],
    getRoom: () => {
      throw new Error('not expected');
    },
  } as unknown as EnginePersistence;
}

const liveMatch: MatchRow = {
  id: 'match-direct',
  tournament_id: 'tour-1',
  round: 1,
  match_number: 1,
  player1_id: 'u1',
  player2_id: 'u2',
  winner_id: null,
  room_code: 'T1R1M1',
  status: 'in_progress',
  started_at: new Date().toISOString(),
  completed_at: null,
  ready_at: new Date().toISOString(),
  ready_deadline_at: new Date().toISOString(),
  player1_joined_at: new Date().toISOString(),
  player2_joined_at: new Date().toISOString(),
  winner_source: null,
  status_reason: null,
  forfeit_user_id: null,
  no_show_user_id: null,
  bot_tier: null,
  player1_score: null,
  player2_score: null,
};

describe('applyTournamentGameOverFromRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses scheduledTournamentMatchId without room lookup', async () => {
    const persistence = makeGameOverPersistence({ ...liveMatch });
    const lookup = vi.fn();
    const io = makeIoMock();

    const applied = await applyTournamentGameOverFromRoom(
      io,
      { code: 'T1R1M1', scheduledTournamentMatchId: 'match-direct' },
      { winnerUserId: 'u1', player1Score: 30, player2Score: 10 },
      persistence,
      lookup,
    );

    expect(applied).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
    const updated = await persistence.fetchMatchById('match-direct');
    expect(updated?.status).toBe('completed');
    expect(updated?.winner_id).toBe('u1');
  });

  it('falls back to room code when in-memory match id is missing', async () => {
    const persistence = makeGameOverPersistence({ ...liveMatch, id: 'match-from-room' });
    const lookup = vi.fn().mockResolvedValue({ ...liveMatch, id: 'match-from-room' });
    const io = makeIoMock();

    const applied = await applyTournamentGameOverFromRoom(
      io,
      { code: 'T1R1M1' },
      { winnerUserId: 'u1', player1Score: 30, player2Score: 10 },
      persistence,
      lookup,
    );

    expect(applied).toBe(true);
    expect(lookup).toHaveBeenCalledWith('T1R1M1');
    const updated = await persistence.fetchMatchById('match-from-room');
    expect(updated?.status).toBe('completed');
  });

  it('applyMatchResult is idempotent after game_over completion', async () => {
    const persistence = makeGameOverPersistence({ ...liveMatch });
    const io = makeIoMock();
    const { applyMatchResult } = await import('./engine');

    await applyMatchResult(
      io,
      {
        matchId: 'match-direct',
        winnerId: 'u1',
        player1Score: 30,
        player2Score: 10,
        winnerSource: 'game_over',
      },
      persistence,
    );
    await applyMatchResult(
      io,
      {
        matchId: 'match-direct',
        winnerId: 'u2',
        player1Score: 30,
        player2Score: 10,
        winnerSource: 'game_over',
      },
      persistence,
    );

    const updated = await persistence.fetchMatchById('match-direct');
    expect(updated?.status).toBe('completed');
    expect(updated?.winner_id).toBe('u1');
  });

  it('alerts (T-15) when the completion RPC rejects a non-participant winner', async () => {
    const persistence = makeGameOverPersistence({ ...liveMatch });
    (persistence as { completeTournamentMatch: unknown }).completeTournamentMatch = async () => {
      throw new Error('winner_not_participant');
    };
    const io = makeIoMock();
    const { applyMatchResult } = await import('./engine');

    await expect(
      applyMatchResult(
        io,
        { matchId: 'match-direct', winnerId: 'u3', player1Score: 30, player2Score: 10, winnerSource: 'game_over' },
        persistence,
      ),
    ).rejects.toThrow('winner_not_participant');

    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('winner_not_participant'),
      expect.objectContaining({
        level: 'error',
        fingerprint: ['tournament-invariant-violation', 'winner_not_participant', 'match-direct'],
        tags: expect.objectContaining({ tournament_alert: 'invariant_violation' }),
      }),
    );
  });

  it('alerts (T-15) when the bracket advance target is missing', async () => {
    const persistence = makeGameOverPersistence({ ...liveMatch });
    (persistence as { completeTournamentMatch: unknown }).completeTournamentMatch = async () => ({
      status: 'completed',
      winner_id: 'u1',
      winner_source: 'game_over',
      player1_score: 30,
      player2_score: 10,
      applied: true,
      conflict: false,
      advance_target_missing: true,
      advanced_to_match_id: null,
      advanced_to_slot: null,
      advanced_to_status: null,
      tournament_completed: false,
      round_now_complete: false,
      placements: null,
    });
    const io = makeIoMock();
    const { applyMatchResult } = await import('./engine');

    await applyMatchResult(
      io,
      { matchId: 'match-direct', winnerId: 'u1', player1Score: 30, player2Score: 10, winnerSource: 'game_over' },
      persistence,
    );

    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('advance_target_missing'),
      expect.objectContaining({
        level: 'error',
        fingerprint: ['tournament-invariant-violation', 'advance_target_missing', 'match-direct'],
      }),
    );
  });

  it('alerts (T-15) on double advancement — advanced match id with no resulting status', async () => {
    const persistence = makeGameOverPersistence({ ...liveMatch });
    (persistence as { completeTournamentMatch: unknown }).completeTournamentMatch = async () => ({
      status: 'completed',
      winner_id: 'u1',
      winner_source: 'game_over',
      player1_score: 30,
      player2_score: 10,
      applied: true,
      conflict: false,
      advance_target_missing: false,
      advanced_to_match_id: 'match-sf1',
      advanced_to_slot: 'player1',
      advanced_to_status: null,
      tournament_completed: false,
      round_now_complete: false,
      placements: null,
    });
    const io = makeIoMock();
    const { applyMatchResult } = await import('./engine');

    await applyMatchResult(
      io,
      { matchId: 'match-direct', winnerId: 'u1', player1Score: 30, player2Score: 10, winnerSource: 'game_over' },
      persistence,
    );

    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('double_advancement'),
      expect.objectContaining({
        fingerprint: ['tournament-invariant-violation', 'double_advancement', 'match-direct'],
      }),
    );
  });

  it('returns false without throwing when no tournament match resolves', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const io = makeIoMock();
    const applied = await applyTournamentGameOverFromRoom(
      io,
      { code: 'PRIVATE1' },
      { winnerUserId: 'u1', player1Score: 30, player2Score: 0 },
      makeGameOverPersistence({ ...liveMatch }),
      lookup,
    );

    expect(applied).toBe(false);
    expect(lookup).toHaveBeenCalledWith('PRIVATE1');
  });
});
