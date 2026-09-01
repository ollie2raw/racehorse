import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseFetchMock = vi.fn();

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => supabaseFetchMock(...args),
}));

const ACTIVE_TOURNAMENT_NOW = new Date('2026-05-17T03:00:00.000Z');

describe('fetchActiveAssignedMatchForUser', () => {
  beforeEach(() => {
    vi.resetModules();
    supabaseFetchMock.mockReset();
    vi.useRealTimers();
  });

  it('returns a ready human-vs-bot match before the deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ACTIVE_TOURNAMENT_NOW);
    const userId = '11111111-1111-4111-8111-111111111111';
    const tournamentId = '22222222-2222-4222-8222-222222222222';
    const readyDeadlineAt = new Date(ACTIVE_TOURNAMENT_NOW.getTime() + 60_000).toISOString();

    supabaseFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('scheduled_tournament_matches')) {
        return [{
          id: 'match-ready',
          tournament_id: tournamentId,
          round: 1,
          match_number: 1,
          player1_id: userId,
          player2_id: `bot:fritz:${tournamentId}:1`,
          winner_id: null,
          room_code: 'TREADYR1M1',
          status: 'ready',
          ready_at: new Date().toISOString(),
          ready_deadline_at: readyDeadlineAt,
          started_at: null,
          completed_at: null,
          player1_joined_at: null,
          player2_joined_at: new Date().toISOString(),
          winner_source: null,
          status_reason: null,
          forfeit_user_id: null,
          no_show_user_id: null,
          bot_tier: 'standard',
          player1_score: null,
          player2_score: null,
        }];
      }
      if (url.includes('/scheduled_tournaments?')) {
        return [{
          id: tournamentId,
          scheduled_start: '2026-05-17T02:30:00.000Z',
          registration_open_at: '2026-05-17T02:00:00.000Z',
          registration_close_at: '2026-05-17T02:28:00.000Z',
          status: 'in_progress',
          format: 'single_elimination',
          win_target: 30,
          max_players: 8,
          winner_id: null,
          created_at: '2026-05-17T00:00:00.000Z',
        }];
      }
      if (url.includes('/profiles?')) {
        return [];
      }
      return [];
    });

    const { fetchActiveAssignedMatchForUser } = await import('./persistence');
    const result = await fetchActiveAssignedMatchForUser(userId);

    expect(result?.match.id).toBe('match-ready');
    expect(result?.tournament.id).toBe(tournamentId);
    vi.useRealTimers();
  });

  it('does not return stale in_progress rows that already have a winner', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const tournamentId = '22222222-2222-4222-8222-222222222222';

    supabaseFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('scheduled_tournament_matches')) {
        return [{
          id: 'match-stale-winner',
          tournament_id: tournamentId,
          round: 3,
          match_number: 1,
          player1_id: userId,
          player2_id: 'u2',
          winner_id: 'u2',
          room_code: 'TFINALDONE',
          status: 'in_progress',
          ready_at: new Date().toISOString(),
          ready_deadline_at: null,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          player1_joined_at: new Date().toISOString(),
          player2_joined_at: new Date().toISOString(),
          winner_source: 'game_over',
          status_reason: null,
          forfeit_user_id: null,
          no_show_user_id: null,
          bot_tier: null,
          player1_score: 0,
          player2_score: 40,
        }];
      }
      if (url.includes('/scheduled_tournaments?')) {
        return [{
          id: tournamentId,
          scheduled_start: '2026-05-17T02:30:00.000Z',
          registration_open_at: '2026-05-17T02:00:00.000Z',
          registration_close_at: '2026-05-17T02:28:00.000Z',
          status: 'in_progress',
          format: 'single_elimination',
          win_target: 30,
          max_players: 8,
          winner_id: null,
          created_at: '2026-05-17T00:00:00.000Z',
        }];
      }
      return [];
    });

    const { fetchActiveAssignedMatchForUser } = await import('./persistence');
    const result = await fetchActiveAssignedMatchForUser(userId);

    expect(result).toBeNull();
  });

  it('does not return completed or expired ready matches', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const tournamentId = '22222222-2222-4222-8222-222222222222';

    supabaseFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('scheduled_tournament_matches')) {
        return [{
          id: 'match-expired',
          tournament_id: tournamentId,
          round: 1,
          match_number: 1,
          player1_id: userId,
          player2_id: `bot:fritz:${tournamentId}:1`,
          winner_id: null,
          room_code: 'TEXPIRED',
          status: 'ready',
          ready_at: new Date(Date.now() - 120_000).toISOString(),
          ready_deadline_at: new Date(Date.now() - 60_000).toISOString(),
          started_at: null,
          completed_at: null,
          player1_joined_at: null,
          player2_joined_at: new Date().toISOString(),
          winner_source: null,
          status_reason: null,
          forfeit_user_id: null,
          no_show_user_id: null,
          bot_tier: 'standard',
          player1_score: null,
          player2_score: null,
        }];
      }
      if (url.includes('/scheduled_tournaments?')) {
        return [{
          id: tournamentId,
          scheduled_start: '2026-05-17T02:30:00.000Z',
          registration_open_at: '2026-05-17T02:00:00.000Z',
          registration_close_at: '2026-05-17T02:28:00.000Z',
          status: 'in_progress',
          format: 'single_elimination',
          win_target: 30,
          max_players: 8,
          winner_id: null,
          created_at: '2026-05-17T00:00:00.000Z',
        }];
      }
      return [];
    });

    const { fetchActiveAssignedMatchForUser } = await import('./persistence');
    const result = await fetchActiveAssignedMatchForUser(userId);

    expect(result).toBeNull();
  });

  it('prefers the newest attachable tournament match over older stale candidates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ACTIVE_TOURNAMENT_NOW);
    const userId = '11111111-1111-4111-8111-111111111111';
    const oldTournamentId = '22222222-2222-4222-8222-222222222222';
    const newTournamentId = '33333333-3333-4333-8333-333333333333';

    supabaseFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('scheduled_tournament_matches')) {
        return [
          {
            id: 'match-old',
            tournament_id: oldTournamentId,
            round: 1,
            match_number: 1,
            player1_id: userId,
            player2_id: `bot:fritz:${oldTournamentId}:1`,
            winner_id: null,
            room_code: 'TOLDR1M1',
            status: 'ready',
            ready_at: new Date().toISOString(),
            ready_deadline_at: new Date(Date.now() + 60_000).toISOString(),
            started_at: null,
            completed_at: null,
            player1_joined_at: null,
            player2_joined_at: new Date().toISOString(),
            winner_source: null,
            status_reason: null,
            forfeit_user_id: null,
            no_show_user_id: null,
            bot_tier: 'standard',
            player1_score: null,
            player2_score: null,
          },
          {
            id: 'match-new',
            tournament_id: newTournamentId,
            round: 1,
            match_number: 1,
            player1_id: userId,
            player2_id: `bot:fritz:${newTournamentId}:1`,
            winner_id: null,
            room_code: 'TNEWR1M1',
            status: 'ready',
            ready_at: new Date().toISOString(),
            ready_deadline_at: new Date(Date.now() + 60_000).toISOString(),
            started_at: null,
            completed_at: null,
            player1_joined_at: null,
            player2_joined_at: new Date().toISOString(),
            winner_source: null,
            status_reason: null,
            forfeit_user_id: null,
            no_show_user_id: null,
            bot_tier: 'standard',
            player1_score: null,
            player2_score: null,
          },
        ];
      }
      if (url.includes(`/scheduled_tournaments?select=*&id=eq.${encodeURIComponent(oldTournamentId)}`)) {
        return [{
          id: oldTournamentId,
          scheduled_start: '2026-05-17T02:00:00.000Z',
          registration_open_at: '2026-05-17T01:30:00.000Z',
          registration_close_at: '2026-05-17T01:58:00.000Z',
          status: 'in_progress',
          format: 'single_elimination',
          win_target: 30,
          max_players: 8,
          winner_id: null,
          created_at: '2026-05-17T00:00:00.000Z',
        }];
      }
      if (url.includes(`/scheduled_tournaments?select=*&id=eq.${encodeURIComponent(newTournamentId)}`)) {
        return [{
          id: newTournamentId,
          scheduled_start: '2026-05-17T02:30:00.000Z',
          registration_open_at: '2026-05-17T02:00:00.000Z',
          registration_close_at: '2026-05-17T02:28:00.000Z',
          status: 'in_progress',
          format: 'single_elimination',
          win_target: 30,
          max_players: 8,
          winner_id: null,
          created_at: '2026-05-17T00:30:00.000Z',
        }];
      }
      return [];
    });

    const { fetchActiveAssignedMatchForUser } = await import('./persistence');
    const result = await fetchActiveAssignedMatchForUser(userId);

    expect(result?.match.id).toBe('match-new');
    expect(result?.tournament.id).toBe(newTournamentId);
    vi.useRealTimers();
  });

  it('prefers a match the player has already joined over a newer-scheduled one (T-11)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ACTIVE_TOURNAMENT_NOW);
    const userId = '11111111-1111-4111-8111-111111111111';
    const joinedTournamentId = '22222222-2222-4222-8222-222222222222';
    const newerTournamentId = '33333333-3333-4333-8333-333333333333';

    const baseMatch = {
      round: 1,
      match_number: 1,
      player2_id: 'bot:fritz:x:1',
      winner_id: null,
      status: 'ready' as const,
      ready_at: new Date().toISOString(),
      ready_deadline_at: new Date(Date.now() + 60_000).toISOString(),
      started_at: null,
      completed_at: null,
      player2_joined_at: new Date().toISOString(),
      winner_source: null,
      status_reason: null,
      forfeit_user_id: null,
      no_show_user_id: null,
      bot_tier: 'standard' as const,
      player1_score: null,
      player2_score: null,
    };

    supabaseFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('scheduled_tournament_matches')) {
        return [
          // Older tournament, but the player has entered this room.
          { ...baseMatch, id: 'match-joined', tournament_id: joinedTournamentId,
            player1_id: userId, room_code: 'TJOINR1M1', player1_joined_at: new Date().toISOString() },
          // Newer tournament, player has not joined.
          { ...baseMatch, id: 'match-newer', tournament_id: newerTournamentId,
            player1_id: userId, room_code: 'TNEWR1M1', player1_joined_at: null },
        ];
      }
      if (url.includes(`id=eq.${encodeURIComponent(joinedTournamentId)}`)) {
        return [{ id: joinedTournamentId, scheduled_start: '2026-05-17T02:00:00.000Z',
          registration_open_at: '2026-05-17T01:30:00.000Z', registration_close_at: '2026-05-17T01:58:00.000Z',
          status: 'in_progress', format: 'single_elimination', win_target: 30, max_players: 8,
          winner_id: null, created_at: '2026-05-17T00:00:00.000Z' }];
      }
      if (url.includes(`id=eq.${encodeURIComponent(newerTournamentId)}`)) {
        return [{ id: newerTournamentId, scheduled_start: '2026-05-17T02:30:00.000Z',
          registration_open_at: '2026-05-17T02:00:00.000Z', registration_close_at: '2026-05-17T02:28:00.000Z',
          status: 'in_progress', format: 'single_elimination', win_target: 30, max_players: 8,
          winner_id: null, created_at: '2026-05-17T00:30:00.000Z' }];
      }
      return [];
    });

    const { fetchActiveAssignedMatchForUser } = await import('./persistence');
    const result = await fetchActiveAssignedMatchForUser(userId);

    expect(result?.match.id).toBe('match-joined');
    expect(result?.tournament.id).toBe(joinedTournamentId);
    vi.useRealTimers();
  });

  it('does not recover matches from tournaments past the active window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T06:00:00.000Z'));
    const userId = '11111111-1111-4111-8111-111111111111';
    const staleTournamentId = '44444444-4444-4444-8444-444444444444';

    supabaseFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('scheduled_tournament_matches')) {
        return [{
          id: 'match-stale',
          tournament_id: staleTournamentId,
          round: 1,
          match_number: 1,
          player1_id: userId,
          player2_id: `bot:fritz:${staleTournamentId}:1`,
          winner_id: null,
          room_code: 'TSTALER1M1',
          status: 'ready',
          ready_at: new Date('2026-05-17T03:31:00.000Z').toISOString(),
          ready_deadline_at: new Date('2026-05-17T03:33:00.000Z').toISOString(),
          started_at: null,
          completed_at: null,
          player1_joined_at: null,
          player2_joined_at: new Date('2026-05-17T03:31:00.000Z').toISOString(),
          winner_source: null,
          status_reason: null,
          forfeit_user_id: null,
          no_show_user_id: null,
          bot_tier: 'standard',
          player1_score: null,
          player2_score: null,
        }];
      }
      if (url.includes('/scheduled_tournaments?')) {
        return [{
          id: staleTournamentId,
          scheduled_start: '2026-05-17T03:00:00.000Z',
          registration_open_at: '2026-05-17T02:30:00.000Z',
          registration_close_at: '2026-05-17T02:58:00.000Z',
          status: 'in_progress',
          format: 'single_elimination',
          win_target: 30,
          max_players: 8,
          winner_id: null,
          created_at: '2026-05-17T01:00:00.000Z',
        }];
      }
      return [];
    });

    const { fetchActiveAssignedMatchForUser } = await import('./persistence');
    const result = await fetchActiveAssignedMatchForUser(userId);

    expect(result).toBeNull();
    vi.useRealTimers();
  });
});
