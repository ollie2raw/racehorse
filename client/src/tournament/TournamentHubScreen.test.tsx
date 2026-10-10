/**
 * The Phase 3C Tournament Hub, rendered: feature gating, the Fritz Cup and
 * Live Event cards, registration without leaving the hub, structured error
 * copy, Join only on a tap, cancellation, local time, loading / partial
 * failure / empty states, and deduplicated boundary refreshes.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

vi.mock('../components', () => ({ GlobalNav: () => null }));

import TournamentHubScreen, { BOUNDARY_REFRESH_BACKOFF_MS } from './TournamentHubScreen';
import { TournamentApiError } from './tournamentApi';
import { resetTournamentClockForTests } from './tournamentClock';
import type { MyTournament, ScheduledTournament } from './types';

const NOW = Date.parse('2026-10-30T16:00:00.000Z'); // 09:00 PDT, 12:00 EDT
const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();
const USER = { userId: '11111111-1111-4111-8111-111111111111', username: 'p1' };
const IDLE = { phase: 'idle' as const, tournamentId: null, startedAtMono: 0, error: null };

function event(id: string, status: ScheduledTournament['status'], startIn: number, over: Partial<ScheduledTournament> = {}): ScheduledTournament {
  return {
    id, kind: 'live', status, scheduled_start: at(startIn), registration_open_at: at(startIn - 12 * HOUR),
    registration_close_at: at(startIn - 2 * 60_000), format: '7-tile', win_target: 30, max_players: 8,
    winner_id: null, created_at: at(-HOUR), registered_count: 3, ...over,
  };
}
function mine(t: ScheduledTournament, status: MyTournament['myRegistration']['status']): MyTournament {
  return { ...t, myRegistration: { status, placement: null, placementLabel: null, seed: null }, myLastMatch: null };
}
// 17:00 PT today (8 h away), open for registration.
const LIVE = event('live-1', 'registration_open', 8 * HOUR);

type Props = ComponentProps<typeof TournamentHubScreen>;
function renderHub(over: Partial<Props> = {}) {
  const props: Props = {
    identity: USER,
    features: { tournaments: true, fritzCup: true },
    upcoming: [LIVE],
    myTournaments: [],
    activeAssignedMatch: null,
    cancelledTournamentIds: new Set(),
    fritzLaunch: IDLE,
    upcomingError: null,
    myError: null,
    isLoading: false,
    hasLoaded: true,
    timeZone: 'America/New_York',
    onBackHome: vi.fn(),
    onPlayFritzCup: vi.fn(),
    onJoinMatch: vi.fn(),
    onViewBracket: vi.fn(),
    onViewResult: vi.fn(),
    onRegister: vi.fn(async () => ({ alreadyRegistered: false })),
    onWithdraw: vi.fn(async () => undefined),
    onRetry: vi.fn(),
    onBoundary: vi.fn(),
    ...over,
  };
  const view = render(<TournamentHubScreen {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<Props>) => view.rerender(<TournamentHubScreen {...props} {...next} />) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetTournamentClockForTests(() => performance.now());
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Tournament Hub: features', () => {
  it('Fritz Cup off: no Fritz Cup card at all (no disabled button, no "coming soon")', () => {
    renderHub({ features: { tournaments: true, fritzCup: false } });
    expect(screen.queryByText('Fritz Cup')).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy();
  });

  it('Fritz Cup on: the primary card with its copy', () => {
    renderHub();
    expect(screen.getByRole('heading', { name: 'Fritz Cup' })).toBeTruthy();
    expect(screen.getByText('Play now · 3 rounds vs Fritz')).toBeTruthy();
    expect(screen.getByText('Beat Fritz, Elite Fritz, and Master Fritz to win the Cup.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play Fritz Cup' })).toBeTruthy();
  });

  it('tournaments off: the unavailable state and nothing else', () => {
    renderHub({ features: { tournaments: false, fritzCup: false } });
    expect(screen.getByText('Tournaments are unavailable right now')).toBeTruthy();
    expect(screen.queryByText('Live Event')).toBeNull();
    expect(screen.queryByRole('button', { name: /Register|Play Fritz Cup/ })).toBeNull();
  });

  it('signed out: sign-in CTAs', () => {
    const onOpenAuth = vi.fn();
    renderHub({ identity: null, onOpenAuth });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to play' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to register' }));
    expect(onOpenAuth).toHaveBeenCalledTimes(2);
  });
});

describe('Tournament Hub: Fritz Cup', () => {
  it('Play → onPlayFritzCup; starting / building / slow states', () => {
    const { props, rerenderWith } = renderHub();
    fireEvent.click(screen.getByRole('button', { name: 'Play Fritz Cup' }));
    expect(props.onPlayFritzCup).toHaveBeenCalledTimes(1);
    rerenderWith({ fritzLaunch: { ...IDLE, phase: 'creating' } });
    const starting = screen.getByRole('button', { name: 'Starting Fritz Cup…' }) as HTMLButtonElement;
    expect(starting.disabled).toBe(true);
    rerenderWith({ fritzLaunch: { ...IDLE, phase: 'building', tournamentId: 'cup' } });
    expect(screen.getByText(/Building your bracket/)).toBeTruthy();
    rerenderWith({ fritzLaunch: { ...IDLE, phase: 'slow', tournamentId: 'cup' } });
    expect(screen.getByText('Taking longer than usual.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View bracket' }));
    expect(props.onViewBracket).toHaveBeenCalledWith('cup');
  });

  it('errors show their copy, never codes', () => {
    renderHub({ fritzLaunch: { ...IDLE, phase: 'failed', error: new TournamentApiError({ code: 'fritz_cup_cooldown', retryAfterMs: 30_000, reason: 'cooldown' }) } });
    expect(screen.getByRole('alert').textContent).toBe('You just started a Cup. Try again in 30s.');
    expect(screen.queryByText(/fritz_cup_cooldown/)).toBeNull();
  });

  it('an active cup: Join Match (a tap) / Resume Fritz Cup; never a second Play', () => {
    const cup = mine({ ...event('cup', 'in_progress', -60_000), kind: 'fritz_cup' }, 'active');
    const ready = { matchId: 'm-cup', tournamentId: 'cup', round: 2 as const, matchNumber: 1, roomCode: 'T', opponentId: null, opponentUsername: 'Elite Fritz', matchStatus: 'ready' as const, readyDeadlineAt: null };
    const { props, rerenderWith } = renderHub({ myTournaments: [cup], activeAssignedMatch: ready });
    expect(screen.queryByRole('button', { name: 'Play Fritz Cup' })).toBeNull();
    expect(screen.getByText('Your Semifinal vs Fritz is ready')).toBeTruthy();
    expect(props.onJoinMatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Join Match' }));
    expect(props.onJoinMatch).toHaveBeenCalledWith('m-cup');
    rerenderWith({ activeAssignedMatch: { ...ready, matchStatus: 'in_progress' } });
    expect(screen.getByRole('button', { name: 'Resume Fritz Cup' })).toBeTruthy();
  });
});

describe('Tournament Hub: Live Events', () => {
  it('shows the local time (New York: 8:00 PM), the count and Fritz fill, the countdown; no PT label', () => {
    const { container } = renderHub();
    expect(screen.getByText('Today · 8:00 PM')).toBeTruthy();
    expect(screen.getByText('3 registered · Fritz fills open seats')).toBeTruthy();
    expect(screen.getByText('Starts in 8h 00m')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bPT\b|\bET\b|Pacific|30 minutes/);
  });

  it('California sees the same event at 5:00 PM', () => {
    renderHub({ timeZone: 'America/Los_Angeles' });
    expect(screen.getByText('Today · 5:00 PM')).toBeTruthy();
  });

  it('before registration opens: no Register, no "Be the first to register"', () => {
    renderHub({ upcoming: [event('e', 'upcoming', 14 * HOUR)] });
    expect(screen.getByText('Registration opens in 2h 00m')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Register' })).toBeNull();
    expect(screen.queryByText(/Be the first/)).toBeNull();
  });

  it('Register stays on the hub: pending "Registering…", no navigation', async () => {
    let resolve!: () => void;
    const onRegister = vi.fn(() => new Promise<unknown>((r) => { resolve = () => r({ alreadyRegistered: false }); }));
    const { props } = renderHub({ onRegister });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    const pending = screen.getByRole('button', { name: 'Registering…' }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    expect(onRegister).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
    expect(props.onViewBracket).not.toHaveBeenCalled();
  });

  it('registered: a visible text status and Withdraw while allowed', () => {
    renderHub({ myTournaments: [mine(LIVE, 'registered')] });
    expect(screen.getByText('Registered')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });

  it('refusals are shown on the card in plain words', async () => {
    const onRegister = vi.fn(async () => { throw new TournamentApiError({ code: 'overlapping_tournament', conflict: { tournamentId: 'cup', kind: 'fritz_cup', scheduledStart: at(0) } }); });
    renderHub({ onRegister });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Register' })); });
    expect(screen.getByRole('alert').textContent).toBe('You have a Fritz Cup in progress. Finish it first.');

    const onWithdraw = vi.fn(async () => { throw new TournamentApiError({ code: 'withdraw_closed' }); });
    renderHub({ myTournaments: [mine(LIVE, 'registered')], onWithdraw, features: { tournaments: true, fritzCup: false } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Withdraw' })); });
    expect(screen.getAllByRole('alert').at(-1)!.textContent).toBe("Registration has closed, so you can't withdraw now.");
  });

  it('full shows "Full" (text), no Register', () => {
    renderHub({ upcoming: [event('e', 'registration_open', 5 * HOUR, { registered_count: 8 })] });
    expect(screen.getByText('Full')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Register' })).toBeNull();
  });

  it('a ready Live match: Join Match only on a tap', () => {
    const started = event('s', 'in_progress', -60_000);
    const match = { matchId: 'm-s', tournamentId: 's', round: 1 as const, matchNumber: 2, roomCode: 'T', opponentId: 'u2', opponentUsername: 'u2', matchStatus: 'ready' as const, readyDeadlineAt: null };
    const { props } = renderHub({ upcoming: [], myTournaments: [mine(started, 'active')], activeAssignedMatch: match });
    expect(screen.getByText('Your Quarterfinal is ready')).toBeTruthy();
    expect(props.onJoinMatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Join Match' }));
    expect(props.onJoinMatch).toHaveBeenCalledWith('m-s');
  });

  it('cancelled: says so, with no countdown', () => {
    renderHub({ upcoming: [], myTournaments: [mine({ ...LIVE, status: 'cancelled' }, 'registered')] });
    expect(screen.getByText('This event was cancelled')).toBeTruthy();
    expect(screen.queryByText(/Starts in/)).toBeNull();
  });

  it('at most one more Live Event, shown compact', () => {
    renderHub({ upcoming: [LIVE, event('b', 'registration_open', 11 * HOUR), event('c', 'upcoming', 32 * HOUR)] });
    expect(screen.getAllByRole('article', { name: /^Live Event/ })).toHaveLength(2);
  });
});

describe('Tournament Hub: loading, failures, empty', () => {
  it('loading: placeholders (no blank screen)', () => {
    const { container } = renderHub({ isLoading: true, hasLoaded: false });
    expect(screen.getByText('Loading tournaments…')).toBeTruthy();
    expect(container.querySelectorAll('.th-event--skeleton')).toHaveLength(2);
  });

  it('/upcoming failed but /my answered: the player\'s own event stays usable', () => {
    renderHub({ upcoming: [], upcomingError: 'network', myTournaments: [mine(LIVE, 'registered')] });
    expect(screen.getByText('Registered')).toBeTruthy();
    expect(screen.queryByText("Couldn't load Live Events")).toBeNull();
  });

  it('/upcoming failed with nothing else: a retry', () => {
    const { props } = renderHub({ upcoming: [], upcomingError: 'network' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('/my failed: public events shown, personal state flagged with a retry', () => {
    renderHub({ myError: 'internal' });
    expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy();
    expect(screen.getByText(/Your entries couldn.t be loaded/)).toBeTruthy();
  });

  it('no Live Event: Fritz Cup stays primary; without Fritz, an empty state with retry', () => {
    renderHub({ upcoming: [] });
    expect(screen.getByText('No Live Event is scheduled right now.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play Fritz Cup' })).toBeTruthy();
    renderHub({ upcoming: [], features: { tournaments: true, fritzCup: false } });
    expect(screen.getByText('No tournaments right now')).toBeTruthy();
  });
});

describe('Tournament Hub: countdown boundaries', () => {
  it('registration opening (the server must act): one refresh at zero, then backed-off retries while still not open', async () => {
    const opening = event('e', 'upcoming', 12 * HOUR + 3_000); // opens in 3 s
    const { props } = renderHub({ upcoming: [opening], features: { tournaments: true, fritzCup: false } });
    expect(screen.getByText('Registration opens in 3s')).toBeTruthy();
    expect(props.onBoundary).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });
    expect(props.onBoundary).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Registration opens shortly')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(BOUNDARY_REFRESH_BACKOFF_MS[1] + 100); });
    expect(props.onBoundary).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(props.onBoundary).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/-\d/)).toBeNull();
  });

  it('registration closing (not entered): the card turns to "Registration closed" with the start countdown, never negative', async () => {
    const closing = event('e', 'registration_open', 2 * 60_000 + 3_000);
    renderHub({ upcoming: [closing], features: { tournaments: true, fritzCup: false } });
    expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });
    expect(screen.queryByRole('button', { name: 'Register' })).toBeNull();
    expect(screen.getByText(/Registration closed · Starts in (2m 00s|1m 5\ds)/)).toBeTruthy();
  });

  it('the start (registered): refreshes once at zero, never shows a negative countdown', async () => {
    const soon = event('e', 'registration_open', 4_000);
    const { props } = renderHub({ upcoming: [soon], myTournaments: [mine(soon, 'registered')], features: { tournaments: true, fritzCup: false } });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_500); });
    expect(props.onBoundary).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Starts in 0s')).toBeTruthy();
  });

  it('Phase 3E: History is a compact action for signed-in players only', () => {
    const onOpenHistory = vi.fn();
    const { unmount } = renderHub({ onOpenHistory });
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(onOpenHistory).toHaveBeenCalled();
    unmount();
    renderHub({ onOpenHistory, identity: null });
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull();
  });
});
