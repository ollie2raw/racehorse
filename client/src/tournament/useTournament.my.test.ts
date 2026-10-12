/**
 * useTournament on /my + /upcoming (Phase 3C): multi-tournament state, the
 * playable match, partial failures, feature flags, coalesced socket refetch,
 * cancellation, registration without local guesses, and the Fritz Cup launch.
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

import { useTournament, FRITZ_LAUNCH_SLOW_MS, TOURNAMENT_REFRESH_COALESCE_MS } from './useTournament';
import { TournamentApiError } from './tournamentApi';
import { resetTournamentClockForTests } from './tournamentClock';
import type { MyTournament, ScheduledTournament } from './types';

const USER = '11111111-1111-4111-8111-111111111111';
const HOUR = 60 * 60_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

function tournament(id: string, kind: 'live' | 'fritz_cup', status: ScheduledTournament['status'], startInMs: number): ScheduledTournament {
  return {
    id, kind, status, scheduled_start: at(startInMs), registration_open_at: at(startInMs - 12 * HOUR),
    registration_close_at: at(startInMs - 2 * 60_000), format: '7-tile', win_target: 30, max_players: 8,
    winner_id: null, created_at: at(-HOUR), registered_count: kind === 'live' ? 3 : null,
  };
}
function mine(t: ScheduledTournament, status: MyTournament['myRegistration']['status'], placement: number | null = null): MyTournament {
  return { ...t, myRegistration: { status, placement, placementLabel: placement === 1 ? 'Champion' : null, seed: null }, myLastMatch: null };
}
const cup = tournament('cup-1', 'fritz_cup', 'in_progress', -60_000);
const live = tournament('live-1', 'live', 'registration_open', 5 * HOUR);
const playable = (tournamentId: string, matchStatus: 'ready' | 'in_progress') => ({
  matchId: `m-${tournamentId}`, tournamentId, round: 1 as const, matchNumber: 1, roomCode: 'TROOM', opponentId: 'bot:fritz:x:2',
  opponentUsername: 'Fritz', matchStatus, readyDeadlineAt: null,
});
const FEATURES = { tournaments: true, fritzCup: true };

function serve(my: Partial<{ tournaments: MyTournament[]; activeAssignedMatch: ReturnType<typeof playable> | null; features: typeof FEATURES }> = {}) {
  api.fetchUpcoming.mockResolvedValue({ tournaments: [live], features: FEATURES });
  api.fetchMy.mockResolvedValue({
    registrations: [], tournaments: my.tournaments ?? [], activeAssignedMatch: my.activeAssignedMatch ?? null, features: my.features ?? FEATURES,
  });
}

async function mount(userId: string | null = USER) {
  const hook = renderHook(() => useTournament({ userId, enabled: true }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetTournamentClockForTests(() => performance.now());
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useTournament: /my as the authoritative multi-tournament state', () => {
  it('an active Fritz Cup and a later Live registration together, with the ready match and features', async () => {
    serve({ tournaments: [mine(cup, 'active'), mine(live, 'registered')], activeAssignedMatch: playable('cup-1', 'ready') });
    const { result } = await mount();
    expect(result.current.myTournaments.map((t) => t.id)).toEqual(['cup-1', 'live-1']);
    expect(result.current.activeAssignedMatch).toMatchObject({ tournamentId: 'cup-1', matchStatus: 'ready' });
    expect(result.current.recoveryMatch).toBe(result.current.activeAssignedMatch);
    expect(result.current.features).toEqual(FEATURES);
    expect(result.current.upcoming.map((t) => t.id)).toEqual(['live-1']);
    // The legacy (/me-shaped) view describes the cup, not the later Live Event.
    expect(result.current).toMatchObject({ activeTournamentId: 'cup-1', tournamentPhase: 'match_ready' });
  });

  it('an in-progress match is the recovery match; eliminated / champion / cancelled map to the legacy phases', async () => {
    serve({ tournaments: [mine(cup, 'active')], activeAssignedMatch: playable('cup-1', 'in_progress') });
    let { result } = await mount();
    expect(result.current).toMatchObject({ tournamentPhase: 'in_match', recoveryMatch: { matchStatus: 'in_progress' } });

    serve({ tournaments: [mine({ ...cup, status: 'completed' }, 'eliminated', 5)] });
    ({ result } = await mount());
    expect(result.current).toMatchObject({ tournamentPhase: 'eliminated', activeTournamentId: 'cup-1', recoveryMatch: null });

    serve({ tournaments: [mine({ ...cup, status: 'completed' }, 'winner', 1)] });
    ({ result } = await mount());
    expect(result.current).toMatchObject({ tournamentPhase: 'completed', activeTournamentId: 'cup-1' });

    serve({ tournaments: [mine({ ...live, status: 'cancelled' }, 'registered')] });
    ({ result } = await mount());
    expect(result.current.myTournaments[0].status).toBe('cancelled');
    expect(result.current.tournamentPhase).toBe('completed');
  });

  it('one request failing keeps what the other returned', async () => {
    serve({ tournaments: [mine(live, 'registered')] });
    api.fetchUpcoming.mockRejectedValue(new TournamentApiError({ code: 'network' }));
    let { result } = await mount();
    expect(result.current).toMatchObject({ upcomingError: 'network', myError: null, error: null });
    expect(result.current.myTournaments).toHaveLength(1);

    serve();
    api.fetchMy.mockRejectedValue(new TournamentApiError({ code: 'internal' }));
    ({ result } = await mount());
    expect(result.current).toMatchObject({ upcomingError: null, myError: 'internal', error: null });
    expect(result.current.upcoming).toHaveLength(1);
    expect(result.current.features).toEqual(FEATURES);

    api.fetchUpcoming.mockRejectedValue(new TournamentApiError({ code: 'network' }));
    ({ result } = await mount());
    expect(result.current.error).toBe('network');
  });

  it('signed out: no /my request; features from /upcoming', async () => {
    serve();
    api.fetchUpcoming.mockResolvedValue({ tournaments: [live], features: { tournaments: true, fritzCup: false } });
    const { result } = await mount(null);
    expect(api.fetchMy).not.toHaveBeenCalled();
    expect(result.current.features).toEqual({ tournaments: true, fritzCup: false });
  });

  it('a burst of socket events → one refetch; match_ready only stores the push (never joins)', async () => {
    serve();
    const { result } = await mount();
    const before = api.fetchMy.mock.calls.length;
    const delegates = result.current.hubSocketDelegatesRef.current;
    act(() => {
      delegates.onRegistrationUpdated({ tournamentId: 'live-1' });
      delegates.onBracketGenerated({ tournamentId: 'live-1' });
      delegates.onMatchUpdated({ tournamentId: 'live-1' });
      delegates.onRoundCompleted({ tournamentId: 'live-1' });
      delegates.onMatchReady({ tournamentId: 'cup-1', matchId: 'm-cup-1', round: 1, matchNumber: 1, roomCode: 'TROOM', matchStatus: 'ready', readyAt: null, readyDeadlineAt: null, opponentId: null, opponentUsername: 'Fritz' });
    });
    expect(result.current.pendingMatch?.matchId).toBe('m-cup-1');
    await act(async () => { await vi.advanceTimersByTimeAsync(TOURNAMENT_REFRESH_COALESCE_MS + 10); });
    expect(api.fetchMy.mock.calls.length - before).toBe(1);
    expect(api.startFritzCup).not.toHaveBeenCalled();
  });

  it('tournament:cancelled marks the tournament, clears its pending match and refetches', async () => {
    serve({ tournaments: [mine(live, 'registered')] });
    const { result } = await mount();
    act(() => {
      result.current.hubSocketDelegatesRef.current.onMatchReady({ tournamentId: 'live-1', matchId: 'm-live-1', round: 1, matchNumber: 1, roomCode: 'T', matchStatus: 'ready', readyAt: null, readyDeadlineAt: null, opponentId: null, opponentUsername: null });
    });
    serve({ tournaments: [mine({ ...live, status: 'cancelled' }, 'registered')] });
    act(() => { result.current.hubSocketDelegatesRef.current.onTournamentCancelled({ tournamentId: 'live-1', kind: 'live', status: 'cancelled' }); });
    expect(result.current.cancelledTournamentIds.has('live-1')).toBe(true);
    expect(result.current.pendingMatch).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(TOURNAMENT_REFRESH_COALESCE_MS + 10); });
    expect(result.current.myTournaments[0].status).toBe('cancelled');
  });

  it('foreground (visibilitychange) refetches', async () => {
    serve();
    await mount();
    const before = api.fetchMy.mock.calls.length;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(api.fetchMy.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('useTournament: registration', () => {
  it('register refetches and reports alreadyRegistered; no local row is invented', async () => {
    serve();
    const { result } = await mount();
    api.registerForTournament.mockResolvedValue({ alreadyRegistered: true });
    serve({ tournaments: [mine(live, 'registered')] });
    let out: { alreadyRegistered: boolean } | undefined;
    await act(async () => { out = await result.current.register('live-1'); });
    expect(out).toEqual({ alreadyRegistered: true });
    expect(result.current.myTournaments[0].myRegistration.status).toBe('registered');
  });

  it('a refused registration throws its structured error and changes nothing', async () => {
    serve();
    const { result } = await mount();
    const before = result.current.myTournaments;
    api.registerForTournament.mockRejectedValue(new TournamentApiError({ code: 'overlapping_tournament', conflict: { tournamentId: 'cup-1', kind: 'fritz_cup', scheduledStart: at(0) } }));
    let thrown: unknown;
    await act(async () => { try { await result.current.register('live-1'); } catch (err) { thrown = err; } });
    expect(thrown).toMatchObject({ code: 'overlapping_tournament', conflict: { kind: 'fritz_cup' } });
    expect(result.current.myTournaments).toBe(before);
  });

  it('withdraw: a refusal leaves the registration in place', async () => {
    serve({ tournaments: [mine(live, 'registered')] });
    const { result } = await mount();
    api.withdrawFromTournament.mockRejectedValue(new TournamentApiError({ code: 'withdraw_closed' }));
    let thrown: unknown;
    await act(async () => { try { await result.current.withdraw('live-1'); } catch (err) { thrown = err; } });
    expect(thrown).toMatchObject({ code: 'withdraw_closed' });
    expect(result.current.myTournaments[0].myRegistration.status).toBe('registered');
  });
});

describe('useTournament: Fritz Cup launch', () => {
  it('a double tap starts one cup; the response sets the cup id and its ready match', async () => {
    serve();
    const { result } = await mount();
    let resolve!: (v: unknown) => void;
    api.startFritzCup.mockReturnValue(new Promise((r) => { resolve = r; }));
    act(() => { void result.current.startFritzCup(); void result.current.startFritzCup(); });
    expect(api.startFritzCup).toHaveBeenCalledTimes(1);
    expect(result.current.fritzLaunch.phase).toBe('creating');
    expect(result.current.fritzLaunchIntent).toMatchObject({ tournamentId: null });
    // /my now reports the cup and its match too (the refetch after the create).
    serve({ tournaments: [mine(cup, 'active')], activeAssignedMatch: playable('cup-1', 'ready') });
    await act(async () => { resolve({ existing: false, tournament: cup, activeAssignedMatch: playable('cup-1', 'ready') }); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.fritzLaunch).toMatchObject({ phase: 'building', tournamentId: 'cup-1' });
    expect(result.current.fritzLaunchIntent).toMatchObject({ tournamentId: 'cup-1' });
    expect(result.current.activeAssignedMatch).toMatchObject({ tournamentId: 'cup-1', matchStatus: 'ready' });
    act(() => { result.current.endFritzLaunch(); });
    expect(result.current.fritzLaunchIntent).toBeNull();
  });

  it('no playable match after 10 s → slow (the cup is not started again)', async () => {
    serve();
    const { result } = await mount();
    api.startFritzCup.mockResolvedValue({ existing: false, tournament: cup, activeAssignedMatch: null });
    await act(async () => { await result.current.startFritzCup(); });
    expect(result.current.fritzLaunch.phase).toBe('building');
    await act(async () => { await vi.advanceTimersByTimeAsync(FRITZ_LAUNCH_SLOW_MS + 10); });
    expect(result.current.fritzLaunch.phase).toBe('slow');
    expect(api.startFritzCup).toHaveBeenCalledTimes(1);
  });

  it('errors are kept structured; tournaments_disabled re-reads the flags', async () => {
    serve();
    const { result } = await mount();
    api.startFritzCup.mockRejectedValue(new TournamentApiError({ code: 'fritz_cup_cooldown', retryAfterMs: 30_000, reason: 'cooldown' }));
    await act(async () => { await result.current.startFritzCup(); });
    expect(result.current.fritzLaunch).toMatchObject({ phase: 'failed', error: { code: 'fritz_cup_cooldown', retryAfterMs: 30_000 } });
    expect(result.current.fritzLaunchIntent).toBeNull();

    api.startFritzCup.mockRejectedValue(new TournamentApiError({ code: 'tournaments_disabled', status: 403 }));
    serve({ features: { tournaments: true, fritzCup: false } });
    await act(async () => { await result.current.startFritzCup(); await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.features).toEqual({ tournaments: true, fritzCup: false });
  });

  it('a cancellation of the cup being launched ends the launch', async () => {
    serve();
    const { result } = await mount();
    api.startFritzCup.mockResolvedValue({ existing: false, tournament: cup, activeAssignedMatch: null });
    await act(async () => { await result.current.startFritzCup(); });
    act(() => { result.current.hubSocketDelegatesRef.current.onTournamentCancelled({ tournamentId: 'cup-1', kind: 'fritz_cup' }); });
    expect(result.current.fritzLaunch.phase).toBe('idle');
  });
});

describe('Phase 4A: a signed-in user who arrives after mount (async session restore)', () => {
  it('loads /my even when the first, signed-out fetch is still in flight', async () => {
    let releaseUpcoming: (v: unknown) => void = () => undefined;
    api.fetchUpcoming.mockReturnValueOnce(new Promise((resolve) => { releaseUpcoming = resolve; }));
    serve({ tournaments: [mine(live, 'registered')] });
    const hook = renderHook(({ userId }: { userId: string | null }) => useTournament({ userId, enabled: true }), { initialProps: { userId: null as string | null } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(api.fetchMy).not.toHaveBeenCalled();
    // The session restores while the signed-out fetch is still pending.
    hook.rerender({ userId: USER });
    await act(async () => {
      releaseUpcoming({ tournaments: [live], features: FEATURES });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.fetchMy).toHaveBeenCalled();
    expect(hook.result.current.myTournaments.map((t) => t.myRegistration.status)).toEqual(['registered']);
  });
});

