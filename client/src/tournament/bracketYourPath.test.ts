import { describe, expect, it } from 'vitest';
import { deriveYourPath, initialRoundTab } from './bracketYourPath';
import type { TournamentMatch } from './types';

const ME = 'me';
const m = (id: string, round: 1 | 2 | 3, p1: string | null, p2: string | null, over: Partial<TournamentMatch> = {}): TournamentMatch => ({
  id, tournament_id: 't', round, match_number: 1, player1_id: p1, player2_id: p2, winner_id: null, room_code: null,
  status: 'waiting', bot_tier: null, started_at: null, completed_at: null, player1_score: null, player2_score: null, ...over,
});
const names = new Map<string, string>([['ana', 'ana']]);
const path = (matches: TournamentMatch[], playable: { matchId: string; matchStatus: string } | null = null) =>
  deriveYourPath({ matches, userId: ME, usernames: names, playable });

describe('Your path', () => {
  it('ready (Join) and in progress (Resume) come from /my', () => {
    const qf = m('qf', 1, ME, 'bot:fritz:t:2', { status: 'ready', bot_tier: 'standard' });
    expect(path([qf], { matchId: 'qf', matchStatus: 'ready' })).toMatchObject({ state: 'ready', round: 1, headline: 'Your Quarterfinal is ready', opponent: { label: 'Fritz', badgeLabel: 'Fritz' } });
    expect(path([qf], { matchId: 'qf', matchStatus: 'in_progress' })).toMatchObject({ state: 'in_progress', headline: 'Your Quarterfinal is in progress' });
  });
  it('advanced, then the next round', () => {
    const qf = m('qf', 1, ME, 'ana', { status: 'completed', winner_id: ME, outcomeKind: 'played' });
    expect(path([qf])).toMatchObject({ state: 'advanced', headline: 'Through to the Semifinal', outcome: { title: 'You won' } });
    const sf = m('sf', 2, ME, null);
    expect(path([qf, sf])).toMatchObject({ state: 'waiting', round: 2, headline: 'Semifinal · waiting for your opponent' });
    expect(initialRoundTab(path([qf]))).toBe(2);
  });
  it('an administrative advance reads as advanced, not won', () => {
    const qf = m('qf', 1, ME, 'ana', { status: 'completed', winner_id: ME, outcomeKind: 'administrative' });
    expect(path([qf])?.outcome).toMatchObject({ title: 'You advanced', detail: 'Opponent unavailable · Advanced to the Semifinal' });
  });
  it('eliminated by Elite Fritz; champion', () => {
    const sf = m('sf', 2, ME, 'bot:fritz:t:5', { status: 'completed', winner_id: 'bot:fritz:t:5', bot_tier: 'elite', outcomeKind: 'played' });
    expect(path([sf])).toMatchObject({ state: 'eliminated', headline: 'Eliminated in the Semifinal', outcome: { detail: 'Lost to Elite Fritz' } });
    const fin = m('f', 3, 'ana', ME, { status: 'completed', winner_id: ME, outcomeKind: 'played' });
    expect(path([fin])).toMatchObject({ state: 'champion', headline: 'Champion' });
  });
  it('not in the bracket: none', () => {
    expect(path([m('x', 1, 'ana', 'bot:fritz:t:1')])).toBeNull();
    expect(deriveYourPath({ matches: [], userId: null, usernames: names, playable: null })).toBeNull();
  });
});
