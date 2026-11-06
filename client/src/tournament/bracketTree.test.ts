/**
 * The bracket tree's derived state: card badges, lit connector lines, who lost a decided match, seeds.
 */
import { describe, expect, it } from 'vitest';
import { championConnector, deriveConnectorStates, matchBadge, seedFor, slotResult } from './bracketTree';
import type { TournamentMatch } from './types';

const m = (id: string, round: 1 | 2 | 3, n: number, p1: string | null, p2: string | null, over: Partial<TournamentMatch> = {}): TournamentMatch => ({
  id, tournament_id: 't', round, match_number: n, player1_id: p1, player2_id: p2, winner_id: null, status: 'waiting',
  started_at: null, completed_at: null, player1_score: null, player2_score: null, ...over,
});
const done = (match: TournamentMatch) => match.status === 'completed' || match.status === 'bye';

describe('matchBadge', () => {
  it('says live, ready, upcoming, waiting, final and bye in words', () => {
    expect(matchBadge(m('a', 1, 1, 'x', 'y', { status: 'in_progress' }), false)).toBe('live');
    expect(matchBadge(m('a', 1, 1, 'x', 'y', { status: 'ready' }), false)).toBe('ready');
    expect(matchBadge(m('a', 1, 1, 'x', 'y'), false)).toBe('upcoming');
    expect(matchBadge(m('a', 2, 1, 'x', null), false)).toBe('waiting');
    expect(matchBadge(m('a', 2, 1, null, null), false)).toBe('waiting');
    expect(matchBadge(m('a', 1, 1, 'x', 'y', { status: 'completed', winner_id: 'x' }), true)).toBe('done');
    expect(matchBadge(m('a', 1, 1, 'x', null, { status: 'bye', winner_id: 'x' }), true)).toBe('bye');
  });

  it('a result the display rule is hiding is not "final" yet', () => {
    expect(matchBadge(m('a', 1, 1, 'x', 'y', { status: 'completed', winner_id: 'x' }), false)).toBe('upcoming');
  });
});

describe('deriveConnectorStates', () => {
  const qf = [
    m('q1', 1, 1, 'me', 'f2', { status: 'completed', winner_id: 'me' }),
    m('q2', 1, 2, 'a', 'b', { status: 'completed', winner_id: 'b' }),
    m('q3', 1, 3, 'c', 'd', { status: 'in_progress' }),
    m('q4', 1, 4, 'e', 'f'),
  ];
  const sf = [m('s1', 2, 1, 'me', 'b'), m('s2', 2, 2, null, null)];
  const fin = [m('f', 3, 1, null, null)];
  const states = deriveConnectorStates({ rounds: [qf, sf, fin], isCompleted: done, youUserId: 'me' });

  it('lights the outgoing line of a decided match, in the viewer\'s colour when the viewer advanced', () => {
    expect(states.get('q1')).toMatchObject({ decided: true, youAdvanced: true });
    expect(states.get('q2')).toMatchObject({ decided: true, youAdvanced: false });
    expect(states.get('q3')).toMatchObject({ decided: false, youAdvanced: false });
    expect(states.get('q4')).toMatchObject({ decided: false });
  });

  it('feeds a later match from its own two feeders only', () => {
    expect(states.get('s1')).toMatchObject({ fedDecided: true, fedYou: true });
    expect(states.get('s2')).toMatchObject({ fedDecided: false, fedYou: false });
    expect(states.get('f')).toMatchObject({ fedDecided: false });
    expect(states.get('q1')).toMatchObject({ fedDecided: false });
  });

  it('the champion line is lit only once the final has a winner', () => {
    expect(championConnector(fin[0], done, 'me')).toMatchObject({ fedDecided: false, fedYou: false });
    const won = m('f', 3, 1, 'me', 'b', { status: 'completed', winner_id: 'me' });
    expect(championConnector(won, done, 'me')).toMatchObject({ fedDecided: true, fedYou: true });
    expect(championConnector(won, done, 'someone')).toMatchObject({ fedDecided: true, fedYou: false });
    expect(championConnector(null, done, 'me')).toMatchObject({ fedDecided: false });
  });

  it('a spectator (no user id) never gets the viewer colour', () => {
    const spectator = deriveConnectorStates({ rounds: [qf, sf, fin], isCompleted: done, youUserId: null });
    expect(spectator.get('q1')).toMatchObject({ decided: true, youAdvanced: false });
  });
});

describe('slotResult and seedFor', () => {
  const match = m('q', 1, 1, 'x', 'y', { status: 'completed', winner_id: 'x' });
  it('marks the winner and the loser only once the match is decided', () => {
    expect(slotResult(match, 'x', true)).toBe('won');
    expect(slotResult(match, 'y', true)).toBe('lost');
    expect(slotResult(match, 'x', false)).toBeNull();
    expect(slotResult(m('q', 1, 1, 'x', 'y'), 'x', true)).toBeNull();
    expect(slotResult(match, null, true)).toBeNull();
  });

  it('shows a seed only when the registration has a real one', () => {
    const seeds = new Map<string, number | null>([['a', 3], ['b', null], ['c', 0]]);
    expect(seedFor('a', seeds)).toBe(3);
    expect(seedFor('b', seeds)).toBeNull();
    expect(seedFor('c', seeds)).toBeNull();
    expect(seedFor('zzz', seeds)).toBeNull();
    expect(seedFor(null, seeds)).toBeNull();
  });
});
