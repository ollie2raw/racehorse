import { describe, expect, it } from 'vitest';
import {
  decideTournamentAutoAttach,
  FRITZ_LAUNCH_INTENT_MS,
  matchEndsFritzLaunchIntent,
  type AutoAttachInput,
} from './tournamentJoinPolicy';

const CUP = 'cup-1';
const LIVE = 'live-1';
const ready = (tournamentId: string) => ({ matchId: `m-${tournamentId}`, tournamentId, matchStatus: 'ready' as const });
const inProgress = (tournamentId: string) => ({ matchId: `m-${tournamentId}`, tournamentId, matchStatus: 'in_progress' as const });
const base = (over: Partial<AutoAttachInput>): AutoAttachInput => ({
  source: 'my', match: ready(LIVE), launchIntent: null, nowMono: 100_000, inOtherGame: false, ...over,
});

describe('tournament join policy', () => {
  it('a ready match is never joined from match_ready, /my, reconnect or resume', () => {
    for (const source of ['match_ready', 'my'] as const) {
      for (const tournamentId of [LIVE, CUP]) {
        expect(decideTournamentAutoAttach(base({ source, match: ready(tournamentId) })).attach).toBe(false);
      }
    }
  });

  it('a ready match is not joined while the player is in another game either', () => {
    expect(decideTournamentAutoAttach(base({ source: 'match_ready', inOtherGame: true }))).toEqual({ attach: false, reason: 'in_other_game' });
  });

  it('an in_progress match from /my (this player already joined it) is restored', () => {
    expect(decideTournamentAutoAttach(base({ source: 'my', match: inProgress(LIVE) }))).toEqual({ attach: true, reason: 'restore_in_progress' });
  });

  it('…but not by pulling the player out of a different game', () => {
    expect(decideTournamentAutoAttach(base({ source: 'my', match: inProgress(LIVE), inOtherGame: true })).attach).toBe(false);
  });

  it('a socket match_ready saying in_progress is not authoritative for this player', () => {
    expect(decideTournamentAutoAttach(base({ source: 'match_ready', match: inProgress(LIVE) }))).toEqual({ attach: false, reason: 'socket_not_authoritative' });
  });

  it('Play Fritz Cup joins that cup\'s first ready match, from the create response or its match_ready', () => {
    const launchIntent = { startedAtMono: 99_000, tournamentId: CUP };
    expect(decideTournamentAutoAttach(base({ source: 'fritz_create', match: ready(CUP), launchIntent }))).toEqual({ attach: true, reason: 'fritz_launch' });
    expect(decideTournamentAutoAttach(base({ source: 'match_ready', match: ready(CUP), launchIntent }))).toEqual({ attach: true, reason: 'fritz_launch' });
    expect(decideTournamentAutoAttach(base({ source: 'my', match: ready(CUP), launchIntent }))).toEqual({ attach: true, reason: 'fritz_launch' });
  });

  it('while the cup id is still unknown (create in flight) a ready match waits', () => {
    const launchIntent = { startedAtMono: 99_000, tournamentId: null };
    expect(decideTournamentAutoAttach(base({ source: 'match_ready', match: ready(CUP), launchIntent }))).toEqual({ attach: false, reason: 'awaiting_cup_id' });
  });

  it('a stale launch intent cannot join a later match', () => {
    const launchIntent = { startedAtMono: 100_000 - FRITZ_LAUNCH_INTENT_MS, tournamentId: CUP };
    expect(decideTournamentAutoAttach(base({ source: 'match_ready', match: ready(CUP), launchIntent })).attach).toBe(false);
  });

  it('a launch intent never joins another tournament\'s match (a Live Event match stays a tap)', () => {
    const launchIntent = { startedAtMono: 99_000, tournamentId: CUP };
    expect(decideTournamentAutoAttach(base({ source: 'match_ready', match: ready(LIVE), launchIntent })).attach).toBe(false);
    expect(matchEndsFritzLaunchIntent(launchIntent, LIVE)).toBe(true);
    expect(matchEndsFritzLaunchIntent(launchIntent, CUP)).toBe(false);
    expect(matchEndsFritzLaunchIntent({ startedAtMono: 0, tournamentId: null }, LIVE)).toBe(false);
  });
});
