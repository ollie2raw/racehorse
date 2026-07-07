# Phase: App.tsx ENTANGLEMENT E11 — Runtime-Slice Type Narrowing

## Goal

Resolve **ENTANGLEMENT E11** (`auth + socket + room`) by narrowing the **type surface** at runtime-slice boundaries where `App.tsx` forwards session slices into multiplayer connection and tournament attach consumers. **Zero runtime behavior change** — types and documentation only.

## Summary

| Item | Result |
|------|--------|
| Entanglement resolved | **E11** — comment removed from `App.tsx` |
| Behavior change | **None** — `flattenMultiplayerConnectionParams` spread logic unchanged |
| New narrowed types | 5 aliases in `multiplayerRuntime.ts` |
| Boundary types updated | `UseMultiplayerConnectionParams`, `UseMultiplayerConnectionHostParamsSource`, `FlatMultiplayerConnectionParams`, `TournamentAttachRuntime` |
| `useAppSessionRuntime` return shape | **Unchanged** (out of scope) |
| `useMultiplayerConnection` internals | **Unchanged** flatten/spread (out of scope) |

---

## Type definitions — before / after (full source)

### 1. `multiplayerRuntime.ts` — new connection-boundary aliases (after only; did not exist before)

**Before:** No `MultiplayerConnection*` or `TournamentAttachNavigationRuntime` aliases.

**After:**

```typescript
/** Room refs read by useMultiplayerConnection after slice flatten. */
export type MultiplayerConnectionRoomRuntime = Pick<
  MultiplayerRoomRuntime,
  'joinedRoomRef' | 'roomIdentityRef' | 'stateRef' | 'youRef'
>;

/** Reconnect refs read by useMultiplayerConnection after slice flatten. */
export type MultiplayerConnectionReconnectRuntime = Pick<
  MultiplayerReconnectRuntime,
  | 'reconnectRoomCodeRef'
  | 'reconnectShouldJoinRef'
  | 'preventAutoRejoinRef'
  | 'reconnectAttemptTimerRef'
  | 'reconnectAttemptCountRef'
  | 'intentionalDisconnectRef'
  | 'rejoinInFlightRef'
>;

/** Join-flight refs read by useMultiplayerConnection after slice flatten. */
export type MultiplayerConnectionJoinFlightRuntime = Pick<
  MultiplayerJoinFlightRuntime,
  'pendingCreateOnConnectRef' | 'autoJoinAttemptedRef' | 'autoConnectAttemptedRef'
>;

/** Navigation surface read by useMultiplayerConnection (flatten uses setAppMode only). */
export type MultiplayerConnectionNavigationRuntime = Pick<MultiplayerNavigationRuntime, 'setAppMode'>;

/** Navigation refs read by useTournamentMatchSession attach paths. */
export type TournamentAttachNavigationRuntime = Pick<
  MultiplayerNavigationRuntime,
  'appModeRef' | 'setAppMode'
>;
```

### 2. `multiplayerRuntime.ts` — `TournamentAttachRuntime`

**Before:**

```typescript
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

**After:**

```typescript
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
  navigationRuntime: TournamentAttachNavigationRuntime;
};
```

### 3. `useMultiplayerConnection.ts` — `UseMultiplayerConnectionParams`

**Before:**

```typescript
export type UseMultiplayerConnectionParams = {
  config: MultiplayerConnectionConfig;
  connectionState: MultiplayerConnectionState;
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: MultiplayerRoomRuntime;
  reconnectRuntime: MultiplayerReconnectRuntime;
  joinFlightRuntime: MultiplayerJoinFlightRuntime;
  authRuntime: MultiplayerAuthRuntime;
  navigationRuntime: MultiplayerNavigationRuntime;
  gameplayRefsRuntime: MultiplayerGameplayRefsRuntime & {
    isMutedRef: MutableRefObject<boolean>;
    rematchAwaitingStateRef: MutableRefObject<boolean>;
  };
  recoveryRuntime: MultiplayerRecoveryCallbacksRuntime;
  roomSocialRuntime: MultiplayerRoomSocialRuntime;
  uiSetters: MultiplayerConnectionUiSetters;
  recoveryDispatchRef?: MutableRefObject<(event: RecoveryEvent) => RecoveryMachineSnapshot | null>;
};
```

**After:**

```typescript
export type UseMultiplayerConnectionParams = {
  config: MultiplayerConnectionConfig;
  connectionState: MultiplayerConnectionState;
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: MultiplayerConnectionRoomRuntime;
  reconnectRuntime: MultiplayerConnectionReconnectRuntime;
  joinFlightRuntime: MultiplayerConnectionJoinFlightRuntime;
  authRuntime: MultiplayerAuthRuntime;
  navigationRuntime: MultiplayerConnectionNavigationRuntime;
  gameplayRefsRuntime: MultiplayerGameplayRefsRuntime & {
    isMutedRef: MutableRefObject<boolean>;
    rematchAwaitingStateRef: MutableRefObject<boolean>;
  };
  recoveryRuntime: MultiplayerRecoveryCallbacksRuntime;
  roomSocialRuntime: MultiplayerRoomSocialRuntime;
  uiSetters: MultiplayerConnectionUiSetters;
  recoveryDispatchRef?: MutableRefObject<(event: RecoveryEvent) => RecoveryMachineSnapshot | null>;
};
```

(`socketRuntime` and `authRuntime` unchanged — already minimal.)

### 4. `useMultiplayerConnection.ts` — `FlatMultiplayerConnectionParams` (removed fields only)

**Before** included these fields **removed** in after:

```typescript
  joinInFlightRef: MutableRefObject<boolean>;
  createInFlightRef: MutableRefObject<boolean>;
  inviteJoinInFlightRef: MutableRefObject<boolean>;
  maxSequenceRef: MutableRefObject<number>;
```

**After:** those four fields are absent; all other `FlatMultiplayerConnectionParams` fields unchanged. Flatten implementation unchanged:

```typescript
function flattenMultiplayerConnectionParams(
  params: UseMultiplayerConnectionParams,
): FlatMultiplayerConnectionParams {
  return {
    ...params.config,
    ...params.connectionState,
    ...params.socketRuntime,
    ...params.roomRuntime,
    ...params.reconnectRuntime,
    ...params.joinFlightRuntime,
    ...params.authRuntime,
    ...params.gameplayRefsRuntime,
    ...params.recoveryRuntime,
    ...params.roomSocialRuntime,
    ...params.uiSetters,
    setAppMode: params.navigationRuntime.setAppMode,
  };
}
```

### 5. `useMultiplayerConnectionHostParams.ts` — `UseMultiplayerConnectionHostParamsSource` slice fields

**Before:**

```typescript
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: MultiplayerRoomRuntime;
  reconnectRuntime: MultiplayerReconnectRuntime;
  joinFlightRuntime: MultiplayerJoinFlightRuntime;
  authRuntime: MultiplayerAuthRuntime;
  navigationRuntime: MultiplayerNavigationRuntime;
```

**After:**

```typescript
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: MultiplayerConnectionRoomRuntime;
  reconnectRuntime: MultiplayerConnectionReconnectRuntime;
  joinFlightRuntime: MultiplayerConnectionJoinFlightRuntime;
  authRuntime: MultiplayerAuthRuntime;
  navigationRuntime: MultiplayerConnectionNavigationRuntime;
```

### 6. `App.tsx` — E11 comment

**Before:**

```typescript
  // ENTANGLEMENT E11 [auth + socket + room]
  // useAppSessionRuntime bundles auth, socket, and room refs into one runtime object for useMultiplayerConnection.
  // Splitting refs across hooks without updating multiplayerRuntime types breaks the connection host wiring.
  // Resolution path: narrow runtime slices per concern once socket and room layers are fully decoupled. Phase 3 candidate.
  const {
```

**After:** comment block removed; destructuring of `useAppSessionRuntime()` unchanged.

---

## Fields removed from whole-slice pass-through — verification

Each field below was removed from the **connection** boundary type. Verification is against `useMultiplayerConnection.ts`, `registerMultiplayerConnectionSocketHandlers.ts`, and `recoveryConnectionBridge.ts` (via `syncRecoveryLegacyRefs`).

### `roomRuntime` — removed from connection boundary

| Field | Unused confirmation |
|-------|---------------------|
| `joinedRoomResponseRef` | `rg 'joinedRoomResponseRef' client/src/multiplayer/useMultiplayerConnection.ts client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts` → **0 matches**. Used only in lobby/join-ack paths (`joinAckCoordinator.ts`), not connection flatten consumer. |
| `maxSequenceRef` | `rg 'maxSequenceRef' client/src/multiplayer/useMultiplayerConnection.ts client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts` → **0 matches**. Sequence tracking lives in `useRoomSocketSync.ts` (frozen / out of scope). |
| `roomPlayersRef` | `rg 'roomPlayersRef' client/src/multiplayer/useMultiplayerConnection.ts client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts` → **0 matches**. |

### `roomRuntime` — retained (used)

| Field | Used at |
|-------|---------|
| `joinedRoomRef` | `useMultiplayerConnection.ts:341`, `:371`, `:459`, `:481`, `:491`; `registerMultiplayerConnectionSocketHandlers.ts:135`, `:275` |
| `roomIdentityRef` | `useMultiplayerConnection.ts:218` |
| `stateRef` | `useMultiplayerConnection.ts:483`, `:492`; `registerMultiplayerConnectionSocketHandlers.ts:203` |
| `youRef` | `registerMultiplayerConnectionSocketHandlers.ts:204`, `:240`, `:265` |

### `joinFlightRuntime` — removed from connection boundary

| Field | Unused confirmation |
|-------|---------------------|
| `joinInFlightRef` | `rg 'joinInFlightRef' client/src/multiplayer/useMultiplayerConnection.ts client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts` → **0 matches** (only `rejoinInFlightRef` used). Lobby guards: `useMultiplayerRoomActions.ts` (out of scope). |
| `createInFlightRef` | Same grep → **0 matches** in connection consumer. |
| `inviteJoinInFlightRef` | Same grep → **0 matches** in connection consumer. |
| `pendingCreateResolversRef` | `rg 'pendingCreateResolversRef' client/src/multiplayer/useMultiplayerConnection.ts client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts` → **0 matches**. |

### `joinFlightRuntime` — retained (used)

| Field | Used at |
|-------|---------|
| `pendingCreateOnConnectRef` | `registerMultiplayerConnectionSocketHandlers.ts:108-109` |
| `autoJoinAttemptedRef` | `useMultiplayerConnection.ts:337`, `:342`, `:488` |
| `autoConnectAttemptedRef` | `useMultiplayerConnection.ts:526`, `:536`, `:539` |

### `navigationRuntime` — removed from connection boundary

| Field | Unused confirmation |
|-------|---------------------|
| `appModeRef` | Connection reads `appMode` from `connectionState`, not `appModeRef`. Flatten assigns only `setAppMode` (`useMultiplayerConnection.ts:163`). `rg 'appModeRef' client/src/multiplayer/useMultiplayerConnection.ts` → **0 matches**. |

### `navigationRuntime` — retained for connection

| Field | Used at |
|-------|---------|
| `setAppMode` | `useMultiplayerConnection.ts:163` (flatten), `:251`, `:489`, `:525`; handlers via flat params |

### `reconnectRuntime` — all fields retained

All seven fields in `MultiplayerConnectionReconnectRuntime` are read: `syncRecoveryLegacyRefs` (`useMultiplayerConnection.ts:187-191`), `preventAutoRejoinRef` (`:337`), `reconnectAttemptTimerRef` (`:303`), `intentionalDisconnectRef` (multiple), `reconnectAttemptCountRef` (`:227`), etc.

### `authRuntime` — all fields retained

`authUserRef`, `authProfileRef`, `authAccessTokenRef`, `multiplayerIdentityUserIdRef` used in `useMultiplayerConnection.ts:218-221`, `:345-347`, `:588-599` and `registerMultiplayerConnectionSocketHandlers.ts:83-95`.

### `socketRuntime` — all fields retained

`socketRef` and `connectRef` used throughout connection (`useMultiplayerConnection.ts:212`, `:530`, etc.).

### `TournamentAttachRuntime.navigationRuntime` — narrowed to `TournamentAttachNavigationRuntime`

Both fields confirmed in `useTournamentMatchSession.ts`:

| Field | Used at |
|-------|---------|
| `appModeRef` | `:343`, `:367`, `:478`, `:504`, `:595`, `:689`, `:735`, `:759` |
| `setAppMode` | destructured `:166`; used in exit/navigate callbacks throughout file |

Other `TournamentAttachRuntime` nested slices were already `Pick<>` before this pass; no field changes there.

---

## Discrepancies vs. sizing recon (`docs/phase-app-e11-sizing-recon-report.md`)

| Recon claim | Verified result | Action taken |
|-------------|-----------------|--------------|
| `roomRuntime` includes `maxSequenceRef` for connection handlers | **Incorrect** — zero reads in connection path | Removed from `MultiplayerConnectionRoomRuntime` and `FlatMultiplayerConnectionParams` |
| `joinFlightRuntime` — "all join-flight refs spread for room join/create handlers" | **Overstated** — only `pendingCreateOnConnectRef`, `autoJoinAttemptedRef`, `autoConnectAttemptedRef` read in connection consumer | Narrowed `MultiplayerConnectionJoinFlightRuntime` to those three |
| `navigationRuntime` — `setAppMode` only for connection | **Correct** | `MultiplayerConnectionNavigationRuntime = Pick<..., 'setAppMode'>` |
| `roomRuntime` — `youRef` carried for downstream handlers | **Correct** | Retained in `MultiplayerConnectionRoomRuntime` |
| Tournament `navigationRuntime` uses `appModeRef` + `setAppMode` | **Correct** | `TournamentAttachNavigationRuntime` documents both; type was `MultiplayerNavigationRuntime` (wider than necessary) |

---

## Typecheck / test / build results

### Before (pre-change baseline, this session)

```text
$ cd client && npx tsc --noEmit -p tsconfig.app.json
(exit 0, no errors)

$ cd client && npm run test
 Test Files  47 passed (47)
      Tests  427 passed (427)

$ npm run build --prefix client
✓ built in 5.20s
```

### After (post-change)

```text
$ cd client && npx tsc --noEmit -p tsconfig.app.json
(exit 0, no errors)

$ cd client && npm run test
 Test Files  47 passed (47)
      Tests  427 passed (427)

$ cd client && node run-behavior-tests.mjs
[run-behavior-tests] 31 files passed

$ npm run build --prefix client
✓ built in 5.17s
```

---

## What remains unresolved (next phase sizing)

| Item | Why deferred |
|------|--------------|
| `useAppSessionRuntime` still returns full `MultiplayerRoomRuntime`, `MultiplayerJoinFlightRuntime`, etc. | Explicitly out of scope — return shape frozen for this pass |
| `App.tsx` still passes full slice objects from `useAppSessionRuntime` | Structural typing: wider runtime objects satisfy narrowed boundary types; no runtime pick at callsite |
| `useMultiplayerLobbyHostProps` source still types whole slices on input | Out of scope — already narrows on output; reference precedent only |
| Physical decoupling of auth/socket/room refs into separate hooks | Requires runtime wiring changes beyond type narrowing |
| `FlatMultiplayerConnectionParams` still a large flat god-type | Flatten spread pattern frozen; further decomposition is a separate sizing task |

**Blocked items:** None. Narrowing completed without requiring changes to `useMultiplayerConnection` flatten/spread **logic**.

---

## Frozen / out-of-scope confirmation

**ENTANGLEMENT markers in `App.tsx` after this pass:** E7, E8 resolved in prior phases; **E11 resolved**; no new markers added.

| Path / system | Touched? |
|---------------|----------|
| `client/src/useAppSessionRuntime.ts` (return shape / 7 slices) | **No** |
| `useMultiplayerConnection` flatten/spread **logic** | **No** |
| `useMultiplayerLobbyHostProps` | **No** |
| E4/E7/E8 files (`resetMultiplayerRoomState` split, `matchmakingRoomJoin.ts`, `postGameExit.ts`) | **No** |
| `client/src/multiplayer/recoveryMachine.ts` | **No** |
| `client/src/multiplayer/socketEventBus.ts` | **No** |
| Projection-gate functions in `client/src/multiplayer/useRoomSocketSync.ts` | **No** |
| `client/src/modules/**` | **No** |
| `client/src/bot/**` | **No** |
| `client/src/match/session/**` (incl. `useTournamentMatchSession.ts` — types only via import) | **No** |
| `server/src/**` | **No** |

**Files changed by this task:**

| Path | Change |
|------|--------|
| `client/src/multiplayer/multiplayerRuntime.ts` | Added 5 narrowed aliases; `TournamentAttachRuntime.navigationRuntime` → `TournamentAttachNavigationRuntime` |
| `client/src/multiplayer/useMultiplayerConnection.ts` | `UseMultiplayerConnectionParams` + `FlatMultiplayerConnectionParams` narrowed |
| `client/src/multiplayer/useMultiplayerConnectionHostParams.ts` | `UseMultiplayerConnectionHostParamsSource` slice types narrowed |
| `client/src/App.tsx` | E11 comment removed |
| `docs/phase-app-e11-typescope-report.md` | **New** (this file) |