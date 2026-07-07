# E7 Verification + E8 Recon (read-only)

## PART 1 — E7 `normalizeRoomCode` parity

### Direct answer

**Is `normalizeRoomCode(x)` identical to `x.trim().toUpperCase()` for every room-code shape this app actually produces/passes?**

**Yes — for all practical room-code values (always `string` at the matchmaking auto-join call site).**

`normalizeRoomCode` does one thing beyond bare `.trim().toUpperCase()`: on **non-string** input (`null`, `undefined`, numbers, etc.) it returns `''` instead of throwing. That matters for `joinedRoomRef.current` (`string | null`) but **not** for `payload.roomCode`, which is typed and supplied as `string` from `MatchFoundPayload` / matchmaking. On any `string` value, the two are byte-for-byte equivalent.

**Code change required:** **None.** E7 guard parity is closed clean.

---

### Full current source of `normalizeRoomCode` in `App.tsx`

**Not imported** — local function in `client/src/App.tsx`:

```typescript
function normalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}
```

(Location: lines 79–81, immediately above the `App` component.)

---

### Original vs E7 guard (for the record)

| Operand | Pre-E7 (`handleMatchmakingAutoJoin`) | Post-E7 (`canAttemptMatchmakingRoomJoin`) |
|---------|--------------------------------------|-------------------------------------------|
| Incoming match room code | `payload.roomCode.trim().toUpperCase()` | `normalizeRoomCode(payload.roomCode)` → same when `payload.roomCode` is `string` |
| Current joined room | `normalizeRoomCode(joinedRoomRef.current)` | `normalizeRoomCode(currentJoinedRoom)` → unchanged |

`defaultNormalizeRoomCode` in `matchmakingRoomJoin.ts` is the same implementation:

```typescript
function defaultNormalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}
```

`normalizeStoredRoomCode` in `match/recovery/matchRecovery.ts` is also the same pattern (used for localStorage recovery codes).

Room codes produced in this app are ASCII strings: matchmaking codes from server, private-room codes (`makeCode`), league `LG-XXXX`, invite URL `?room=`, etc. None rely on extra stripping beyond `trim` + `toUpperCase`.

---

## PART 2 — E8 sizing recon (read-only)

### E8 ENTANGLEMENT comment block (exact, `App.tsx` ~1069)

```typescript
  // ENTANGLEMENT E8 [room + tournament + socket]
  // handlePostGame and abandonCurrentMatch branch on tournament context while calling disconnect or room abandon over socketRef.
  // Splitting post-game navigation from socket/room teardown causes double-leave or tournament bracket desync after match end.
  // Resolution path: tournament session owns exit routing; room layer owns leave/abandon transport. Phase 3 candidate.
```

---

### Full current source — `handlePostGame`

```typescript
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

---

### Full current source — `abandonCurrentMatch`

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

---

### Call sites / consumers — entire `client/` codebase

| Location | Role |
|----------|------|
| `client/src/App.tsx` ~1073 | **Definition** `handlePostGame` |
| `client/src/App.tsx` ~1104 | **Definition** `abandonCurrentMatch` |
| `client/src/App.tsx` ~1369–1370 | Passed into `AppRoutesGamePropsHost` props object |
| `client/src/useAppRoutesInput.tsx` ~75, ~80 | Threaded from `source` into routes input (`handlePostGame`, `abandonCurrentMatch`) |
| `client/src/useAppRoutesInput.tsx` ~237, ~242 | Listed in `useMemo` dependency arrays |
| `client/src/useAppRoutesProps.tsx` ~179, ~186 | Threaded from `source` into routes props |
| `client/src/useAppRoutesProps.tsx` ~270, ~274 | Listed in `useMemo` dependency arrays |
| `client/src/multiplayer/MultiplayerModeController.tsx` ~122, ~134 | **Type** declarations on view props |
| `client/src/multiplayer/MultiplayerModeController.tsx` ~274, ~282 | Destructured from `gameView` |
| `client/src/multiplayer/MultiplayerModeController.tsx` ~482 | `handlePostGame` → `onPostGame={handlePostGame}` on lazy `LiveMatchScreen` |
| `client/src/multiplayer/MultiplayerModeController.tsx` ~495 | `abandonCurrentMatch` → `void abandonCurrentMatch()` in leave-confirm handler |
| `client/src/match/LiveMatchScreen.tsx` ~128 | **Prop type** `onPostGame: () => void` |
| `client/src/match/LiveMatchScreen.tsx` ~493, ~647, ~649 | Consumes `onPostGame` as post-game primary + exit actions |

**Not referenced in:**

- `useMultiplayerShellDelegates.ts` — no mention
- `useMultiplayerLobbyHostProps.ts` — no mention (does reference `resetMultiplayerRoomState`, not E8 callbacks)
- No refs (`handlePostGameRef` / `abandonCurrentMatchRef`) — none exist

**Indirect overlap with E4 only (shared primitive, not E7):**

Both E8 functions call `resetMultiplayerRoomState` (E4 split), but they do **not** call any E7 symbols.

---

### Overlap with E7 change (`matchmakingRoomJoin.ts`)

| E7 symbol | Used by `handlePostGame`? | Used by `abandonCurrentMatch`? |
|-----------|---------------------------|--------------------------------|
| `canAttemptMatchmakingRoomJoin` | **No** | **No** |
| `emitMatchmakingRoomJoin` | **No** | **No** |
| `handleMatchmakingRoomJoinAck` | **No** | **No** |
| `handleMatchmakingAutoJoin` | **No** | **No** |

**Direct answer: Neither E8 function overlaps with anything the E7 change touched.** E8 is post-game / leave-abandon flow; E7 is matchmaking auto-join on match-found. Shared surface is only upstream primitives both already used before E7 (`resetMultiplayerRoomState`, `disconnect`, `emitRoomAbandonMatch`, `normalizeRoomCode`, tournament context, socket ref).

---

### E8 scoping notes (for next task)

- `handlePostGame`: ~30 LOC active path + dead legacy comment block; branches on `currentTournamentContext` vs `resetMultiplayerRoomState` + `disconnect`.
- `abandonCurrentMatch`: ~50 LOC; async `emitRoomAbandonMatch` ack, then `clearRecoverableRoomState`, `resetMultiplayerRoomState({ keepPlayers: true })`, tournament vs multiplayer navigation.
- Consumer chain is shallow: App → routes props/input → `MultiplayerModeController` → `LiveMatchScreen` (`onPostGame` only); abandon is inline in leave modal only.
- No ref exposure; narrower call surface than E4's `resetMultiplayerRoomState`.