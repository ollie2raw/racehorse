import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useMultiplayerShellDelegates } from './useMultiplayerShellDelegates';
import type { MultiplayerShellDelegates } from './multiplayerGameShellTypes';

function makeDelegates(): MultiplayerShellDelegates {
  return {
    stateRef: { current: null },
    draggingStateRef: { current: false },
    handRevealShownRef: { current: null },
    handRevealTimerRef: { current: null },
    rematchAwaitingStateRef: { current: false },
    setState: vi.fn(),
    setLegalMoves: vi.fn(),
    setCanDraw: vi.fn(),
    setRematchRequested: vi.fn(),
    setRematchReadyIds: vi.fn(),
    setOpponentDragging: vi.fn(),
    setHandReveal: vi.fn(),
    setSelectedTile: vi.fn(),
    setPendingUiAction: vi.fn(),
    setActionError: vi.fn(),
    clearTransientRoomUi: vi.fn(),
    applyJoinResponseGameState: vi.fn(() => ({ ok: true, nextState: null })),
    resetShellClientGameSession: vi.fn(),
    inGame: false,
  };
}

describe('useMultiplayerShellDelegates', () => {
  it('forwards setter calls to registered shell delegates', () => {
    const delegates = makeDelegates();
    const delegatesRef = createRef<MultiplayerShellDelegates | null>();
    delegatesRef.current = delegates;
    const { result } = renderHook(() => useMultiplayerShellDelegates(delegatesRef));

    act(() => {
      result.current.setState(null);
      result.current.setLegalMoves([]);
      result.current.setCanDraw(true);
      result.current.setActionError('oops');
      result.current.clearTransientRoomUi();
    });

    expect(delegates.setState).toHaveBeenCalledWith(null);
    expect(delegates.setLegalMoves).toHaveBeenCalledWith([]);
    expect(delegates.setCanDraw).toHaveBeenCalledWith(true);
    expect(delegates.setActionError).toHaveBeenCalledWith('oops');
    expect(delegates.clearTransientRoomUi).toHaveBeenCalledTimes(1);
  });

  it('no-ops when shell delegates are not registered yet', () => {
    const delegatesRef = createRef<MultiplayerShellDelegates | null>();
    const { result } = renderHook(() => useMultiplayerShellDelegates(delegatesRef));

    expect(() => {
      act(() => {
        result.current.setState(null);
        result.current.clearTransientRoomUi();
      });
    }).not.toThrow();
  });

  it('picks up newly registered delegates after shell mount', () => {
    const delegates = makeDelegates();
    const delegatesRef = createRef<MultiplayerShellDelegates | null>();
    const { result } = renderHook(() => useMultiplayerShellDelegates(delegatesRef));

    act(() => {
      result.current.setState(null);
    });

    delegatesRef.current = delegates;

    act(() => {
      result.current.setRematchRequested(true);
    });

    expect(delegates.setRematchRequested).toHaveBeenCalledWith(true);
  });
});