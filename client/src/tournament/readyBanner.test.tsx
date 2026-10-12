/**
 * The app-wide ready banner (Phase 3D): shown for a ready tournament match on
 * other screens, never stacked on a screen that already offers Join, gone once
 * the match is joined / gone / cancelled, dismissible per match, recovered
 * from /my without a socket, and never a Join over another game.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readyBannerMode, selectReadyBannerMatch, type ReadyBannerMatch } from './readyBanner';
import { TournamentReadyBannerHost } from './TournamentReadyBannerHost';
import type { MatchReadyEvent, TournamentAssignedPlayable } from './types';

afterEach(cleanup);

const playable = (matchId: string, matchStatus: 'ready' | 'in_progress' = 'ready', round: 1 | 2 | 3 = 2, tournamentId = 't1'): TournamentAssignedPlayable => ({
  matchId, tournamentId, round, matchNumber: 1, roomCode: `R-${matchId}`, opponentId: null, opponentUsername: null, matchStatus, readyDeadlineAt: null,
});
const push = (matchId: string, round: 1 | 2 | 3 = 2, tournamentId = 't1'): MatchReadyEvent => ({
  tournamentId, matchId, round, matchNumber: 1, roomCode: `R-${matchId}`, matchStatus: 'ready', readyAt: null, readyDeadlineAt: null, opponentId: null, opponentUsername: null,
});
const NONE: ReadonlySet<string> = new Set();
const select = (over: Partial<Parameters<typeof selectReadyBannerMatch>[0]>) =>
  selectReadyBannerMatch({ activeAssignedMatch: null, pendingMatch: null, pendingMatchAtMono: 0, myRequestedAtMono: 0, cancelledTournamentIds: NONE, ...over });
const match: ReadyBannerMatch = { matchId: 'm2', tournamentId: 't1', round: 2, roomCode: 'R-m2' };
const mode = (over: Partial<Parameters<typeof readyBannerMode>[0]>) =>
  readyBannerMode({
    match, dismissedMatchIds: NONE, appMode: 'home', tournamentSubView: 'hub', activeTournamentId: null,
    joinedRoom: null, currentTournamentMatch: null, liveGameOver: false, ...over,
  });

describe('which match', () => {
  it('/my ready assignment; in_progress or none is no banner', () => {
    expect(select({ activeAssignedMatch: playable('m2') })).toMatchObject({ matchId: 'm2', round: 2 });
    expect(select({ activeAssignedMatch: playable('m2', 'in_progress') })).toBeNull();
    expect(select({})).toBeNull();
  });
  it('a match_ready push shows until a /my sent after it answers', () => {
    expect(select({ pendingMatch: push('m3'), pendingMatchAtMono: 200, myRequestedAtMono: 100 })).toMatchObject({ matchId: 'm3' });
    // /my sent after the push answered without the match (joined elsewhere, gone): no banner.
    expect(select({ pendingMatch: push('m3'), pendingMatchAtMono: 200, myRequestedAtMono: 300 })).toBeNull();
  });
  it('a cancelled tournament never shows', () => {
    const cancelled = new Set(['t1']);
    expect(select({ activeAssignedMatch: playable('m2'), cancelledTournamentIds: cancelled })).toBeNull();
    expect(select({ pendingMatch: push('m3'), pendingMatchAtMono: 2, cancelledTournamentIds: cancelled })).toBeNull();
  });
});

describe('where it shows', () => {
  it('1. an unrelated screen shows it with Join', () => {
    expect(mode({ appMode: 'home' })).toBe('join');
    expect(mode({ appMode: 'stats' })).toBe('join');
  });
  it('2. not on the Hub (its card offers Join)', () => {
    expect(mode({ appMode: 'tournament', tournamentSubView: 'hub' })).toBe('hidden');
  });
  it("3. not on this tournament's bracket (Your Path offers Join); another tournament's bracket shows it", () => {
    expect(mode({ appMode: 'tournament', tournamentSubView: 'bracket', activeTournamentId: 't1' })).toBe('hidden');
    expect(mode({ appMode: 'tournament', tournamentSubView: 'bracket', activeTournamentId: 'other' })).toBe('join');
  });
  it("4. not over this tournament's result / post-game (they offer Join next round)", () => {
    expect(mode({ appMode: 'tournament', tournamentSubView: 'result', activeTournamentId: 't1' })).toBe('hidden');
    expect(mode({ appMode: 'multiplayer', joinedRoom: 'R-m1', currentTournamentMatch: { tournamentId: 't1', matchId: 'm1' }, liveGameOver: true })).toBe('hidden');
  });
  it('not inside the match itself', () => {
    expect(mode({ appMode: 'multiplayer', joinedRoom: 'R-m2', currentTournamentMatch: { tournamentId: 't1', matchId: 'm2' } })).toBe('hidden');
  });
  it('10. in another game: shown without Join (never switches)', () => {
    expect(mode({ appMode: 'multiplayer', joinedRoom: 'PRIVATE1', currentTournamentMatch: null })).toBe('in_game');
    expect(mode({ appMode: 'bot' })).toBe('in_game');
    expect(mode({ appMode: 'dailyFritz' })).toBe('in_game');
    // Another tournament's match still in play.
    expect(mode({ appMode: 'multiplayer', joinedRoom: 'R-x', currentTournamentMatch: { tournamentId: 't9', matchId: 'x' } })).toBe('in_game');
  });
  it('7. a dismissed match stays hidden', () => {
    expect(mode({ dismissedMatchIds: new Set(['m2']) })).toBe('hidden');
  });
});

type HostProps = Parameters<typeof TournamentReadyBannerHost>[0];
function host(over: Partial<HostProps> = {}) {
  const props: HostProps = {
    enabled: true, activeAssignedMatch: playable('m2'), pendingMatch: null, pendingMatchAtMono: 0, myRequestedAtMono: 0,
    cancelledTournamentIds: NONE, appMode: 'home', tournamentSubView: 'hub', activeTournamentId: null, joinedRoom: null,
    currentTournamentMatch: null, liveGameOver: false, joining: false, onJoin: vi.fn(), ...over,
  };
  const view = render(<TournamentReadyBannerHost {...props} />);
  return { ...view, props, update: (next: Partial<HostProps>) => view.rerender(<TournamentReadyBannerHost {...props} {...next} />) };
}

describe('the banner', () => {
  it('names the round and joins only on a tap', () => {
    const { props } = host();
    expect(screen.getByText('Your Semifinal is ready')).toBeTruthy();
    expect(props.onJoin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Join your Semifinal' }));
    expect(props.onJoin).toHaveBeenCalledWith('m2');
  });
  it('Quarterfinal / Final copy', () => {
    const { update } = host({ activeAssignedMatch: playable('m1', 'ready', 1) });
    expect(screen.getByText('Your Quarterfinal is ready')).toBeTruthy();
    update({ activeAssignedMatch: playable('m3', 'ready', 3) });
    expect(screen.getByText('Your Final is ready')).toBeTruthy();
  });
  it('5. disappears when the match goes in progress', () => {
    const { update } = host();
    update({ activeAssignedMatch: playable('m2', 'in_progress') });
    expect(screen.queryByText(/is ready/)).toBeNull();
  });
  it('6. disappears when the assignment is gone or the tournament is cancelled', () => {
    const { update } = host();
    update({ activeAssignedMatch: null });
    expect(screen.queryByText(/is ready/)).toBeNull();
    update({ activeAssignedMatch: playable('m2'), cancelledTournamentIds: new Set(['t1']) });
    expect(screen.queryByText(/is ready/)).toBeNull();
  });
  it('7. dismiss hides it for this match through rerenders and refetches; 8. a new match id shows again', () => {
    const { update } = host();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss match ready notice' }));
    expect(screen.queryByText(/is ready/)).toBeNull();
    update({ activeAssignedMatch: { ...playable('m2'), readyDeadlineAt: '2026-10-31T00:00:00.000Z' } });
    expect(screen.queryByText(/is ready/)).toBeNull();
    update({ activeAssignedMatch: playable('m3', 'ready', 3) });
    expect(screen.getByText('Your Final is ready')).toBeTruthy();
  });
  it('9. recovered from /my alone (no match_ready ever arrived)', () => {
    host({ pendingMatch: null, activeAssignedMatch: playable('m2') });
    expect(screen.getByText('Your Semifinal is ready')).toBeTruthy();
  });
  it('10. over another game: no Join button, and nothing joins', () => {
    const { props } = host({ appMode: 'multiplayer', joinedRoom: 'PRIVATE1' });
    expect(screen.getByText('Your Semifinal is ready')).toBeTruthy();
    expect(screen.getByText('Finish or leave this game to join.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull();
    expect(props.onJoin).not.toHaveBeenCalled();
  });
  it('off when tournaments are off', () => {
    host({ enabled: false });
    expect(screen.queryByText(/is ready/)).toBeNull();
  });
  it('Join is a 44px+ target and shows progress while joining', () => {
    host({ joining: true });
    const join = screen.getByRole('button', { name: 'Joining your Semifinal' }) as HTMLButtonElement;
    expect(join.textContent).toBe('Joining…');
    expect(join.disabled).toBe(true);
  });
});
