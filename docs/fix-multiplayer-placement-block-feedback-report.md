# Report: Multiplayer Placement Block UX Feedback

## 1. Rationale & Decision
During forced draw chains in multiplayer, the client triggers a sequence of card-draw animations. During these animations, `drawSequenceActive` is set to `true` and tiles are flying (`flyingTiles.length > 0`), locking placement actions to prevent state synchronization issues and out-of-order move execution.

Previously, these blocks occurred silently without visual feedback. Because the post-forced-draw animation lock lasts for ~2.8 seconds, players clicking on placement zones perceived the UI as unresponsive or broken.

We resolved this by adding user-visible toast feedback ('Finishing draw animation…') when a click is blocked by `drawSequenceActive` or `flyingTiles.length > 0`. We kept the block silent for `pendingActionRef.current` (which acts as a debounce/in-flight request guard) to avoid spamming toast notifications on rapid double-clicks.

---

## 2. Before / After Source Code

### `client/src/match/session/actions/useLiveMatchActions.ts`

#### BEFORE
```typescript
  const isGameplayActionBlocked = useCallback(() => {
    if (!socket || !joinedRoom || !state || !you) return true;
    if (
      !socket.connected ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      rejoinInFlightRef.current
    ) {
      showToast('Reconnecting...', 1200);
      return true;
    }
    if (pendingActionRef.current || drawSequenceActive || flyingTiles.length > 0) return true;
    if (pendingUiAction === 'draw' || pendingUiAction === 'pass' || pendingUiAction === 'play') {
      return true;
    }
    if (state.handOver || state.gameOver) return true;
    if (!state.playerIds.includes(you)) return true;
    return state.playerIds[state.currentPlayerIndex] !== you;
  }, [
    socket,
    joinedRoom,
    state,
    you,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    pendingUiAction,
    showToast,
    drawSequenceActive,
    flyingTiles,
    pendingActionRef,
  ]);
```

#### AFTER
```typescript
  const isGameplayActionBlocked = useCallback(() => {
    if (!socket || !joinedRoom || !state || !you) return true;
    if (
      !socket.connected ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      rejoinInFlightRef.current
    ) {
      showToast('Reconnecting...', 1200);
      return true;
    }
    if (pendingActionRef.current) {
      return true;
    }
    if (drawSequenceActive || flyingTiles.length > 0) {
      showToast('Finishing draw animation…', 1200);
      return true;
    }
    if (pendingUiAction === 'draw' || pendingUiAction === 'pass' || pendingUiAction === 'play') {
      return true;
    }
    if (state.handOver || state.gameOver) return true;
    if (!state.playerIds.includes(you)) return true;
    return state.playerIds[state.currentPlayerIndex] !== you;
  }, [
    socket,
    joinedRoom,
    state,
    you,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    pendingUiAction,
    showToast,
    drawSequenceActive,
    flyingTiles,
    pendingActionRef,
  ]);
```

---

## 3. New Unit Test Suite
We introduced a dedicated test file to assert correct behavior of `isGameplayActionBlocked` under various blocking conditions:

### `client/src/match/session/actions/useLiveMatchActions.test.ts`
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiveMatchActions, type UseLiveMatchActionsParams } from './useLiveMatchActions';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../../../types';

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

function makeParams(overrides: Partial<UseLiveMatchActionsParams> = {}): UseLiveMatchActionsParams {
  const socket = { connected: true, emit: vi.fn() } as unknown as Socket;
  return {
    socket,
    joinedRoom: ROOM,
    you: YOU,
    state: makeState(),
    legalMoves: [],
    canDraw: false,
    roomRecoveryState: 'idle',
    isRecoveringConnection: false,
    rejoinInFlightRef: { current: false },
    pendingUiAction: null,
    drawSequenceActive: false,
    flyingTiles: [],
    rematchRequested: false,
    stateRef: { current: makeState() },
    legalMovesRef: { current: [] },
    selectedTileRef: { current: null },
    pendingActionRef: { current: false },
    pendingGameplayActionRef: { current: null },
    draggingStateRef: { current: false },
    mpAutoDrawSuppressUntilSequenceRef: { current: null },
    autoTurnActionKeyRef: { current: '' },
    isMutedRef: { current: false },
    dispatchSession: vi.fn(),
    schedulePlayerReadyRef: { current: vi.fn() },
    trySchedulePlayerReadyRef: { current: vi.fn() },
    isMyTurn: true,
    hasPlayMoves: false,
    canDrawNow: false,
    canPass: false,
    myHandLength: 1,
    boneyardCount: 0,
    setError: vi.fn(),
    setActionError: vi.fn(),
    setPendingUiAction: vi.fn(),
    setRematchRequested: vi.fn(),
    setSelectedTile: vi.fn(),
    setDrawStepMyHand: vi.fn(),
    showToast: vi.fn(),
    onGameStart: vi.fn(),
    appendMultiplayerMove: vi.fn(),
    flashLastPlayed: vi.fn(),
    ...overrides,
  };
}

describe('useLiveMatchActions - isGameplayActionBlocked toasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not toast and returns false when not blocked', () => {
    const params = makeParams();
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(false);
    expect(params.showToast).not.toHaveBeenCalled();
  });

  it('toasts "Finishing draw animation…" when drawSequenceActive is true', () => {
    const params = makeParams({ drawSequenceActive: true });
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(true);
    expect(params.showToast).toHaveBeenCalledWith('Finishing draw animation…', 1200);
  });

  it('toasts "Finishing draw animation…" when flyingTiles is not empty', () => {
    const params = makeParams({
      flyingTiles: [{ x: 0, y: 0, toX: 10, toY: 10, id: 1 }],
    });
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(true);
    expect(params.showToast).toHaveBeenCalledWith('Finishing draw animation…', 1200);
  });

  it('does not toast (silent block) when pendingActionRef is true', () => {
    const params = makeParams();
    params.pendingActionRef.current = true;
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(true);
    expect(params.showToast).not.toHaveBeenCalled();
  });
});
```

---

## 4. Test Suite Execution Output
All tests in the client package executed and passed successfully:

```
 ✓ src/match/session/actions/useLiveMatchActions.test.ts (4 tests) 27ms

 Test Files  74 passed (74)
      Tests  575 passed (575)
   Start at  20:13:02
   Duration  15.59s (transform 5.20s, setup 6.88s, import 12.82s, tests 3.58s, environment 66.76s)
```
