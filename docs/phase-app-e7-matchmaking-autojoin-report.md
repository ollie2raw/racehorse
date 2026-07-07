# Phase: App.tsx ENTANGLEMENT E7 — Matchmaking Auto-Join Split

## Goal

Resolve **ENTANGLEMENT E7** (`room + auth + navigation`) by splitting `handleMatchmakingAutoJoin` into a named join-transport layer and an App-level orchestrator. The public callback signature and single call site remain unchanged.

## Summary

| Item | Result |
|------|--------|
| Entanglement resolved | **E7** — comment removed; join/ack/navigation roles named |
| Behavior change | **None** — same guard timing, optimistic UI order, ack handling |
| New module | `client/src/multiplayer/matchmakingRoomJoin.ts` |
| New tests | `client/src/multiplayer/matchmakingRoomJoin.test.ts` (5 cases) |

## Ordering decision: optimistic navigation preserved

**Question:** Can `setOverlayPayload(payload)` and `setAppMode('multiplayer')` move after a successful `room:join` ack?

**Answer: No — preserved before emit.**

**Reasoning:**

1. `MatchmakingScreen` calls `onAutoJoinRoom` as soon as a match is ready so both players join **before the countdown ends** (`handleMatchReady` comment: *"Join the match room immediately so both players are seated before the countdown ends"*).
2. `setOverlayPayload` drives `MatchFoundOverlay` in `MultiplayerModeController` — the vs-screen countdown UX while the join runs.
3. `setAppMode('multiplayer')` mounts the multiplayer shell that hosts matchmaking + overlay.

Moving either call after ack would delay the overlay and mode switch by one network round-trip, changing perceived responsiveness. On failed ack, the original code also left overlay/mode already switched (toast only); that behavior is unchanged.

**What changed instead:** Join transport (`emitMatchmakingRoomJoin`) now returns a Promise with the ack; ack side effects (`handleMatchmakingRoomJoinAck`) are named and testable; App explicitly documents that it owns **optimistic navigation** while the join module owns **socket transport + ack routing**.

## `handleMatchmakingAutoJoin` — before / after

### Before

```typescript
  // ENTANGLEMENT E7 [room + auth + navigation]
  // handleMatchmakingAutoJoin emits room:join with auth identity and switches appMode to multiplayer on match found.
  // Separating room join from navigation stranding the overlay open or joining without switching to the MP shell.
  // Resolution path: matchmaking service callback returns join result; App owns navigation side effect. Phase 3 candidate.
  const handleMatchmakingAutoJoin = useCallback(
    (payload: MatchFoundPayload) => {
      const roomCode = payload.roomCode.trim().toUpperCase();
      const activeSocket = socketRef.current;
      if (!activeSocket?.connected) {
        return;
      }
      if (normalizeRoomCode(joinedRoomRef.current) === roomCode) {
        return;
      }

      setOverlayPayload(payload);

      const username = authProfile?.username ?? authUser?.email?.split('@')[0] ?? 'Guest';
      setAppMode('multiplayer');
      activeSocket.emit(
        'room:join',
        roomCode,
        { username, userId: multiplayerIdentityUserId, authToken: multiplayerAuthToken },
        (resp: RoomAckResponse) => {
          if (!resp?.ok) {
            showToast(resp?.error ?? 'Could not join matched room.', 2500);
            return;
          }
          applyJoinedRoomResponse(resp);
        },
      );
    },
    [
      normalizeRoomCode,
      authProfile?.username,
      authUser?.email,
      multiplayerIdentityUserId,
      multiplayerAuthToken,
      applyJoinedRoomResponse,
      showToast,
      setAppMode,
    ],
  );
```

### After

```typescript
  // Matchmaking auto-join: see matchmakingRoomJoin.ts (join transport + ack); App owns optimistic navigation below.
  const handleMatchmakingAutoJoin = useCallback(
    (payload: MatchFoundPayload) => {
      const activeSocket = socketRef.current;
      if (
        !canAttemptMatchmakingRoomJoin({
          socket: activeSocket,
          roomCode: payload.roomCode,
          currentJoinedRoom: joinedRoomRef.current,
          normalizeRoomCode,
        })
      ) {
        return;
      }

      // Optimistic overlay + mode switch before ack — keeps countdown/match-found UI responsive while join runs.
      setOverlayPayload(payload);
      setAppMode('multiplayer');

      const username = authProfile?.username ?? authUser?.email?.split('@')[0] ?? 'Guest';
      void emitMatchmakingRoomJoin({
        socket: activeSocket!,
        roomCode: payload.roomCode,
        identity: {
          username,
          userId: multiplayerIdentityUserId,
          authToken: multiplayerAuthToken,
        },
      }).then((resp) => {
        handleMatchmakingRoomJoinAck(resp, { applyJoinedRoomResponse, showToast });
      });
    },
    [
      authProfile?.username,
      authUser?.email,
      multiplayerIdentityUserId,
      multiplayerAuthToken,
      applyJoinedRoomResponse,
      showToast,
      setAppMode,
    ],
  );
```

### Import added (App.tsx)

```typescript
import {
  canAttemptMatchmakingRoomJoin,
  emitMatchmakingRoomJoin,
  handleMatchmakingRoomJoinAck,
} from './multiplayer/matchmakingRoomJoin';
```

## Full source — `client/src/multiplayer/matchmakingRoomJoin.ts`

```typescript
import type { RoomAckResponse, RoomJoinIdentity } from './roomTransport';

export type MatchmakingJoinSocket = {
  connected?: boolean;
  emit: (event: string, ...args: unknown[]) => void;
};

export type MatchmakingRoomJoinAttemptParams = {
  socket: MatchmakingJoinSocket | null;
  roomCode: string;
  currentJoinedRoom: string | null;
  normalizeRoomCode?: (value: unknown) => string;
};

export type MatchmakingRoomJoinEmitParams = {
  socket: MatchmakingJoinSocket;
  roomCode: string;
  identity: RoomJoinIdentity;
};

export type MatchmakingRoomJoinAckHandlers = {
  applyJoinedRoomResponse: (resp: RoomAckResponse) => void;
  showToast: (message: string, duration?: number) => void;
};

function defaultNormalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function canAttemptMatchmakingRoomJoin(params: MatchmakingRoomJoinAttemptParams): boolean {
  const normalize = params.normalizeRoomCode ?? defaultNormalizeRoomCode;
  const roomCode = normalize(params.roomCode);
  const activeSocket = params.socket;
  if (!activeSocket?.connected) {
    return false;
  }
  if (normalize(params.currentJoinedRoom) === roomCode) {
    return false;
  }
  return true;
}

export function emitMatchmakingRoomJoin(params: MatchmakingRoomJoinEmitParams): Promise<RoomAckResponse> {
  const roomCode = params.roomCode.trim().toUpperCase();
  return new Promise((resolve) => {
    params.socket.emit('room:join', roomCode, params.identity, (resp: RoomAckResponse) => {
      resolve(resp ?? {});
    });
  });
}

export function handleMatchmakingRoomJoinAck(
  resp: RoomAckResponse,
  handlers: MatchmakingRoomJoinAckHandlers,
): void {
  if (!resp?.ok) {
    handlers.showToast(resp?.error ?? 'Could not join matched room.', 2500);
    return;
  }
  handlers.applyJoinedRoomResponse(resp);
}
```

## Full source — `client/src/multiplayer/matchmakingRoomJoin.test.ts`

```typescript
import { describe, expect, it, vi } from 'vitest';
import {
  canAttemptMatchmakingRoomJoin,
  emitMatchmakingRoomJoin,
  handleMatchmakingRoomJoinAck,
} from './matchmakingRoomJoin';
import type { RoomJoinIdentity } from './roomTransport';

const identity: RoomJoinIdentity = {
  username: 'Player',
  userId: 'user-1',
  authToken: 'token-1',
};

describe('canAttemptMatchmakingRoomJoin', () => {
  it('does not attempt join when socket is not connected', () => {
    expect(
      canAttemptMatchmakingRoomJoin({
        socket: { connected: false, emit: vi.fn() },
        roomCode: 'ROOM1',
        currentJoinedRoom: null,
      }),
    ).toBe(false);
  });

  it('does not attempt join when already in the target room', () => {
    expect(
      canAttemptMatchmakingRoomJoin({
        socket: { connected: true, emit: vi.fn() },
        roomCode: 'room1',
        currentJoinedRoom: 'ROOM1',
      }),
    ).toBe(false);
  });
});

describe('emitMatchmakingRoomJoin', () => {
  it('resolves with the room:join ack response', async () => {
    const emit = vi.fn((...args: unknown[]) => {
      const ack = args[3] as ((resp: unknown) => void) | undefined;
      ack?.({ ok: true, roomCode: 'ROOM1' });
    });

    await expect(
      emitMatchmakingRoomJoin({
        socket: { connected: true, emit },
        roomCode: ' room1 ',
        identity,
      }),
    ).resolves.toEqual({ ok: true, roomCode: 'ROOM1' });

    expect(emit).toHaveBeenCalledWith('room:join', 'ROOM1', identity, expect.any(Function));
  });
});

describe('handleMatchmakingRoomJoinAck', () => {
  it('applies joined-room response on successful ack', () => {
    const applyJoinedRoomResponse = vi.fn();
    const showToast = vi.fn();

    handleMatchmakingRoomJoinAck(
      { ok: true, roomCode: 'ROOM1' },
      { applyJoinedRoomResponse, showToast },
    );

    expect(applyJoinedRoomResponse).toHaveBeenCalledWith({ ok: true, roomCode: 'ROOM1' });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows toast and skips apply on failed ack', () => {
    const applyJoinedRoomResponse = vi.fn();
    const showToast = vi.fn();

    handleMatchmakingRoomJoinAck(
      { ok: false, error: 'Room full' },
      { applyJoinedRoomResponse, showToast },
    );

    expect(showToast).toHaveBeenCalledWith('Room full', 2500);
    expect(applyJoinedRoomResponse).not.toHaveBeenCalled();
  });
});
```

## Test / build results

### Before (per E9 report / pre-change baseline)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **415** passed, **45** test files |
| `cd client && node run-behavior-tests.mjs` | **31** files passed |
| `npm run build --prefix client` | ✓ built |

### After (this change)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **420** passed (+5), **46** test files (+1) |
| `cd client && node run-behavior-tests.mjs` | **31** files passed (unchanged) |
| `npm run build --prefix client` | ✓ built |

## Call site — untouched confirmation

| Consumer | Location | Touched? |
|----------|----------|----------|
| `handleMatchmakingAutoJoin` prop → `AppRoutesGamePropsHost` | `App.tsx` ~1355 | **No** (same callback name/signature; body refactored only) |

No ref exposure; no other call sites.

## Frozen / out-of-scope confirmation

**Untouched ENTANGLEMENT markers in `App.tsx`:** E8, E11 (2 remain; E2, E3, E4, E7, E9 resolved).

**Explicitly untouched E8 region:** `handlePostGame`, `abandonCurrentMatch`, and the E8 comment block (~1069+) — no edits.

**Untouched frozen systems:**

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
| `client/src/App.tsx` | E7 resolved; orchestrator + imports |
| `client/src/multiplayer/matchmakingRoomJoin.ts` | **New** |
| `client/src/multiplayer/matchmakingRoomJoin.test.ts` | **New** |
| `docs/phase-app-e7-matchmaking-autojoin-report.md` | **New** (this file) |