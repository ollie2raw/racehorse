import { describe, expect, it } from 'vitest';
import { buildTournamentMeState } from './meState';
import type { MatchRow, RegistrationRow, ScheduledTournamentRow } from './types';

const userId = '11111111-1111-4111-8111-111111111111';
const tournamentId = '22222222-2222-4222-8222-222222222222';

function makeTournament(overrides: Partial<ScheduledTournamentRow> = {}): ScheduledTournamentRow {
  return {
    id: tournamentId,
    scheduled_start: new Date(Date.now() + 10 * 60_000).toISOString(),
    registration_open_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    registration_close_at: new Date(Date.now() - 1 * 60_000).toISOString(),
    status: 'in_progress',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeReg(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: 'reg-1',
    tournament_id: tournamentId,
    user_id: userId,
    registered_at: new Date().toISOString(),
    seed: 1,
    placement: null,
    status: 'active',
    ...overrides,
  };
}

function makeMatch(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'match-1',
    tournament_id: tournamentId,
    round: 1,
    match_number: 1,
    player1_id: userId,
    player2_id: 'bot:fritz:tour-1:1',
    winner_id: null,
    room_code: '',
    status: 'waiting',
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
    bot_tier: 'standard',
    player1_score: null,
    player2_score: null,
    ...overrides,
  };
}

describe('buildTournamentMeState', () => {
  it('returns bracket_lobby between registration close and scheduled_start', () => {
    const startMs = Date.parse('2026-05-17T12:00:00.000Z');
    const closeMs = startMs - 2 * 60_000;
    const tournament = makeTournament({
      scheduled_start: new Date(startMs).toISOString(),
      registration_open_at: new Date(startMs - 30 * 60_000).toISOString(),
      registration_close_at: new Date(closeMs).toISOString(),
    });
    const reg = makeReg();
    const match = makeMatch();
    const state = buildTournamentMeState({
      userId,
      registrations: [reg],
      tournamentsById: new Map([[tournamentId, tournament]]),
      matchesByTournamentId: new Map([[tournamentId, [match]]]),
      opponentUsernameByUserId: new Map(),
      now: new Date(closeMs + 60_000),
    });

    expect(startMs - closeMs).toBe(2 * 60_000);
    expect(state.currentTournamentPhase).toBe('bracket_lobby');
    expect(state.activeTournamentId).toBe(tournamentId);
    expect(state.assignedMatch).toEqual(
      expect.objectContaining({
        matchId: 'match-1',
        opponentUsername: 'Fritz',
        roomCode: null,
        matchStatus: 'waiting',
      }),
    );
    expect(state.countdown).toEqual({
      kind: 'scheduled_start',
      at: tournament.scheduled_start,
    });
  });

  it('returns match_ready with roomCode only after scheduled_start dispatch', () => {
    const tournament = makeTournament({
      scheduled_start: new Date(Date.now() - 60_000).toISOString(),
    });
    const reg = makeReg();
    const match = makeMatch({
      status: 'ready',
      room_code: 'TROOM1',
      ready_at: new Date().toISOString(),
      ready_deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const state = buildTournamentMeState({
      userId,
      registrations: [reg],
      tournamentsById: new Map([[tournamentId, tournament]]),
      matchesByTournamentId: new Map([[tournamentId, [match]]]),
      opponentUsernameByUserId: new Map(),
    });

    expect(state.currentTournamentPhase).toBe('match_ready');
    expect(state.assignedMatch?.roomCode).toBe('TROOM1');
    expect(state.countdown?.kind).toBe('ready_deadline');
  });

  it('ignores stale in-progress tournaments past the active window', () => {
    const now = new Date('2026-05-15T03:30:00.000Z');
    const tournament = makeTournament({
      scheduled_start: new Date('2026-05-15T00:00:00.000Z').toISOString(),
    });
    const reg = makeReg();
    const match = makeMatch({
      status: 'ready',
      room_code: 'TSTALE1',
      ready_at: new Date('2026-05-15T00:05:00.000Z').toISOString(),
      ready_deadline_at: new Date('2026-05-15T00:07:00.000Z').toISOString(),
    });

    const state = buildTournamentMeState({
      userId,
      registrations: [reg],
      tournamentsById: new Map([[tournamentId, tournament]]),
      matchesByTournamentId: new Map([[tournamentId, [match]]]),
      opponentUsernameByUserId: new Map(),
      now,
    });

    expect(state.currentTournamentPhase).toBeNull();
    expect(state.activeTournamentId).toBeNull();
    expect(state.assignedMatch).toBeNull();
  });

  it('returns no active tournament id when the event was cancelled', () => {
    const tournament = makeTournament({ status: 'cancelled' });
    const reg = makeReg();
    const state = buildTournamentMeState({
      userId,
      registrations: [reg],
      tournamentsById: new Map([[tournamentId, tournament]]),
      matchesByTournamentId: new Map([[tournamentId, [makeMatch()]]]),
      opponentUsernameByUserId: new Map(),
    });

    expect(state.currentTournamentPhase).toBe('completed');
    expect(state.activeTournamentId).toBeNull();
    expect(state.assignedMatch).toBeNull();
  });
});
