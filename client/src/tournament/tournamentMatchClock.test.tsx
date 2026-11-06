/**
 * The tournament turn clock in the match HUD (Phase 3D): the server's
 * deadline counted down on the shared server clock (never the device clock),
 * the player's own missed-turn warnings from the server's counts, "Resolving
 * turn…" at zero with no local action, next-hand timing, and clearing on
 * game over / null / room change. Fake monotonic time: no real waits.
 */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TournamentMatchHud from './TournamentMatchHud';
import { tournamentPlayerDisplay } from './displayNames';
import { observeTournamentRequest, resetTournamentClockForTests } from './tournamentClock';
import {
  clearTournamentClock,
  deriveTournamentClockView,
  missedTurnWarning,
  recordTournamentClock,
  recordTournamentClockFromStateUpdate,
  resetTournamentMatchClockForTests,
  TOURNAMENT_CLOCK_STALE_GRACE_MS,
  TOURNAMENT_VIEW_DESYNC_GRACE_MS,
  tournamentClockLabel,
  useTournamentClockRecovery,
  useTournamentMatchClock,
  useTournamentViewDesyncRecovery,
  type TournamentClockState,
} from './tournamentMatchClock';

const { dispatchSocketEvent } = vi.hoisted(() => ({ dispatchSocketEvent: vi.fn() }));
vi.mock('../multiplayer/socketEventBus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../multiplayer/socketEventBus')>()),
  dispatchSocketEvent,
}));

const SERVER = Date.parse('2026-10-31T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
let mono = 0;

/** Advance fake timers and the monotonic source together. */
function advance(ms: number) {
  act(() => {
    mono += ms;
    vi.advanceTimersByTime(ms);
  });
}

const turn = (seatId: string, inMs: number, missedTurns = 0, maxMissedTurns = 3): TournamentClockState => ({
  kind: 'turn', seatId, deadlineAt: iso(SERVER + inMs), missedTurns, maxMissedTurns,
});
const nextHand = (inMs: number): TournamentClockState => ({ kind: 'next_hand', seatId: null, waitingSeatIds: ['me'], deadlineAt: iso(SERVER + inMs) });

beforeEach(() => {
  vi.useFakeTimers();
  mono = 10_000;
  resetTournamentClockForTests(() => mono);
  // The server clock: at mono 10_000 the server reads SERVER.
  observeTournamentRequest(10_000, 10_000, iso(SERVER));
  resetTournamentMatchClockForTests();
});
afterEach(() => {
  cleanup();
  resetTournamentMatchClockForTests();
  resetTournamentClockForTests();
  vi.useRealTimers();
});

function hud(over: Partial<Parameters<typeof TournamentMatchHud>[0]> = {}) {
  return render(
    <TournamentMatchHud
      round={2}
      roomCode="ROOM-A"
      you="me"
      isHandActive
      isMyTurn
      gameOver={false}
      opponent={tournamentPlayerDisplay('rival-id', { username: 'Rival' })}
      {...over}
    />,
  );
}
const turnText = () => document.querySelector('.tmh-turn__text')?.textContent ?? null;
const warningText = () => document.querySelector('.tmh-warning')?.textContent ?? null;

describe('turn countdown', () => {
  it('your turn counts down to the server deadline', () => {
    recordTournamentClock('ROOM-A', turn('me', 32_000));
    hud();
    expect(turnText()).toBe('Your turn · 32s');
    advance(2_000);
    expect(turnText()).toBe('Your turn · 30s');
  });

  it("a human opponent's timed turn", () => {
    recordTournamentClock('ROOM-A', turn('rival', 20_000));
    hud({ isMyTurn: false });
    expect(turnText()).toBe("Opponent's turn · 20s");
  });

  it('Fritz is never on a deadline (the server does not time Fritz): Fritz is thinking', () => {
    recordTournamentClock('ROOM-A', null);
    hud({ isMyTurn: false, opponent: tournamentPlayerDisplay('bot:fritz:t:3', { round: 2 }) });
    expect(turnText()).toBe('Elite Fritz is thinking');
    expect(document.querySelector('.tmh-clock-bar')).toBeNull();
  });

  it('a new authoritative deadline replaces the old one', () => {
    recordTournamentClock('ROOM-A', turn('me', 10_000));
    hud();
    expect(turnText()).toBe('Your turn · 10s');
    act(() => recordTournamentClock('ROOM-A', turn('me', 45_000)));
    expect(turnText()).toBe('Your turn · 45s');
  });

  it('reconnect uses the deadline the server returns now (not a fresh 45s)', () => {
    // Attach ack after reconnecting mid-turn: 12s left on the server.
    recordTournamentClock('ROOM-A', turn('me', 12_000), iso(SERVER));
    hud();
    expect(turnText()).toBe('Your turn · 12s');
  });

  it('a device clock jump does not change the countdown', () => {
    recordTournamentClock('ROOM-A', turn('me', 30_000));
    hud();
    act(() => { vi.setSystemTime(Date.now() + 6 * 3_600_000); });
    advance(1_000);
    expect(turnText()).toBe('Your turn · 29s');
  });

  it('counts down on the shared server clock (its offset, not the device time)', () => {
    // Device time is hours off; only the server-clock sample matters.
    vi.setSystemTime(SERVER - 9 * 3_600_000);
    recordTournamentClock('ROOM-A', turn('me', 40_000));
    hud();
    expect(turnText()).toBe('Your turn · 40s');
  });
});

describe('missed turns (from the server counts)', () => {
  it('none, one, and the last one before a forfeit', () => {
    recordTournamentClock('ROOM-A', turn('me', 30_000, 0));
    const { unmount } = hud();
    expect(warningText()).toBeNull();
    unmount();
    recordTournamentClock('ROOM-A', turn('me', 31_000, 1));
    const second = hud();
    expect(warningText()).toBe('1 missed turn');
    expect(document.querySelector('.tmh-warning--severe')).toBeNull();
    second.unmount();
    recordTournamentClock('ROOM-A', turn('me', 32_000, 2));
    hud();
    expect(warningText()).toContain('2 missed turns · one more will forfeit the match');
    expect(document.querySelector('.tmh-warning--severe')).not.toBeNull();
  });

  it('follows the server limit (not a hard-coded 3)', () => {
    const view = (missed: number, max: number) =>
      missedTurnWarning(deriveTournamentClockView({ snapshot: { roomCode: 'R', clock: turn('me', 5_000, missed, max), firstSeenServerMs: SERVER }, you: 'me', nowServerMs: SERVER, gameOver: false }));
    expect(view(2, 5)).toEqual({ text: '2 missed turns', severe: false });
    expect(view(4, 5)).toEqual({ text: '4 missed turns · one more will forfeit the match', severe: true });
    expect(view(1, 2)?.severe).toBe(true);
  });

  it("the opponent's misses are not shown as the player's warning", () => {
    recordTournamentClock('ROOM-A', turn('rival', 30_000, 2));
    hud({ isMyTurn: false });
    expect(warningText()).toBeNull();
  });
});

describe('expiry', () => {
  it('at zero shows "Resolving turn…" and does nothing locally; a stale clock asks for state once', () => {
    const requestState = vi.fn();
    recordTournamentClock('ROOM-A', turn('me', 3_000, 1));
    hud();
    renderHook(() => useTournamentClockRecovery({ roomCode: 'ROOM-A', active: true, requestState }));
    advance(3_000);
    expect(turnText()).toBe('Resolving turn…');
    expect(requestState).not.toHaveBeenCalled();
    advance(TOURNAMENT_CLOCK_STALE_GRACE_MS);
    expect(requestState).toHaveBeenCalledTimes(1);
    expect(requestState).toHaveBeenCalledWith('tournament_clock_stale');
    advance(60_000);
    expect(requestState).toHaveBeenCalledTimes(1);
  });

  it('the server update in time replaces "Resolving turn…" and no state request is made', () => {
    const requestState = vi.fn();
    recordTournamentClock('ROOM-A', turn('me', 1_000));
    hud();
    renderHook(() => useTournamentClockRecovery({ roomCode: 'ROOM-A', active: true, requestState }));
    advance(1_500);
    expect(turnText()).toBe('Resolving turn…');
    act(() => recordTournamentClock('ROOM-A', turn('rival', 45_000)));
    expect(turnText()).toBe("Opponent's turn · 44s");
    advance(TOURNAMENT_CLOCK_STALE_GRACE_MS);
    expect(requestState).not.toHaveBeenCalled();
  });
});

describe('next hand', () => {
  it('"Next hand in 18s", no turn wording and no missed-turn warning', () => {
    recordTournamentClock('ROOM-A', nextHand(18_000));
    hud({ isHandActive: false });
    expect(turnText()).toBe('Next hand in 18s');
    expect(warningText()).toBeNull();
    expect(screen.queryByText(/your turn/i)).toBeNull();
    expect(tournamentClockLabel(deriveTournamentClockView({ snapshot: { roomCode: 'R', clock: nextHand(0), firstSeenServerMs: SERVER }, you: 'me', nowServerMs: SERVER + 1, gameOver: false })))
      .toBe('Starting next hand…');
  });
});

describe('clearing', () => {
  it('a null clock clears the countdown', () => {
    recordTournamentClock('ROOM-A', turn('me', 30_000));
    hud();
    expect(turnText()).toBe('Your turn · 30s');
    act(() => recordTournamentClock('ROOM-A', null));
    expect(turnText()).toBe('Your move');
  });

  it('game over hides the countdown', () => {
    recordTournamentClock('ROOM-A', turn('me', 30_000));
    hud({ gameOver: true, isHandActive: false });
    expect(turnText()).toBeNull();
  });

  it('room A → room B: A\'s clock is never shown in B, and leaving A forgets it', () => {
    recordTournamentClock('ROOM-A', turn('me', 30_000));
    const { rerender } = hud();
    rerender(
      <TournamentMatchHud round={3} roomCode="ROOM-B" you="me" isHandActive isMyTurn gameOver={false} opponent={null} />,
    );
    expect(turnText()).toBe('Your move');
    const recovery = renderHook(({ room }) => useTournamentClockRecovery({ roomCode: room, active: true, requestState: vi.fn() }), { initialProps: { room: 'ROOM-A' } });
    recovery.rerender({ room: 'ROOM-B' });
    const { result } = renderHook(() => useTournamentMatchClock('ROOM-A'));
    expect(result.current).toBeNull();
  });

  it('leaving the room clears its clock; another room\'s clear leaves it alone', () => {
    recordTournamentClock('ROOM-A', turn('me', 30_000));
    clearTournamentClock('ROOM-Z');
    const { result } = renderHook(() => useTournamentMatchClock('room-a'));
    expect(result.current?.clock?.kind).toBe('turn');
    act(() => clearTournamentClock('ROOM-A'));
    expect(result.current).toBeNull();
  });
});

describe('normal rooms', () => {
  it('a state update without tournamentClock records nothing', () => {
    expect(recordTournamentClockFromStateUpdate('ROOM-N', { serverNow: iso(SERVER) } as never)).toBe(false);
    const { result } = renderHook(() => useTournamentMatchClock('ROOM-N'));
    expect(result.current).toBeNull();
  });

  it('a tournament state update records its clock (null too)', () => {
    expect(recordTournamentClockFromStateUpdate('ROOM-T', { tournamentClock: turn('me', 9_000), serverNow: iso(SERVER) })).toBe(true);
    const { result } = renderHook(() => useTournamentMatchClock('ROOM-T'));
    expect(result.current?.clock?.kind).toBe('turn');
  });

  it('malformed clocks are ignored (treated as no clock)', () => {
    recordTournamentClock('ROOM-A', { kind: 'turn', seatId: 'me', deadlineAt: 'soon' });
    const { result } = renderHook(() => useTournamentMatchClock('ROOM-A'));
    expect(result.current?.clock).toBeNull();
  });
});

describe('a clock that says it is the player\'s turn while the match view does not', () => {
  // Owner report (2026-11-02): the header read "YOUR TURN · 38S" while every hand tile was dimmed (the view believed it was not the player's turn).
  // The clock and the match state are two separate client stores; if the state ever lags, nothing recovered it until the deadline passed.
  const desync = (over: Partial<Parameters<typeof useTournamentViewDesyncRecovery>[0]> = {}) => ({
    roomCode: 'ROOM-A',
    active: true,
    viewIsMyTurn: false,
    you: 'me',
    requestState: vi.fn(),
    ...over,
  });

  it('asks for the room state once, after a short grace, when the clock names the player and the view does not', () => {
    recordTournamentClock('ROOM-A', turn('me', 40_000));
    const params = desync();
    renderHook(() => useTournamentViewDesyncRecovery(params));

    advance(TOURNAMENT_VIEW_DESYNC_GRACE_MS - 100);
    expect(params.requestState).not.toHaveBeenCalled();
    advance(200);
    expect(params.requestState).toHaveBeenCalledTimes(1);
    expect(params.requestState).toHaveBeenCalledWith('tournament_clock_view_desync');

    advance(10_000);
    expect(params.requestState).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the view agrees (the usual case), including a brief gap that closes inside the grace', () => {
    recordTournamentClock('ROOM-A', turn('me', 40_000));
    const requestState = vi.fn();
    const { rerender } = renderHook((p) => useTournamentViewDesyncRecovery(p), { initialProps: desync({ requestState }) });
    advance(500); // the state is still catching up
    rerender(desync({ requestState, viewIsMyTurn: true }));
    advance(5_000);

    expect(requestState).not.toHaveBeenCalled();
  });

  it('does nothing while it is the opponent\'s turn, Fritz\'s turn (no clock), a next hand, or the clock is resolving', () => {
    const cases: Array<[string, () => void]> = [
      ['the opponent\'s turn', () => recordTournamentClock('ROOM-A', turn('rival', 40_000))],
      ['no clock (Fritz\'s turn)', () => recordTournamentClock('ROOM-A', null)],
      ['a next hand', () => recordTournamentClock('ROOM-A', nextHand(20_000))],
    ];
    for (const [, setClock] of cases) {
      resetTournamentMatchClockForTests();
      setClock();
      const params = desync();
      const view = renderHook(() => useTournamentViewDesyncRecovery(params));
      advance(5_000);
      expect(params.requestState).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('asks again for a later deadline (a new turn), not again for the same one', () => {
    recordTournamentClock('ROOM-A', turn('me', 40_000));
    const params = desync();
    renderHook(() => useTournamentViewDesyncRecovery(params));
    advance(TOURNAMENT_VIEW_DESYNC_GRACE_MS + 100);
    expect(params.requestState).toHaveBeenCalledTimes(1);

    act(() => recordTournamentClock('ROOM-A', turn('me', 85_000)));
    advance(TOURNAMENT_VIEW_DESYNC_GRACE_MS + 100);
    expect(params.requestState).toHaveBeenCalledTimes(2);
  });

  it('the HUD asks the room for its state through the shared recovery path when the hand is still dimmed', () => {
    dispatchSocketEvent.mockClear();
    recordTournamentClock('ROOM-A', turn('me', 40_000));
    hud({ isMyTurn: false });

    advance(TOURNAMENT_VIEW_DESYNC_GRACE_MS + 100);

    expect(dispatchSocketEvent).toHaveBeenCalledTimes(1);
    expect(dispatchSocketEvent).toHaveBeenCalledWith({ type: 'RESYNC_NEEDED', payload: { roomCode: 'ROOM-A' } });
  });

  it('the HUD stays quiet when the hand agrees with the clock', () => {
    dispatchSocketEvent.mockClear();
    recordTournamentClock('ROOM-A', turn('me', 40_000));
    hud({ isMyTurn: true });

    advance(10_000);

    expect(dispatchSocketEvent).not.toHaveBeenCalled();
  });

  it('is off when the match is not active', () => {
    recordTournamentClock('ROOM-A', turn('me', 40_000));
    const params = desync({ active: false });
    renderHook(() => useTournamentViewDesyncRecovery(params));
    advance(5_000);
    expect(params.requestState).not.toHaveBeenCalled();
  });
});

describe('screen reader announcements', () => {
  it('announce changes and one 10-second threshold, never each tick', () => {
    recordTournamentClock('ROOM-A', turn('me', 15_000));
    hud();
    const sr = () => document.querySelector('.tmh-sr')?.textContent;
    expect(sr()).toBe('Your turn');
    advance(2_000);
    expect(sr()).toBe('Your turn');
    advance(4_000);
    expect(sr()).toBe('Your turn, 10 seconds left');
    advance(3_000);
    expect(sr()).toBe('Your turn, 10 seconds left');
    expect(sr()).not.toMatch(/\b[0-9]s\b|· \d+s/);
  });
});

