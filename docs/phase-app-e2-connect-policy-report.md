# Phase: App.tsx ENTANGLEMENT E2 — Connect Policy Extraction

## Goal

Resolve **ENTANGLEMENT E2** (`socket + auth + navigation`) in `client/src/App.tsx` by extracting the feed-mode lazy-connect decision into a named, testable pure function. The connect **trigger site** stays in `App.tsx`; only the policy condition moves out.

**Report file choice:** New file `docs/phase-app-e2-connect-policy-report.md` — no existing entanglement-resolution report in `docs/`; this follows the one-marker-per-report audit trail pattern used elsewhere in the repo.

## Summary

| Item | Result |
|------|--------|
| Entanglement resolved | **E2** — comment removed, policy named |
| Behavior change | **None** — same conditions fire `connectRef.current()` |
| New module | `client/src/multiplayer/connectPolicy.ts` |
| New tests | `client/src/multiplayer/connectPolicy.test.ts` (4 cases) |

## App.tsx effect — before / after

### Before (committed baseline)

```typescript
  // ENTANGLEMENT E2 [socket + auth + navigation]
  // Feed mode triggers connectRef when authUser is present but socket is not yet connected.
  // Moving connect trigger to socket-only hook ignores feed's auth-gated lazy connect and leaves feed stale offline.
  // Resolution path: explicit connect policy table keyed by appMode + auth readiness. Phase 3 candidate.
  useEffect(() => {
    if (appMode !== 'feed' || !authUser) return;
    if (!socket?.connected) connectRef.current();
  }, [appMode, authUser, socket?.connected]);
```

### After

```typescript
  // Feed lazy-connect policy: see shouldAutoConnectForMode in multiplayer/connectPolicy.ts
  useEffect(() => {
    if (
      !shouldAutoConnectForMode({
        appMode,
        hasAuthUser: Boolean(authUser),
        isSocketConnected: Boolean(socket?.connected),
      })
    ) {
      return;
    }
    connectRef.current();
  }, [appMode, authUser, socket?.connected]);
```

### Import added (App.tsx)

```typescript
import { shouldAutoConnectForMode } from './multiplayer/connectPolicy';
```

## Full source — `client/src/multiplayer/connectPolicy.ts`

```typescript
import type { AppMode } from '../appRouteTypes';

export type ConnectPolicyParams = {
  appMode: AppMode;
  hasAuthUser: boolean;
  isSocketConnected: boolean;
};

/**
 * Feed mode lazily connects the socket once auth is ready.
 * Other modes manage connect elsewhere; do not auto-connect here.
 */
export function shouldAutoConnectForMode(params: ConnectPolicyParams): boolean {
  const { appMode, hasAuthUser, isSocketConnected } = params;
  return appMode === 'feed' && hasAuthUser && !isSocketConnected;
}
```

## Full source — `client/src/multiplayer/connectPolicy.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { shouldAutoConnectForMode } from './connectPolicy';

describe('shouldAutoConnectForMode', () => {
  it('connects in feed mode when authed and socket is disconnected', () => {
    expect(
      shouldAutoConnectForMode({
        appMode: 'feed',
        hasAuthUser: true,
        isSocketConnected: false,
      }),
    ).toBe(true);
  });

  it('does not connect in feed mode when authed and socket is already connected', () => {
    expect(
      shouldAutoConnectForMode({
        appMode: 'feed',
        hasAuthUser: true,
        isSocketConnected: true,
      }),
    ).toBe(false);
  });

  it('does not connect in feed mode when there is no auth user', () => {
    expect(
      shouldAutoConnectForMode({
        appMode: 'feed',
        hasAuthUser: false,
        isSocketConnected: false,
      }),
    ).toBe(false);
  });

  it('does not connect in non-feed mode even when authed and disconnected', () => {
    expect(
      shouldAutoConnectForMode({
        appMode: 'multiplayer',
        hasAuthUser: true,
        isSocketConnected: false,
      }),
    ).toBe(false);
  });
});
```

## Test / build results

### Before (pre-change baseline)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **402** passed, **42** test files |
| `cd client && node run-behavior-tests.mjs` | **31** files passed |
| `npm run build --prefix client` | ✓ built |

### After (this change)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **406** passed (+4), **43** test files (+1) |
| `cd client && node run-behavior-tests.mjs` | **31** files passed (unchanged) |
| `npm run build --prefix client` | ✓ built |

## Frozen / out-of-scope confirmation

**Untouched ENTANGLEMENT markers in `App.tsx`:** E3, E4, E7, E8, E9, E11 (6 remain).

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
| `client/src/App.tsx` | E2 resolved; import + effect uses `shouldAutoConnectForMode` |
| `client/src/multiplayer/connectPolicy.ts` | **New** |
| `client/src/multiplayer/connectPolicy.test.ts` | **New** |
| `docs/phase-app-e2-connect-policy-report.md` | **New** (this file) |