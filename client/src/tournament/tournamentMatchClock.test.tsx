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
  tournamentClockLabel,
  useTournamentClockRecovery,
  useTournamentMatchClock,
  type TournamentClockState,
} from './tournamentMatchClock';

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
