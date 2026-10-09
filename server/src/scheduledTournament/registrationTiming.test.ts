import { describe, expect, it } from 'vitest';
import {
  isTournamentBracketLobbyPhase,
  isTournamentRegistrationWindowOpen,
} from './engine';
import { buildTournamentMeState } from './meState';
import type { RegistrationRow, ScheduledTournamentRow } from './types';

const userId = '11111111-1111-4111-8111-111111111111';
const tournamentId = '22222222-2222-4222-8222-222222222222';

/**
 * The window a seeded Live Event row carries (M2 SQL is the source of truth:
 * open 12 h, close 2 min before start). The server only reads these stored
 * timestamps; this fixture mirrors one such row.
 */
function seededWindow(scheduledStartMs: number) {
  return {
    registration_open_at: new Date(scheduledStartMs - 12 * 60 * 60_000).toISOString(),
    registration_close_at: new Date(scheduledStartMs - 2 * 60_000).toISOString(),
  };
}

describe('tournament registration timing (from stored timestamps)', () => {
  const scheduledStartMs = Date.parse('2026-05-17T12:00:00.000Z');

  it('keeps registration open at scheduled_start minus 3 minutes', () => {
    const times = seededWindow(scheduledStartMs);
    const nowMs = scheduledStartMs - 3 * 60_000;
    expect(
      isTournamentRegistrationWindowOpen({
        status: 'registration_open',
        registration_close_at: times.registration_close_at,
        nowMs,
      }),
    ).toBe(true);
  });

  it('closes registration at scheduled_start minus 2 minutes', () => {
    const times = seededWindow(scheduledStartMs);
    const closeMs = Date.parse(times.registration_close_at);
    expect(closeMs).toBe(scheduledStartMs - 2 * 60_000);
    expect(
      isTournamentRegistrationWindowOpen({
        status: 'registration_open',
        registration_close_at: times.registration_close_at,
        nowMs: closeMs,
      }),
    ).toBe(false);
  });

  it('bracket_lobby lasts 2 minutes between close and scheduled_start', () => {
    const times = seededWindow(scheduledStartMs);
    const closeMs = Date.parse(times.registration_close_at);
    const startMs = scheduledStartMs;

    expect(
      isTournamentBracketLobbyPhase({
        registration_close_at: times.registration_close_at,
        scheduled_start: new Date(startMs).toISOString(),
        nowMs: closeMs + 30_000,
      }),
    ).toBe(true);
    expect(
      isTournamentBracketLobbyPhase({
        registration_close_at: times.registration_close_at,
        scheduled_start: new Date(startMs).toISOString(),
        nowMs: startMs - 1_000,
      }),
    ).toBe(true);
    expect(
      isTournamentBracketLobbyPhase({
        registration_close_at: times.registration_close_at,
        scheduled_start: new Date(startMs).toISOString(),
        nowMs: closeMs - 1_000,
      }),
    ).toBe(false);
    expect(startMs - closeMs).toBe(2 * 60_000);
  });

  it('match_ready still begins at scheduled_start after dispatch', () => {
    const times = seededWindow(scheduledStartMs);
    const tournament: ScheduledTournamentRow = {
      id: tournamentId,
      scheduled_start: new Date(scheduledStartMs).toISOString(),
      registration_open_at: times.registration_open_at,
      registration_close_at: times.registration_close_at,
      status: 'in_progress',
      format: '7-tile',
      win_target: 30,
      max_players: 8,
      winner_id: null,
      created_at: new Date('2026-05-01T00:00:00.000Z').toISOString(),
    };
    const reg: RegistrationRow = {
      id: 'reg-1',
      tournament_id: tournamentId,
      user_id: userId,
      registered_at: times.registration_open_at,
      seed: 1,
      placement: null,
      status: 'registered',
    };
    const state = buildTournamentMeState({
      userId,
      registrations: [reg],
      tournamentsById: new Map([[tournamentId, tournament]]),
      matchesByTournamentId: new Map([
        [
          tournamentId,
          [
            {
              id: 'match-1',
              tournament_id: tournamentId,
              round: 1,
              match_number: 1,
              player1_id: userId,
              player2_id: '33333333-3333-4333-8333-333333333333',
              winner_id: null,
              status: 'ready',
              room_code: 'TROOM1',
              ready_at: new Date(scheduledStartMs).toISOString(),
              ready_deadline_at: new Date(scheduledStartMs + 2 * 60_000).toISOString(),
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
            },
          ],
        ],
      ]),
      opponentUsernameByUserId: new Map(),
      now: new Date(scheduledStartMs),
    });

    expect(state.currentTournamentPhase).toBe('match_ready');
    expect(state.assignedMatch?.roomCode).toBe('TROOM1');
    expect(state.countdown?.kind).toBe('ready_deadline');
  });
});
