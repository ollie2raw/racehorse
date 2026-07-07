# Phase: Server `index.ts` Phase 2 Sub-phase 3 — Chat/Emote Socket Handler Extraction

## Goal

Extract **only** the `room:chat:send` and `room:emote:send` socket handlers and their **local** per-socket token-bucket rate limiters from `server/src/index.ts`. Zero behavior change.

## Summary

| Item | Result |
|------|--------|
| New module | `server/src/multiplayer/registerRoomChatEmoteHandlers.ts` (83 LOC) |
| New tests | `server/src/multiplayer/registerRoomChatEmoteHandlers.test.ts` (180 LOC, 10 tests) |
| `index.ts` LOC | 1,460 → **1,390** (−70) |
| Behavior change | **None** |
| Per-socket rate limiter scoping | **Preserved** (see below) |

---

## Grep proof — `nowMs` / `clampString` usage inside `io.on('connection')`

**Command:**

```bash
rg 'nowMs|clampString' server/src/index.ts
```

**Before extraction (inside connection handler only):**

| Symbol | Lines | Consumers |
|--------|-------|-----------|
| `nowMs` | 985 (definition), 993, 995, 1018, 1019, 1043, 1044 | `makeRateLimiter` + chat/emote message `id`/`t` fields only |
| `clampString` | 986 (definition), 1014, 1039 | chat text (200) and emote (16) only |

**After extraction:** no `nowMs` or `clampString` remain in `index.ts`.

**Conclusion:** Both helpers were **chat/emote-only** inside the connection handler. No other connection-handler consumer existed. **Decision: move both helpers with the handlers** (no duplication, no shared stub left in `index.ts`).

`makeRateLimiter`, `canSendChat`, and `canSendEmote` were likewise only used by the two handlers.

---

## Per-socket rate-limiter scoping — explicit confirmation

**Before:** Inside `io.on('connection', (socket) => { ... })`, each new connection executed:

```typescript
const canSendChat = makeRateLimiter(6, 10_000);
const canSendEmote = makeRateLimiter(10, 10_000);
```

`makeRateLimiter` closes over `tokens` and `last` — **fresh closure per connection**.

**After:** `index.ts` calls `registerRoomChatEmoteHandlers(socket)` once per connection. That function body contains the identical `makeRateLimiter` invocations **before** registering `socket.on(...)` handlers:

```typescript
export function registerRoomChatEmoteHandlers(socket: Socket): void {
  const canSendChat = makeRateLimiter(6, 10_000);
  const canSendEmote = makeRateLimiter(10, 10_000);
  socket.on('room:chat:send', ...);
  socket.on('room:emote:send', ...);
}
```

- **No module-level** `canSendChat` / `canSendEmote` singleton.
- **No ref bridge** — handlers close over the `socket` parameter passed per call.
- **Test proof:** `registers independent chat and emote limiters per socket` — first socket exhausts 6 chat messages; second socket on same room still emits.

This is **not** the global `installSocketRateLimit` / `SOCKET_EVENT_LIMITS` mechanism (unchanged, still applied before chat/emote registration).

---

## Module path and naming justification

**Path:** `server/src/multiplayer/registerRoomChatEmoteHandlers.ts`

**Reasoning (mirrors prior extractions):**

- **Colocation:** Room-level realtime behavior lives beside `registerRoomSessionHandlers.ts` and `roomSession.ts`.
- **Naming pattern:** `register*` prefix matches `registerFriendInviteHandlers`, `registerRoomSessionHandlers` — one function called per `io.on('connection')` socket.
- **Single concern:** Local chat/emote token buckets + `room:chat` / `room:emote` broadcast — not presence, matchmaking, or global rate limits.

---

## Moved code — before (from `server/src/index.ts` inside `io.on('connection')`)

```typescript
  const nowMs = () => Date.now();
  const clampString = (s: string, max: number) => {
    const t = (s ?? '').trim();
    return t.length > max ? t.slice(0, max) : t;
  };

  const makeRateLimiter = (burst: number, perMs: number) => {
    let tokens = burst;
    let last = nowMs();
    return () => {
      const t = nowMs();
      const refill = ((t - last) / perMs) * burst;
      tokens = Math.min(burst, tokens + refill);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };
  };

  const canSendChat = makeRateLimiter(6, 10_000);
  const canSendEmote = makeRateLimiter(10, 10_000);

  socket.on('room:chat:send', (payload: { text: string }) => {
    try {
      if (!canSendChat()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const text = clampString(String(payload?.text ?? ''), 200);
      if (!text) return;

      const msg = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        text,
      };

      socket.to(roomId).emit('room:chat', msg);
    } catch (e) {
      console.warn('room:chat:send failed', e);
    }
  });

  socket.on('room:emote:send', (payload: { emote: string }) => {
    try {
      if (!canSendEmote()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const emote = clampString(String(payload?.emote ?? ''), 16);
      if (!emote) return;

      const evt = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        emote,
      };

      socket.to(roomId).emit('room:emote', evt);
    } catch (e) {
      console.warn('room:emote:send failed', e);
    }
  });
```

## After (`server/src/index.ts`)

```typescript
  registerRoomChatEmoteHandlers(socket);
```

**Import added:**

```typescript
import { registerRoomChatEmoteHandlers } from './multiplayer/registerRoomChatEmoteHandlers';
```

**Connection-handler order preserved:** `installSocketRateLimit(socket)` → matchmaking → tournament → `registerRoomSessionHandlers` → presence/friend handlers → **`registerRoomChatEmoteHandlers(socket)`** → `stats:weekly` → disconnect.

---

## New module — full source (`server/src/multiplayer/registerRoomChatEmoteHandlers.ts`)

```typescript
import type { Socket } from 'socket.io';

const nowMs = () => Date.now();

function clampString(s: string, max: number) {
  const t = (s ?? '').trim();
  return t.length > max ? t.slice(0, max) : t;
}

function makeRateLimiter(burst: number, perMs: number, readNowMs: () => number = nowMs) {
  let tokens = burst;
  let last = readNowMs();
  return () => {
    const t = readNowMs();
    const refill = ((t - last) / perMs) * burst;
    tokens = Math.min(burst, tokens + refill);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/** Registers per-socket room chat/emote handlers with independent token-bucket limits. */
export function registerRoomChatEmoteHandlers(socket: Socket): void {
  const canSendChat = makeRateLimiter(6, 10_000);
  const canSendEmote = makeRateLimiter(10, 10_000);

  socket.on('room:chat:send', (payload: { text: string }) => {
    try {
      if (!canSendChat()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const text = clampString(String(payload?.text ?? ''), 200);
      if (!text) return;

      const msg = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        text,
      };

      socket.to(roomId).emit('room:chat', msg);
    } catch (e) {
      console.warn('room:chat:send failed', e);
    }
  });

  socket.on('room:emote:send', (payload: { emote: string }) => {
    try {
      if (!canSendEmote()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const emote = clampString(String(payload?.emote ?? ''), 16);
      if (!emote) return;

      const evt = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        emote,
      };

      socket.to(roomId).emit('room:emote', evt);
    } catch (e) {
      console.warn('room:emote:send failed', e);
    }
  });
}

/** @internal Exported for unit tests only — not part of the public server API. */
export const __roomChatEmoteTestUtils = {
  clampString,
  makeRateLimiter,
};
```

**Note:** `makeRateLimiter` accepts an optional `readNowMs` injectable **only for unit tests** (default `nowMs` = `Date.now()`). Production calls use the default — identical runtime behavior.

---

## Test file — full source (`server/src/multiplayer/registerRoomChatEmoteHandlers.test.ts`)

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import {
  __roomChatEmoteTestUtils,
  registerRoomChatEmoteHandlers,
} from './registerRoomChatEmoteHandlers';

const { clampString, makeRateLimiter } = __roomChatEmoteTestUtils;

type HandlerMap = Record<string, (payload: unknown) => void>;

function createSocketStub(overrides: {
  data?: Record<string, unknown>;
  emit?: ReturnType<typeof vi.fn>;
} = {}): { socket: Socket; handlers: HandlerMap; roomEmit: ReturnType<typeof vi.fn> } {
  const handlers: HandlerMap = {};
  const roomEmit = overrides.emit ?? vi.fn();
  const socket = {
    data: overrides.data ?? {},
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers[event] = handler;
    }),
    to: vi.fn(() => ({ emit: roomEmit })),
  } as unknown as Socket;
  return { socket, handlers, roomEmit };
}

describe('clampString', () => {
  it('trims and clamps chat text to max length', () => {
    expect(clampString('  hello  ', 200)).toBe('hello');
    expect(clampString('x'.repeat(250), 200)).toBe('x'.repeat(200));
  });

  it('trims and clamps emote text to 16 chars', () => {
    expect(clampString('  wave  ', 16)).toBe('wave');
    expect(clampString('abcdefghijklmnopqrs', 16)).toBe('abcdefghijklmnop');
  });
});

describe('makeRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows burst sends then blocks until tokens refill', () => {
    let now = 0;
    const limiter = makeRateLimiter(3, 10_000, () => now);

    expect(limiter()).toBe(true);
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(false);

    now = 5_000;
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(false);

    now = 15_000;
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(false);
  });
});

describe('registerRoomChatEmoteHandlers', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers independent chat and emote limiters per socket', () => {
    const first = createSocketStub({
      data: { roomId: 'ROOM1', userId: 'u1', username: 'A' },
    });
    const second = createSocketStub({
      data: { roomId: 'ROOM1', userId: 'u2', username: 'B' },
    });
    registerRoomChatEmoteHandlers(first.socket);
    registerRoomChatEmoteHandlers(second.socket);

    for (let i = 0; i < 6; i += 1) {
      first.handlers['room:chat:send']({ text: `msg-${i}` });
    }
    first.handlers['room:chat:send']({ text: 'blocked' });
    expect(first.roomEmit).toHaveBeenCalledTimes(6);

    second.handlers['room:chat:send']({ text: 'still-ok' });
    expect(second.roomEmit).toHaveBeenCalledTimes(1);
  });

  it('no-ops chat when roomId is missing', () => {
    const { socket, handlers, roomEmit } = createSocketStub({ data: {} });
    registerRoomChatEmoteHandlers(socket);

    handlers['room:chat:send']({ text: 'hello' });

    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('no-ops chat when rate-limited', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM1', userId: 'u1', username: 'A' },
    });
    registerRoomChatEmoteHandlers(socket);

    for (let i = 0; i < 6; i += 1) {
      handlers['room:chat:send']({ text: `msg-${i}` });
    }
    handlers['room:chat:send']({ text: 'blocked' });

    expect(roomEmit).toHaveBeenCalledTimes(6);
    expect(roomEmit.mock.calls.at(-1)?.[1]).toMatchObject({ text: 'msg-5' });
  });

  it('emits chat payload with expected shape via socket.to(roomId)', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM9', userId: 'user-1', username: 'Alice' },
    });
    registerRoomChatEmoteHandlers(socket);

    handlers['room:chat:send']({ text: '  hello world  ' });

    expect(socket.to).toHaveBeenCalledWith('ROOM9');
    expect(roomEmit).toHaveBeenCalledWith('room:chat', {
      id: expect.stringMatching(/^1700000000000-/),
      t: 1_700_000_000_000,
      from: { userId: 'user-1', username: 'Alice' },
      text: 'hello world',
    });
  });

  it('no-ops emote when roomId is missing', () => {
    const { socket, handlers, roomEmit } = createSocketStub({ data: {} });
    registerRoomChatEmoteHandlers(socket);

    handlers['room:emote:send']({ emote: 'wave' });

    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('no-ops emote when rate-limited', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM1', userId: 'u1', username: 'A' },
    });
    registerRoomChatEmoteHandlers(socket);

    for (let i = 0; i < 10; i += 1) {
      handlers['room:emote:send']({ emote: `e${i}` });
    }
    handlers['room:emote:send']({ emote: 'blocked' });

    expect(roomEmit).toHaveBeenCalledTimes(10);
  });

  it('emits emote payload with expected shape via socket.to(roomId)', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM9', userId: 'user-1', username: 'Alice' },
    });
    registerRoomChatEmoteHandlers(socket);

    handlers['room:emote:send']({ emote: '  thumbsup  ' });

    expect(socket.to).toHaveBeenCalledWith('ROOM9');
    expect(roomEmit).toHaveBeenCalledWith('room:emote', {
      id: expect.stringMatching(/^1700000000000-/),
      t: 1_700_000_000_000,
      from: { userId: 'user-1', username: 'Alice' },
      emote: 'thumbsup',
    });
  });
});
```

---

## Test / build results

### Before (sub-phase 2 after-state; verified at task start)

| Command | Result |
|---------|--------|
| `cd server && npm test` | **62** files, **452** tests passed |
| `npm run build --prefix server` | ✓ `tsc -p tsconfig.json` |

**Discrepancy:** None — baseline matched sub-phase 2 report exactly.

### After (this change)

| Command | Result |
|---------|--------|
| `cd server && npm test` | **63** files (+1), **462** tests (+10) passed |
| `npm run build --prefix server` | ✓ `tsc -p tsconfig.json` |

---

## Frozen / out-of-scope confirmation

| System | Touched? |
|--------|----------|
| Legacy tournament block (`ENABLE_LEGACY_TOURNAMENTS` and contents) | **No** |
| `createGameOverPersistScheduler` | **No** |
| Presence (`socketsByUserId`, `emitPresenceUpdateToFriends`, `presence:identify` / `presence:online`, `friend:invite` handlers) | **No** |
| Matchmaking room-shell hydration (`roomShellHydration.ts`) | **No** |
| Daily warmup scheduling (`scheduled/dailyWarmup.ts`) | **No** |
| Global `SOCKET_EVENT_LIMITS` / `installSocketRateLimit` | **No** |
| `io` / `Server` / CORS setup | **No** |
| `client/**` | **No** |

**Files changed by this task:**

| Path | Change |
|------|--------|
| `server/src/multiplayer/registerRoomChatEmoteHandlers.ts` | **New** — per-socket chat/emote registration |
| `server/src/multiplayer/registerRoomChatEmoteHandlers.test.ts` | **New** — 10 unit tests |
| `server/src/index.ts` | Inline handlers replaced with `registerRoomChatEmoteHandlers(socket)` |
| `docs/phase-server-index-chat-emote-extraction-report.md` | **New** (this file) |