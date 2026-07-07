# Phase: App.tsx ENTANGLEMENT E3 — Joined-Room Persist Policy

## Goal

Resolve **ENTANGLEMENT E3** (`room + game + tournament`) in `client/src/App.tsx` by naming the cross-domain assembly that feeds `shouldPersistLastRoomCode`. The persistence **effect site** stays in `App.tsx`; only the input assembly moves out.

## Design choice: approach (b)

Two options were considered:

| Option | Description |
|--------|-------------|
| **(a)** | Widen `shouldPersistLastRoomCode` to accept a pre-assembled persist-context object |
| **(b)** | Extract assembly of `{ gameOver, isTerminalTournamentMatch }` into a named helper; keep `shouldPersistLastRoomCode` unchanged |

**Chosen: (b)**, extended with a thin `shouldPersistJoinedRoom` wrapper.

**Rationale:**

- `shouldPersistLastRoomCode` in `matchRecovery.ts` already encodes the room-layer guard rules and documents that it mirrors App's effect — changing its signature would be churn without benefit.
- The E3 coupling is specifically the **inline assembly** of game (`liveGameOver`) and tournament (`tournamentMatch` + `isTerminalTournamentMatch`) signals at the App call site, not missing guard logic.
- Pulling `isTerminalTournamentMatch` into `matchRecovery.ts` would couple the storage helper module to the tournament domain; a sibling `joinedRoomPersistPolicy.ts` module names that coupling in one place while leaving `matchRecovery.ts` as pure storage + low-level guards.
- Mirrors the E2 pattern: App passes raw cross-domain inputs to one named policy function.

## Summary

| Item | Result |
|------|--------|
| Entanglement resolved | **E3** — comment removed, policy named |
| Behavior change | **None** — `saveLastRoomCode` fires under the same conditions |
| New module | `client/src/match/recovery/joinedRoomPersistPolicy.ts` |
| New tests | `client/src/match/recovery/joinedRoomPersistPolicy.test.ts` (4 cases) |
| `matchRecovery.ts` | **Unchanged** |

## App.tsx — import change

### Before

```typescript
import {
  clearLastRoomCode,
  LAST_ROOM_STORAGE_KEY,
  readRoomInviteCodeFromLocation,
  saveLastRoomCode,
  shouldPersistLastRoomCode,
} from './match/recovery/matchRecovery';
```

```typescript
import { isTerminalTournamentMatch } from './tournament/terminalMatches';
```

### After

```typescript
import {
  clearLastRoomCode,
  LAST_ROOM_STORAGE_KEY,
  readRoomInviteCodeFromLocation,
  saveLastRoomCode,
} from './match/recovery/matchRecovery';
import { shouldPersistJoinedRoom } from './match/recovery/joinedRoomPersistPolicy';
```

(`isTerminalTournamentMatch` import removed from `App.tsx` — now owned by the policy module.)

## App.tsx effect — before / after

### Before

```typescript
  // ENTANGLEMENT E3 [room + game + tournament]
  // joinedRoom persistence gates saveLastRoomCode on liveGameOver and terminal tournament match state.
  // Room-only persistence would save codes after finished games or block recovery for active tournament exits.
  // Resolution path: pass explicit persist policy from game/tournament layers into a room recovery helper. Phase 3 candidate.
  useEffect(() => {
    joinedRoomRef.current = joinedRoom;
    if (
      shouldPersistLastRoomCode({
        joinedRoom,
        preventAutoRejoin: preventAutoRejoinRef.current,
        gameOver: liveGameOver,
        isTerminalTournamentMatch: Boolean(
          tournamentMatch?.matchId && isTerminalTournamentMatch(tournamentMatch.matchId),
        ),
      })
    ) {
      saveLastRoomCode(joinedRoom!);
    }
  }, [joinedRoom, liveGameOver, tournamentMatch?.matchId]);
```

### After

```typescript
  // Joined-room persist policy: see shouldPersistJoinedRoom in match/recovery/joinedRoomPersistPolicy.ts
  useEffect(() => {
    joinedRoomRef.current = joinedRoom;
    if (
      shouldPersistJoinedRoom({
        joinedRoom,
        preventAutoRejoin: preventAutoRejoinRef.current,
        liveGameOver,
        tournamentMatchId: tournamentMatch?.matchId,
      })
    ) {
      saveLastRoomCode(joinedRoom!);
    }
  }, [joinedRoom, liveGameOver, tournamentMatch?.matchId]);
```

## Full source — `client/src/match/recovery/joinedRoomPersistPolicy.ts`

```typescript
import { isTerminalTournamentMatch } from '../../tournament/terminalMatches';
import { shouldPersistLastRoomCode } from './matchRecovery';

export type JoinedRoomPersistContext = {
  joinedRoom: string | null;
  preventAutoRejoin: boolean;
  liveGameOver: boolean | undefined;
  tournamentMatchId: string | null | undefined;
};

export type RoomPersistGateSignals = {
  gameOver: boolean | undefined;
  isTerminalTournamentMatch: boolean;
};

/**
 * Assembles game + tournament gate signals for joined-room localStorage persistence.
 * App.tsx supplies raw cross-domain state; this helper names the coupling explicitly.
 */
export function buildRoomPersistGateSignals(
  context: Pick<JoinedRoomPersistContext, 'liveGameOver' | 'tournamentMatchId'>,
): RoomPersistGateSignals {
  return {
    gameOver: context.liveGameOver,
    isTerminalTournamentMatch: Boolean(
      context.tournamentMatchId && isTerminalTournamentMatch(context.tournamentMatchId),
    ),
  };
}

export function shouldPersistJoinedRoom(context: JoinedRoomPersistContext): boolean {
  const gateSignals = buildRoomPersistGateSignals(context);
  return shouldPersistLastRoomCode({
    joinedRoom: context.joinedRoom,
    preventAutoRejoin: context.preventAutoRejoin,
    gameOver: gateSignals.gameOver,
    isTerminalTournamentMatch: gateSignals.isTerminalTournamentMatch,
  });
}
```

## Full source — `client/src/match/recovery/joinedRoomPersistPolicy.test.ts`

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldPersistJoinedRoom } from './joinedRoomPersistPolicy';
import * as terminalMatches from '../../tournament/terminalMatches';

describe('shouldPersistJoinedRoom', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists when joined room is active and no gate signals block', () => {
    vi.spyOn(terminalMatches, 'isTerminalTournamentMatch').mockReturnValue(false);

    expect(
      shouldPersistJoinedRoom({
        joinedRoom: 'ROOM1',
        preventAutoRejoin: false,
        liveGameOver: false,
        tournamentMatchId: 'match-1',
      }),
    ).toBe(true);
  });

  it('does not persist when the live game is over', () => {
    vi.spyOn(terminalMatches, 'isTerminalTournamentMatch').mockReturnValue(false);

    expect(
      shouldPersistJoinedRoom({
        joinedRoom: 'ROOM1',
        preventAutoRejoin: false,
        liveGameOver: true,
        tournamentMatchId: null,
      }),
    ).toBe(false);
  });

  it('does not persist when the tournament match is terminal', () => {
    vi.spyOn(terminalMatches, 'isTerminalTournamentMatch').mockReturnValue(true);

    expect(
      shouldPersistJoinedRoom({
        joinedRoom: 'ROOM1',
        preventAutoRejoin: false,
        liveGameOver: false,
        tournamentMatchId: 'terminal-match',
      }),
    ).toBe(false);
  });

  it('does not persist when auto-rejoin is prevented', () => {
    vi.spyOn(terminalMatches, 'isTerminalTournamentMatch').mockReturnValue(false);

    expect(
      shouldPersistJoinedRoom({
        joinedRoom: 'ROOM1',
        preventAutoRejoin: true,
        liveGameOver: false,
        tournamentMatchId: null,
      }),
    ).toBe(false);
  });
});
```

## Test / build results

### Before (per E2 report / pre-change baseline)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **406** passed, **43** test files |
| `cd client && node run-behavior-tests.mjs` | **31** files passed |
| `npm run build --prefix client` | ✓ built |

### After (this change)

| Command | Result |
|---------|--------|
| `cd client && npm test` | **410** passed (+4), **44** test files (+1) |
| `cd client && node run-behavior-tests.mjs` | **31** files passed (unchanged) |
| `npm run build --prefix client` | ✓ built |

## Frozen / out-of-scope confirmation

**Untouched ENTANGLEMENT markers in `App.tsx`:** E4, E7, E8, E9, E11 (5 remain; E2 and E3 resolved).

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
| `client/src/App.tsx` | E3 resolved; import + effect use `shouldPersistJoinedRoom` |
| `client/src/match/recovery/joinedRoomPersistPolicy.ts` | **New** |
| `client/src/match/recovery/joinedRoomPersistPolicy.test.ts` | **New** |
| `docs/phase-app-e3-room-persist-report.md` | **New** (this file) |