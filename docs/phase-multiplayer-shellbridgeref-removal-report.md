# Phase: Multiplayer Cleanup — Remove `shellBridgeRef` Ref Bridge

## Prerequisite confirmation

**Does `docs/repo-health-audit-2026-07.md` exist at that exact path?** **YES**

---

## 1. Investigation

### 1.1 `App.tsx` — bridge declaration and usage (BEFORE)

```tsx
import type { MultiplayerGameShellBridge } from './multiplayer/multiplayerGameShellTypes';
import { useMultiplayerShellDelegates } from './multiplayer/useMultiplayerShellDelegates';
```

```tsx
  const gameShellBridgeRef = useRef<MultiplayerGameShellBridge | null>(null);
  const sharedGameplayRefs = useMemo(
    () => ({
      stateRef: { current: null as GameState | null },
      draggingStateRef: { current: false },
      handRevealShownRef: { current: null as number | null },
      handRevealTimerRef: { current: null as ReturnType<typeof setTimeout> | null },
      rematchAwaitingStateRef: { current: false },
    }),
    [],
  );
  const stateRef = sharedGameplayRefs.stateRef;
  const draggingStateRef = sharedGameplayRefs.draggingStateRef;
  const handRevealShownRef = sharedGameplayRefs.handRevealShownRef;
  const handRevealTimerRef = sharedGameplayRefs.handRevealTimerRef;
  const rematchAwaitingStateRef = sharedGameplayRefs.rematchAwaitingStateRef;

  const shellDelegates = useMultiplayerShellDelegates(gameShellBridgeRef);
  const {
    setState: shellSetState,
    setLegalMoves: shellSetLegalMoves,
    setCanDraw: shellSetCanDraw,
    setRematchRequested: shellSetRematchRequested,
    setRematchReadyIds: shellSetRematchReadyIds,
    setOpponentDragging: shellSetOpponentDragging,
    setHandReveal: shellSetHandReveal,
    setSelectedTile: shellSetSelectedTile,
    setPendingUiAction: shellSetPendingUiAction,
    setActionError: shellSetActionError,
    clearTransientRoomUi,
  } = shellDelegates;
```

```tsx
  const resetClientGameSession = useCallback(() => {
    maxSequenceRef.current = -1;
    maxEventSequenceRef.current = -1;
    roomMatchIdRef.current = null;
    playerReadyEmittedRef.current = false;
    matchStartedRef.current = false;
    clearTournamentAttachRefs();
    resyncBufferedUpdateRef.current = null;
    gameShellBridgeRef.current?.resetShellClientGameSession();
  }, [clearTournamentAttachRefs]);
```

```tsx
  const applySnapshot = useCallback(
    (resp: RoomAckResponse) =>
      gameShellBridgeRef.current?.applyJoinResponseGameState(resp) ?? {
        ok: false,
        nextState: null,
      },
    [],
  );
```

```tsx
            shellBridgeRef={gameShellBridgeRef}
```

`shellSetState`, `shellSetLegalMoves`, etc. are passed to `useMultiplayerConnectionHostParams`, `useTournamentMatchSession`, `resetGameShellState`, and other App connection/room handlers (20+ call sites).

### 1.2 `useMultiplayerShellDelegates.ts` — full source (BEFORE)

```tsx
import { useCallback } from 'react';
import type { MutableRefObject, SetStateAction } from 'react';
import type { GameState, Move, Tile } from '../types';
import type { MultiplayerGameShellBridge } from './multiplayerGameShellTypes';

type HandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: { you: number; opponent: number };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

export function useMultiplayerShellDelegates(
  shellBridgeRef: MutableRefObject<MultiplayerGameShellBridge | null>,
) {
  const setState = useCallback(
    (value: SetStateAction<GameState | null>) => {
      shellBridgeRef.current?.setState(value);
    },
    [shellBridgeRef],
  );

  const setLegalMoves = useCallback(
    (value: SetStateAction<Move[]>) => {
      shellBridgeRef.current?.setLegalMoves(value);
    },
    [shellBridgeRef],
  );

  const setCanDraw = useCallback(
    (value: SetStateAction<boolean>) => {
      shellBridgeRef.current?.setCanDraw(value);
    },
    [shellBridgeRef],
  );

  const setRematchRequested = useCallback(
    (value: SetStateAction<boolean>) => {
      shellBridgeRef.current?.setRematchRequested(value);
    },
    [shellBridgeRef],
  );

  const setRematchReadyIds = useCallback(
    (value: SetStateAction<string[]>) => {
      shellBridgeRef.current?.setRematchReadyIds(value);
    },
    [shellBridgeRef],
  );

  const setOpponentDragging = useCallback(
    (value: SetStateAction<boolean>) => {
      shellBridgeRef.current?.setOpponentDragging(value);
    },
    [shellBridgeRef],
  );

  const setHandReveal = useCallback(
    (value: SetStateAction<HandEndedPayload | null>) => {
      shellBridgeRef.current?.setHandReveal(value);
    },
    [shellBridgeRef],
  );

  const setSelectedTile = useCallback(
    (value: SetStateAction<Tile | null>) => {
      shellBridgeRef.current?.setSelectedTile(value);
    },
    [shellBridgeRef],
  );

  const setPendingUiAction = useCallback(
    (
      value: SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>,
    ) => {
      shellBridgeRef.current?.setPendingUiAction(value);
    },
    [shellBridgeRef],
  );

  const setActionError = useCallback(
    (value: SetStateAction<string>) => {
      shellBridgeRef.current?.setActionError(value);
    },
    [shellBridgeRef],
  );

  const clearTransientRoomUi = useCallback(() => {
    shellBridgeRef.current?.clearTransientRoomUi();
  }, [shellBridgeRef]);

  return {
    setState,
    setLegalMoves,
    setCanDraw,
    setRematchRequested,
    setRematchReadyIds,
    setOpponentDragging,
    setHandReveal,
    setSelectedTile,
    setPendingUiAction,
    setActionError,
    clearTransientRoomUi,
  };
}
```

### 1.3 `MultiplayerGameShell.tsx` — bridge population (BEFORE)

Props destructuring:

```tsx
  shellBridgeRef,
  sharedGameplayRefs,
```

Bridge object + population (~L949–1008):

```tsx
  const bridge = useMemo(
    (): MultiplayerGameShellBridge => ({
      stateRef,
      draggingStateRef,
      handRevealShownRef,
      handRevealTimerRef,
      rematchAwaitingStateRef,
      setState,
      setLegalMoves,
      setCanDraw,
      setRematchRequested,
      setRematchReadyIds,
      setOpponentDragging,
      setHandReveal,
      setSelectedTile,
      setPendingUiAction,
      setActionError,
      clearTransientRoomUi,
      applyJoinResponseGameState,
      resetShellClientGameSession,
      inGame,
    }),
    [/* stable deps */],
  );

  useLayoutEffect(() => {
    shellBridgeRef.current = bridge;
    return () => {
      shellBridgeRef.current = null;
      resetGameSnapshot();
    };
  }, [bridge, shellBridgeRef]);
```

Setters (`setState`, `setLegalMoves`, …) originate from `useLiveMatchSession` inside the shell (owned React state in the match session hook, not in App).

### 1.4 `multiplayerGameShellTypes.ts` — bridge type (BEFORE)

```tsx
/** Imperative bridge App connection/lobby code uses without re-rendering App on state:update. */
export type MultiplayerGameShellBridge = {
  stateRef: MutableRefObject<GameState | null>;
  draggingStateRef: MutableRefObject<boolean>;
  handRevealShownRef: MutableRefObject<number | null>;
  handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
  setState: Dispatch<SetStateAction<GameState | null>>;
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  setRematchRequested: Dispatch<SetStateAction<boolean>>;
  setRematchReadyIds: Dispatch<SetStateAction<string[]>>;
  setOpponentDragging: Dispatch<SetStateAction<boolean>>;
  setHandReveal: Dispatch<SetStateAction<HandEndedPayload | null>>;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  setPendingUiAction: Dispatch<SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>>;
  setActionError: Dispatch<SetStateAction<string>>;
  clearTransientRoomUi: () => void;
  applyJoinResponseGameState: (resp: { state?: GameState | null; matchStarted?: boolean; you?: string }) => { ok: boolean; nextState: GameState | null };
  resetShellClientGameSession: () => void;
  inGame: boolean;
};

// Props included:
  shellBridgeRef: MutableRefObject<MultiplayerGameShellBridge | null>;
```

### 1.5 Every state mutation routed through the bridge

| Bridge member | What it mutates / triggers | Who calls it (App side) | Who reads result |
|---------------|--------------------------|-------------------------|------------------|
| `setState` | `useLiveMatchSession` game `state` | Connection handlers, room reset, socket sync via `useMultiplayerConnectionHostParams` | Shell re-renders `LiveMatchScreen`; `stateRef` synced for imperative reads |
| `setLegalMoves` | Legal move list | Room reset, connection host params | Board/hand legality in shell |
| `setCanDraw` | Draw availability flag | Room reset, connection host params | Draw UI in shell |
| `setRematchRequested` | Rematch request flag | Connection host params | Post-game overlay |
| `setRematchReadyIds` | Ready player ids for rematch | Connection host params | Rematch UI |
| `setOpponentDragging` | Opponent drag animation flag | Connection host params | Presentation layer |
| `setHandReveal` | Hand-ended reveal payload | Room reset, connection host params | Hand-over modal sequence |
| `setSelectedTile` | Selected hand tile | Room reset, connection host params | Board/hand selection |
| `setPendingUiAction` | Pending action spinner kind | Connection host params, room actions | Action buttons disabled state |
| `setActionError` | Inline action error string | Tournament session, connection, abandon handlers | Error display in shell |
| `clearTransientRoomUi` | Clears pending UI + selection | Connection host params, room leave | Transient overlays |
| `applyJoinResponseGameState` | Applies join ack state/legalMoves/canDraw; updates `maxSequenceRef` | `useJoinAckCoordinator` via `applySnapshot` | Join flow; tournament metadata |
| `resetShellClientGameSession` | Resets shell session refs + opponent UI + calls `clearTransientRoomUi` | `resetClientGameSession` in App | Clean session on leave/rematch |
| `stateRef` etc. | Read-only mirrors (not setters) | Exposed on bridge object; App uses separate `sharedGameplayRefs` sync | `useAppSessionRuntime`, connection code |

---

## 2. Diagnosis — why the bridge existed

1. **Game state lives in `useLiveMatchSession` inside `MultiplayerGameShell`**, not in `App.tsx`. Moving `state` to App would re-render the entire app tree on every `state:update` socket event — explicitly avoided (bridge comment: *"without re-rendering App on state:update"*).

2. **App connection/lobby code must imperatively reset or seed shell state** on room join, leave, abandon, and recovery — but App is the parent that owns socket connection hooks (`useMultiplayerConnectionHostParams`, `useJoinAckCoordinator`, etc.).

3. **The ref bridge was a workaround**: populate `shellBridgeRef.current` after shell mount so App hooks could call shell setters with stable `[]` deps (`applySnapshot`) without lifting state or passing setters as props that would need to exist before shell mounts.

4. **`sharedGameplayRefs`** (separate from bridge) mirrors latest gameplay values into App-owned ref objects for **read-only** imperative access in connection code — not the same banned mutation pattern, left unchanged in this task.

---

## 3. Fix design

### Chosen approach: **Registration callback + App `useState`**

- `MultiplayerGameShell` calls `onShellDelegatesChange(delegates)` in `useLayoutEffect` when mounted/updated, and `onShellDelegatesChange(null)` on unmount.
- `App.tsx` stores `shellDelegates` in `useState<MultiplayerShellDelegates | null>(null)`.
- `useMultiplayerShellDelegates(shellDelegates)` wraps the registered object (same API as before, but reads from state not ref).
- `applySnapshot` and `resetClientGameSession` call `shellDelegates?.…` directly with `[shellDelegates]` deps.

### Why this fits

- **Proper React data flow**: child registers capabilities upward via a callback prop; parent holds a normal value.
- **No App re-render on `state:update`**: calling `shellDelegates.setState` updates shell-internal state only; App does not own `state`.
- **App re-renders once** when shell mounts (delegates go `null` → object) and once on unmount — acceptable, same as before when bridge object identity changed.

### Alternatives rejected

| Alternative | Why rejected |
|-------------|--------------|
| Lift `useLiveMatchSession` to App | Touches frozen `client/src/match/session/**`; massive scope |
| Keep ref but rename | Still the banned ref-bridge pattern |
| Store delegates only in `useRef` in App | Would recreate stable-callback ref indirection for `applySnapshot`; state + callback is explicit |
| Context provider | New global channel; overkill for parent/child only |

### Rename

`MultiplayerGameShellBridge` → `MultiplayerShellDelegates` (same shape, removes "bridge" semantics).

---

## 4. Implementation — files changed

### 4.1 `multiplayerGameShellTypes.ts` (AFTER — full)

```tsx
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, Tile } from '../types';
import type { StateUpdatePayload } from './useRoomSocketSync';
import type { FriendInviteState, RoomPlayer, RoomRecoveryState } from './multiplayerRuntime';

type HandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: { you: number; opponent: number };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

/** Live-match controls registered from MultiplayerGameShell for App connection/lobby code. */
export type MultiplayerShellDelegates = {
  stateRef: MutableRefObject<GameState | null>;
  draggingStateRef: MutableRefObject<boolean>;
  handRevealShownRef: MutableRefObject<number | null>;
  handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
  setState: Dispatch<SetStateAction<GameState | null>>;
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  setRematchRequested: Dispatch<SetStateAction<boolean>>;
  setRematchReadyIds: Dispatch<SetStateAction<string[]>>;
  setOpponentDragging: Dispatch<SetStateAction<boolean>>;
  setHandReveal: Dispatch<SetStateAction<HandEndedPayload | null>>;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  setActionError: Dispatch<SetStateAction<string>>;
  clearTransientRoomUi: () => void;
  applyJoinResponseGameState: (resp: {
    state?: GameState | null;
    matchStarted?: boolean;
    you?: string;
  }) => { ok: boolean; nextState: GameState | null };
  resetShellClientGameSession: () => void;
  inGame: boolean;
};

export type MultiplayerGameShellConnectionRecovery = {
  roomRecoveryState: RoomRecoveryState;
  isRecoveringConnection: boolean;
  roomRecoveryMessage: string;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
};

type RoomEventMeta = {
  matchId?: string;
  lastEventSequence?: number;
  eventCount?: number;
};

export type MultiplayerGameShellProps = {
  socket: Socket | null;
  joinedRoom: string;
  you: string;
  players: RoomPlayer[];
  isConnected: boolean;
  showToast: (message: string, duration?: number) => void;
  connectionRecovery: MultiplayerGameShellConnectionRecovery;
  setError: Dispatch<SetStateAction<string>>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  isMuted: boolean;
  isMutedRef: MutableRefObject<boolean>;
  trayCenterRef: RefObject<HTMLDivElement | null>;
  authUser: { id: string; email?: string | null } | null;
  authProfile: { username?: string | null; glicko_rating?: number | null } | null;
  refreshAuthProfile: () => Promise<void>;
  authProfileRef: MutableRefObject<{ glicko_rating?: number | null } | null>;
  supabaseEnabled: boolean;
  tournamentMatch: {
    isTournament?: boolean;
    opponentUserId?: string | null;
    opponentUsername?: string | null;
    round?: number;
  } | null;
  tournamentOpponentLabel: string | null;
  rejoinInFlightRef: MutableRefObject<boolean>;
  joinedRoomRef: MutableRefObject<string | null>;
  maxSequenceRef: MutableRefObject<number>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  resyncInFlightRef: MutableRefObject<boolean>;
  resyncBufferedUpdateRef: MutableRefObject<StateUpdatePayload | null>;
  resyncFlushRef: MutableRefObject<(() => void) | null>;
  fetchGameState: (reason: string) => Promise<boolean>;
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  onShellDelegatesChange: (delegates: MultiplayerShellDelegates | null) => void;
  sharedGameplayRefs: {
    stateRef: MutableRefObject<import('../types').GameState | null>;
    draggingStateRef: MutableRefObject<boolean>;
    handRevealShownRef: MutableRefObject<number | null>;
    handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
    rematchAwaitingStateRef: MutableRefObject<boolean>;
  };
  setAbandonedMatchNotice: Dispatch<SetStateAction<AbandonedMatchNotice | null>>;
};

export type AbandonedMatchNotice = {
  context: 'tournament' | 'multiplayer';
  title: string;
  detail: string;
  tournamentId?: string | null;
};
```

### 4.2 `useMultiplayerShellDelegates.ts` (AFTER — full)

See current file at `client/src/multiplayer/useMultiplayerShellDelegates.ts` (116 LOC). Key change: parameter is `shellDelegates: MultiplayerShellDelegates | null` instead of `shellBridgeRef`.

### 4.3 `MultiplayerGameShell.tsx` — changed regions (AFTER)

Props: `onShellDelegatesChange` replaces `shellBridgeRef`.

Registration effect:

```tsx
  useLayoutEffect(() => {
    onShellDelegatesChange(shellDelegates);
    return () => {
      onShellDelegatesChange(null);
      resetGameSnapshot();
    };
  }, [onShellDelegatesChange, shellDelegates]);
```

### 4.4 `App.tsx` — changed regions (AFTER)

```tsx
import type { MultiplayerShellDelegates } from './multiplayer/multiplayerGameShellTypes';
```

```tsx
  const [shellDelegates, setShellDelegates] = useState<MultiplayerShellDelegates | null>(null);
  const handleShellDelegatesChange = useCallback((next: MultiplayerShellDelegates | null) => {
    setShellDelegates(next);
  }, []);

  const shellDelegateActions = useMultiplayerShellDelegates(shellDelegates);
  const {
    setState: shellSetState,
    /* ... unchanged destructuring ... */
  } = shellDelegateActions;
```

```tsx
    shellDelegates?.resetShellClientGameSession();
  }, [clearTournamentAttachRefs, shellDelegates]);
```

```tsx
  const applySnapshot = useCallback(
    (resp: RoomAckResponse) =>
      shellDelegates?.applyJoinResponseGameState(resp) ?? {
        ok: false,
        nextState: null,
      },
    [shellDelegates],
  );
```

```tsx
            onShellDelegatesChange={handleShellDelegatesChange}
```

---

## 5. Tests

### 5.1 New file — `useMultiplayerShellDelegates.test.ts` (full)

```tsx
import { describe, expect, it, vi } from 'vitest';
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
  it('forwards setter calls to registered shell delegates', () => { /* ... */ });
  it('no-ops when shell delegates are not registered yet', () => { /* ... */ });
  it('picks up newly registered delegates after shell mount', () => { /* ... */ });
});
```

### 5.2 Coverage disclosure

**Covered:**
- Delegate wrapper forwards `setState`, `setLegalMoves`, `setCanDraw`, `setActionError`, `clearTransientRoomUi` to registered object
- Null-safe no-op before shell mounts
- Re-registration after shell mount updates forwarded calls

**Not covered (explicit):**
- Full `MultiplayerGameShell` ↔ `App` integration mount cycle
- `applyJoinResponseGameState` / `resetShellClientGameSession` end-to-end (live in `useLiveMatchSession`, frozen)
- Socket-driven `state:update` ordering — wiring/JSX per Daily Puzzle precedent

---

## 6. Grep proof — bridge fully removed

```bash
rg 'shellBridgeRef|gameShellBridgeRef|MultiplayerGameShellBridge' client/src
# (no matches)

rg '\.current\?\.setState|shellBridge' client/src
# (no matches)

rg 'MultiplayerShellDelegates' client/src
# App.tsx, MultiplayerGameShell.tsx, multiplayerGameShellTypes.ts,
# useMultiplayerShellDelegates.ts, useMultiplayerShellDelegates.test.ts
```

`MultiplayerGameShellBridge` type name removed. No `.current?.setState` ref-mutation pattern remains.

**Note:** `sharedGameplayRefs` read-sync pattern unchanged (read-only mirrors for connection code, not setter bridge).

---

## 7. Verification

| Check | Before | After |
|-------|--------|-------|
| Client test files | 60 | **61** (+1) |
| Client tests | 510 | **513** (+3) |
| Client build | PASS | **PASS** |

```
Test Files  61 passed (61)
Tests       513 passed (513)
✓ built in 5.71s
```

---

## 8. Files touched

| File | Action |
|------|--------|
| `client/src/multiplayer/multiplayerGameShellTypes.ts` | Renamed bridge type → `MultiplayerShellDelegates`; `onShellDelegatesChange` prop |
| `client/src/multiplayer/useMultiplayerShellDelegates.ts` | Accept nullable delegates object instead of ref |
| `client/src/multiplayer/MultiplayerGameShell.tsx` | Register delegates via callback; remove ref population |
| `client/src/App.tsx` | `useState` + `handleShellDelegatesChange`; remove `gameShellBridgeRef` |
| `client/src/multiplayer/useMultiplayerShellDelegates.test.ts` | **Created** — 3 tests |
| `docs/phase-multiplayer-shellbridgeref-removal-report.md` | **Created** — this report |

**Frozen files:** Not touched.

---

## 9. Behavior preservation

- Same setters invoked from same App call sites (via `shellDelegateActions` aliases unchanged).
- Shell still owns game state in `useLiveMatchSession`.
- Registration happens in `useLayoutEffect` (same timing as previous ref population).
- Unmount clears delegates and `resetGameSnapshot()` — unchanged cleanup.
- Before shell mounts, all delegate calls no-op via optional chaining (same as `ref.current === null`).

---

## 10. Follow-up: `shellDelegates` useMemo stability

The investigation quote in §1.3 used a placeholder dependency array (`[/* stable deps */]`). A dedicated verification pass confirms the **actual** post-refactor useMemo, its complete dependency list, and per-dep stability analysis.

**Result:** Confirmed stable during normal gameplay — no spurious App re-renders on `state:update`. Intentional re-registration only at `inGame` lifecycle boundaries. No code fix required.

**Full report:** `docs/phase-multiplayer-shellbridgeref-removal-verification-report.md`