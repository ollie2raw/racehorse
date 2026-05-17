import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverTournamentMatches } from './recovery';
import type { EnginePersistence } from './persistenceInterface';
import type { MatchRow, RegistrationRow, ScheduledTournamentRow } from './types';

vi.mock('./matchDispatch', () => ({
  dispatchTournamentMatch: vi.fn(async () => ({
    ok: true,
    matchId: 'm-ready',
    tournamentId: 'tour-1',
    roomCode: 'TR1',
    status: 'ready',
    readyAt: new Date().toISOString(),
    readyDeadlineAt: new Date().toISOString(),
    recipients: [],
    reusedExistingRoom: true,
    emittedReady: true,
  })),
}));

function makeTournament(): ScheduledTournamentRow {
  return {
    id: 'tour-1',
    scheduled_start: new Date('2026-05-15T00:00:00Z').toISOString(),
    registration_open_at: new Date('2026-05-14T23:30:00Z').toISOString(),
    registration_close_at: new Date('2026-05-14T23:55:00Z').toISOString(),
    status: 'in_progress',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: new Date('2026-05-01T00:00:00Z').toISOString(),
  };
}

function makeMatch(overrides: Partial<MatchRow>): MatchRow {
  return {
    id: 'm-1',
    tournament_id: 'tour-1',
    round: 1,
    match_number: 1,
    player1_id: 'u1',
    player2_id: 'u2',
    winner_id: null,
    room_code: 'TR1',
    status: 'ready',
    ready_at: null,
    ready_deadline_at: null,
    started_at: null,
    completed_at: null,
    player1_joined_at: null,
    player2_joined_at: null,
    winner_source: null,
    status_reason: null,
    forfeit_user_id: null,
    no_show_user_id: null,
    bot_tier: null,
    player1_score: null,
    player2_score: null,
    ...overrides,
  };
}

describe('recoverTournamentMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recreates a missing in-progress room and re-dispatches ready matches', async () => {
    const rooms = new Map<string, any>();
    const readyMatch = makeMatch({ id: 'm-ready', status: 'ready' });
    const liveMatch = makeMatch({ id: 'm-live', status: 'in_progress', room_code: 'LIVE1' });
    const persistence: EnginePersistence = {
      fetchTournamentById: async () => makeTournament(),
      fetchTournamentsByStatus: async () => [makeTournament()],
      fetchRegistrations: async () => [] as RegistrationRow[],
      fetchRegistrationsWithProfile: async () => [],
      fetchMatches: async () => [readyMatch, liveMatch],
      fetchMatchById: async () => null,
      fetchMatchByRoomCode: async () => null,
      insertMatch: vi.fn(async () => readyMatch),
      updateMatch: vi.fn(async () => undefined),
      updateRegistrationPlacement: vi.fn(async () => undefined),
      updateRegistrationStatus: vi.fn(async () => undefined),
      updateTournamentStatus: vi.fn(async () => undefined),
      createReservedRoom: vi.fn((code: string) => {
        const room = { code, players: [] };
        rooms.set(code, room);
        return room;
      }),
      getRoom: vi.fn((code: string) => {
        const room = rooms.get(code);
        if (!room) throw new Error('not_found');
        return room;
      }),
    };

    const result = await recoverTournamentMatches({ sockets: { sockets: new Map() } } as any, persistence);

    expect(result).toEqual({ readyRecovered: 1, inProgressRecovered: 1 });
    expect((persistence.createReservedRoom as any).mock.calls[0][0]).toBe('LIVE1');
  });
});
