import { describe, it, expect } from 'vitest';
import {
  assertBracketConsistent,
  collectBracketConsistencyViolations,
  type BracketConsistencyInput,
} from './assertBracketConsistent.testkit';
import type { MatchRow, RegistrationRow } from './types';

function match(round: 1 | 2 | 3, matchNumber: number, over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: `m-${round}-${matchNumber}`,
    tournament_id: 'tour-1',
    round,
    match_number: matchNumber,
    player1_id: null,
    player2_id: null,
    winner_id: null,
    room_code: null,
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
    bot_tier: null,
    player1_score: null,
    player2_score: null,
    ...over,
  };
}

function reg(userId: string, over: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: `reg-${userId}`,
    tournament_id: 'tour-1',
    user_id: userId,
    registered_at: '2026-05-14T23:00:00Z',
    seed: null,
    placement: null,
    status: 'active',
    ...over,
  };
}

const completed = (winner: string, p1: string, p2: string, round: 1 | 2 | 3, n: number) =>
  match(round, n, {
    player1_id: p1,
    player2_id: p2,
    winner_id: winner,
    status: 'completed',
    completed_at: '2026-05-15T00:10:00Z',
    winner_source: 'game_over',
  });

/** A fully played-out 8-human bracket: u1 champion, u2 runner-up. */
function playedOutBracket(): BracketConsistencyInput {
  const matches: MatchRow[] = [
    completed('u1', 'u1', 'u8', 1, 1),
    completed('u4', 'u4', 'u5', 1, 2),
    completed('u3', 'u3', 'u6', 1, 3),
    completed('u2', 'u2', 'u7', 1, 4),
    completed('u1', 'u1', 'u4', 2, 1),
    completed('u2', 'u3', 'u2', 2, 2),
    completed('u1', 'u1', 'u2', 3, 1),
  ];
  const registrations: RegistrationRow[] = [
    reg('u1', { status: 'winner', placement: 1 }),
    reg('u2', { status: 'eliminated', placement: 2 }),
    reg('u3', { status: 'eliminated', placement: 3 }),
    reg('u4', { status: 'eliminated', placement: 3 }),
    reg('u5', { status: 'eliminated', placement: 5 }),
    reg('u6', { status: 'eliminated', placement: 5 }),
    reg('u7', { status: 'eliminated', placement: 5 }),
    reg('u8', { status: 'eliminated', placement: 5 }),
  ];
  return {
    tournament: { id: 'tour-1', status: 'completed', winner_id: 'u1' },
    matches,
    registrations,
  };
}

describe('assertBracketConsistent', () => {
  it('passes a fully consistent played-out bracket', () => {
    expect(collectBracketConsistencyViolations(playedOutBracket())).toEqual([]);
    expect(() => assertBracketConsistent(playedOutBracket())).not.toThrow();
  });

  it('passes a mid-tournament bracket (QF done, one SF ready)', () => {
    const matches: MatchRow[] = [
      completed('u1', 'u1', 'u8', 1, 1),
      completed('u4', 'u4', 'u5', 1, 2),
      match(1, 3, { player1_id: 'u3', player2_id: 'u6', status: 'in_progress' }),
      match(1, 4, { player1_id: 'u2', player2_id: 'u7', status: 'ready' }),
      match(2, 1, { player1_id: 'u1', player2_id: 'u4', status: 'ready' }),
      match(2, 2, { status: 'waiting' }),
      match(3, 1, { status: 'waiting' }),
    ];
    const registrations = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map((u) =>
      reg(u, { status: u === 'u8' || u === 'u5' ? 'eliminated' : 'active' }),
    );
    expect(
      collectBracketConsistencyViolations({
        tournament: { id: 'tour-1', status: 'in_progress', winner_id: null },
        matches,
        registrations,
      }),
    ).toEqual([]);
  });

  it('catches a completed match with a non-participant winner (T-INV-2)', () => {
    const input = playedOutBracket();
    input.matches[0] = { ...input.matches[0], winner_id: 'stranger' };
    const v = collectBracketConsistencyViolations(input);
    expect(v.some((s) => s.includes('not a participant'))).toBe(true);
  });

  it('catches a winner not advanced into the feeder slot (T-INV-5)', () => {
    const input = playedOutBracket();
    // SF1.player1 should be u1 (QF1 winner); corrupt it.
    input.matches[4] = { ...input.matches[4], player1_id: 'u4', winner_id: 'u4' };
    const v = collectBracketConsistencyViolations(input);
    expect(v.some((s) => s.includes('is not in 2/1.player1'))).toBe(true);
  });

  it('catches a target match past waiting with feeders not both terminal (T-INV-6)', () => {
    const input = playedOutBracket();
    input.matches[1] = { ...input.matches[1], status: 'in_progress', winner_id: null, completed_at: null };
    const v = collectBracketConsistencyViolations(input);
    expect(v.some((s) => s.includes('feeders are') && s.includes('not both terminal'))).toBe(true);
  });

  it('catches a user live in two matches at once (T-INV-7)', () => {
    const input = playedOutBracket();
    input.matches[5] = { ...input.matches[5], status: 'in_progress', winner_id: null, completed_at: null };
    input.matches[6] = { ...input.matches[6], status: 'in_progress', winner_id: null, completed_at: null };
    // u2 is player in both SF2 and the Final now.
    const v = collectBracketConsistencyViolations(input);
    expect(v.some((s) => s.includes('u2 is in 2 ready/in_progress matches'))).toBe(true);
  });

  it('catches a loser whose registration is not eliminated (T-INV-10)', () => {
    const input = playedOutBracket();
    input.registrations[7] = reg('u8', { status: 'active' });
    const v = collectBracketConsistencyViolations(input);
    expect(v.some((s) => s.includes('u8') && s.includes('expected eliminated'))).toBe(true);
  });

  it('catches a wrong placement for exit round (T-INV-10)', () => {
    const input = playedOutBracket();
    input.registrations[2] = reg('u3', { status: 'eliminated', placement: 5 }); // lost SF, should be 3
    const v = collectBracketConsistencyViolations(input);
    expect(v.some((s) => s.includes('u3 lost in round 2') && s.includes('expected 3'))).toBe(true);
  });

  it('catches tournament marked completed while the final is unfinished', () => {
    const input = playedOutBracket();
    input.matches[6] = match(3, 1, { player1_id: 'u1', player2_id: 'u2', status: 'in_progress' });
    const v = collectBracketConsistencyViolations(input);
    expect(v.some((s) => s.includes('status is completed but the final match'))).toBe(true);
  });

  it('T-INV-3 / D-3: flags a spurious tournament_match_winner_conflict log', () => {
    const input = playedOutBracket();
    input.capturedLogs = [{ event: 'tournament_match_winner_conflict', matchId: 'm-1-1' }];
    const v = collectBracketConsistencyViolations(input);
    expect(v.some((s) => s.includes('expected 0 tournament_match_winner_conflict'))).toBe(true);
  });

  it('T-INV-3 / D-3: allows an expected conflict log when the test declares it', () => {
    const input = playedOutBracket();
    input.capturedLogs = [{ event: 'tournament_match_winner_conflict' }];
    input.expectedConflictLogs = 1;
    expect(collectBracketConsistencyViolations(input)).toEqual([]);
  });

  it('catches a bracket that is not 7 rows', () => {
    const input = playedOutBracket();
    input.matches = input.matches.slice(0, 6);
    const v = collectBracketConsistencyViolations(input);
    expect(v.some((s) => s.includes('expected 7 match rows'))).toBe(true);
  });
});
