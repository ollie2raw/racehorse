/**
 * Closed-bracket timing and wording (Phase 3E): the return-to-Hub timing runs
 * on the tournament server clock (a device clock jump forward or back changes
 * nothing, and nothing goes negative), and the Final is described by how it
 * was decided — only a played Final "defeated" anyone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveBracketTerminalState,
  finalOutcomeDetail,
  msUntilBracketAutoKick,
  TOURNAMENT_BRACKET_AUTO_KICK_MS,
} from './bracketTerminal';
import { markTerminalTournamentMatch } from './terminalMatches';
import { observeTournamentRequest, resetTournamentClockForTests } from './tournamentClock';
import type { BracketView, TournamentMatch, TournamentOutcomeKind } from './types';

const SERVER = Date.parse('2026-10-31T03:00:00.000Z');
let mono = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(SERVER);
  mono = 1_000;
  resetTournamentClockForTests(() => mono);
  observeTournamentRequest(1_000, 1_000, new Date(SERVER).toISOString());
  window.sessionStorage.clear();
});
afterEach(() => {
  resetTournamentClockForTests();
  vi.useRealTimers();
});

function bracket(kind: TournamentOutcomeKind, completedAt: string): BracketView {
  const fin: TournamentMatch = {
    id: 'f', tournament_id: 't', round: 3, match_number: 1, player1_id: 'ana', player2_id: 'bo', winner_id: 'ana', room_code: null,
    status: 'completed', bot_tier: null, started_at: null, completed_at: completedAt, player1_score: 30, player2_score: 12, outcomeKind: kind,
  };
  return {
    tournament: { id: 't', kind: 'live', status: 'in_progress', scheduled_start: new Date(SERVER - 3_600_000).toISOString(), registration_open_at: '', registration_close_at: '', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: '' },
    registrations: [
      { id: 'r1', tournament_id: 't', user_id: 'ana', registered_at: '', seed: 1, placement: null, status: 'active', username: 'Alice' },
      { id: 'r2', tournament_id: 't', user_id: 'bo', registered_at: '', seed: 2, placement: null, status: 'active', username: 'Bob' },
    ],
    matches: [fin],
  };
}
const derive = (b: BracketView) => deriveBracketTerminalState({ bracket: b, userId: 'viewer', tournamentPhase: null, assignedMatch: null });

describe('closed-bracket timing uses the server clock', () => {
  it('a device clock jump forward or back does not change when the bracket closes to the Hub', () => {
    const finishedAt = new Date(SERVER - 10_000).toISOString(); // 10 s ago on the server
    const before = derive(bracket('played', finishedAt));
    expect(before.shouldAutoKickToHub).toBe(false);
    const remaining = msUntilBracketAutoKick(before.completedAtMs);
    expect(remaining).toBe(TOURNAMENT_BRACKET_AUTO_KICK_MS - 10_000);

    for (const jump of [+6 * 3_600_000, -6 * 3_600_000, +3 * 86_400_000]) {
      vi.setSystemTime(SERVER + jump);
      const after = derive(bracket('played', finishedAt));
      expect(after.shouldAutoKickToHub).toBe(false);
      expect(msUntilBracketAutoKick(after.completedAtMs)).toBe(remaining);
    }

    // Real (monotonic) time passing does close it.
    mono += TOURNAMENT_BRACKET_AUTO_KICK_MS;
    expect(derive(bracket('played', finishedAt)).shouldAutoKickToHub).toBe(true);
    expect(msUntilBracketAutoKick(derive(bracket('played', finishedAt)).completedAtMs)).toBe(0);
  });

  it('a locally recorded completion is stamped in server time (never negative after a device change)', () => {
    vi.setSystemTime(SERVER - 5 * 3_600_000); // device 5 h behind the server
    markTerminalTournamentMatch({ matchId: 'f', tournamentId: 't' });
    const state = derive(bracket('played', new Date(SERVER).toISOString()));
    expect(state.completedAtMs).toBe(SERVER);
    expect(msUntilBracketAutoKick(state.completedAtMs)).toBe(TOURNAMENT_BRACKET_AUTO_KICK_MS);
  });
});

describe('the Final in words', () => {
  it.each([
    ['played', 'Alice defeated Bob in the Final.'],
    ['forfeit', 'Alice won the Final by forfeit.'],
    ['missed_turns', 'Alice advanced after missed turns.'],
    ['no_show', 'Alice advanced after a no-show.'],
    ['administrative', 'Alice advanced by rule.'],
    ['bye', 'Alice won the Final on a bye.'],
    ['bot_simulated', 'Alice won the Final.'],
  ] as const)('%s → %s', (kind, text) => {
    expect(derive(bracket(kind, new Date(SERVER).toISOString())).detail).toBe(text);
  });

  it('only a played Final says "defeated"', () => {
    const kinds: TournamentOutcomeKind[] = ['forfeit', 'missed_turns', 'no_show', 'administrative', 'bye', 'bot_simulated'];
    for (const kind of kinds) expect(finalOutcomeDetail('Master Fritz', 'Alice', kind)).not.toMatch(/defeated/);
  });
});
