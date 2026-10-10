import { describe, expect, it } from 'vitest';
import { deriveFritzCupCardState, deriveLiveEventCardState, selectHubLiveEvents } from './hubCardState';
import type { FritzLaunchState } from './useTournament';
import type { MyTournament, ScheduledTournament } from './types';

const NOW = Date.parse('2026-10-30T16:00:00.000Z');
const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();

function event(id: string, status: ScheduledTournament['status'], startIn: number, over: Partial<ScheduledTournament> = {}): ScheduledTournament {
  return {
    id, kind: 'live', status, scheduled_start: at(startIn), registration_open_at: at(startIn - 12 * HOUR),
    registration_close_at: at(startIn - 2 * 60_000), format: '7-tile', win_target: 30, max_players: 8,
    winner_id: null, created_at: at(-24 * HOUR), registered_count: 3, ...over,
  };
}
function mine(t: ScheduledTournament, status: MyTournament['myRegistration']['status'], over: Partial<MyTournament> = {}): MyTournament {
  return { ...t, myRegistration: { status, placement: null, placementLabel: null, seed: null }, myLastMatch: null, ...over };
}
const playable = (tournamentId: string, matchStatus: 'ready' | 'in_progress', round: 1 | 2 | 3 = 1) => ({
  matchId: `m-${tournamentId}`, tournamentId, round, matchNumber: 1, roomCode: 'T', opponentId: null, opponentUsername: null, matchStatus, readyDeadlineAt: null,
});
const live = (e: ScheduledTournament, m: MyTournament | null = null, extra: { playable?: ReturnType<typeof playable>; cancelled?: boolean; nowMs?: number } = {}) =>
  deriveLiveEventCardState({ event: e, mine: m, playable: extra.playable ?? null, cancelled: extra.cancelled ?? false, nowMs: extra.nowMs ?? NOW });

describe('Live Event card state', () => {
  it('before registration opens', () => {
    expect(live(event('e', 'upcoming', 14 * HOUR))).toMatchObject({ kind: 'not_open', opensAt: at(2 * HOUR) });
  });
  it('open, then full (8 humans)', () => {
    expect(live(event('e', 'registration_open', 5 * HOUR))).toMatchObject({ kind: 'open' });
    expect(live(event('e', 'registration_open', 5 * HOUR, { registered_count: 8 }))).toMatchObject({ kind: 'full' });
  });
  it('registered: withdraw only while registration is open', () => {
    const e = event('e', 'registration_open', 5 * HOUR);
    expect(live(e, mine(e, 'registered'))).toEqual({ kind: 'registered', startsAt: e.scheduled_start, canWithdraw: true });
    expect(live(e, mine(e, 'registered'), { nowMs: NOW + 5 * HOUR - 60_000 })).toMatchObject({ kind: 'registered', canWithdraw: false });
  });
  it('registration closed (not entered), and under way', () => {
    const e = event('e', 'registration_open', 60_000);
    expect(live(e)).toMatchObject({ kind: 'closed', underway: false });
    expect(live(event('e', 'in_progress', -60_000))).toMatchObject({ kind: 'closed', underway: true });
  });
  it('entered: bracket set before the start, then setting up the match, then advanced', () => {
    const e = event('e', 'in_progress', 60_000);
    expect(live(e, mine(e, 'active'))).toMatchObject({ kind: 'bracket_set' });
    const started = event('e', 'in_progress', -60_000);
    expect(live(started, mine(started, 'active'))).toEqual({ kind: 'starting' });
    expect(live(started, mine(started, 'active', { myLastMatch: { matchId: 'x', round: 1, won: true, outcomeKind: 'played', opponentId: null, opponentBotTier: null } }))).toEqual({ kind: 'advanced' });
  });
  it('match ready (a tap) and in progress (resume)', () => {
    const e = event('e', 'in_progress', -60_000);
    expect(live(e, mine(e, 'active'), { playable: playable('e', 'ready', 2) })).toEqual({ kind: 'match_ready', matchId: 'm-e', round: 2 });
    expect(live(e, mine(e, 'active'), { playable: playable('e', 'in_progress') })).toEqual({ kind: 'in_match', matchId: 'm-e', round: 1 });
    // another tournament's match is not this card's
    expect(live(e, mine(e, 'active'), { playable: playable('other', 'ready') }).kind).toBe('starting');
  });
  it('eliminated (placement label or the exit round), champion', () => {
    const e = event('e', 'completed', -HOUR);
    expect(live(e, mine(e, 'eliminated', { myRegistration: { status: 'eliminated', placement: 3, placementLabel: 'Semifinalist', seed: 2 } })))
      .toEqual({ kind: 'eliminated', placementLabel: 'Semifinalist', exitRound: null });
    expect(live(e, mine(e, 'eliminated', { myLastMatch: { matchId: 'x', round: 1, won: false, outcomeKind: 'played', opponentId: null, opponentBotTier: null } })))
      .toMatchObject({ kind: 'eliminated', exitRound: 1 });
    expect(live(e, mine(e, 'winner'))).toEqual({ kind: 'champion' });
  });
  it('cancelled: by status or by the socket event (no countdown)', () => {
    const e = event('e', 'registration_open', 5 * HOUR);
    expect(live({ ...e, status: 'cancelled' })).toEqual({ kind: 'cancelled' });
    expect(live(e, mine(e, 'registered'), { cancelled: true })).toEqual({ kind: 'cancelled' });
  });
});

describe('which Live Events the hub shows', () => {
  it('the next relevant event first, at most one more; a later registration still shows as registered', () => {
    const a = event('a', 'registration_open', 1 * HOUR);
    const b = event('b', 'registration_open', 4 * HOUR);
    const c = event('c', 'upcoming', 25 * HOUR);
    const rows = selectHubLiveEvents({ upcoming: [a, b, c], myTournaments: [mine(b, 'registered')], nowMs: NOW });
    expect(rows.map((r) => r.event.id)).toEqual(['a', 'b']);
    expect(rows[1].mine?.myRegistration.status).toBe('registered');
  });
  it('the player\'s started event (gone from /upcoming) comes first; Fritz Cups never appear here', () => {
    const started = event('s', 'in_progress', -10 * 60_000);
    const next = event('n', 'registration_open', 3 * HOUR);
    const cup = { ...event('cup', 'in_progress', -60_000), kind: 'fritz_cup' as const };
    const rows = selectHubLiveEvents({ upcoming: [next], myTournaments: [mine(started, 'active'), mine(cup, 'active')], nowMs: NOW });
    expect(rows.map((r) => r.event.id)).toEqual(['s', 'n']);
  });
  it('a just-cancelled registered event stays visible (as cancelled) until /my drops it', () => {
    const cancelled = event('x', 'cancelled', 2 * HOUR);
    const rows = selectHubLiveEvents({ upcoming: [], myTournaments: [mine(cancelled, 'registered')], nowMs: NOW });
    expect(rows.map((r) => r.event.id)).toEqual(['x']);
  });
});

describe('Fritz Cup card state', () => {
  const idle: FritzLaunchState = { phase: 'idle', tournamentId: null, startedAtMono: 0, error: null };
  const on = { tournaments: true, fritzCup: true };
  const cup = (status: MyTournament['myRegistration']['status'] = 'active') =>
    mine({ ...event('cup', 'in_progress', -60_000), kind: 'fritz_cup' }, status);
  const fritz = (over: Partial<Parameters<typeof deriveFritzCupCardState>[0]>) =>
    deriveFritzCupCardState({ features: on, signedIn: true, myTournaments: [], playable: null, launch: idle, ...over });

  it('hidden when Fritz Cups are off (or tournaments are), or before features are known', () => {
    expect(fritz({ features: { tournaments: true, fritzCup: false } })).toEqual({ kind: 'hidden' });
    expect(fritz({ features: { tournaments: false, fritzCup: false } })).toEqual({ kind: 'hidden' });
    expect(fritz({ features: null })).toEqual({ kind: 'hidden' });
  });
  it('sign in / play / starting / building / slow / failed', () => {
    expect(fritz({ signedIn: false })).toEqual({ kind: 'sign_in' });
    expect(fritz({})).toEqual({ kind: 'play' });
    expect(fritz({ launch: { ...idle, phase: 'creating' } })).toEqual({ kind: 'starting' });
    expect(fritz({ launch: { ...idle, phase: 'building', tournamentId: 'cup' } })).toEqual({ kind: 'building' });
    expect(fritz({ launch: { ...idle, phase: 'slow', tournamentId: 'cup' } })).toEqual({ kind: 'slow', tournamentId: 'cup' });
    expect(fritz({ launch: { ...idle, phase: 'failed' } }).kind).toBe('failed');
  });
  it('an active cup: Join (ready), Resume (in progress), waiting — never a second Play', () => {
    expect(fritz({ myTournaments: [cup()], playable: playable('cup', 'ready', 2) })).toEqual({ kind: 'join', tournamentId: 'cup', matchId: 'm-cup', round: 2 });
    expect(fritz({ myTournaments: [cup()], playable: playable('cup', 'in_progress') })).toMatchObject({ kind: 'resume' });
    expect(fritz({ myTournaments: [cup()] })).toMatchObject({ kind: 'waiting', tournamentId: 'cup' });
  });
  it('an active cup stays reachable even when new cups are switched off', () => {
    expect(fritz({ features: { tournaments: true, fritzCup: false }, myTournaments: [cup()], playable: playable('cup', 'ready') }).kind).toBe('join');
  });
  it('a finished cup does not block a new one', () => {
    expect(fritz({ myTournaments: [mine({ ...event('cup', 'completed', -HOUR), kind: 'fritz_cup' }, 'eliminated')] })).toEqual({ kind: 'play' });
  });
});
