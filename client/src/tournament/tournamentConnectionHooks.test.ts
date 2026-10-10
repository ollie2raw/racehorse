/**
 * Phase 3E connection fixes found by the real-app journeys:
 *  - "Join Semifinal" from the post-match screen leaves the finished room
 *    first, then joins once out of it (never on its own, never twice);
 *  - a player with a live tournament stake keeps a socket on non-game
 *    screens (reconnecting when a route hand-off dropped it), so match_ready
 *    and cancellations reach the app-wide banner.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { NEXT_ROUND_JOIN_SETTLE_MS, useNextRoundJoin } from './useNextRoundJoin';
import { hasLiveTournamentStake, TOURNAMENT_RECONNECT_DELAY_MS, useTournamentLiveConnection } from './useTournamentLiveConnection';
import type { AppMode } from '../types';
import type { MyTournament } from './types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('join the next round from the post-match screen', () => {
  function setup(initial: { appMode: AppMode; joinedRoom: string | null; currentMatchId: string | null }) {
    const leaveFinishedMatch = vi.fn();
    const attach = vi.fn();
    const hook = renderHook((p: typeof initial) => useNextRoundJoin({ ...p, leaveFinishedMatch, attach }), { initialProps: initial });
    return { hook, leaveFinishedMatch, attach };
  }

  it('still in the finished match: leave it, then join once out of the room', () => {
    const { hook, leaveFinishedMatch, attach } = setup({ appMode: 'multiplayer', joinedRoom: 'R1', currentMatchId: 'qf' });
    act(() => hook.result.current('sf'));
    expect(leaveFinishedMatch).toHaveBeenCalledTimes(1);
    expect(attach).not.toHaveBeenCalled();
    hook.rerender({ appMode: 'tournament', joinedRoom: null, currentMatchId: null });
    act(() => { vi.advanceTimersByTime(NEXT_ROUND_JOIN_SETTLE_MS); });
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith('sf');
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it('not in a room (result screen, bracket): join directly', () => {
    const { hook, leaveFinishedMatch, attach } = setup({ appMode: 'tournament', joinedRoom: null, currentMatchId: null });
    act(() => hook.result.current('sf'));
    expect(leaveFinishedMatch).not.toHaveBeenCalled();
    expect(attach).toHaveBeenCalledWith('sf');
  });

  it('going somewhere else instead cancels it — nothing joins later on its own', () => {
    const { hook, attach } = setup({ appMode: 'multiplayer', joinedRoom: 'R1', currentMatchId: 'qf' });
    act(() => hook.result.current('sf'));
    hook.rerender({ appMode: 'home', joinedRoom: null, currentMatchId: null });
    hook.rerender({ appMode: 'tournament', joinedRoom: null, currentMatchId: null });
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(attach).not.toHaveBeenCalled();
  });
});

describe('a live tournament stake keeps a socket', () => {
  const t = (status: MyTournament['status'], reg: MyTournament['myRegistration']['status']): MyTournament => ({
    id: 'x', kind: 'live', status, scheduled_start: '', registration_open_at: '', registration_close_at: '', format: '', win_target: 30, max_players: 8,
    winner_id: null, created_at: '', myRegistration: { status: reg, placement: null, placementLabel: null, seed: null }, myLastMatch: null,
  });

  it('what counts as a stake', () => {
    expect(hasLiveTournamentStake([t('registration_open', 'registered')], null)).toBe(true);
    expect(hasLiveTournamentStake([t('in_progress', 'active')], null)).toBe(true);
    expect(hasLiveTournamentStake([t('completed', 'eliminated'), t('cancelled', 'registered')], null)).toBe(false);
    expect(hasLiveTournamentStake([], null)).toBe(false);
  });

  function setup(props: { appMode: AppMode; connected: boolean; stake: boolean; signedIn?: boolean }) {
    const connectRef = { current: vi.fn() };
    const socket = { connected: props.connected } as unknown as Socket;
    renderHook(() => useTournamentLiveConnection({
      enabled: true,
      signedIn: props.signedIn ?? true,
      myTournaments: props.stake ? [t('in_progress', 'active')] : [],
      activeAssignedMatch: null,
      appMode: props.appMode,
      socket,
      // App state can still say "connected" after a hand-off dropped the socket.
      isConnected: true,
      connectRef,
    }));
    act(() => { vi.advanceTimersByTime(TOURNAMENT_RECONNECT_DELAY_MS); });
    return connectRef.current;
  }

  it('reconnects a dropped socket on Home (even when app state still says connected)', () => {
    expect(setup({ appMode: 'home', connected: false, stake: true })).toHaveBeenCalledTimes(1);
  });
  it('leaves a live socket, no stake, signed-out players and socket-owning screens alone', () => {
    expect(setup({ appMode: 'home', connected: true, stake: true })).not.toHaveBeenCalled();
    expect(setup({ appMode: 'home', connected: false, stake: false })).not.toHaveBeenCalled();
    expect(setup({ appMode: 'home', connected: false, stake: true, signedIn: false })).not.toHaveBeenCalled();
    expect(setup({ appMode: 'bot', connected: false, stake: true })).not.toHaveBeenCalled();
    expect(setup({ appMode: 'multiplayer', connected: false, stake: true })).not.toHaveBeenCalled();
  });
});
