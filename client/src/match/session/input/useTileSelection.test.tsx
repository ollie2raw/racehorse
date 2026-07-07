import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../../../types';
import { useTileSelection } from './useTileSelection';

const YOU = 'player-you';
const OPP = 'player-opp';
const ROOM = 'ABCD';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    config: { scoringMultiple: 5, winningScore: 100 },
    playerIds: [YOU, OPP],
    players: {
      [YOU]: { id: YOU, hand: [{ low: 1, high: 2 }], score: 0 },
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

function makeSocket() {
  const emit = vi.fn();
  const socket = { emit, connected: true } as unknown as Socket;
  return { socket, emit };
}

describe('useTileSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects a tile and emits dragging=true on tap', () => {
    const { socket, emit } = makeSocket();
    const pendingActionRef = { current: false };
    const draggingStateRef = { current: false };
    const tile = { low: 1, high: 2 };

    const { result } = renderHook(() =>
      useTileSelection({
        you: YOU,
        state: makeState(),
        joinedRoom: ROOM,
        roomRecoveryState: 'idle',
        isRecoveringConnection: false,
        isMyTurn: true,
        socket,
        pendingActionRef,
        draggingStateRef,
      }),
    );

    act(() => {
      result.current.handleTileTap(tile);
    });

    expect(result.current.selectedTile).toEqual(tile);
    expect(result.current.selectedTileRef.current).toEqual(tile);
    expect(emit).toHaveBeenCalledWith('player:dragging', ROOM, { dragging: true });
  });

  it('deselects when tapping the already-selected tile', () => {
    const { socket, emit } = makeSocket();
    const pendingActionRef = { current: false };
    const draggingStateRef = { current: false };
    const tile = { low: 1, high: 2 };

    const { result } = renderHook(() =>
      useTileSelection({
        you: YOU,
        state: makeState(),
        joinedRoom: ROOM,
        roomRecoveryState: 'idle',
        isRecoveringConnection: false,
        isMyTurn: true,
        socket,
        pendingActionRef,
        draggingStateRef,
      }),
    );

    act(() => {
      result.current.handleTileTap(tile);
    });
    emit.mockClear();

    act(() => {
      result.current.handleTileTap(tile);
    });

    expect(result.current.selectedTile).toBeNull();
    expect(emit).toHaveBeenCalledWith('player:dragging', ROOM, { dragging: false });
  });

  it('ignores taps while a gameplay action is in flight', () => {
    const { socket, emit } = makeSocket();
    const pendingActionRef = { current: true };
    const draggingStateRef = { current: false };
    const tile = { low: 1, high: 2 };

    const { result } = renderHook(() =>
      useTileSelection({
        you: YOU,
        state: makeState(),
        joinedRoom: ROOM,
        roomRecoveryState: 'idle',
        isRecoveringConnection: false,
        isMyTurn: true,
        socket,
        pendingActionRef,
        draggingStateRef,
      }),
    );

    act(() => {
      result.current.handleTileTap(tile);
    });

    expect(result.current.selectedTile).toBeNull();
    expect(emit).not.toHaveBeenCalledWith('player:dragging', ROOM, expect.anything());
  });

  it('emits pregame draw pick when socket is connected', () => {
    const { socket, emit } = makeSocket();
    const pendingActionRef = { current: false };
    const draggingStateRef = { current: false };

    const { result } = renderHook(() =>
      useTileSelection({
        you: YOU,
        state: null,
        joinedRoom: ROOM,
        roomRecoveryState: 'idle',
        isRecoveringConnection: false,
        isMyTurn: false,
        socket,
        pendingActionRef,
        draggingStateRef,
      }),
    );

    act(() => {
      result.current.onPregameTileTap('slot-3');
    });

    expect(emit).toHaveBeenCalledWith('game:pregame_draw_pick', { slotId: 'slot-3' });
  });

  it('does not emit pregame draw pick without a socket', () => {
    const pendingActionRef = { current: false };
    const draggingStateRef = { current: false };

    const { result } = renderHook(() =>
      useTileSelection({
        you: YOU,
        state: null,
        joinedRoom: ROOM,
        roomRecoveryState: 'idle',
        isRecoveringConnection: false,
        isMyTurn: false,
        socket: null,
        pendingActionRef,
        draggingStateRef,
      }),
    );

    act(() => {
      result.current.onPregameTileTap('slot-3');
    });

    expect(result.current.selectedTile).toBeNull();
  });
});