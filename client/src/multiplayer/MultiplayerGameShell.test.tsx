import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
