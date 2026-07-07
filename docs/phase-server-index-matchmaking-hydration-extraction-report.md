# Phase: Server `index.ts` Phase 2 Sub-phase 2 — Matchmaking Room-Shell Hydration Extraction

## Goal

Extract **only** the matchmaking room-shell hydration helpers from `server/src/index.ts` into a dedicated module. Zero behavior change: same Supabase query, `'MM'` prefix check, log messages, 50ms polling interval, `MATCHMAKING_JOIN_SYNC_MAX_MS` deadline, and return values.

## Summary

| Item | Result |
|------|--------|
| New module | `server/src/matchmaking/roomShellHydration.ts` (50 LOC) |
| New tests | `server/src/matchmaking/roomShellHydration.test.ts` (145 LOC, 9 tests) |
| `index.ts` LOC | 1,504 → **1,460** (−44) |
| Behavior change | **None** |
| Circular import risk | **None** (`rooms` does not import `matchmaking`) |
| Existing `matchmaking/` files modified | **None** (new file only) |

---

## Call-site grep proof (entire `server/src/` tree)

**Command:**

```bash
rg 'tryHydrateMatchmakingRoomShell|waitUntilMatchmakingRoomSocketsReady|MATCHMAKING_JOIN_SYNC_MAX_MS' server/src
```

**Results:**

| File | Role |
|------|------|
| `server/src/index.ts` | **Definition (before)** → import + `initRoomSession` wiring (after) |
| `server/src/multiplayer/roomSession.ts` | Type definitions on `RoomSessionHandlerDeps` only |
| `server/src/multiplayer/registerRoomSessionHandlers.ts:317` | Runtime consumer via `handlerDeps.tryHydrateMatchmakingRoomShell(roomCode)` |
| `server/src/multiplayer/registerRoomSessionHandlers.ts:453` | Runtime consumer via `handlerDeps.waitUntilMatchmakingRoomSocketsReady(io, room.code, mmSeatSockets)` |
| `server/src/multiplayer/registerRoomSessionHandlers.*.test.ts` | Test stubs (mocks) |
| `server/src/multiplayer/handReadyGameplayLock.test.ts` | Test stub |
| `server/src/multiplayer/forcedDrawAnimation.test.ts` | Test stub |
| `server/src/multiplayer/botSeating.test.ts` | Test stub |
| `server/src/scheduledTournament/tournamentHumanBotFlow.test.ts` | Test stub |

**Conclusion:** Production runtime path is **`index.ts` → `initRoomSession(io, { … })` → `registerRoomSessionHandlers` via `handlerDeps`**. No other production callsite defines or invokes these functions directly. Extraction replaces the `index.ts` definitions with imports; `initRoomSession` wiring unchanged.

---

## Module path and naming justification

**Path:** `server/src/matchmaking/roomShellHydration.ts`

**Reasoning (mirrors `postGameExit.ts` / `dailyWarmup.ts` pattern):**

- **Verb+noun, single concern:** `roomShellHydration` names the operation (restore in-memory MM room shells after deploy), not generic socket or room lifecycle code.
- **Domain colocation:** Logic is matchmaking-specific (`MM` prefix, `matchmaking_matches` Supabase table). `matchmaking/index.ts` already imports `createReservedRoom` from `../rooms` — same dependency direction, no new coupling pattern.
- **Not `server/src/rooms/`:** `rooms.ts` owns engine/game room primitives; hydration is a **post-deploy recovery** concern for matchmaking rows, not core room CRUD.
- **No circular import:** `rooms.ts` does not import `matchmaking/`. New module imports `rooms` + `supabaseUtils` only. `matchmaking/index.ts` is **not** modified.

---

## Moved functions — before (from `server/src/index.ts`)

```typescript
/**
 * After Render/deploy the in-memory Map is empty but matchmaking still has an
 * `in_progress` row. Recreate a reserved room shell so players can re-seat;
 * game state is not restored (would require separate persisted snapshots).
 */
async function tryHydrateMatchmakingRoomShell(roomCode: string): Promise<'skipped' | 'already' | 'hydrated' | 'miss'> {
  const code = roomCode.trim().toUpperCase();
  if (!code.startsWith('MM')) return 'skipped';
  if (peekRoom(code)) return 'already';
  try {
    const rows = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/matchmaking_matches?room_code=eq.${encodeURIComponent(code)}&status=eq.in_progress&select=id&limit=1`,
    );
    const id = typeof rows[0]?.id === 'string' ? rows[0].id : null;
    if (!id) return 'miss';
    const room = createReservedRoom(code, { winningScore: 60 });
    room.matchmakingMatchId = id;
    console.log('[room:hydrate] matchmaking shell restored', { roomCode: code, matchmakingMatchId: id });
    return 'hydrated';
  } catch (err) {
    console.warn('[room:hydrate] failed', err instanceof Error ? err.message : err);
    return 'miss';
  }
}

/** Matchmaking: allow the second client up to this long after both seats fill before attempting deal. */
const MATCHMAKING_JOIN_SYNC_MAX_MS = 5000;

/**
 * Ensures both engine seat sockets have executed `socket.join(roomCode)` so the
 * subsequent `broadcastStateUpdate` reliably reaches everyone.
 */
async function waitUntilMatchmakingRoomSocketsReady(
  io: Server,
  roomCode: string,
  engineSeatSocketIds: string[],
): Promise<void> {
  if (engineSeatSocketIds.length < 2) return;
  const deadline = Date.now() + MATCHMAKING_JOIN_SYNC_MAX_MS;
  while (Date.now() < deadline) {
    const members = io.sockets.adapter.rooms.get(roomCode);
    if (members && engineSeatSocketIds.every((id) => members.has(id))) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}
```

**`initRoomSession` wiring (unchanged):**

```typescript
initRoomSession(io, {
  persistRoomMatchLog,
  onGameOver: createGameOverPersistScheduler,
  finalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room),
  resolveSocketIdentity,
  normalizeUsername,
  normalizeUserId,
  tryHydrateMatchmakingRoomShell,
  waitUntilMatchmakingRoomSocketsReady,
  onAfterMatchStarted,
  notifyRoomPlayersInGame,
  maybeFinalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room),
});
```

**`index.ts` import added (after):**

```typescript
import {
  tryHydrateMatchmakingRoomShell,
  waitUntilMatchmakingRoomSocketsReady,
} from './matchmaking/roomShellHydration';
```

**Unused imports removed from `index.ts`:** `createReservedRoom`, `peekRoom` (hydration-only).

---

## New module — full source (`server/src/matchmaking/roomShellHydration.ts`)

```typescript
import type { Server } from 'socket.io';
import { createReservedRoom, peekRoom } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';

/**
 * After Render/deploy the in-memory Map is empty but matchmaking still has an
 * `in_progress` row. Recreate a reserved room shell so players can re-seat;
 * game state is not restored (would require separate persisted snapshots).
 */
export async function tryHydrateMatchmakingRoomShell(
  roomCode: string,
): Promise<'skipped' | 'already' | 'hydrated' | 'miss'> {
  const code = roomCode.trim().toUpperCase();
  if (!code.startsWith('MM')) return 'skipped';
  if (peekRoom(code)) return 'already';
  try {
    const rows = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/matchmaking_matches?room_code=eq.${encodeURIComponent(code)}&status=eq.in_progress&select=id&limit=1`,
    );
    const id = typeof rows[0]?.id === 'string' ? rows[0].id : null;
    if (!id) return 'miss';
    const room = createReservedRoom(code, { winningScore: 60 });
    room.matchmakingMatchId = id;
    console.log('[room:hydrate] matchmaking shell restored', { roomCode: code, matchmakingMatchId: id });
    return 'hydrated';
  } catch (err) {
    console.warn('[room:hydrate] failed', err instanceof Error ? err.message : err);
    return 'miss';
  }
}

/** Matchmaking: allow the second client up to this long after both seats fill before attempting deal. */
export const MATCHMAKING_JOIN_SYNC_MAX_MS = 5000;

/**
 * Ensures both engine seat sockets have executed `socket.join(roomCode)` so the
 * subsequent `broadcastStateUpdate` reliably reaches everyone.
 */
export async function waitUntilMatchmakingRoomSocketsReady(
  io: Server,
  roomCode: string,
  engineSeatSocketIds: string[],
): Promise<void> {
  if (engineSeatSocketIds.length < 2) return;
  const deadline = Date.now() + MATCHMAKING_JOIN_SYNC_MAX_MS;
  while (Date.now() < deadline) {
    const members = io.sockets.adapter.rooms.get(roomCode);
    if (members && engineSeatSocketIds.every((id) => members.has(id))) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}
```

---

## Test file — full source (`server/src/matchmaking/roomShellHydration.test.ts`)

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import * as rooms from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import {
  MATCHMAKING_JOIN_SYNC_MAX_MS,
  tryHydrateMatchmakingRoomShell,
  waitUntilMatchmakingRoomSocketsReady,
} from './roomShellHydration';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

describe('tryHydrateMatchmakingRoomShell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'skipped' for non-MM-prefixed room codes", async () => {
    const fetchMock = vi.mocked(supabaseFetch);
    const peekSpy = vi.spyOn(rooms, 'peekRoom');

    const result = await tryHydrateMatchmakingRoomShell('PRIVATE1');

    expect(result).toBe('skipped');
    expect(peekSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'already' when the room is already in memory", async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue({ code: 'MM12345' } as rooms.Room);
    const fetchMock = vi.mocked(supabaseFetch);

    const result = await tryHydrateMatchmakingRoomShell('mm12345');

    expect(result).toBe('already');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'miss' when Supabase has no in_progress row", async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue(undefined);
    vi.mocked(supabaseFetch).mockResolvedValue([]);

    const result = await tryHydrateMatchmakingRoomShell('MMNOPE');

    expect(result).toBe('miss');
    expect(supabaseFetch).toHaveBeenCalledWith(
      '/rest/v1/matchmaking_matches?room_code=eq.MMNOPE&status=eq.in_progress&select=id&limit=1',
    );
  });

  it("returns 'hydrated' and sets matchmakingMatchId on the reserved shell", async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue(undefined);
    vi.mocked(supabaseFetch).mockResolvedValue([{ id: 'mm-match-1' }]);
    const created = { matchmakingMatchId: undefined as string | undefined };
    vi.spyOn(rooms, 'createReservedRoom').mockReturnValue(created as rooms.Room);

    const result = await tryHydrateMatchmakingRoomShell('MMHYDR');

    expect(result).toBe('hydrated');
    expect(rooms.createReservedRoom).toHaveBeenCalledWith('MMHYDR', { winningScore: 60 });
    expect(created.matchmakingMatchId).toBe('mm-match-1');
  });

  it("returns 'miss' when Supabase fetch throws", async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue(undefined);
    vi.mocked(supabaseFetch).mockRejectedValue(new Error('db_down'));

    const result = await tryHydrateMatchmakingRoomShell('MMERR');

    expect(result).toBe('miss');
  });
});

describe('waitUntilMatchmakingRoomSocketsReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function makeIo(membersForRoom: Set<string> | undefined): Server {
    return {
      sockets: {
        adapter: {
          rooms: {
            get: vi.fn(() => membersForRoom),
          },
        },
      },
    } as unknown as Server;
  }

  it('returns immediately when fewer than two engine seat socket ids are provided', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const io = makeIo(new Set(['sock-a']));

    await waitUntilMatchmakingRoomSocketsReady(io, 'MMROOM', ['sock-a']);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('returns immediately when both seat sockets are already in the room', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const io = makeIo(new Set(['sock-a', 'sock-b']));

    await waitUntilMatchmakingRoomSocketsReady(io, 'MMROOM', ['sock-a', 'sock-b']);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('polls every 50ms until both seat sockets join the room', async () => {
    let members = new Set<string>(['sock-a']);
    const io = makeIo(undefined);
    vi.mocked(io.sockets.adapter.rooms.get).mockImplementation(() => members);

    const pending = waitUntilMatchmakingRoomSocketsReady(io, 'MMROOM', ['sock-a', 'sock-b']);

    await vi.advanceTimersByTimeAsync(50);
    members = new Set(['sock-a', 'sock-b']);
    await vi.advanceTimersByTimeAsync(50);

    await pending;

    expect(io.sockets.adapter.rooms.get).toHaveBeenCalled();
  });

  it('stops polling after MATCHMAKING_JOIN_SYNC_MAX_MS even if sockets never join', async () => {
    const io = makeIo(new Set(['sock-a']));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const pending = waitUntilMatchmakingRoomSocketsReady(io, 'MMROOM', ['sock-a', 'sock-b']);

    await vi.advanceTimersByTimeAsync(MATCHMAKING_JOIN_SYNC_MAX_MS + 200);

    await pending;

    const pollDelays = setTimeoutSpy.mock.calls.map((call) => call[1]).filter((delay) => delay === 50);
    expect(pollDelays.length).toBeGreaterThan(0);
  });
});
```

---

## Test / build results

### Before (sub-phase 1 after-state; verified at task start)

| Command | Result |
|---------|--------|
| `cd server && npm test` | **61** files, **443** tests passed |
| `npm run build --prefix server` | ✓ `tsc -p tsconfig.json` |

**Discrepancy:** None — baseline matched sub-phase 1 report exactly.

### After (this change)

| Command | Result |
|---------|--------|
| `cd server && npm test` | **62** files (+1), **452** tests (+9) passed |
| `npm run build --prefix server` | ✓ `tsc -p tsconfig.json` |

---

## Frozen / out-of-scope confirmation

| System | Touched? |
|--------|----------|
| Legacy tournament block (`ENABLE_LEGACY_TOURNAMENTS` and contents) | **No** |
| `createGameOverPersistScheduler` | **No** |
| Presence (`socketsByUserId`, `emitPresenceUpdateToFriends`, `presence:identify` / `presence:online`) | **No** |
| Chat/emote socket handlers | **No** |
| `io` / `Server` / CORS setup | **No** |
| `registerMatchmakingHandlers` and existing `matchmaking/*.ts` files | **No** (new `roomShellHydration.ts` only) |
| `server/src/scheduled/dailyWarmup.ts` (sub-phase 1) | **No** |
| Phase 1 extractions (`server/src/http/**`, `server/src/shared/**`, `server/src/http/stores/**`) | **No** |
| `client/**` | **No** |
| `registerRoomSessionHandlers.ts` runtime logic | **No** (still consumes via `handlerDeps`) |

**Files changed by this task:**

| Path | Change |
|------|--------|
| `server/src/matchmaking/roomShellHydration.ts` | **New** — extracted hydration helpers |
| `server/src/matchmaking/roomShellHydration.test.ts` | **New** — 9 unit tests |
| `server/src/index.ts` | Removed helpers; import + unchanged `initRoomSession` wiring |
| `docs/phase-server-index-matchmaking-hydration-extraction-report.md` | **New** (this file) |