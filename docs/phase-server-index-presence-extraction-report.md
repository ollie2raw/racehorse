# Phase: Server `index.ts` Phase 2 Sub-phase 4 — Presence System Extraction

## Goal

Extract **only** the presence tracking system from `server/src/index.ts`. Zero behavior change. Preserve **single shared** `socketsByUserId` Map instance across league routes, friend invites, and presence handlers.

## Summary

| Item | Result |
|------|--------|
| New module | `server/src/social/registerPresenceHandlers.ts` (118 LOC) |
| New tests | `server/src/social/registerPresenceHandlers.test.ts` (218 LOC, 7 tests) |
| `index.ts` LOC | 1,390 → **1,330** (−60) |
| `socketsByUserId` declaration | **Stays in `index.ts`** (single instance preserved) |
| Behavior change | **None** |

---

## Full grep proof — every `socketsByUserId` consumer in `server/src/`

**Command:**

```bash
rg 'socketsByUserId' server/src
```

| File | Line(s) | Role |
|------|---------|------|
| `server/src/index.ts` | **453** | **Module-scope declaration** — `const socketsByUserId = new Map<string, Set<string>>()` |
| `server/src/index.ts` | **497** | Passed to `registerLeagueRoutes(app, { ..., socketsByUserId })` at module load |
| `server/src/index.ts` | **856** | `emitPresenceUpdateToFriends({ io, socketsByUserId }, ...)` in `notifyRoomPlayersInGame` |
| `server/src/index.ts` | **898** | Passed into `registerPresenceHandlers(socket, { ..., socketsByUserId })` |
| `server/src/index.ts` | **904** | Passed into `registerFriendInviteHandlers(io, socket, socketsByUserId, ...)` |
| `server/src/index.ts` | **915** | Read in `friend:invite:decline` handler (not extracted — stays in index) |
| `server/src/http/routes/league.ts` | **20** | Type on `LeagueRouteDeps` |
| `server/src/http/routes/league.ts` | **24** | Destructured from deps |
| `server/src/http/routes/league.ts` | **301** | `state.todaysOpponent.online = Boolean(opponentUserId && socketsByUserId.get(opponentUserId)?.size)` |
| `server/src/social/registerFriendInviteHandlers.ts` | **26** | Parameter type |
| `server/src/social/registerFriendInviteHandlers.ts` | **58** | `socketsByUserId.get(toUserId)` for invite delivery |
| `server/src/social/registerFriendInviteHandlers.test.ts` | **68, 91, 112, 135** | Test-local Map instances (not production) |
| `server/src/social/registerPresenceHandlers.ts` | **8, 16, 29, 42, 65, 79, 81, 97** | Reads/writes via `deps.socketsByUserId` parameter |
| `server/src/social/registerPresenceHandlers.test.ts` | multiple | Test-local Map instances |

**No other production consumers** outside this table.

---

## Single-Map-instance decision

**Decision:** Keep `const socketsByUserId = new Map<string, Set<string>>()` **in `index.ts`** at line 453. Do **not** instantiate a new Map inside the presence module.

**Reasoning:**

1. `registerLeagueRoutes(app, { socketsByUserId })` runs at **module load time** (line 493–497), before any socket connects. It holds a reference to the Map declared in `index.ts`.
2. `registerFriendInviteHandlers` and `friend:invite:decline` in `index.ts` also read the same Map by reference.
3. Moving the declaration into `registerPresenceHandlers.ts` would create a **second Map** unless carefully re-exported — league routes would retain a stale empty Map, breaking `todaysOpponent.online` presence checks.

**How sharing is preserved after extraction:**

- `index.ts` still owns the one Map instance.
- `registerPresenceHandlers(socket, { io, socketsByUserId, ... })` receives that Map **by reference** per connection.
- `emitPresenceUpdateToFriends({ io, socketsByUserId }, userId, status)` receives the same Map for `notifyRoomPlayersInGame` in-game broadcasts.
- No module-level Map inside `registerPresenceHandlers.ts`.

---

## Module path and naming justification

**Path:** `server/src/social/registerPresenceHandlers.ts`

**Reasoning:**

- Colocated with `social/presence.ts` (`upsertPresence`) and `registerFriendInviteHandlers.ts` (also receives `socketsByUserId`).
- `register*` prefix matches per-socket registration pattern from sub-phases 2–3.
- Presence is a social/friends concern (friend-list `presence:update` broadcasts), not core room engine logic.

---

## Moved pieces — before (from `server/src/index.ts`)

### `emitPresenceUpdateToFriends`

```typescript
// Emit presence:update to all sockets of friends who are currently connected.
function emitPresenceUpdateToFriends(userId: string, status: string): void {
  void (async () => {
    try {
      const enc = encodeURIComponent(userId);
      const rows = await supabaseFetch<Array<{ user_id: string; friend_user_id: string }>>(
        `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
        `&status=eq.accepted&select=user_id,friend_user_id`,
      );
      for (const r of rows) {
        const friendId = r.user_id === userId ? r.friend_user_id : r.user_id;
        const friendSockets = socketsByUserId.get(friendId);
        if (!friendSockets?.size) continue;
        for (const socketId of friendSockets) {
          io.to(socketId).emit('presence:update', { userId, status });
        }
      }
    } catch { /* non-critical */ }
  })();
}
```

### Per-connection presence block (inside `io.on('connection')`)

```typescript
  const removeSocketPresence = () => {
    const userId = normalizeUserId(socket.data?.userId);
    if (!userId) return;
    const set = socketsByUserId.get(userId);
    if (!set) return;
    set.delete(socket.id);
    if (set.size === 0) socketsByUserId.delete(userId);
  };

  socket.on(
    'presence:identify',
    async (payload: RoomJoinConfig, cb?: AckFn) => {
    try {
      const { username, userId } = await resolveSocketIdentity(payload ?? {});
      if (!userId) return cb?.({ ok: false });
      console.log('[presence] identify received', userId);
      removeSocketPresence();
      socket.data.userId = userId;
      socket.data.username = username;
      const existing = socketsByUserId.get(userId) ?? new Set<string>();
      existing.add(socket.id);
      socketsByUserId.set(userId, existing);
      void upsertPresence(userId, 'online').catch(() => {});
      emitPresenceUpdateToFriends(userId, 'online');
      cb?.({ ok: true });
    } catch {
      cb?.({ ok: false });
    }
  });

  socket.on('presence:online', (argUserIds: unknown, cb?: AckFn) => {
    const userIds = Array.isArray(argUserIds)
      ? argUserIds
          .map((id) => normalizeUserId(id))
          .filter((id): id is string => Boolean(id))
      : [];
    const onlineUserIds = userIds.filter((id) => (socketsByUserId.get(id)?.size ?? 0) > 0);
    console.log(
      '[presence] online check',
      JSON.stringify({
        requested: userIds.length,
        online: onlineUserIds.length,
        registeredUsers: socketsByUserId.size,
      }),
    );
    cb?.({ ok: true, onlineUserIds });
  });
```

### Disconnect presence lines (before)

```typescript
  socket.on('disconnect', () => {
    removeSocketPresence();
    const userId = normalizeUserId(socket.data?.userId);
    if (isUuidLike(userId)) {
      void upsertPresence(userId as string, 'offline').catch(() => {});
      emitPresenceUpdateToFriends(userId as string, 'offline');
    }
    const { wasActiveRoomPlayer, roomCode } = handleRoomPlayerDisconnect(io, socket);
    // ... Fritz forfeit / bot_match_pending logic unchanged ...
```

---

## After (`server/src/index.ts`)

**Map declaration unchanged:**

```typescript
const socketsByUserId = new Map<string, Set<string>>();
registerLeagueRoutes(app, {
  getAuthenticatedUserId,
  supabaseFetch,
  isAdminSecret,
  socketsByUserId,
});
```

**`notifyRoomPlayersInGame` (stays in index — uses extracted emit helper):**

```typescript
      emitPresenceUpdateToFriends({ io, socketsByUserId }, playerId, 'in_game');
```

**Connection handler:**

```typescript
  const { handlePresenceDisconnect } = registerPresenceHandlers(socket, {
    io,
    socketsByUserId,
    resolveSocketIdentity,
    normalizeUserId,
    isUuidLike,
  });
```

**Disconnect handler (presence lines only replaced):**

```typescript
  socket.on('disconnect', () => {
    handlePresenceDisconnect();
    const userId = normalizeUserId(socket.data?.userId);
    const { wasActiveRoomPlayer, roomCode } = handleRoomPlayerDisconnect(io, socket);
    if (isUuidLike(userId) && roomCode && wasActiveRoomPlayer) {
      // ... Fritz forfeit logic unchanged ...
```

**Import added:**

```typescript
import {
  emitPresenceUpdateToFriends,
  registerPresenceHandlers,
} from './social/registerPresenceHandlers';
```

---

## New module — full source (`server/src/social/registerPresenceHandlers.ts`)

```typescript
import type { Server, Socket } from 'socket.io';
import type { AckFn, RoomJoinConfig } from '../multiplayer/roomSession';
import { supabaseFetch } from '../supabaseUtils';
import { upsertPresence } from './presence';

export type PresenceHandlerDeps = {
  io: Server;
  socketsByUserId: Map<string, Set<string>>;
  resolveSocketIdentity: (config: RoomJoinConfig) => Promise<{ username: string; userId: string | null }>;
  normalizeUserId: (value: unknown) => string | null;
  isUuidLike: (value: string | null | undefined) => boolean;
};

// Emit presence:update to all sockets of friends who are currently connected.
export function emitPresenceUpdateToFriends(
  deps: Pick<PresenceHandlerDeps, 'io' | 'socketsByUserId'>,
  userId: string,
  status: string,
): void {
  void (async () => {
    try {
      const enc = encodeURIComponent(userId);
      const rows = await supabaseFetch<Array<{ user_id: string; friend_user_id: string }>>(
        `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
          `&status=eq.accepted&select=user_id,friend_user_id`,
      );
      for (const r of rows) {
        const friendId = r.user_id === userId ? r.friend_user_id : r.user_id;
        const friendSockets = deps.socketsByUserId.get(friendId);
        if (!friendSockets?.size) continue;
        for (const socketId of friendSockets) {
          deps.io.to(socketId).emit('presence:update', { userId, status });
        }
      }
    } catch {
      /* non-critical */
    }
  })();
}

export function createRemoveSocketPresence(
  socket: Socket,
  socketsByUserId: Map<string, Set<string>>,
  normalizeUserId: PresenceHandlerDeps['normalizeUserId'],
): () => void {
  return () => {
    const userId = normalizeUserId(socket.data?.userId);
    if (!userId) return;
    const set = socketsByUserId.get(userId);
    if (!set) return;
    set.delete(socket.id);
    if (set.size === 0) socketsByUserId.delete(userId);
  };
}

export function registerPresenceHandlers(
  socket: Socket,
  deps: PresenceHandlerDeps,
): {
  removeSocketPresence: () => void;
  handlePresenceDisconnect: () => void;
} {
  const removeSocketPresence = createRemoveSocketPresence(
    socket,
    deps.socketsByUserId,
    deps.normalizeUserId,
  );

  socket.on(
    'presence:identify',
    async (payload: RoomJoinConfig, cb?: AckFn) => {
      try {
        const { username, userId } = await deps.resolveSocketIdentity(payload ?? {});
        if (!userId) return cb?.({ ok: false });
        console.log('[presence] identify received', userId);
        removeSocketPresence();
        socket.data.userId = userId;
        socket.data.username = username;
        const existing = deps.socketsByUserId.get(userId) ?? new Set<string>();
        existing.add(socket.id);
        deps.socketsByUserId.set(userId, existing);
        void upsertPresence(userId, 'online').catch(() => {});
        emitPresenceUpdateToFriends(deps, userId, 'online');
        cb?.({ ok: true });
      } catch {
        cb?.({ ok: false });
      }
    },
  );

  socket.on('presence:online', (argUserIds: unknown, cb?: AckFn) => {
    const userIds = Array.isArray(argUserIds)
      ? argUserIds
          .map((id) => deps.normalizeUserId(id))
          .filter((id): id is string => Boolean(id))
      : [];
    const onlineUserIds = userIds.filter((id) => (deps.socketsByUserId.get(id)?.size ?? 0) > 0);
    console.log(
      '[presence] online check',
      JSON.stringify({
        requested: userIds.length,
        online: onlineUserIds.length,
        registeredUsers: deps.socketsByUserId.size,
      }),
    );
    cb?.({ ok: true, onlineUserIds });
  });

  const handlePresenceDisconnect = () => {
    removeSocketPresence();
    const userId = deps.normalizeUserId(socket.data?.userId);
    if (deps.isUuidLike(userId)) {
      void upsertPresence(userId as string, 'offline').catch(() => {});
      emitPresenceUpdateToFriends(deps, userId as string, 'offline');
    }
  };

  return { removeSocketPresence, handlePresenceDisconnect };
}
```

---

## Test file — full source (`server/src/social/registerPresenceHandlers.test.ts`)

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
import { supabaseFetch } from '../supabaseUtils';
import * as presence from './presence';
import {
  createRemoveSocketPresence,
  emitPresenceUpdateToFriends,
  registerPresenceHandlers,
} from './registerPresenceHandlers';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

vi.mock('./presence', () => ({
  upsertPresence: vi.fn().mockResolvedValue(undefined),
}));

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';

const isUuidLike = (value: string | null | undefined): boolean =>
  Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );

type HandlerMap = Record<string, (...args: unknown[]) => unknown>;

function createSocketStub(overrides: {
  id?: string;
  data?: Record<string, unknown>;
} = {}): Socket {
  return {
    id: overrides.id ?? 'sock-1',
    data: overrides.data ?? {},
    on: vi.fn(),
  } as unknown as Socket;
}

function captureHandlers(socket: Socket): HandlerMap {
  const handlers: HandlerMap = {};
  vi.mocked(socket.on).mockImplementation((event: string, handler: (...args: unknown[]) => unknown) => {
    handlers[event] = handler;
    return socket;
  });
  return handlers;
}

describe('createRemoveSocketPresence', () => {
  const normalizeUserId = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  it('removes socket id and deletes map entry when last socket for user disconnects', () => {
    const socketsByUserId = new Map<string, Set<string>>([[USER_A, new Set(['sock-1', 'sock-2'])]]);
    const socket = createSocketStub({ id: 'sock-1', data: { userId: USER_A } });
    const remove = createRemoveSocketPresence(socket, socketsByUserId, normalizeUserId);

    remove();

    expect(socketsByUserId.get(USER_A)?.has('sock-1')).toBe(false);
    expect(socketsByUserId.get(USER_A)?.has('sock-2')).toBe(true);

    const socket2 = createSocketStub({ id: 'sock-2', data: { userId: USER_A } });
    createRemoveSocketPresence(socket2, socketsByUserId, normalizeUserId)();

    expect(socketsByUserId.has(USER_A)).toBe(false);
  });
});

describe('registerPresenceHandlers', () => {
  const normalizeUserId = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('presence:identify registers socket and upserts online presence on success', async () => {
    const socketsByUserId = new Map<string, Set<string>>();
    const socket = createSocketStub({ id: 'sock-a' });
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const resolveSocketIdentity = vi.fn().mockResolvedValue({ username: 'Alice', userId: USER_A });
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId,
      resolveSocketIdentity,
      normalizeUserId,
      isUuidLike,
    });

    await handlers['presence:identify']({ username: 'Alice' }, cb);

    expect(cb).toHaveBeenCalledWith({ ok: true });
    expect(socket.data.userId).toBe(USER_A);
    expect(socketsByUserId.get(USER_A)?.has('sock-a')).toBe(true);
    expect(presence.upsertPresence).toHaveBeenCalledWith(USER_A, 'online');
  });

  it('presence:identify returns ok:false when identity has no userId', async () => {
    const socketsByUserId = new Map<string, Set<string>>();
    const socket = createSocketStub();
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId,
      resolveSocketIdentity: vi.fn().mockResolvedValue({ username: 'Guest', userId: null }),
      normalizeUserId,
      isUuidLike,
    });

    await handlers['presence:identify']({}, cb);

    expect(cb).toHaveBeenCalledWith({ ok: false });
    expect(socketsByUserId.size).toBe(0);
  });

  it('presence:identify returns ok:false when resolveSocketIdentity throws', async () => {
    const socketsByUserId = new Map<string, Set<string>>();
    const socket = createSocketStub();
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId,
      resolveSocketIdentity: vi.fn().mockRejectedValue(new Error('auth_failed')),
      normalizeUserId,
      isUuidLike,
    });

    await handlers['presence:identify']({}, cb);

    expect(cb).toHaveBeenCalledWith({ ok: false });
  });

  it('presence:online returns only user ids with connected sockets', () => {
    const socketsByUserId = new Map<string, Set<string>>([
      [USER_A, new Set(['sock-a'])],
      [USER_B, new Set(['sock-b'])],
    ]);
    const socket = createSocketStub();
    const handlers = captureHandlers(socket);
    const cb = vi.fn();
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;

    registerPresenceHandlers(socket, {
      io,
      socketsByUserId,
      resolveSocketIdentity: vi.fn(),
      normalizeUserId,
      isUuidLike,
    });

    handlers['presence:online']([USER_A, USER_C, 'not-a-uuid'], cb);

    expect(cb).toHaveBeenCalledWith({ ok: true, onlineUserIds: [USER_A] });
  });

  it('handlePresenceDisconnect removes socket and upserts offline for uuid users', () => {
    const socketsByUserId = new Map<string, Set<string>>([[USER_A, new Set(['sock-a'])]]);
    const socket = createSocketStub({ id: 'sock-a', data: { userId: USER_A } });
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    vi.mocked(supabaseFetch).mockResolvedValue([]);

    const { handlePresenceDisconnect } = registerPresenceHandlers(socket, {
      io,
      socketsByUserId,
      resolveSocketIdentity: vi.fn(),
      normalizeUserId,
      isUuidLike,
    });

    handlePresenceDisconnect();

    expect(socketsByUserId.has(USER_A)).toBe(false);
    expect(presence.upsertPresence).toHaveBeenCalledWith(USER_A, 'offline');
  });
});

describe('emitPresenceUpdateToFriends', () => {
  beforeEach(() => {
    vi.mocked(supabaseFetch).mockReset();
  });

  it('emits presence:update only to connected friend sockets', async () => {
    const friendEmit = vi.fn();
    const io = {
      to: vi.fn((socketId: string) => ({
        emit: socketId === 'sock-friend' ? friendEmit : vi.fn(),
      })),
    } as unknown as Server;
    const socketsByUserId = new Map<string, Set<string>>([[USER_B, new Set(['sock-friend'])]]);

    vi.mocked(supabaseFetch).mockResolvedValue([
      { user_id: USER_A, friend_user_id: USER_B },
      { user_id: USER_A, friend_user_id: USER_C },
    ]);

    emitPresenceUpdateToFriends({ io, socketsByUserId }, USER_A, 'online');
    await Promise.resolve();
    await Promise.resolve();

    expect(friendEmit).toHaveBeenCalledWith('presence:update', { userId: USER_A, status: 'online' });
    expect(io.to).toHaveBeenCalledTimes(1);
    expect(io.to).toHaveBeenCalledWith('sock-friend');
    expect(supabaseFetch).toHaveBeenCalledWith(
      `/rest/v1/friends?or=(user_id.eq.${encodeURIComponent(USER_A)},friend_user_id.eq.${encodeURIComponent(USER_A)})&status=eq.accepted&select=user_id,friend_user_id`,
    );
  });
});
```

---

## Test / build results

### Before (sub-phase 3 after-state; verified at task start)

| Command | Result |
|---------|--------|
| `cd server && npm test` | **63** files, **462** tests passed |
| `npm run build --prefix server` | ✓ `tsc -p tsconfig.json` |

**Discrepancy:** None — baseline matched sub-phase 3 report exactly.

### After (this change)

| Command | Result |
|---------|--------|
| `cd server && npm test` | **64** files (+1), **469** tests (+7) passed |
| `npm run build --prefix server` | ✓ `tsc -p tsconfig.json` |

---

## Frozen / out-of-scope confirmation

| System | Touched? |
|--------|----------|
| Legacy tournament block (`ENABLE_LEGACY_TOURNAMENTS` and contents) | **No** |
| `createGameOverPersistScheduler` | **No** |
| Matchmaking room-shell hydration (`roomShellHydration.ts`) | **No** |
| Chat/emote handlers (`registerRoomChatEmoteHandlers.ts`) | **No** |
| Daily warmup scheduling (`scheduled/dailyWarmup.ts`) | **No** |
| Global `SOCKET_EVENT_LIMITS` / `installSocketRateLimit` | **No** |
| `io` / `Server` / CORS setup | **No** |
| `registerFriendInviteHandlers` module | **No** (still called from index with same Map ref) |
| `registerLeagueRoutes` / `http/routes/league.ts` | **No** (same Map ref at module load) |
| Disconnect handler — room player / Fritz forfeit / `bot_match_pending` | **No** (only presence prefix replaced) |
| `client/**` | **No** |

**Files changed by this task:**

| Path | Change |
|------|--------|
| `server/src/social/registerPresenceHandlers.ts` | **New** — presence handlers + friend broadcast |
| `server/src/social/registerPresenceHandlers.test.ts` | **New** — 7 unit tests |
| `server/src/index.ts` | Map stays; inline presence removed; import + wiring |
| `docs/phase-server-index-presence-extraction-report.md` | **New** (this file) |