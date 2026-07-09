# Report: Removing Draw Animation Input Block

## 1. Rationale & Decision
The visual draw and flying-tile animations take ~2.8 seconds. Restricting player input during this time created a perceived latency and sluggishness, even though the underlying authoritative game state was ready for the next player action.

To match the fast-paced, responsive feel of the offline/bot single-player modes, we have completely decoupled player input (placement, draw, pass clicks) from the visual animations. 
- The client-side visual animations will continue to play exactly as they did before.
- Inputs are no longer blocked by `drawSequenceActive` or `flyingTiles.length > 0` flags in `isGameplayActionBlocked()`.
- The gameplay actions proceed immediately based on actual gameplay rules (whose turn it is, legal moves, connection status, etc.).
- The visual block toast has been removed entirely.

---

## 2. Before / After Diff

### `client/src/match/session/actions/useLiveMatchActions.ts`

```diff
@@ -345,15 +345,11 @@ export function useLiveMatchActions(params: UseLiveMatchActionsParams): UseLiveM
       showToast('Reconnecting...', 1200);
       return true;
     }
-    if (pendingActionRef.current) {
-      return true;
-    }
-    if (drawSequenceActive || flyingTiles.length > 0) {
-      showToast('Finishing draw animation…', 1200);
-      return true;
-    }
+    if (pendingActionRef.current) {
+      return true;
+    }
     if (pendingUiAction === 'draw' || pendingUiAction === 'pass' || pendingUiAction === 'play') {
       return true;
     }
@@ -367,8 +363,6 @@ export function useLiveMatchActions(params: UseLiveMatchActionsParams): UseLiveM
     rejoinInFlightRef,
     pendingUiAction,
     showToast,
-    drawSequenceActive,
-    flyingTiles,
     pendingActionRef,
   ]);
```

---

## 3. Updated Test File

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

describe('useLiveMatchActions - isGameplayActionBlocked is cosmetic/unblocked on animation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not block and returns false when not blocked', () => {
    const params = makeParams();
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(false);
    expect(params.showToast).not.toHaveBeenCalled();
  });

  it('does NOT block (returns false) when drawSequenceActive is true', () => {
    const params = makeParams({ drawSequenceActive: true });
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(false);
    expect(params.showToast).not.toHaveBeenCalled();
  });

  it('does NOT block (returns false) when flyingTiles is not empty', () => {
    const params = makeParams({
      flyingTiles: [{ x: 0, y: 0, toX: 10, toY: 10, id: 1 }],
    });
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(false);
    expect(params.showToast).not.toHaveBeenCalled();
  });

  it('blocks silently (returns true without toast) when pendingActionRef is true', () => {
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

## 4. Build & Test Output
- **Client Build**: Compiles cleanly with no type-checking errors.
- **Client Test Suite**: All 575 tests across 74 test files run successfully.
```
 ✓ src/match/session/actions/useLiveMatchActions.test.ts (4 tests) 29ms

 Test Files  74 passed (74)
      Tests  575 passed (575)
   Start at  20:27:28
   Duration  15.22s
```
