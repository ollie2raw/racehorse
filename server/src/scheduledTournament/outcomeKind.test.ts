import { describe, expect, it, vi } from 'vitest';
import {
  ADMINISTRATIVE_GAME_OVER_REASONS,
  ADMINISTRATIVE_NO_SHOW_REASONS,
  tournamentOutcomeKind,
} from './outcomeKind';
import { EVENT_BACKSTOP_LABELS } from './eventBackstop';
import { MATCH_CAP_LABELS } from './engine';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn(async () => { throw new Error('no database in this test'); }), isSupabaseTimeoutError: () => false }));

const H1 = '11111111-1111-4111-8111-111111111111';
const H2 = '22222222-2222-4222-8222-222222222222';
const BOT = 'bot:fritz:t-1:7';

const done = (over: Record<string, unknown>) => ({
  status: 'completed' as const,
  winner_id: H1,
  player1_id: H1,
  player2_id: H2,
  winner_source: 'game_over' as const,
  status_reason: null as string | null,
  no_show_user_id: null as string | null,
  ...over,
});

describe('tournamentOutcomeKind', () => {
  it('no result yet → null', () => {
    expect(tournamentOutcomeKind(done({ status: 'ready', winner_id: null }))).toBeNull();
    expect(tournamentOutcomeKind(done({ status: 'in_progress', winner_id: null }))).toBeNull();
  });

  it('a game played to its end → played', () => {
    expect(tournamentOutcomeKind(done({}))).toBe('played');
    expect(tournamentOutcomeKind(done({ player2_id: BOT }))).toBe('played');
  });

  it('a player left → forfeit; three missed turns → missed_turns', () => {
    expect(tournamentOutcomeKind(done({ winner_source: 'forfeit', status_reason: 'player1_forfeit' }))).toBe('forfeit');
    expect(tournamentOutcomeKind(done({ winner_source: 'forfeit', status_reason: 'player2_forfeit' }))).toBe('forfeit');
    expect(tournamentOutcomeKind(done({ winner_source: 'forfeit', status_reason: 'missed_turns' }))).toBe('missed_turns');
  });

  it('an absent human → no_show (reconciler and event backstop)', () => {
    for (const reason of ['player1_no_show', 'player2_no_show', 'event_backstop_player1_no_show', 'event_backstop_player2_no_show']) {
      expect(tournamentOutcomeKind(done({ winner_source: 'no_show', status_reason: reason, no_show_user_id: H2 }))).toBe('no_show');
    }
    // an absent human against Fritz: Fritz advances, the human is the no-show
    expect(tournamentOutcomeKind(done({ winner_id: BOT, player1_id: BOT, winner_source: 'no_show', status_reason: 'player2_no_show', no_show_user_id: H2 }))).toBe('no_show');
  });

  it('a human advancing past Fritz recorded as the "no-show" (failed start) → administrative, never no_show', () => {
    for (const reason of ['player2_no_show', 'event_backstop_player2_no_show']) {
      expect(tournamentOutcomeKind(done({ player2_id: BOT, winner_source: 'no_show', status_reason: reason, no_show_user_id: BOT }))).toBe('administrative');
    }
    expect(tournamentOutcomeKind(done({ player1_id: BOT, player2_id: H1, winner_source: 'no_show', status_reason: 'player1_no_show', no_show_user_id: BOT }))).toBe('administrative');
    // a seat no-show without a recorded user is not attributable either
    expect(tournamentOutcomeKind(done({ winner_source: 'no_show', status_reason: 'player2_no_show', no_show_user_id: null }))).toBe('administrative');
  });

  it('higher-seed / start-failed / undispatched / window-open advances → administrative', () => {
    for (const reason of ADMINISTRATIVE_NO_SHOW_REASONS) {
      expect(tournamentOutcomeKind(done({ winner_source: 'no_show', status_reason: reason }))).toBe('administrative');
    }
    expect([...ADMINISTRATIVE_NO_SHOW_REASONS]).toEqual(expect.arrayContaining([
      'start_failed_after_retry_higher_seed_advanced',
      'double_no_show_higher_seed_advanced',
      'event_backstop_not_started_higher_seed_advanced',
      'event_backstop_undispatched_human_advanced',
      'event_backstop_window_open_higher_seed',
    ]));
  });

  it('match cap and event backstop decisions (even by live score) → administrative', () => {
    // Every label the two resolvers can write is listed.
    for (const labels of [MATCH_CAP_LABELS, EVENT_BACKSTOP_LABELS]) {
      for (const reason of Object.values(labels)) {
        expect(ADMINISTRATIVE_GAME_OVER_REASONS.has(reason)).toBe(true);
        expect(tournamentOutcomeKind(done({ status_reason: reason }))).toBe('administrative');
      }
    }
  });

  it('Fritz against Fritz → bot_simulated; a walkover → bye', () => {
    expect(tournamentOutcomeKind(done({ winner_id: BOT, player1_id: BOT, player2_id: 'bot:fritz:t-1:8', status_reason: 'bot_simulated' }))).toBe('bot_simulated');
    expect(tournamentOutcomeKind(done({ player2_id: null, winner_source: null }))).toBe('bye');
  });

  it('an unlisted reason is never reported as a competitive result', () => {
    expect(tournamentOutcomeKind(done({ status_reason: 'some_future_reason' }))).toBe('administrative');
    expect(tournamentOutcomeKind(done({ winner_source: 'no_show', status_reason: 'some_future_reason' }))).toBe('administrative');
    expect(tournamentOutcomeKind(done({ winner_source: 'forfeit', status_reason: 'some_future_reason' }))).toBe('administrative');
    expect(tournamentOutcomeKind(done({ winner_source: null }))).toBe('administrative');
  });
});
