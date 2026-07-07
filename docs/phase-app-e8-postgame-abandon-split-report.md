# Phase: App.tsx ENTANGLEMENT E8 — Post-Game / Abandon Exit Split

## Goal

Resolve **ENTANGLEMENT E8** (`room + tournament + socket`) by splitting `handlePostGame` and `abandonCurrentMatch` into named transport functions (`client/src/multiplayer/postGameExit.ts`) and App-level navigation orchestrators. Public callback names, signatures, and call sites unchanged.

## Module name choice

**`client/src/multiplayer/postGameExit.ts`** — mirrors `matchmakingRoomJoin.ts` (E7): pure multiplayer transport helpers colocated under `client/src/multiplayer/`, named for the exit lifecycle (post-game home disconnect + match abandon ack) rather than a generic “teardown” module.

## Summary

| Item | Result |
|------|--------|
| Entanglement resolved | **E8** — comment removed; transport vs navigation named |
| Behavior change | **None** — same side-effect order and timing |
| New module | `client/src/multiplayer/postGameExit.ts` |
| New tests | `client/src/multiplayer/postGameExit.test.ts` (7 cases) |
| Navigation tests | **None** — orchestration closures over React setters (same judgment as E4) |

---

## Ordering preservation

### `handlePostGame`

| Step | Before | After |
|------|--------|-------|
| 1 | `resetRoomRecoveryState()` | `resetRoomRecoveryState()` (orchestrator) |
| 2 | `if (currentTournamentContext)` → `navigateAfterTournamentMatch('bracket')` → `return` | unchanged (orchestrator navigation) |
| 3 | Legacy comment block | unchanged (verbatim) |
| 4 | `resetMultiplayerRoomState({ keepPlayers: false, clearRoomCode: true })` | `performPostGameHomeTeardown` step 1 |
| 5 | `disconnect('post-game to home')` | `performPostGameHomeTeardown` step 2 |

Tournament branch still skips transport entirely. Non-tournament transport order inside `performPostGameHomeTeardown`: reset room → disconnect (unchanged).

### `abandonCurrentMatch` (success path)

| Step | Before | After |
|------|--------|-------|
| 1 | Guard: `!activeSocket?.connected \|\| !activeRoomCode` → shell error | `canAttemptMatchAbandon` guard (equivalent) → shell error |
| 2 | `console.log('[leave-game] confirm', …)` | unchanged (orchestrator) |
| 3 | `await emitRoomAbandonMatch(…)` | `await emitMatchAbandonTransport(…)` (same underlying emit) |
| 4a (fail ack) | `console.log ack/error` → `shellSetActionError` → `showToast` → `return` | `console.log` → `handleMatchAbandonFailure` (same two calls) → `return` |
| 4b (success) | `console.log ack/success` | unchanged |
| 5 | `clearRecoverableRoomState()` | `performMatchAbandonSuccessCleanup` step 1 |
| 6 | `resetMultiplayerRoomState({ keepPlayers: true })` | `performMatchAbandonSuccessCleanup` step 2 |
| 7 | `shellSetActionError('')` | `performMatchAbandonSuccessCleanup` step 3 |
| 8 | Tournament vs multiplayer `setAppMode` / bracket branch | unchanged (orchestrator navigation) |

Catch path: `console.log` → `handleMatchAbandonFailure` (same as before's `shellSetActionError` + `showToast`).

**No reordering was required or performed.**

---

## `handlePostGame` — before

```typescript
  // ENTANGLEMENT E8 [room + tournament + socket]
  // handlePostGame and abandonCurrentMatch branch on tournament context while calling disconnect or room abandon over socketRef.
  // Splitting post-game navigation from socket/room teardown causes double-leave or tournament bracket desync after match end.
  // Resolution path: tournament session owns exit routing; room layer owns leave/abandon transport. Phase 3 candidate.
  const handlePostGame = useCallback(() => {
    resetRoomRecoveryState();
    // Tournament matches should return to tournament lobby, not disconnect to Home.
    if (currentTournamentContext) {
      navigateAfterTournamentMatch('bracket');
      return;
    }
    // LEGACY TOURNAMENT — TournamentScreen.tsx is unmounted and unreachable.
    // This branch is dead code. Do not remove yet — remove in Phase 2 cleanup.
    // const inTournament =
    //   Boolean(currentTournamentContext) ||
    //   Boolean(tournamentId) ||
    //   tournamentState?.status === 'running';
    // if (!inTournament) return disconnect('post-game to home');
    // resetMultiplayerRoomState({ keepPlayers: true });
    // shellSetActionError('');
    // setAppMode('tournament');
    // Orchestrate post-game cleanup:
    // 1. Reset room + shell state (tournament match, room code, identity ref, shell bridge, sequence refs)
    // 2. Transport teardown (socket close, leave/abandon emit, recovery flags, navigate home)
    // Order matters: reset room state before transport so shell unmounts cleanly.
    resetMultiplayerRoomState({ keepPlayers: false, clearRoomCode: true });
    disconnect('post-game to home');
  }, [
    currentTournamentContext,
    disconnect,
    navigateAfterTournamentMatch,
    resetMultiplayerRoomState,
    resetRoomRecoveryState,
  ]);
```

## `handlePostGame` — after

```typescript
  // Post-game / abandon exit: transport in multiplayer/postGameExit.ts; App owns navigation below.
  const handlePostGame = useCallback(() => {
    resetRoomRecoveryState();
    // Tournament matches should return to tournament lobby, not disconnect to Home.
    if (currentTournamentContext) {
      navigateAfterTournamentMatch('bracket');
      return;
    }
    // LEGACY TOURNAMENT — TournamentScreen.tsx is unmounted and unreachable.
    // This branch is dead code. Do not remove yet — remove in Phase 2 cleanup.
    // const inTournament =
    //   Boolean(currentTournamentContext) ||
    //   Boolean(tournamentId) ||
    //   tournamentState?.status === 'running';
    // if (!inTournament) return disconnect('post-game to home');
    // resetMultiplayerRoomState({ keepPlayers: true });
    // shellSetActionError('');
    // setAppMode('tournament');
    // Orchestrate post-game cleanup:
    // 1. Reset room + shell state (tournament match, room code, identity ref, shell bridge, sequence refs)
    // 2. Transport teardown (socket close, leave/abandon emit, recovery flags, navigate home)
    // Order matters: reset room state before transport so shell unmounts cleanly.
    performPostGameHomeTeardown({ resetMultiplayerRoomState, disconnect });
  }, [
    currentTournamentContext,
    disconnect,
    navigateAfterTournamentMatch,
    resetMultiplayerRoomState,
    resetRoomRecoveryState,
  ]);
```

---

## `abandonCurrentMatch` — before

```typescript
  const abandonCurrentMatch = useCallback(async () => {
    const activeSocket = socketRef.current;
    const activeRoomCode = normalizeRoomCode(joinedRoomRef.current);
    if (!activeSocket?.connected || !activeRoomCode) {
      shellSetActionError('Could not leave the match right now.');
      return;
    }
    console.log('[leave-game] confirm', {
      mode: currentTournamentContext ? 'tournament' : 'multiplayer',
      roomCode: activeRoomCode,
      tournamentMatchId: currentTournamentContext?.matchId ?? null,
    });
    try {
      const resp = await emitRoomAbandonMatch(activeSocket, {
        roomCode: activeRoomCode,
        tournamentMatchId: currentTournamentContext?.matchId ?? null,
      });
      if (!resp?.ok) {
        const errorMessage = resp?.error ?? 'Could not leave the match.';
        console.log('[leave-game] ack/error', {
          roomCode: activeRoomCode,
          error: errorMessage,
        });
        shellSetActionError(errorMessage);
        showToast(errorMessage, 2200);
        return;
      }
      console.log('[leave-game] ack/success', {
        roomCode: activeRoomCode,
      });
      clearRecoverableRoomState();
      resetMultiplayerRoomState({ keepPlayers: true });
      shellSetActionError('');
      if (currentTournamentContext?.tournamentId) {
        setActiveTournamentId(currentTournamentContext.tournamentId);
        setTournamentSubView('bracket');
        setAppMode('tournament');
        void tournament.openBracket(currentTournamentContext.tournamentId);
        void tournament.refresh();
      } else {
        setAppMode('multiplayer');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not leave the match.';
      console.log('[leave-game] ack/error', {
        roomCode: activeRoomCode,
        error: message,
      });
      shellSetActionError(message);
      showToast(message, 2200);
    }
  }, [
    clearRecoverableRoomState,
    currentTournamentContext,
    emitWithAck,
    normalizeRoomCode,
    resetMultiplayerRoomState,
    showToast,
    tournament,
  ]);
```

## `abandonCurrentMatch` — after

```typescript
  const abandonCurrentMatch = useCallback(async () => {
    const activeSocket = socketRef.current;
    const activeRoomCode = normalizeRoomCode(joinedRoomRef.current);
    if (!canAttemptMatchAbandon({ socket: activeSocket, activeRoomCode })) {
      shellSetActionError('Could not leave the match right now.');
      return;
    }
    console.log('[leave-game] confirm', {
      mode: currentTournamentContext ? 'tournament' : 'multiplayer',
      roomCode: activeRoomCode,
      tournamentMatchId: currentTournamentContext?.matchId ?? null,
    });
    try {
      const resp = await emitMatchAbandonTransport(activeSocket!, {
        roomCode: activeRoomCode,
        tournamentMatchId: currentTournamentContext?.matchId ?? null,
      });
      if (!resp?.ok) {
        const errorMessage = resp?.error ?? 'Could not leave the match.';
        console.log('[leave-game] ack/error', {
          roomCode: activeRoomCode,
          error: errorMessage,
        });
        handleMatchAbandonFailure(errorMessage, { shellSetActionError, showToast });
        return;
      }
      console.log('[leave-game] ack/success', {
        roomCode: activeRoomCode,
      });
      performMatchAbandonSuccessCleanup({
        clearRecoverableRoomState,
        resetMultiplayerRoomState,
        shellSetActionError,
      });
      if (currentTournamentContext?.tournamentId) {
        setActiveTournamentId(currentTournamentContext.tournamentId);
        setTournamentSubView('bracket');
        setAppMode('tournament');
        void tournament.openBracket(currentTournamentContext.tournamentId);
        void tournament.refresh();
      } else {
        setAppMode('multiplayer');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not leave the match.';
      console.log('[leave-game] ack/error', {
        roomCode: activeRoomCode,
        error: message,
      });
      handleMatchAbandonFailure(message, { shellSetActionError, showToast });
    }
  }, [
    clearRecoverableRoomState,
    currentTournamentContext,
    normalizeRoomCode,
    resetMultiplayerRoomState,
    showToast,
    tournament,
  ]);
```

### Import changes (App.tsx)

Added:

```typescript
import {
  canAttemptMatchAbandon,
  emitMatchAbandonTransport,
  handleMatchAbandonFailure,
  performMatchAbandonSuccessCleanup,
  performPostGameHomeTeardown,
} from './multiplayer/postGameExit';
```

Removed unused `emitRoomAbandonMatch` import (now called inside `postGameExit.ts`).

### Incidental diff — `abandonCurrentMatch` dependency array

`emitWithAck` was removed from `abandonCurrentMatch`'s `useCallback` dependency array because it was **unused in the function body in both before and after** the E8 refactor (the callback always used `emitRoomAbandonMatch` / `emitMatchAbandonTransport`, never `emitWithAck` directly). This is a **no-op for behavior** and was **not requested by E8 scope** — documented here so nothing silent slips through the audit trail.

**Follow-up verification:** Audit of pre-E8 `abandonCurrentMatch` (`git show HEAD:client/src/App.tsx`) confirms `emitWithAck` appeared **only** in the dependency array (line ~1205 in committed `App.tsx`), never in the function body — a stale/unused dependency. Removing it does not change runtime behavior.

---

## Full source — `client/src/multiplayer/postGameExit.ts`

```typescript
import { emitRoomAbandonMatch, type RoomAbandonPayload, type RoomAckResponse, type SocketEmitter } from './roomTransport';

export type PostGameHomeTeardownHandlers = {
  resetMultiplayerRoomState: (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void;
  disconnect: (reason: string) => void;
};

export type MatchAbandonAttemptParams = {
  socket: { connected?: boolean } | null;
  activeRoomCode: string;
};

export type MatchAbandonFailureHandlers = {
  shellSetActionError: (message: string) => void;
  showToast: (message: string, duration?: number) => void;
};

export type MatchAbandonSuccessCleanupHandlers = {
  clearRecoverableRoomState: () => void;
  resetMultiplayerRoomState: (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void;
  shellSetActionError: (message: string) => void;
};

/** Non-tournament post-game transport: reset room/shell then disconnect socket. */
export function performPostGameHomeTeardown(handlers: PostGameHomeTeardownHandlers): void {
  handlers.resetMultiplayerRoomState({ keepPlayers: false, clearRoomCode: true });
  handlers.disconnect('post-game to home');
}

export function canAttemptMatchAbandon(params: MatchAbandonAttemptParams): boolean {
  return Boolean(params.socket?.connected && params.activeRoomCode);
}

export function emitMatchAbandonTransport(
  socket: SocketEmitter,
  payload: RoomAbandonPayload,
): Promise<RoomAckResponse> {
  return emitRoomAbandonMatch(socket, payload);
}

export function handleMatchAbandonFailure(
  errorMessage: string,
  handlers: MatchAbandonFailureHandlers,
): void {
  handlers.shellSetActionError(errorMessage);
  handlers.showToast(errorMessage, 2200);
}

/** Room-layer cleanup after a successful room:abandon_match ack (no navigation). */
export function performMatchAbandonSuccessCleanup(handlers: MatchAbandonSuccessCleanupHandlers): void {
  handlers.clearRecoverableRoomState();
  handlers.resetMultiplayerRoomState({ keepPlayers: true });
  handlers.shellSetActionError('');
}
```

---

## Full source — `client/src/multiplayer/postGameExit.test.ts`

```typescript
import { describe, expect, it, vi } from 'vitest';
import * as roomTransport from './roomTransport';
import {
  canAttemptMatchAbandon,
  emitMatchAbandonTransport,
  handleMatchAbandonFailure,
  performMatchAbandonSuccessCleanup,
  performPostGameHomeTeardown,
} from './postGameExit';

describe('performPostGameHomeTeardown', () => {
  it('resets multiplayer room state then disconnects', () => {
    const resetMultiplayerRoomState = vi.fn();
    const disconnect = vi.fn();

    performPostGameHomeTeardown({ resetMultiplayerRoomState, disconnect });

    expect(resetMultiplayerRoomState).toHaveBeenCalledWith({ keepPlayers: false, clearRoomCode: true });
    expect(disconnect).toHaveBeenCalledWith('post-game to home');
    expect(resetMultiplayerRoomState.mock.invocationCallOrder[0]).toBeLessThan(
      disconnect.mock.invocationCallOrder[0],
    );
  });
});

describe('canAttemptMatchAbandon', () => {
  it('returns false when socket is not connected', () => {
    expect(
      canAttemptMatchAbandon({
        socket: { connected: false },
        activeRoomCode: 'ROOM1',
      }),
    ).toBe(false);
  });

  it('returns false when room code is empty', () => {
    expect(
      canAttemptMatchAbandon({
        socket: { connected: true },
        activeRoomCode: '',
      }),
    ).toBe(false);
  });

  it('returns true when socket is connected and room code is present', () => {
    expect(
      canAttemptMatchAbandon({
        socket: { connected: true },
        activeRoomCode: 'ROOM1',
      }),
    ).toBe(true);
  });
});

describe('emitMatchAbandonTransport', () => {
  it('delegates to emitRoomAbandonMatch with the same payload', async () => {
    const spy = vi.spyOn(roomTransport, 'emitRoomAbandonMatch').mockResolvedValue({ ok: true });
    const socket = { emit: vi.fn() };

    await expect(
      emitMatchAbandonTransport(socket, {
        roomCode: 'ROOM1',
        tournamentMatchId: 'match-1',
      }),
    ).resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledWith(socket, {
      roomCode: 'ROOM1',
      tournamentMatchId: 'match-1',
    });

    spy.mockRestore();
  });
});

describe('handleMatchAbandonFailure', () => {
  it('sets shell error and shows toast', () => {
    const shellSetActionError = vi.fn();
    const showToast = vi.fn();

    handleMatchAbandonFailure('Room full', { shellSetActionError, showToast });

    expect(shellSetActionError).toHaveBeenCalledWith('Room full');
    expect(showToast).toHaveBeenCalledWith('Room full', 2200);
  });
});

describe('performMatchAbandonSuccessCleanup', () => {
  it('clears recoverable state, resets room, then clears shell error in order', () => {
    const clearRecoverableRoomState = vi.fn();
    const resetMultiplayerRoomState = vi.fn();
    const shellSetActionError = vi.fn();

    performMatchAbandonSuccessCleanup({
      clearRecoverableRoomState,
      resetMultiplayerRoomState,
      shellSetActionError,
    });

    expect(clearRecoverableRoomState).toHaveBeenCalledTimes(1);
    expect(resetMultiplayerRoomState).toHaveBeenCalledWith({ keepPlayers: true });
    expect(shellSetActionError).toHaveBeenCalledWith('');
    expect(clearRecoverableRoomState.mock.invocationCallOrder[0]).toBeLessThan(
      resetMultiplayerRoomState.mock.invocationCallOrder[0],
    );
    expect(resetMultiplayerRoomState.mock.invocationCallOrder[0]).toBeLessThan(
      shellSetActionError.mock.invocationCallOrder[0],
    );
  });
});
```

---

## Navigation orchestration — not unit-tested

Tournament bracket navigation (`navigateAfterTournamentMatch`, `setAppMode`, `tournament.openBracket`, etc.) remains in App `useCallback`s closing over React state setters and the tournament hook — same practical constraints as E4's `resetRoomIdentityState` judgment. Transport pieces are fully tested; navigation is covered by existing integration/behavior suites.

---

## Test / build results

### Before (pre-change baseline, this task)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **420** passed, **46** test files |
| `cd client && node run-behavior-tests.mjs` | **31** files passed |
| `npm run build --prefix client` | ✓ built |

### After (this change)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **427** passed (+7), **47** test files (+1) |
| `cd client && node run-behavior-tests.mjs` | **31** files passed (unchanged) |
| `npm run build --prefix client` | ✓ built |

---

## Call sites — untouched confirmation

| Consumer | Location | Touched? |
|----------|----------|----------|
| `handlePostGame` definition | `App.tsx` | Body refactored; **name/signature unchanged** |
| `abandonCurrentMatch` definition | `App.tsx` | Body refactored; **name/signature unchanged** |
| Props → `AppRoutesGamePropsHost` | `App.tsx` ~1369–1370 | **No** |
| `useAppRoutesInput.tsx` | threads both | **No** |
| `useAppRoutesProps.tsx` | threads both | **No** |
| `MultiplayerModeController.tsx` | `onPostGame`, leave confirm | **No** |
| `LiveMatchScreen.tsx` | `onPostGame` prop | **No** |

---

## Frozen / out-of-scope confirmation

**Untouched ENTANGLEMENT markers:** **E11** only (1 remains; E2/E3/E4/E7/E9/E8 resolved).

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
| `resetMultiplayerRoomState` (E4 split) | No — **called only**, not modified |
| `client/src/multiplayer/matchmakingRoomJoin.ts` (E7) | No |

**Files changed by this task:**

| Path | Change |
|------|--------|
| `client/src/App.tsx` | E8 resolved; orchestrators call `postGameExit` transport |
| `client/src/multiplayer/postGameExit.ts` | **New** |
| `client/src/multiplayer/postGameExit.test.ts` | **New** |
| `docs/phase-app-e8-postgame-abandon-split-report.md` | **New** (this file) |