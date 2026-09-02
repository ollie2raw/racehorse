// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildAppPath, resolveAppRoute } from './appRoutePath';

describe('app route paths', () => {
  it.each([
    ['/multiplayer', { mode: 'multiplayer', multiplayerView: 'quick' }],
    ['/multiplayer/private', { mode: 'multiplayer', multiplayerView: 'private' }],
    ['/solo/fritz', { mode: 'botSetup' }],
    ['/solo/ghost', { mode: 'ghostSetup' }],
    ['/social', { mode: 'feed' }],
    ['/daily-fritz/leaderboard', { mode: 'dailyFritzLeaderboard' }],
    ['/learn/how-to-play', { mode: 'learn', learnHowToPlay: true }],
    ['/settings', { mode: 'settings' }],
  ])('resolves %s', (path, expected) => {
    expect(resolveAppRoute(path)).toEqual(expected);
  });

  it('decodes parameterized profile and tournament routes', () => {
    expect(resolveAppRoute('/players/Player%20One')).toEqual({
      mode: 'profile',
      profileUsername: 'Player One',
    });
    expect(resolveAppRoute('/tournament/tour-1')).toEqual({
      mode: 'tournament',
      tournamentId: 'tour-1',
      tournamentView: 'bracket',
    });
    expect(resolveAppRoute('/tournament/tour-1/result')).toEqual({
      mode: 'tournament',
      tournamentId: 'tour-1',
      tournamentView: 'result',
    });
  });

  it('builds parameterized and subview paths from app state', () => {
    const base = {
      multiplayerView: 'quick' as const,
      profileUsername: null,
      learnHowToPlay: false,
      tournamentId: null,
      tournamentView: 'hub' as const,
    };
    expect(buildAppPath({ ...base, mode: 'profile', profileUsername: '@Maya' })).toBe('/players/Maya');
    expect(buildAppPath({ ...base, mode: 'multiplayer', multiplayerView: 'private' })).toBe('/multiplayer/private');
    expect(buildAppPath({ ...base, mode: 'learn', learnHowToPlay: true })).toBe('/learn/how-to-play');
    expect(buildAppPath({
      ...base,
      mode: 'tournament',
      tournamentId: 'tour-1',
      tournamentView: 'result',
    })).toBe('/tournament/tour-1/result');
  });

  it('keeps active match modes on the existing root path', () => {
    const base = {
      multiplayerView: 'quick' as const,
      profileUsername: null,
      learnHowToPlay: false,
      tournamentId: null,
      tournamentView: 'hub' as const,
    };
    expect(buildAppPath({ ...base, mode: 'bot' })).toBe('/');
    expect(buildAppPath({ ...base, mode: 'ghost' })).toBe('/');
  });

  it('round-trips the settings route', () => {
    // The nav dropdown pushes this path, so resolve and build must agree or
    // a reload of /settings would land the user on home.
    expect(buildAppPath({
      multiplayerView: 'quick',
      profileUsername: null,
      learnHowToPlay: false,
      tournamentId: null,
      tournamentView: 'hub',
      mode: 'settings',
    })).toBe('/settings');
  });
});
