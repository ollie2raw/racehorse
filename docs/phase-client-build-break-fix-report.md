# Phase Client Build Break Fix Report

This document reports the investigation and resolution of the three clusters of client typecheck and build failures blocking the `npm run build` step.

---

## 1. Investigation Findings

### Cluster 1: `App.tsx` - `spectateRoom` missing from `MultiplayerConnectionActionsBridge`

* **Findings**: We investigated whether the missing `spectateRoom` property was a case of (a) an over-narrow type interface or (b) a method that does not exist at runtime on the connection controller.
* **Evidence**:
  The connection actions controller is instantiated as follows:
  ```typescript
  const connectionActions = useMultiplayerConnectionActionsBridge(connectRef);
  ```
  The type `MultiplayerConnectionActionsBridge` is defined in `client/src/multiplayer/useMultiplayerConnectionContext.ts`:
  ```typescript
  export type MultiplayerConnectionActions = {
    connect: () => void;
    disconnect: (reason?: string) => void;
    retryRoomRecovery: () => void;
  };

  export type MultiplayerConnectionActionsBridge = MultiplayerConnectionActions & {
    disconnectRef: MutableRefObject<(reason?: string) => void>;
    retryRoomRecoveryRef: MutableRefObject<() => void>;
  };
  ```
  The implementation at runtime only exposes connection-level controls (`connect`, `disconnect`, and `retryRoomRecovery`) and has never implemented `spectateRoom`.
* **Conclusion**: This is **Case (b)**. The spectating function was historically designed to belong to the *lobby* actions controller (`useMultiplayerLobbyController` / `useMultiplayerRoomActions`), not the connection controller. 
* **Resolution**: Instead of incorrectly drilling `onSpectate` from `App.tsx` via the `social` routes bundle, we solved this cleanly by using a bridge component `PublicProfileScreenLobbyBridge.tsx` similar to `FriendsScreenLobbyBridge.tsx`. The bridge extracts the correct `spectateRoom` action directly from `useMultiplayerLobbyActionsContext()` and passes it to the lazily-loaded `PublicProfileScreen`. All drilled props in `App.tsx`, `AppRoutes.tsx`, `useAppRoutesProps.tsx`, and `appRouteTypes.ts` have been cleanly reverted, resolving the compiler error.

---

### Cluster 2: `FriendsScreen.tsx` - Presence Status Shape Mismatch

* **Findings**: The type of `presenceMap` was changed from `Map<string, PresenceStatus>` to `Map<string, { status: PresenceStatus; roomCode: string | null }>` to track and store the room code of active game sessions.
* **Purpose of `roomCode`**: `roomCode` stores the active room session code when a player's presence status is `in_game`. This allows the UI to render a "Spectate" button that calls `onSpectate(roomCode)`.
* **Resolution**:
  - `handlePresenceUpdate` was corrected to store the presence object `{ status, roomCode }` instead of trying to write a plain string, preserving the existing `roomCode` when real-time updates are received.
  - The preview pane presence status accessor `displayPresenceMap.get(selectedFriend.userId)` was updated to read the `.status` property (defaulting to `'offline'`) to avoid comparing the status object to a plain string. 
  - The original three-way color/label logic (`online` / `in_game` / `offline`) was fully preserved.

---

### Cluster 3: `PublicProfileScreenLobbyBridge.tsx` - Unused React Import

* **Findings**: Since the file utilizes the modern React 17+ JSX transform, the default `import React` statement was unused and generated lint/compile errors.
* **Resolution**: The default import was dropped, changing `import React, { ComponentProps } from 'react';` to `import type { ComponentProps } from 'react';`.

---

## 2. Before/After Source Code Comparison

### File 1: `client/src/App.tsx`
**Before (Cluster 1 break)**:
```typescript
      social: {
        socket,
        joinedRoom,
        showToast,
        outboundChallenge,
        clearOutboundChallenge,
        profileTarget,
        setProfileTarget,
        toast,
        onSpectate: connectionActions.spectateRoom,
      },
```
**After (Fixed)**:
```typescript
      social: {
        socket,
        joinedRoom,
        showToast,
        outboundChallenge,
        clearOutboundChallenge,
        profileTarget,
        setProfileTarget,
        toast,
      },
```

### File 2: `client/src/friends/FriendsScreen.tsx`
**Before (Cluster 2 break)**:
```typescript
    const handlePresenceUpdate = (userId: string, status: string) => {
      setPresenceMap((prev) => {
        const next = new Map(prev);
        const presenceStatus: PresenceStatus = status === 'online' || status === 'in_game' ? status : 'offline';
        if (next.get(userId) !== presenceStatus) {
          next.set(userId, presenceStatus);
        }
        return presenceMapsEqual(prev, next) ? prev : next;
      });
    };
...
                  {(() => {
                    const s = displayPresenceMap.get(selectedFriend.userId) ?? 'offline';
                    const color = s === 'online' ? 'var(--tier-rookie)' : s === 'in_game' ? 'var(--tier-elite)' : 'var(--text-dim)';
                    const label = s === 'online' ? 'Online' : s === 'in_game' ? 'In Game' : 'Offline';
```
**After (Fixed)**:
```typescript
    const handlePresenceUpdate = (userId: string, status: string) => {
      setPresenceMap((prev) => {
        const next = new Map(prev);
        const presenceStatus: PresenceStatus = status === 'online' || status === 'in_game' ? status : 'offline';
        const current = next.get(userId);
        if (!current || current.status !== presenceStatus) {
          next.set(userId, { status: presenceStatus, roomCode: current?.roomCode ?? null });
        }
        return presenceMapsEqual(prev, next) ? prev : next;
      });
    };
...
                  {(() => {
                    const s = displayPresenceMap.get(selectedFriend.userId)?.status ?? 'offline';
                    const color = s === 'online' ? 'var(--tier-rookie)' : s === 'in_game' ? 'var(--tier-elite)' : 'var(--text-dim)';
                    const label = s === 'online' ? 'Online' : s === 'in_game' ? 'In Game' : 'Offline';
```

### File 3: `client/src/multiplayer/PublicProfileScreenLobbyBridge.tsx`
**Before (Cluster 3 break)**:
```typescript
import React, { ComponentProps } from 'react';
import PublicProfileScreen from '../social/PublicProfileScreen';
import { useMultiplayerLobbyActionsContext } from './useMultiplayerLobbyController';

type PublicProfileScreenLobbyBridgeProps = Omit<
  ComponentProps<typeof PublicProfileScreen>,
  'onSpectate'
>;

export default function PublicProfileScreenLobbyBridge(props: PublicProfileScreenLobbyBridgeProps) {
  const { spectateRoom } = useMultiplayerLobbyActionsContext();
  return (
    <PublicProfileScreen
      {...props}
      onSpectate={spectateRoom}
    />
  );
}
```
**After (Fixed)**:
```typescript
import type { ComponentProps } from 'react';
import PublicProfileScreen from '../social/PublicProfileScreen';
import { useMultiplayerLobbyActionsContext } from './useMultiplayerLobbyController';

type PublicProfileScreenLobbyBridgeProps = Omit<
  ComponentProps<typeof PublicProfileScreen>,
  'onSpectate'
>;

export default function PublicProfileScreenLobbyBridge(props: PublicProfileScreenLobbyBridgeProps) {
  const { spectateRoom } = useMultiplayerLobbyActionsContext();
  return (
    <PublicProfileScreen
      {...props}
      onSpectate={spectateRoom}
    />
  );
}
```

---

## 3. Command Execution Verification

After applying all fixes, we ran the required verification checks:

1. **TypeScript Compilation (Typecheck)**:
   ```bash
   npm run typecheck --prefix client
   ```
   *Result*: **Passed** (Clean output with 0 errors).

2. **Unit Tests (Vitest)**:
   ```bash
   npm run test --prefix client
   ```
   *Result*: **Passed** (All 571 tests passed successfully).

3. **Vite Production Build**:
   ```bash
   npm run build --prefix client
   ```
   *Result*: **Passed** (Bundle minified and chunk assets successfully built).

4. **Bundle Size Checks**:
   ```bash
   npm run size-check --prefix client
   ```
   *Result*: **Passed** (All chunk size limits satisfied).
