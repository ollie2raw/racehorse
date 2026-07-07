# Phase: App.tsx ENTANGLEMENT E4 — Room / Shell / Tournament Reset Split

## Goal

Resolve **ENTANGLEMENT E4** (`room + game shell + tournament`) by splitting `resetMultiplayerRoomState` into three named single-domain `useCallback`s composed in **the same side-effect order** as the original monolith. The public API (`resetMultiplayerRoomState` name, `{ keepPlayers?, clearRoomCode? }` shape, and all call sites) is unchanged.

## Summary

| Item | Result |
|------|--------|
| Entanglement resolved | **E4** — comment removed; three domain resets named |
| Behavior change | **None** — same inputs → same state updates in same order |
| New files | **None** — sub-functions live in `App.tsx` near the composer |
| New tests | **None** — not practical without disproportionate scaffolding (see below) |

## Order preservation

Original monolith interleaved room, tournament, shell, and room again. A naive `room → shell → tournament` composer would reorder `setTournamentMatch(null)` before identity/code clears and move `setPlayers([])` before shell clears.

The composer therefore calls phased segments of the room and shell helpers:

1. `resetRoomIdentityState(options, 'joined')` → `setJoinedRoom(null)`
2. `resetTournamentAttachState()` → `setTournamentMatch(null)`
3. `resetRoomIdentityState(options, 'identity')` → `roomIdentityRef`, `setRoomCode`
4. `resetGameShellState('ui')` → all `shellSet*` calls
5. `resetRoomIdentityState(options, 'players')` → `setPlayers([])` when `!keepPlayers`
6. `resetGameShellState('session')` → `resetClientGameSession()`

This matches the pre-change sequence exactly.

## `resetMultiplayerRoomState` region — before

```typescript
  // ENTANGLEMENT E4 [room + game shell + tournament]
  // resetMultiplayerRoomState clears joined room, tournament match, and game shell state in one callback.
  // Moving room reset without shell/tournament setters leaves stale match UI or orphaned tournament attach state.
  // Resolution path: split into room-only reset plus explicit shell/tournament teardown orchestrated in App. Phase 3 candidate.
  const resetMultiplayerRoomState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}) => {
      const { keepPlayers = false, clearRoomCode = true } = options;
      setJoinedRoom(null);
      setTournamentMatch(null);
      roomIdentityRef.current = null;
      if (clearRoomCode) setRoomCode('');
      shellSetState(null);
      shellSetLegalMoves([]);
      shellSetCanDraw(false);
      shellSetSelectedTile(null);
      shellSetHandReveal(null);
      shellSetRematchRequested(false);
      shellSetRematchReadyIds([]);
      if (!keepPlayers) {
        setPlayers([]);
      }
      resetClientGameSession();
    },
    [
      resetClientGameSession,
      setTournamentMatch,
      shellSetCanDraw,
      shellSetHandReveal,
      shellSetLegalMoves,
      shellSetRematchReadyIds,
      shellSetRematchRequested,
      shellSetSelectedTile,
      shellSetState,
    ],
  );
  resetMultiplayerRoomStateRef.current = resetMultiplayerRoomState;
```

## `resetMultiplayerRoomState` region — after

```typescript
  type RoomIdentityResetPart = 'joined' | 'identity' | 'players';
  type GameShellResetPart = 'ui' | 'session';

  const resetRoomIdentityState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}, part: RoomIdentityResetPart) => {
      const { keepPlayers = false, clearRoomCode = true } = options;
      if (part === 'joined') {
        setJoinedRoom(null);
        return;
      }
      if (part === 'identity') {
        roomIdentityRef.current = null;
        if (clearRoomCode) setRoomCode('');
        return;
      }
      if (!keepPlayers) {
        setPlayers([]);
      }
    },
    [setJoinedRoom, setRoomCode, setPlayers],
  );

  const resetGameShellState = useCallback(
    (part: GameShellResetPart) => {
      if (part === 'ui') {
        shellSetState(null);
        shellSetLegalMoves([]);
        shellSetCanDraw(false);
        shellSetSelectedTile(null);
        shellSetHandReveal(null);
        shellSetRematchRequested(false);
        shellSetRematchReadyIds([]);
        return;
      }
      resetClientGameSession();
    },
    [
      resetClientGameSession,
      shellSetCanDraw,
      shellSetHandReveal,
      shellSetLegalMoves,
      shellSetRematchReadyIds,
      shellSetRematchRequested,
      shellSetSelectedTile,
      shellSetState,
    ],
  );

  const resetTournamentAttachState = useCallback(() => {
    setTournamentMatch(null);
  }, [setTournamentMatch]);

  // Room/shell/tournament reset composition: see resetMultiplayerRoomState below.
  const resetMultiplayerRoomState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}) => {
      resetRoomIdentityState(options, 'joined');
      resetTournamentAttachState();
      resetRoomIdentityState(options, 'identity');
      resetGameShellState('ui');
      resetRoomIdentityState(options, 'players');
      resetGameShellState('session');
    },
    [resetGameShellState, resetRoomIdentityState, resetTournamentAttachState],
  );
  resetMultiplayerRoomStateRef.current = resetMultiplayerRoomState;
```

## Testing

**No new tests added.** `resetRoomIdentityState`, `resetGameShellState`, and `resetTournamentAttachState` are `useCallback`s closing over React state setters, refs, and shell bridge setters defined inside `App.tsx`. Extracting them for unit tests would require either:

- Mounting the full `App` tree (integration-level, high scaffolding), or
- Refactoring setters into injectable deps (out of scope and risks touching the wide `resetMultiplayerRoomState` call surface).

The E2/E3 pattern (pure functions in standalone modules) does not apply here. Regression coverage remains via existing vitest + behavior suites.

## Test / build results

### Before (per E3 report / pre-change baseline)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **410** passed, **44** test files |
| `cd client && node run-behavior-tests.mjs` | **31** files passed |
| `npm run build --prefix client` | ✓ built |

### After (this change)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **410** passed, **44** test files (unchanged) |
| `cd client && node run-behavior-tests.mjs` | **31** files passed (unchanged) |
| `npm run build --prefix client` | ✓ built |

## Call sites — untouched confirmation

`resetMultiplayerRoomState` **name**, **parameter shape**, and **all call sites** were left unchanged:

| Consumer | Location | Touched? |
|----------|----------|----------|
| `handlePostGame` | `App.tsx` ~1060 | **No** (E8 — out of scope) |
| `abandonCurrentMatch` | `App.tsx` ~1101 | **No** (E8 — out of scope) |
| Sign-out flow (`onUsernameSignOut`) | `App.tsx` ~1248 | **No** |
| `useMultiplayerLobbyHostProps` prop | `App.tsx` ~1287 | **No** |
| `resetMultiplayerRoomStateRef.current` | `App.tsx` ~673 | **No** (ref assignment preserved) |

Only the **body** of `resetMultiplayerRoomState` and the three new internal `useCallback`s were introduced; no caller signatures or invocation arguments changed.

## Frozen / out-of-scope confirmation

**Untouched ENTANGLEMENT markers in `App.tsx`:** E7, E8, E9, E11 (4 remain; E2, E3, E4 resolved).

**Explicitly untouched E8 region:** `handlePostGame`, `abandonCurrentMatch`, and the E8 comment block (~1064+) — no edits.

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
| `client/src/App.tsx` | E4 resolved; monolith split into three domain `useCallback`s + composer |
| `docs/phase-app-e4-room-shell-reset-split-report.md` | **New** (this file) |