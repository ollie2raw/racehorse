/**
 * Tournament analytics (Phase 3E): the launch events fire at real triggers,
 * once each — refetches, reconnects and foregrounding never re-send them —
 * with only non-identifying properties, and a failing analytics client never
 * blocks starting a Fritz Cup, registering, or anything else.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchUpcoming: vi.fn(),
  fetchMy: vi.fn(),
  startFritzCup: vi.fn(),
  registerForTournament: vi.fn(),
  withdrawFromTournament: vi.fn(),
  fetchBracket: vi.fn(),
  fetchResult: vi.fn(),
}));
vi.mock('./tournamentApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tournamentApi')>()),
  ...api,
}));

import { __setAnalyticsTransport, type AnalyticsTransport } from '../lib/analytics';
import { useTournament } from './useTournament';
import { TournamentApiError } from './tournamentApi';
import { resetTournamentClockForTests } from './tournamentClock';
import {
  clearTournamentGameContext,
  resetTournamentAnalyticsForTests,
  setTournamentGameContext,
  tournamentGameProps,
  trackTournamentMatchJoined,
} from './tournamentAnalytics';
import type { MyTournament, ScheduledTournament } from './types';

const USER = '11111111-1111-4111-8111-111111111111';
const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const FEATURES = { tournaments: true, fritzCup: true };

function tournament(id: string, kind: 'live' | 'fritz_cup', status: ScheduledTournament['status']): ScheduledTournament {
  return {
    id, kind, status, scheduled_start: at(-60_000), registration_open_at: at(-12 * HOUR), registration_close_at: at(-120_000),
    format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: at(-HOUR), registered_count: null,
  };
}
function mine(t: ScheduledTournament, status: MyTournament['myRegistration']['status'], placement: number | null = null, outcome: MyTournament['myLastMatch'] = null): MyTournament {
  return { ...t, myRegistration: { status, placement, placementLabel: null, seed: null }, myLastMatch: outcome };
}
const cup = tournament('cup-1', 'fritz_cup', 'in_progress');
const ready = { matchId: 'm-cup-r2', tournamentId: 'cup-1', round: 2 as const, matchNumber: 1, roomCode: 'R', opponentId: 'bot:fritz:cup-1:5', opponentUsername: 'Elite Fritz', matchStatus: 'ready' as const, readyDeadlineAt: null };

let captured: Array<{ event: string; props?: Record<string, unknown> }> = [];
function installTransport(throwing = false) {
  const transport: AnalyticsTransport = {
    capture: (event, props) => {
      if (throwing) throw new Error('posthog down');
      captured.push({ event, props: props as Record<string, unknown> });
    },
    identify: () => undefined,
    reset: () => undefined,
  };
  __setAnalyticsTransport(transport);
}
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const events = (name: string) => captured.filter((c) => c.event === name);

function serveMy(tournaments: MyTournament[], activeAssignedMatch: typeof ready | null = null) {
  api.fetchUpcoming.mockResolvedValue({ tournaments: [], features: FEATURES });
  api.fetchMy.mockResolvedValue({ registrations: [], tournaments, activeAssignedMatch, features: FEATURES });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetTournamentClockForTests(() => performance.now());
  resetTournamentAnalyticsForTests();
  for (const fn of Object.values(api)) fn.mockReset();
  captured = [];
  installTransport();
});
afterEach(() => {
  __setAnalyticsTransport(null);
  vi.useRealTimers();
});

describe('tournament analytics', () => {
  it('match ready fires once per match id across refetches / foregrounding / reconnect', async () => {
    serveMy([mine(cup, 'active')], ready);
    const { result } = renderHook(() => useTournament({ userId: USER, enabled: true }));
    await settle();
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await result.current.refresh(); });
      await settle();
    }
    // The same match also announced by the socket.
    act(() => result.current.hubSocketDelegatesRef.current.onMatchReady({ ...ready, readyAt: null } as never));
    await settle();
    expect(events('tournament_match_ready')).toEqual([{ event: 'tournament_match_ready', props: { kind: 'fritz_cup', round: 2 } }]);
  });

  it('champion fires once, on the transition — not for an old result seen on first load', async () => {
    serveMy([mine(cup, 'active')]);
    const { result } = renderHook(() => useTournament({ userId: USER, enabled: true }));
    await settle();
    const won = mine({ ...cup, status: 'completed' }, 'winner', 1, { matchId: 'f', round: 3, won: true, outcomeKind: 'played', opponentId: 'bot:fritz:cup-1:7', opponentBotTier: 'master' });
    serveMy([won]);
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await result.current.refresh(); });
      await settle();
    }
    expect(events('tournament_champion')).toEqual([
      { event: 'tournament_champion', props: { kind: 'fritz_cup', placement: 1, round: 3, outcome_kind: 'played', fritz_tier: 'master' } },
    ]);

    // A fresh session that only ever sees the finished cup sends nothing.
    resetTournamentAnalyticsForTests();
    captured = [];
    renderHook(() => useTournament({ userId: USER, enabled: true }));
    await settle();
    expect(events('tournament_champion')).toEqual([]);
  });

  it('eliminated with placement and outcome kind', async () => {
    const live = tournament('live-1', 'live', 'in_progress');
    serveMy([mine(live, 'active')]);
    const { result } = renderHook(() => useTournament({ userId: USER, enabled: true }));
    await settle();
    serveMy([mine(live, 'eliminated', 3, { matchId: 's', round: 2, won: false, outcomeKind: 'missed_turns', opponentId: 'x', opponentBotTier: null })]);
    await act(async () => { await result.current.refresh(); });
    await settle();
    expect(events('tournament_eliminated')).toEqual([{ event: 'tournament_eliminated', props: { kind: 'live', placement: 3, round: 2, outcome_kind: 'missed_turns' } }]);
  });

  it('Fritz Cup: tapped, created / failed with the error code', async () => {
    serveMy([]);
    const { result } = renderHook(() => useTournament({ userId: USER, enabled: true }));
    await settle();
    api.startFritzCup.mockResolvedValueOnce({ existing: false, tournament: cup, activeAssignedMatch: null });
    await act(async () => { await result.current.startFritzCup(); });
    act(() => result.current.endFritzLaunch());
    api.startFritzCup.mockRejectedValueOnce(new TournamentApiError({ code: 'fritz_cup_cooldown', reason: 'cooldown' }));
    await act(async () => { await result.current.startFritzCup(); });
    await settle();
    expect(captured.map((c) => c.event).filter((e) => e.startsWith('fritz_cup'))).toEqual([
      'fritz_cup_tapped', 'fritz_cup_created', 'fritz_cup_tapped', 'fritz_cup_create_failed',
    ]);
    expect(events('fritz_cup_create_failed')[0].props).toEqual({ kind: 'fritz_cup', error_code: 'fritz_cup_cooldown' });
  });

  it('Live Event: register tapped → registered, or → failed with the code', async () => {
    serveMy([]);
    const { result } = renderHook(() => useTournament({ userId: USER, enabled: true }));
    await settle();
    api.registerForTournament.mockResolvedValueOnce({ alreadyRegistered: false });
    await act(async () => { await result.current.register('live-1'); });
    api.registerForTournament.mockRejectedValueOnce(new TournamentApiError({ code: 'tournament_full' }));
    await act(async () => { await expect(result.current.register('live-2')).rejects.toBeInstanceOf(TournamentApiError); });
    await settle();
    expect(captured.map((c) => c.event).filter((e) => e.startsWith('live_event'))).toEqual([
      'live_event_register_tapped', 'live_event_registered', 'live_event_register_tapped', 'live_event_registration_failed',
    ]);
    expect(events('live_event_registration_failed')[0].props).toEqual({ kind: 'live', error_code: 'tournament_full' });
  });

  it('no identifying data in any property', async () => {
    serveMy([mine(cup, 'active')], ready);
    renderHook(() => useTournament({ userId: USER, enabled: true }));
    await settle();
    trackTournamentMatchJoined({ matchId: 'm-cup-r2', round: 2, opponentId: 'bot:fritz:cup-1:5' }, 'fritz_cup');
    await settle();
    const all = JSON.stringify(captured);
    expect(all).not.toMatch(/bot:fritz|cup-1|m-cup|11111111|Elite Fritz/);
    expect(events('tournament_match_joined')[0].props).toEqual({ kind: 'fritz_cup', round: 2, fritz_tier: 'elite' });
  });

  it('joined fires once per match; game events carry the tournament context only for its room', () => {
    trackTournamentMatchJoined({ matchId: 'a', round: 1 }, 'live');
    trackTournamentMatchJoined({ matchId: 'a', round: 1 }, 'live');
    expect(tournamentGameProps()).toEqual({});
    setTournamentGameContext({ roomCode: 'ROOM1', kind: 'live', round: 2 });
    expect(tournamentGameProps()).toEqual({ tournament: true, round: 2, kind: 'live' });
    clearTournamentGameContext('OTHER');
    expect(tournamentGameProps()).toEqual({ tournament: true, round: 2, kind: 'live' });
    clearTournamentGameContext('room1');
    expect(tournamentGameProps()).toEqual({});
  });

  it('a failing analytics client never blocks starting a Fritz Cup or registering', async () => {
    installTransport(true);
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    serveMy([]);
    const { result } = renderHook(() => useTournament({ userId: USER, enabled: true }));
    await settle();
    api.startFritzCup.mockResolvedValueOnce({ existing: false, tournament: cup, activeAssignedMatch: null });
    await act(async () => { await result.current.startFritzCup(); });
    expect(result.current.fritzLaunch.phase).toBe('building');
    api.registerForTournament.mockResolvedValueOnce({ alreadyRegistered: false });
    await act(async () => { await expect(result.current.register('live-1')).resolves.toEqual({ alreadyRegistered: false }); });
    await settle();
    window.removeEventListener('unhandledrejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
