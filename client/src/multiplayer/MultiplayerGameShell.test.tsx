// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { MultiplayerGameShell } from './MultiplayerGameShell';
import { getGameSnapshot, resetGameSnapshot } from './multiplayerGameSnapshot';
import type { MultiplayerGameShellProps } from './multiplayerGameShellTypes';
import type { RoomAckResponse } from './roomTransport';
import type { GameState } from '../types';

const YOU = 'p1';
const OPP = 'p2';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    config: { scoringMultiple: 5, winningScore: 100 },
    playerIds: [YOU, OPP],
    players: {
      [YOU]: { id: YOU, hand: [], score: 0 },
      [OPP]: { id: OPP, hand: [], score: 0 },
    },
    board: {
      mainLine: [],
      leftEnd: 3,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 1,
    ...overrides,
  };
}

function makeDefaultProps(overrides: Partial<MultiplayerGameShellProps> = {}): MultiplayerGameShellProps {
  const mockSocket = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    onAny: vi.fn(),
    offAny: vi.fn(),
    emit: vi.fn(),
  } as any;

  const sessionRef = { current: { context: { roomCode: 'ROOM123' } } as any };
  const dispatchSession = vi.fn();

  return {
    socket: mockSocket,
    joinedRoom: 'ROOM123',
    you: YOU,
    players: [
      { id: YOU, username: 'You', userId: '1' },
      { id: OPP, username: 'Opponent', userId: '2' },
    ],
    isConnected: true,
    showToast: vi.fn(),
    connectionRecovery: {
      roomRecoveryState: 'idle',
      isRecoveringConnection: false,
      roomRecoveryMessage: '',
      setRoomRecoveryState: vi.fn(),
      setRoomRecoveryMessage: vi.fn(),
    },
    setError: vi.fn(),
    setPlayers: vi.fn(),
    setFriendInvite: vi.fn(),
    isMuted: false,
    isMutedRef: { current: false },
    trayCenterRef: { current: null },
    authUser: { id: '1' },
    authProfile: { username: 'You' },
    refreshAuthProfile: vi.fn().mockResolvedValue(undefined),
    authProfileRef: { current: null },
    supabaseEnabled: false,
    tournamentMatch: null,
    tournamentOpponentLabel: null,
    rejoinInFlightRef: { current: false },
    sessionRuntime: {
      sessionRef,
      dispatchSession,
    } as any,
    schedulePlayerReadyRef: { current: vi.fn() },
    trySchedulePlayerReadyRef: { current: vi.fn() },
    maxSequenceRef: { current: 0 },
    roomPlayersRef: { current: [] },
    resyncInFlightRef: { current: false },
    resyncBufferedUpdateRef: { current: null },
    resyncFlushRef: { current: null },
    fetchGameState: vi.fn(),
    applyRoomEventMeta: vi.fn(),
    shellDelegatesRef: { current: null },
    sharedGameplayRefs: {
      stateRef: { current: null },
      draggingStateRef: { current: false },
      handRevealShownRef: { current: null },
      handRevealTimerRef: { current: null },
      rematchAwaitingStateRef: { current: false },
    },
    setAbandonedMatchNotice: vi.fn(),
    ...overrides,
  };
}

describe('MultiplayerGameShell integration tests', () => {
  it('applies the buffered join response on mount to transition out of "Starting match..." immediately', () => {
    resetGameSnapshot();

    const joinedRoomResponseRef = {
      current: {
        ok: true,
        roomCode: 'ROOM123',
        you: YOU,
        players: [{ id: YOU }, { id: OPP }],
        state: makeState({ sequence: 5 }),
      } as RoomAckResponse,
    };

    const shellDelegatesRef = createRef<any>();

    const props = makeDefaultProps({
      joinedRoomResponseRef,
      shellDelegatesRef,
    });

    render(<MultiplayerGameShell {...props} />);

    // Assert that the state was applied and published to the snapshot
    const snapshot = getGameSnapshot();
    expect(snapshot.hasState).toBe(true);
    expect(snapshot.routeProps.state).not.toBeNull();
    expect(snapshot.routeProps.state?.sequence).toBe(5);

    // Verify the buffer was consumed and cleared
    expect(joinedRoomResponseRef.current).toBeNull();
  });

  it('applies the response via callback when it arrives after mount, and does not double-apply', () => {
    resetGameSnapshot();

    const joinedRoomResponseRef = { current: null as any };
    const shellDelegatesRef = createRef<any>();

    const props = makeDefaultProps({
      joinedRoomResponseRef,
      shellDelegatesRef,
    });

    render(<MultiplayerGameShell {...props} />);

    // Shell is mounted, state should be null initially
    expect(getGameSnapshot().hasState).toBe(false);

    const mockResp = {
      ok: true,
      roomCode: 'ROOM123',
      you: YOU,
      players: [{ id: YOU }, { id: OPP }],
      state: makeState({ sequence: 10 }),
    } as RoomAckResponse;

    // Simulate response arriving after mount:
    // processJoinAck sets the ref and calls applySnapshot
    joinedRoomResponseRef.current = mockResp;

    let callbackApplied = false;
    act(() => {
      if (shellDelegatesRef.current) {
        shellDelegatesRef.current.applyJoinResponseGameState(mockResp);
        callbackApplied = true;
      }
    });

    expect(callbackApplied).toBe(true);

    // Assert that the state was applied
    const snapshot = getGameSnapshot();
    expect(snapshot.hasState).toBe(true);
    expect(snapshot.routeProps.state?.sequence).toBe(10);
  });
});

describe('MultiplayerGameShell HUD score pulse', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * MP-JIT-2 makes a scoring play two `state` transitions — the optimistic local
   * projection, then the authoritative echo ~45ms later. The pulse effect arms a
   * 260ms reset timer and returns clearTimeout as its cleanup, so the second
   * transition cancels the reset. On that run the score is unchanged, so the
   * effect early-returns without arming a replacement and the pulse sticks on.
   * Same shape as the score-toast bug fixed in 869e0712.
   */
  it('clears the HUD score pulse when the authoritative echo follows the optimistic apply', () => {
    resetGameSnapshot();
    vi.useFakeTimers();

    const shellDelegatesRef = createRef<any>();
    const props = makeDefaultProps({
      joinedRoomResponseRef: { current: null as any },
      shellDelegatesRef,
    });

    render(<MultiplayerGameShell {...props} />);

    const applyState = (state: GameState) => {
      act(() => {
        shellDelegatesRef.current?.applyJoinResponseGameState({
          ok: true,
          roomCode: 'ROOM123',
          you: YOU,
          players: [{ id: YOU }, { id: OPP }],
          state,
        } as RoomAckResponse);
      });
    };

    const scored = (sequence: number, oppScore: number) =>
      makeState({
        sequence,
        players: {
          [YOU]: { id: YOU, hand: [], score: 0 },
          [OPP]: { id: OPP, hand: [], score: oppScore },
        },
      });

    // Baseline, then the optimistic apply that scores.
    applyState(scored(1, 0));
    applyState(scored(2, 10));
    expect(getGameSnapshot().routeProps.hudScorePulse[OPP]).toBe(true);

    // Authoritative echo lands inside the 260ms window with the same score.
    act(() => {
      vi.advanceTimersByTime(45);
    });
    applyState(scored(3, 10));

    // Well past the reset window, the pulse must be gone.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(getGameSnapshot().routeProps.hudScorePulse[OPP]).toBeFalsy();
  });
});

describe('MultiplayerGameShell post-game rating refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The rating refresh runs a ~13s retry loop and guards re-entry with
   * multiplayerRatingRefreshKeyRef. Its cleanup set `cancelled = true`, and the
   * effect depends on the raw `state` object — so any post-game state echo
   * cancelled the in-flight loop, while the key guard made the re-run
   * early-return without starting a replacement. The `finally` that clears
   * pending is skipped when cancelled, so the summary stuck on pending forever.
   */
  it('still settles the rating refresh when a state echo lands mid-retry', async () => {
    resetGameSnapshot();
    vi.useFakeTimers();

    const shellDelegatesRef = createRef<any>();
    const props = makeDefaultProps({
      joinedRoomResponseRef: { current: null as any },
      shellDelegatesRef,
      authProfileRef: { current: { glicko_rating: 1500 } } as any,
      authProfile: { username: 'You', glicko_rating: 1500 } as any,
    });

    render(<MultiplayerGameShell {...props} />);

    const applyState = (state: GameState) => {
      act(() => {
        shellDelegatesRef.current?.applyJoinResponseGameState({
          ok: true,
          roomCode: 'ROOM123',
          you: YOU,
          players: [{ id: YOU, userId: '1' }, { id: OPP, userId: '2' }],
          state,
        } as RoomAckResponse);
      });
    };

    const over = (sequence: number) =>
      makeState({ sequence, gameOver: true, handOver: true, winnerId: YOU });

    // Game ends: the retry loop starts and pending goes true.
    applyState(over(20));
    expect(getGameSnapshot().routeProps.multiplayerRatingSummary?.pending).toBe(true);

    // An authoritative echo of the same terminal state lands mid-retry.
    applyState(over(21));

    // Let the whole retry ladder (~13.3s) drain.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(getGameSnapshot().routeProps.multiplayerRatingSummary?.pending).toBe(false);
  });
});

describe('MultiplayerGameShell — history scrubber gating', () => {
  afterEach(() => {
    resetGameSnapshot();
  });

  function renderWith(overrides: Partial<MultiplayerGameShellProps> = {}) {
    resetGameSnapshot();
    const joinedRoomResponseRef = {
      current: {
        ok: true,
        roomCode: 'ROOM123',
        you: YOU,
        players: [{ id: YOU }, { id: OPP }],
        state: makeState({ sequence: 5 }),
      } as RoomAckResponse,
    };
    render(
      <MultiplayerGameShell
        {...makeDefaultProps({ joinedRoomResponseRef, shellDelegatesRef: createRef<any>(), ...overrides })}
      />,
    );
    return getGameSnapshot();
  }

  it('enables the scrubber for a player in a live standard match', () => {
    expect(renderWith().routeProps.historyScrubberEnabled).toBe(true);
  });

  it('disables the scrubber for a spectator', () => {
    // `you` is not among the seated players → spectating.
    expect(renderWith({ you: 'p3' }).routeProps.historyScrubberEnabled).toBe(false);
  });

  it('disables the scrubber for a tournament match', () => {
    expect(
      renderWith({ tournamentMatch: { isTournament: true } as any }).routeProps.historyScrubberEnabled,
    ).toBe(false);
  });
});
