# Phase: App.tsx ENTANGLEMENT E9 — Private Lobby Visibility Predicate

## Goal

Resolve **ENTANGLEMENT E9** (`auth + socket + room + game`) by extracting the multi-domain `showPrivateMatchLobby` boolean assembly into a named, pure, testable predicate. The stats-fetch effect stays in `App.tsx`; only the visibility decision moves out.

## Summary

| Item | Result |
|------|--------|
| Entanglement resolved | **E9** — comment removed, predicate named |
| Behavior change | **None** — same conditions fetch/clear `privateLobbyHostWinStreak` |
| New module | `client/src/multiplayer/privateLobbyVisibility.ts` |
| New tests | `client/src/multiplayer/privateLobbyVisibility.test.ts` (5 cases) |

## App.tsx effect — before / after

### Before

```typescript
  // ENTANGLEMENT E9 [auth + socket + room + game]
  // Private lobby win streak fetch requires authUser, connection/recovery flags, joinedRoom, and hasLiveGameState together.
  // Extracting to auth-only or room-only hook fetches stats during live matches or skips them in the lobby idle state.
  // Resolution path: derive lobby visibility predicate in one selector; stats effect depends on that only. Phase 3 candidate.
  useEffect(() => {
    if (appMode !== 'multiplayer' || !authUser?.id) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    const showPrivateMatchLobby =
      (!isConnected && !isRecoveringConnection) ||
      (isConnected && !joinedRoom) ||
      (isConnected && Boolean(joinedRoom) && !hasLiveGameState);
    if (!showPrivateMatchLobby) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    let cancelled = false;
    void import('./stats/statsApi')
      .then(({ fetchUserStatsByUserId }) => fetchUserStatsByUserId(authUser.id))
      .then((res) => {
        if (cancelled) return;
        if (res.error || !res.data) {
          setPrivateLobbyHostWinStreak(null);
          return;
        }
        setPrivateLobbyHostWinStreak(res.data.currentWinStreak);
      });
    return () => {
      cancelled = true;
    };
  }, [appMode, authUser?.id, isConnected, isRecoveringConnection, joinedRoom, hasLiveGameState]);
```

### After

```typescript
  // Private lobby visibility: see shouldShowPrivateMatchLobby in multiplayer/privateLobbyVisibility.ts
  useEffect(() => {
    if (appMode !== 'multiplayer' || !authUser?.id) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    if (
      !shouldShowPrivateMatchLobby({
        isConnected,
        isRecoveringConnection,
        joinedRoom,
        hasLiveGameState,
      })
    ) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    let cancelled = false;
    void import('./stats/statsApi')
      .then(({ fetchUserStatsByUserId }) => fetchUserStatsByUserId(authUser.id))
      .then((res) => {
        if (cancelled) return;
        if (res.error || !res.data) {
          setPrivateLobbyHostWinStreak(null);
          return;
        }
        setPrivateLobbyHostWinStreak(res.data.currentWinStreak);
      });
    return () => {
      cancelled = true;
    };
  }, [appMode, authUser?.id, isConnected, isRecoveringConnection, joinedRoom, hasLiveGameState]);
```

### Import added (App.tsx)

```typescript
import { shouldShowPrivateMatchLobby } from './multiplayer/privateLobbyVisibility';
```

## Full source — `client/src/multiplayer/privateLobbyVisibility.ts`

```typescript
export type PrivateMatchLobbyVisibilityParams = {
  isConnected: boolean;
  isRecoveringConnection: boolean;
  joinedRoom: string | null;
  hasLiveGameState: boolean;
};

/**
 * Whether the private-match lobby is visible enough to fetch host win-streak stats.
 * Requires connection, room, and live-game signals together — not any single domain alone.
 */
export function shouldShowPrivateMatchLobby(params: PrivateMatchLobbyVisibilityParams): boolean {
  const { isConnected, isRecoveringConnection, joinedRoom, hasLiveGameState } = params;
  return (
    (!isConnected && !isRecoveringConnection) ||
    (isConnected && !joinedRoom) ||
    (isConnected && Boolean(joinedRoom) && !hasLiveGameState)
  );
}
```

## Full source — `client/src/multiplayer/privateLobbyVisibility.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { shouldShowPrivateMatchLobby } from './privateLobbyVisibility';

describe('shouldShowPrivateMatchLobby', () => {
  it('shows lobby when disconnected and not recovering', () => {
    expect(
      shouldShowPrivateMatchLobby({
        isConnected: false,
        isRecoveringConnection: false,
        joinedRoom: 'ROOM1',
        hasLiveGameState: true,
      }),
    ).toBe(true);
  });

  it('shows lobby when connected with no joined room', () => {
    expect(
      shouldShowPrivateMatchLobby({
        isConnected: true,
        isRecoveringConnection: false,
        joinedRoom: null,
        hasLiveGameState: false,
      }),
    ).toBe(true);
  });

  it('shows lobby when connected in a room without live game state', () => {
    expect(
      shouldShowPrivateMatchLobby({
        isConnected: true,
        isRecoveringConnection: false,
        joinedRoom: 'ROOM1',
        hasLiveGameState: false,
      }),
    ).toBe(true);
  });

  it('hides lobby when connected in a room with live game state', () => {
    expect(
      shouldShowPrivateMatchLobby({
        isConnected: true,
        isRecoveringConnection: false,
        joinedRoom: 'ROOM1',
        hasLiveGameState: true,
      }),
    ).toBe(false);
  });

  it('hides lobby when disconnected but recovering connection', () => {
    expect(
      shouldShowPrivateMatchLobby({
        isConnected: false,
        isRecoveringConnection: true,
        joinedRoom: null,
        hasLiveGameState: false,
      }),
    ).toBe(false);
  });
});
```

## Test / build results

### Before (per E3/E4 reports / pre-change baseline)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **410** passed, **44** test files |
| `cd client && node run-behavior-tests.mjs` | **31** files passed |
| `npm run build --prefix client` | ✓ built |

### After (this change)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **415** passed (+5), **45** test files (+1) |
| `cd client && node run-behavior-tests.mjs` | **31** files passed (unchanged) |
| `npm run build --prefix client` | ✓ built |

## Frozen / out-of-scope confirmation

**Untouched ENTANGLEMENT markers in `App.tsx`:** E7, E8, E11 (3 remain; E2, E3, E4, E9 resolved).

**Untouched frozen systems (no edits in this task):**

| Path | Touched? |
|------|----------|
| `client/src/multiplayer/recoveryMachine.ts` | No |
| `client/src/multiplayer/socketEventBus.ts` | No |
| Projection-gate functions in `client/src/multiplayer/useRoomSocketSync.ts` | No |
| `client/src/modules/**` | No |
| `client/src/bot/**` | No |
| `client/src/match/session/**` | No |
| `server/src/**` | No |

**Files changed by this task only:**

| Path | Change |
|------|--------|
| `client/src/App.tsx` | E9 resolved; effect calls `shouldShowPrivateMatchLobby` |
| `client/src/multiplayer/privateLobbyVisibility.ts` | **New** |
| `client/src/multiplayer/privateLobbyVisibility.test.ts` | **New** |
| `docs/phase-app-e9-lobby-visibility-report.md` | **New** (this file) |