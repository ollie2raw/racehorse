# E11 Sizing Recon — `useAppSessionRuntime` (read-only)

Recon only — no code changes in this task.

---

## E11 ENTANGLEMENT comment (verbatim, `client/src/App.tsx`)

**Lines 421–424:**

```typescript
  // ENTANGLEMENT E11 [auth + socket + room]
  // useAppSessionRuntime bundles auth, socket, and room refs into one runtime object for useMultiplayerConnection.
  // Splitting refs across hooks without updating multiplayerRuntime types breaks the connection host wiring.
  // Resolution path: narrow runtime slices per concern once socket and room layers are fully decoupled. Phase 3 candidate.
```

---

## Full shape — `useAppSessionRuntime` (`client/src/useAppSessionRuntime.ts`)

### Input: `UseAppSessionRuntimeSource`

```typescript
export type UseAppSessionRuntimeSource = {
  socketRef: MutableRefObject<Socket | null>;
  connectRef: MutableRefObject<() => void>;
  pendingCreateOnConnectRef: MutableRefObject<boolean>;
  pendingCreateResolversRef: MutableRefObject<Array<(code: string | null) => void>>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
  joinInFlightRef: MutableRefObject<boolean>;
  createInFlightRef: MutableRefObject<boolean>;
  inviteJoinInFlightRef: MutableRefObject<boolean>;
  autoConnectAttemptedRef: MutableRefObject<boolean>;
  reconnectRoomCodeRef: MutableRefObject<string | null>;
  reconnectShouldJoinRef: MutableRefObject<boolean>;
  preventAutoRejoinRef: MutableRefObject<boolean>;
  reconnectAttemptTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reconnectAttemptCountRef: MutableRefObject<number>;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  rejoinInFlightRef: MutableRefObject<boolean>;
  authUserRef: MutableRefObject<{ id?: string | null; email?: string | null } | null>;
  authProfileRef: MutableRefObject<{ username?: string | null } | null>;
  authAccessTokenRef: MutableRefObject<string | null>;
  multiplayerIdentityUserIdRef: MutableRefObject<string | null>;
  appModeRef: MutableRefObject<AppMode>;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
  joinedRoomRef: MutableRefObject<string | null>;
  joinedRoomResponseRef: MutableRefObject<RoomAckResponse | null>;
  roomIdentityRef: MutableRefObject<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>;
  youRef: MutableRefObject<string>;
  stateRef: MutableRefObject<GameState | null>;
  maxSequenceRef: MutableRefObject<number>;
  roomPlayersRef: MutableRefObject<
    Array<{ id: string; username: string; userId: string | null }>
  >;
  applyJoinedRoomResponseRef: MutableRefObject<(resp: RoomAckResponse) => void>;
  clearRecoverableRoomStateRef: MutableRefObject<() => void>;
  resetMultiplayerRoomStateRef: MutableRefObject<
    (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void
  >;
};
```

### Output: `UseAppSessionRuntimeResult`

```typescript
export type UseAppSessionRuntimeResult = {
  socketRuntime: MultiplayerSocketRuntime;
  joinFlightRuntime: MultiplayerJoinFlightRuntime;
  reconnectRuntime: MultiplayerReconnectRuntime;
  authRuntime: MultiplayerAuthRuntime;
  navigationRuntime: MultiplayerNavigationRuntime;
  roomRuntime: MultiplayerRoomRuntime;
  tournamentAttachRuntime: TournamentAttachRuntime;
};
```

### Slice type definitions (`client/src/multiplayer/multiplayerRuntime.ts`)

```typescript
export type MultiplayerSocketRuntime = {
  socketRef: MutableRefObject<Socket | null>;
  connectRef: MutableRefObject<() => void>;
};

export type MultiplayerRoomRuntime = {
  joinedRoomRef: MutableRefObject<string | null>;
  joinedRoomResponseRef: MutableRefObject<unknown>;
  roomIdentityRef: MutableRefObject<RoomIdentity | null>;
  youRef: MutableRefObject<string>;
  stateRef: MutableRefObject<GameState | null>;
  maxSequenceRef: MutableRefObject<number>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
};

export type MultiplayerReconnectRuntime = {
  reconnectRoomCodeRef: MutableRefObject<string | null>;
  reconnectShouldJoinRef: MutableRefObject<boolean>;
  preventAutoRejoinRef: MutableRefObject<boolean>;
  reconnectAttemptTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reconnectAttemptCountRef: MutableRefObject<number>;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  rejoinInFlightRef: MutableRefObject<boolean>;
};

export type MultiplayerJoinFlightRuntime = {
  pendingCreateOnConnectRef: MutableRefObject<boolean>;
  pendingCreateResolversRef: MutableRefObject<Array<(code: string | null) => void>>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
  joinInFlightRef: MutableRefObject<boolean>;
  createInFlightRef: MutableRefObject<boolean>;
  inviteJoinInFlightRef: MutableRefObject<boolean>;
  autoConnectAttemptedRef: MutableRefObject<boolean>;
};

export type MultiplayerAuthRuntime = {
  authUserRef: MutableRefObject<{ id?: string | null; email?: string | null } | null>;
  authProfileRef: MutableRefObject<{ username?: string | null } | null>;
  authAccessTokenRef: MutableRefObject<string | null>;
  multiplayerIdentityUserIdRef: MutableRefObject<string | null>;
};

export type MultiplayerNavigationRuntime = {
  appModeRef: MutableRefObject<AppMode>;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
};

export type TournamentAttachRuntime = {
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: Pick<MultiplayerRoomRuntime, 'joinedRoomRef' | 'joinedRoomResponseRef'>;
  reconnectRuntime: Pick<
    MultiplayerReconnectRuntime,
    'preventAutoRejoinRef' | 'reconnectShouldJoinRef' | 'reconnectRoomCodeRef'
  >;
  recoveryRuntime: Pick<
    MultiplayerRecoveryRuntime,
    | 'applyJoinedRoomResponseRef'
    | 'clearRecoverableRoomStateRef'
    | 'resetMultiplayerRoomStateRef'
  >;
  navigationRuntime: MultiplayerNavigationRuntime;
};
```

### Hook implementation (return object)

```typescript
export function useAppSessionRuntime(source: UseAppSessionRuntimeSource): UseAppSessionRuntimeResult {
  // ... useMemo builds socketRuntime, joinFlightRuntime, reconnectRuntime,
  // authRuntime, navigationRuntime, roomRuntime, tournamentAttachRuntime ...
  return {
    socketRuntime,
    joinFlightRuntime,
    reconnectRuntime,
    authRuntime,
    navigationRuntime,
    roomRuntime,
    tournamentAttachRuntime,
  };
}
```

(Full implementation: 207 LOC in `client/src/useAppSessionRuntime.ts`.)

---

## Direct hook caller

| File | Pattern |
|------|---------|
| `client/src/App.tsx` ~425–466 | **Only** callsite of `useAppSessionRuntime()`; destructures all 7 returned slices immediately |

`UseAppSessionRuntimeResult` is **never** passed as a single undestructured object to any child. App always fans out into named slices.

---

## Downstream consumers — field-level usage

### 1. `App.tsx` → `useTournamentMatchSession({ attachRuntime: tournamentAttachRuntime })`

**Passes:** whole `tournamentAttachRuntime` object (undestructured prop).

**`useTournamentMatchSession` destructures / uses:**

| Slice | Fields used |
|-------|-------------|
| `attachRuntime.socketRuntime` | `socketRef`, `connectRef` |
| `attachRuntime.roomRuntime` | `joinedRoomRef`, `joinedRoomResponseRef` |
| `attachRuntime.reconnectRuntime` | `preventAutoRejoinRef`, `reconnectShouldJoinRef`, `reconnectRoomCodeRef` |
| `attachRuntime.recoveryRuntime` | `applyJoinedRoomResponseRef`, `clearRecoverableRoomStateRef`, `resetMultiplayerRoomStateRef` (via `.current()` calls throughout tournament attach/abandon/exit paths) |
| `attachRuntime.navigationRuntime` | `appModeRef`, `setAppMode` |

---

### 2. `App.tsx` → `useMultiplayerConnectionHostParams({ … })`

**Passes:** six slices as **separate whole-slice props** (not `tournamentAttachRuntime`):

- `socketRuntime`
- `roomRuntime`
- `reconnectRuntime`
- `joinFlightRuntime`
- `authRuntime`
- `navigationRuntime`

**`useMultiplayerConnectionHostParams`** forwards each slice whole into `UseMultiplayerConnectionParams` (lines 250–255).

**`useMultiplayerConnection`** flattens slices via object spread (`flattenMultiplayerConnectionParams`). Fields from E11 slices that are **read** in connection logic include:

| Source slice | Fields read in `useMultiplayerConnection.ts` |
|--------------|-----------------------------------------------|
| `socketRuntime` | `socketRef`, `connectRef` (implicit via spread) |
| `roomRuntime` | `joinedRoomRef`, `roomIdentityRef`, `stateRef` (also `youRef`, `maxSequenceRef` in flat type — carried for downstream handlers) |
| `reconnectRuntime` | `reconnectRoomCodeRef`, `reconnectShouldJoinRef`, `preventAutoRejoinRef`, `rejoinInFlightRef`, `intentionalDisconnectRef`, `reconnectAttemptTimerRef`, `reconnectAttemptCountRef` |
| `joinFlightRuntime` | all join-flight refs (spread into flat params for room join/create handlers) |
| `authRuntime` | `authUserRef`, `authProfileRef`, `authAccessTokenRef`, `multiplayerIdentityUserIdRef` |
| `navigationRuntime` | **`setAppMode` only** in flatten (not `appModeRef`) |

---

### 3. `App.tsx` → `useMultiplayerLobbyHostProps({ … })`

**Passes:** five slices (no `authRuntime`, no `tournamentAttachRuntime`):

- `socketRuntime` (whole)
- `roomRuntime` (whole)
- `joinFlightRuntime` (whole)
- `reconnectRuntime` (whole)
- `navigationRuntime` (whole)

**`useMultiplayerLobbyHostProps`** narrows when building lobby controller props:

| Incoming slice | Re-exported to `useMultiplayerLobbyController` |
|----------------|--------------------------------------------------|
| `socketRuntime` | whole `MultiplayerSocketRuntime` |
| `roomRuntime` | **Pick:** `joinedRoomRef`, `roomIdentityRef` only |
| `joinFlightRuntime` | whole |
| `reconnectRuntime` | **Pick:** `reconnectRoomCodeRef`, `reconnectShouldJoinRef`, `preventAutoRejoinRef` |
| `navigationRuntime` | whole |

**`useMultiplayerLobbyController` / `useMultiplayerRoomActions`** (via spread) use from narrowed props:

| Field | Usage |
|-------|--------|
| `socketRef` | create/join/reconnect socket ops |
| `connectRef` | lazy connect |
| `joinedRoomRef` | room code guards, join state |
| `roomIdentityRef` | join identity fallback |
| `joinFlightRuntime` refs | create/join/invite in-flight guards |
| `reconnectRuntime` picks | auto-rejoin / recovery coordination |
| `navigationRuntime.setAppMode` | mode switches after lobby actions |

---

## Whole-object vs field-picked — summary

| Consumer | Receives `UseAppSessionRuntimeResult` whole? | Receives slice whole? | Picks specific fields? |
|----------|---------------------------------------------|----------------------|-------------------------|
| `App.tsx` | No — destructures 7 slices at callsite | — | — |
| `useTournamentMatchSession` | No | **Yes** — `tournamentAttachRuntime` as `attachRuntime` | Yes — then picks fields per nested slice |
| `useMultiplayerConnectionHostParams` | No | **Yes** — 6 slices passed whole | No at host boundary; flatten spreads all slice fields |
| `useMultiplayerLobbyHostProps` | No | Partial — 5 slices | **Yes** — narrows `roomRuntime` and `reconnectRuntime` before lobby controller |

**Risk note for E11 narrowing:** `useMultiplayerConnection` depends on **full** `roomRuntime` and `authRuntime` objects via spread. `useMultiplayerLobbyHostProps` already demonstrates safe narrowing for lobby-only fields. `tournamentAttachRuntime` is a pre-composed bundle — narrowing it requires updating `TournamentAttachRuntime` type and `useTournamentMatchSession` together.

---

## Overlap with E4 / E7 / E8

| Prior fix | Overlap with `useAppSessionRuntime`? | Detail |
|-----------|--------------------------------------|--------|
| **E4** (`resetMultiplayerRoomState` split) | **Partial — ref only** | `UseAppSessionRuntimeSource.resetMultiplayerRoomStateRef` is wired into `tournamentAttachRuntime.recoveryRuntime`. The hook exposes the **ref** to the E4 composer function; it does not import or wrap `resetRoomIdentityState` / `resetGameShellState` / `resetTournamentAttachState`. `useTournamentMatchSession` calls `resetMultiplayerRoomStateRef.current(...)` in several tournament exit paths. |
| **E7** (`matchmakingRoomJoin.ts`) | **No** | No symbols from `matchmakingRoomJoin.ts` in `useAppSessionRuntime` or its slice types. Matchmaking auto-join uses `socketRef` / `joinedRoomRef` directly in `App.tsx`, not via session runtime slices. |
| **E8** (`postGameExit.ts`) | **No direct** | No symbols from `postGameExit.ts` in the hook. Related refs (`clearRecoverableRoomStateRef`, `resetMultiplayerRoomStateRef`) are bundled for tournament attach recovery; E8's `handlePostGame` / `abandonCurrentMatch` call those **functions** directly in App, not through runtime slices. |

**Direct answer:** E11 shares **ref exposure** with E4/E8 cleanup surfaces (`resetMultiplayerRoomStateRef`, `clearRecoverableRoomStateRef`) but does **not** expose or wrap E7 or E8 named transport/orchestration functions.

---

## E11 resolution sizing notes (for next task)

- **Widest surface:** `useMultiplayerConnection` flat spread — touches nearly every ref in socket/join/reconnect/auth/room slices.
- **Pre-narrowed precedent:** `useMultiplayerLobbyHostProps` already passes `Pick<>` subsets for room + reconnect.
- **Whole-bundle consumer:** `useTournamentMatchSession` takes `TournamentAttachRuntime` intact — smallest slice count (1 prop) but crosses auth/socket/room/recovery/navigation concerns.
- **Not in runtime:** gameplay refs (`draggingStateRef`, etc.), recovery callbacks (`applyJoinedRoomResponse` fn), and `roomSocialRuntime` — App wires those separately to connection host params.