# Phase: Server `index.ts` Phase 2 Sub-phase 5 — Legacy Tournament System Extraction

## Goal

Extract **only** the legacy ad-hoc tournament system gated by `ENABLE_LEGACY_TOURNAMENTS === '1'` from `server/src/index.ts`. This is **distinct** from `initScheduledTournaments` / `scheduledTournament/**` (the new scheduled-tournament system — untouched). Zero behavior change, including the documented **last-connection-wins** `finalizeTournamentMatchHook` reassignment quirk.

## Summary

| Item | Result |
|------|--------|
| New module | `server/src/legacyTournament/registerLegacyTournamentHandlers.ts` (337 LOC) |
| New tests | `server/src/legacyTournament/registerLegacyTournamentHandlers.test.ts` (353 LOC, 10 tests) |
| `index.ts` LOC | 1,330 → **1,051** (−279) |
| `finalizeTournamentMatchHook` | **Stays in `index.ts`** (module-level `let`, reassigned per connection) |
| `globalThis` storage | **Preserved exactly** (`__tournamentsById`, `__tournamentsByCode`) |
| Behavior change | **None** |

---

## Full grep proof — `finalizeTournamentMatchHook` across `server/src/`

**Command:**

```bash
rg 'finalizeTournamentMatchHook' server/src
```

| File | Line(s) | Role |
|------|---------|------|
| `server/src/index.ts` | **540** | Module-scope declaration: `let finalizeTournamentMatchHook: ((room: any) => void) \| null = null;` |
| `server/src/index.ts` | **857** | `initRoomSession` → `finalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room)` (wired at module load) |
| `server/src/index.ts` | **865** | `initRoomSession` → `maybeFinalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room)` (wired at module load) |
| `server/src/index.ts` | **935** | Inside `if (ENABLE_LEGACY_TOURNAMENTS)` → `finalizeTournamentMatchHook = registerLegacyTournamentHandlers(...)` (reassigned per connection) |
| `server/src/legacyTournament/registerLegacyTournamentHandlers.ts` | **171** | JSDoc comment only — no production read/write of the hook variable |

**No other production references** to the identifier `finalizeTournamentMatchHook` exist in `server/src/`.

**Related (not the hook variable):** `maybeFinalizeTournamentMatch` / `finalizeTournamentMatch` are **callback slots** on `initRoomSession` deps (`roomSession.ts`, `registerRoomSessionHandlers.ts`) and are stubbed in various test files. Those slots still delegate to `finalizeTournamentMatchHook?.(room)` from `index.ts` — unchanged.

---

## Closure / reassignment behavior — explicit analysis

### How it worked before extraction

1. **Module load (before any socket connects):** `initRoomSession(io, { finalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room), maybeFinalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room), ... })` captures closures that **read** the module-level `finalizeTournamentMatchHook` variable by reference. At this point the hook is `null`.

2. **Each `io.on('connection')` when `ENABLE_LEGACY_TOURNAMENTS === '1'`:** Inside the connection handler, local functions `emitTournament`, `startNextMatch`, `maybeFinalizeTournamentMatch` were created, then `finalizeTournamentMatchHook = maybeFinalizeTournamentMatch` **reassigned** the module-level variable to the latest connection's closure.

3. **Last-connection-wins:** If multiple sockets connect with the flag on, each overwrites `finalizeTournamentMatchHook`. Whichever socket connected **most recently** owns the hook reference until the next connection.

### Does `maybeFinalizeTournamentMatch` capture per-socket state?

| Function | Captures `socket`? | Used by hook? |
|----------|-------------------|---------------|
| `maybeFinalizeTournamentMatch` | **No** | **Yes** (assigned to hook) |
| `emitTournament` | No (uses `io` only) | Indirectly via `maybeFinalize` / `startNextMatch` |
| `startNextMatch` | No (uses `io`, room helpers) | Indirectly via `maybeFinalize` |
| `getTournamentForSocket` | **Yes** (`socket.data.tournamentId`) | **No** — only used by `tournament:start` handler |

**Conclusion:** The hook closure (`maybeFinalizeTournamentMatch`) does **not** read `socket` directly. It uses `tournamentsById` (from `globalThis`), `emitTournament`, and `startNextMatch`. Reassigning the hook on every connection creates **functionally equivalent** closures (same shared `io`, same shared `globalThis` maps). The reassignment is therefore **behavior-neutral today** but is **intentionally preserved** because it is undocumented cross-connection coupling that this initiative surfaces rather than silently "fixes."

### How extraction preserves the quirk

| Piece | Location after extraction | Preserved? |
|-------|---------------------------|------------|
| `let finalizeTournamentMatchHook` | `index.ts` line 540 | ✅ |
| `initRoomSession` hook wiring | `index.ts` lines 857, 865 | ✅ unchanged lambdas |
| Per-connection reassignment | `index.ts` lines 933–939 | ✅ `finalizeTournamentMatchHook = registerLegacyTournamentHandlers(...)` |
| `ENABLE_LEGACY_TOURNAMENTS` gating | `index.ts` — block skipped when flag off | ✅ |
| `registerLegacyTournamentHandlers` return value | Returns `maybeFinalizeTournamentMatch` built per call | ✅ new closure per connection, same as before |

**No ref bridge** beyond the existing module-level `let` + reassignment. The extracted module does **not** own or export `finalizeTournamentMatchHook`.

---

## Module path and naming justification

**Path:** `server/src/legacyTournament/registerLegacyTournamentHandlers.ts`

**Reasoning:**

- **`legacyTournament/`** — clearly separates the `ENABLE_LEGACY_TOURNAMENTS` ad-hoc system from `scheduledTournament/**` (new system, untouched).
- **`register*`** prefix — matches `registerPresenceHandlers`, `registerRoomChatEmoteHandlers`, `registerMatchmakingHandlers` (per-socket registration inside `io.on('connection')`).
- **Returns hook function** — unique among register modules because `index.ts` must reassign `finalizeTournamentMatchHook` with the per-connection `maybeFinalizeTournamentMatch` closure.

---

## `globalThis` storage — preserved, not cleaned up

**Before and after:** Tournament state lives on:

```typescript
(globalThis as any).__tournamentsById ??= new Map<string, Tournament>();
(globalThis as any).__tournamentsByCode ??= new Map<string, string>();
```

Handler writes in `tournament:create` still use `(globalThis as any).__tournamentsById.set(...)` directly (not a module-local Map alias) — identical to before.

**Follow-up suggestion (not acted on):** Consider documenting whether `globalThis` backing is intentional for dev hot-reload survival vs. an accident. Migrating to module-level Maps would be a separate behavior-relevant decision.

---

## Moved pieces — before (from `server/src/index.ts`)

### Module-scope hook (stayed in `index.ts` — not moved)

```typescript
let finalizeTournamentMatchHook: ((room: any) => void) | null = null;
```

### Inside `io.on('connection')` — full legacy block (lines 946–1219 before extraction)

```typescript
  // TOURNAMENT_HELPERS
  const ENABLE_LEGACY_TOURNAMENTS = process.env.ENABLE_LEGACY_TOURNAMENTS === '1';
  if (ENABLE_LEGACY_TOURNAMENTS) {
    // Global in-memory tournament storage (per server process).
    const tournamentsById = ((globalThis as any).__tournamentsById ??= new Map<string, Tournament>()) as Map<
      string,
      Tournament
    >;
    const tournamentsByCode = ((globalThis as any).__tournamentsByCode ??= new Map<string, string>()) as Map<
      string,
      string
    >;

  const emitTournament = (t: Tournament) => {
    const standings = sortedStandings(t.standings);
    io.to(`tourn:${t.id}`).emit('tournament:state', {
      id: t.id,
      hostSocketId: t.hostSocketId,
      lobbyCode: t.lobbyCode,
      status: t.status,
      players: t.players,
      matches: t.matches,
      currentMatchIndex: t.currentMatchIndex,
      activeMatchId: t.activeMatchId ?? null,
      activeRoomCode: t.activeRoomCode ?? null,
      standings,
    });
  };

  const getTournamentForSocket = (): Tournament | null => {
    const tid = (socket.data?.tournamentId as string | undefined) ?? undefined;
    if (!tid) return null;
    return tournamentsById.get(tid) ?? null;
  };

  const startNextMatch = (t: Tournament) => {
    // advance to next pending match
    while (t.currentMatchIndex < t.matches.length && t.matches[t.currentMatchIndex].status === 'done') {
      t.currentMatchIndex += 1;
    }
    if (t.currentMatchIndex >= t.matches.length) {
      t.status = 'complete';
      t.activeMatchId = null;
      t.activeRoomCode = null;
      emitTournament(t);
      return;
    }

    const m = t.matches[t.currentMatchIndex];
    m.status = 'active';
    t.activeMatchId = m.id;

    // Create a normal 2-player room for this match with a 30-point winning score.
    // Attach tournament metadata so we can record results later on gameOver.
    const seatA = allocatePlayerSeatId();
    const seatB = allocatePlayerSeatId();
    const room = createRoom(seatA, {
      winningScore: 30,
      tournamentId: t.id,
      tournamentMatchId: m.id,
      tournamentMode: 'round_robin',
    } as any);

    // Defensive: ensure config is accessible later even if createRoom doesn't persist arbitrary config
    (room as any).config = { ...(room as any).config, winningScore: 30, tournamentId: t.id, tournamentMatchId: m.id };

    m.roomCode = room.code;
    t.activeRoomCode = room.code;

    // Join the second player in the engine + socket room
    joinRoom(room.code, seatB);
    joinSocketToRoom(m.a, room.code, ['tourn:']);
    joinSocketToRoom(m.b, room.code, ['tourn:']);

    // Room roster for UI
    const pa = t.players.find((p) => p.socketId === m.a);
    const pb = t.players.find((p) => p.socketId === m.b);
    const roomPlayers = [
      { id: seatA, socketId: m.a, username: pa?.username ?? 'Player', userId: pa?.userId ?? null },
      { id: seatB, socketId: m.b, username: pb?.username ?? 'Player', userId: pb?.userId ?? null },
    ];
    setRoomRoster(room.code, roomPlayers);
    io.to(room.code).emit('room:update', { players: roomPlayers });

    // Announce active match (players + spectators)
    io.to(`tourn:${t.id}`).emit('tournament:match:assigned', {
      matchId: m.id,
      roomCode: room.code,
      a: m.a,
      b: m.b,
      aName: roomPlayers[0].username,
      bName: roomPlayers[1].username,
    });

    // Deal is broadcast after both seated clients emit player:ready (see player:ready handler).
    emitTournament(t);

  };

  const maybeFinalizeTournamentMatch = (room: any) => {
    if (!room?.state?.gameOver) return;

    const cfg = (room as any).config ?? {};
    const tid = cfg.tournamentId as string | undefined;
    const mid = cfg.tournamentMatchId as string | undefined;
    if (!tid || !mid) return;

    const t = tournamentsById.get(tid);
    if (!t) return;

    const match = t.matches.find((mm) => mm.id === mid);
    if (!match || match.status === 'done') return;
    if (t.activeMatchId && t.activeMatchId !== mid) {
      console.warn('[tournament] ignoring stale gameOver for non-active match', {
        tournamentId: tid,
        activeMatchId: t.activeMatchId,
        reportedMatchId: mid,
      });
      return;
    }

    const a = match.a;
    const b = match.b;
    const scoreA = room.state.players[a]?.score ?? 0;
    const scoreB = room.state.players[b]?.score ?? 0;
    const winner = scoreA >= scoreB ? a : b;

    applyResult(t, mid, winner, scoreA, scoreB);

    // advance (one match at a time)
    t.currentMatchIndex += 1;
    t.activeMatchId = null;
    t.activeRoomCode = null;

    emitTournament(t);
    startNextMatch(t);
  };
  finalizeTournamentMatchHook = maybeFinalizeTournamentMatch;

// TOURNAMENT_HANDLERS
  socket.on('tournament:create', (arg1?: unknown, arg2?: unknown) => {
    const config = (
      arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
    ) as { username?: unknown; userId?: unknown };
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as any;
    try {
            const username = normalizeUsername(config.username ?? socket.data?.username);
      const userId = normalizeUserId(config.userId ?? socket.data?.userId);
      socket.data.username = username;
      socket.data.userId = userId;

      const id = makeId('t');
      const lobbyCode = makeCode(4);

      const players: TournamentPlayer[] = [{
        socketId: socket.id,
        username,
        userId,
      }];

      const t: Tournament = {
        id,
        lobbyCode,
        hostSocketId: socket.id,
        status: 'lobby',
        players,
        matches: [],
        currentMatchIndex: 0,
        standings: initStandings(players),
        activeMatchId: null,
        activeRoomCode: null,
      };

      (globalThis as any).__tournamentsById.set(id, t);
      (globalThis as any).__tournamentsByCode.set(lobbyCode, id);

      socket.data.tournamentId = id;
      socket.join(`tourn:${id}`);

      cb?.({ ok: true, id, lobbyCode });
      // broadcast lobby state
      io.to(`tourn:${id}`).emit('tournament:lobby:update', { players: t.players, lobbyCode, hostSocketId: t.hostSocketId });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'create_failed';
      console.warn('[tournament:create] failed', e);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('tournament:join', (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const lobbyCode = String(argCode ?? '');
    const config = (
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? arg2 : {}
    ) as { username?: unknown; userId?: unknown };
    const cb = (typeof arg2 === 'function' ? arg2 : arg3) as any;
    try {
      const code = String(lobbyCode ?? '').trim().toUpperCase();
      const tid = (globalThis as any).__tournamentsByCode.get(code) as string | undefined;
      if (!tid) return cb?.({ ok: false, error: 'not_found' });

      const t = (globalThis as any).__tournamentsById.get(tid) as Tournament | undefined;
      if (!t) return cb?.({ ok: false, error: 'not_found' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });

      if (!t.players.some((p) => p.socketId === socket.id)) {
                const username = normalizeUsername(config.username ?? socket.data?.username);
        const userId = normalizeUserId(config.userId ?? socket.data?.userId);
        socket.data.username = username;
        socket.data.userId = userId;
        t.players.push({ socketId: socket.id, username, userId });
        t.standings[socket.id] = {
          socketId: socket.id,
          username,
          played: 0,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
      }

      socket.data.tournamentId = tid;
      socket.join(`tourn:${tid}`);

      cb?.({ ok: true, id: tid, lobbyCode: t.lobbyCode });
      io.to(`tourn:${tid}`).emit('tournament:lobby:update', { players: t.players, lobbyCode: t.lobbyCode, hostSocketId: t.hostSocketId });
    } catch (e) {
      cb?.({ ok: false, error: 'join_failed' });
    }
  });

  socket.on('tournament:add_bot', (arg1?: unknown, arg2?: unknown) => {
    const cb = (typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : undefined) as AckFn | undefined;
    cb?.({ ok: false, error: 'bots_disabled' });
  });

  socket.on('tournament:remove_bot', (arg1?: unknown, arg2?: unknown) => {
    const cb = (typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : undefined) as AckFn | undefined;
    cb?.({ ok: false, error: 'bots_disabled' });
  });

    socket.on('tournament:start', (cb?: any) => {
    try {
      const t = getTournamentForSocket();
      if (!t) return cb?.({ ok: false, error: 'no_tournament' });
      if (socket.id != t.hostSocketId) return cb?.({ ok: false, error: 'not_host' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });
      // Tournament bots are disabled; prune any stale bot entries before start.
      const humanPlayers = t.players.filter(
        (p) => !p.isBot && !p.socketId.startsWith('bot:fritz:') && !p.username.startsWith('Fritz'),
      );
      t.players = humanPlayers;
      t.standings = Object.fromEntries(
        Object.entries(t.standings).filter(([socketId]) =>
          humanPlayers.some((player) => player.socketId === socketId),
        ),
      ) as typeof t.standings;

      if (t.players.length < 2) return cb?.({ ok: false, error: 'need_2' });

      t.status = 'running';
      t.matches = buildRoundRobinMatches(t.players);
      t.currentMatchIndex = 0;
      t.activeMatchId = null;
      t.activeRoomCode = null;

      emitTournament(t);
      startNextMatch(t);

      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: 'start_failed' });
    }
    });
  }
```

### Removed imports from `index.ts` (only used by legacy block)

```typescript
// Removed from './tournament/tournament':
makeCode, makeId, initStandings, buildRoundRobinMatches, sortedStandings, applyResult, Tournament, TournamentPlayer

// Removed from './rooms':
createRoom, joinRoom

// Removed from './multiplayer/roomSession':
allocatePlayerSeatId, joinSocketToRoom, setRoomRoster
```

---

## Moved pieces — after (`server/src/index.ts`)

### Module-scope hook (unchanged)

```typescript
let finalizeTournamentMatchHook: ((room: any) => void) | null = null;
```

### `initRoomSession` wiring (unchanged)

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

### Connection handler replacement

```typescript
  // TOURNAMENT_HELPERS
  const ENABLE_LEGACY_TOURNAMENTS = process.env.ENABLE_LEGACY_TOURNAMENTS === '1';
  if (ENABLE_LEGACY_TOURNAMENTS) {
    finalizeTournamentMatchHook = registerLegacyTournamentHandlers(socket, {
      io,
      normalizeUsername,
      normalizeUserId,
    });
  }
```

### New import

```typescript
import { registerLegacyTournamentHandlers } from './legacyTournament/registerLegacyTournamentHandlers';
```

---

## Full source — new module

`server/src/legacyTournament/registerLegacyTournamentHandlers.ts`:

```typescript
import type { Server, Socket } from 'socket.io';
import {
  makeCode,
  makeId,
  initStandings,
  buildRoundRobinMatches,
  sortedStandings,
  applyResult,
  type Tournament,
  type TournamentPlayer,
} from '../tournament/tournament';
import { createRoom, joinRoom } from '../rooms';
import {
  allocatePlayerSeatId,
  joinSocketToRoom,
  setRoomRoster,
  type AckFn,
} from '../multiplayer/roomSession';

export type LegacyTournamentHandlerDeps = {
  io: Server;
  normalizeUsername: (value: unknown) => string;
  normalizeUserId: (value: unknown) => string | null;
};

export function getLegacyTournamentStorage(): {
  tournamentsById: Map<string, Tournament>;
  tournamentsByCode: Map<string, string>;
} {
  const tournamentsById = ((globalThis as any).__tournamentsById ??= new Map<string, Tournament>()) as Map<
    string,
    Tournament
  >;
  const tournamentsByCode = ((globalThis as any).__tournamentsByCode ??= new Map<string, string>()) as Map<
    string,
    string
  >;
  return { tournamentsById, tournamentsByCode };
}

export function createEmitTournament(io: Server) {
  return (t: Tournament) => {
    const standings = sortedStandings(t.standings);
    io.to(`tourn:${t.id}`).emit('tournament:state', {
      id: t.id,
      hostSocketId: t.hostSocketId,
      lobbyCode: t.lobbyCode,
      status: t.status,
      players: t.players,
      matches: t.matches,
      currentMatchIndex: t.currentMatchIndex,
      activeMatchId: t.activeMatchId ?? null,
      activeRoomCode: t.activeRoomCode ?? null,
      standings,
    });
  };
}

export function createStartNextMatch(io: Server, emitTournament: (t: Tournament) => void) {
  return (t: Tournament) => {
    // advance to next pending match
    while (t.currentMatchIndex < t.matches.length && t.matches[t.currentMatchIndex].status === 'done') {
      t.currentMatchIndex += 1;
    }
    if (t.currentMatchIndex >= t.matches.length) {
      t.status = 'complete';
      t.activeMatchId = null;
      t.activeRoomCode = null;
      emitTournament(t);
      return;
    }

    const m = t.matches[t.currentMatchIndex];
    m.status = 'active';
    t.activeMatchId = m.id;

    // Create a normal 2-player room for this match with a 30-point winning score.
    // Attach tournament metadata so we can record results later on gameOver.
    const seatA = allocatePlayerSeatId();
    const seatB = allocatePlayerSeatId();
    const room = createRoom(seatA, {
      winningScore: 30,
      tournamentId: t.id,
      tournamentMatchId: m.id,
      tournamentMode: 'round_robin',
    } as any);

    // Defensive: ensure config is accessible later even if createRoom doesn't persist arbitrary config
    (room as any).config = { ...(room as any).config, winningScore: 30, tournamentId: t.id, tournamentMatchId: m.id };

    m.roomCode = room.code;
    t.activeRoomCode = room.code;

    // Join the second player in the engine + socket room
    joinRoom(room.code, seatB);
    joinSocketToRoom(m.a, room.code, ['tourn:']);
    joinSocketToRoom(m.b, room.code, ['tourn:']);

    // Room roster for UI
    const pa = t.players.find((p) => p.socketId === m.a);
    const pb = t.players.find((p) => p.socketId === m.b);
    const roomPlayers = [
      { id: seatA, socketId: m.a, username: pa?.username ?? 'Player', userId: pa?.userId ?? null },
      { id: seatB, socketId: m.b, username: pb?.username ?? 'Player', userId: pb?.userId ?? null },
    ];
    setRoomRoster(room.code, roomPlayers);
    io.to(room.code).emit('room:update', { players: roomPlayers });

    // Announce active match (players + spectators)
    io.to(`tourn:${t.id}`).emit('tournament:match:assigned', {
      matchId: m.id,
      roomCode: room.code,
      a: m.a,
      b: m.b,
      aName: roomPlayers[0].username,
      bName: roomPlayers[1].username,
    });

    // Deal is broadcast after both seated clients emit player:ready (see player:ready handler).
    emitTournament(t);
  };
}

export function createMaybeFinalizeTournamentMatch(
  tournamentsById: Map<string, Tournament>,
  emitTournament: (t: Tournament) => void,
  startNextMatch: (t: Tournament) => void,
) {
  return (room: any) => {
    if (!room?.state?.gameOver) return;

    const cfg = (room as any).config ?? {};
    const tid = cfg.tournamentId as string | undefined;
    const mid = cfg.tournamentMatchId as string | undefined;
    if (!tid || !mid) return;

    const t = tournamentsById.get(tid);
    if (!t) return;

    const match = t.matches.find((mm) => mm.id === mid);
    if (!match || match.status === 'done') return;
    if (t.activeMatchId && t.activeMatchId !== mid) {
      console.warn('[tournament] ignoring stale gameOver for non-active match', {
        tournamentId: tid,
        activeMatchId: t.activeMatchId,
        reportedMatchId: mid,
      });
      return;
    }

    const a = match.a;
    const b = match.b;
    const scoreA = room.state.players[a]?.score ?? 0;
    const scoreB = room.state.players[b]?.score ?? 0;
    const winner = scoreA >= scoreB ? a : b;

    applyResult(t, mid, winner, scoreA, scoreB);

    // advance (one match at a time)
    t.currentMatchIndex += 1;
    t.activeMatchId = null;
    t.activeRoomCode = null;

    emitTournament(t);
    startNextMatch(t);
  };
}

/**
 * Registers legacy ad-hoc tournament socket handlers (gated by ENABLE_LEGACY_TOURNAMENTS in index.ts).
 * Returns maybeFinalizeTournamentMatch for assignment to the module-level finalizeTournamentMatchHook.
 */
export function registerLegacyTournamentHandlers(
  socket: Socket,
  deps: LegacyTournamentHandlerDeps,
): (room: any) => void {
  const { io, normalizeUsername, normalizeUserId } = deps;
  const { tournamentsById } = getLegacyTournamentStorage();

  const emitTournament = createEmitTournament(io);
  const startNextMatch = createStartNextMatch(io, emitTournament);
  const maybeFinalizeTournamentMatch = createMaybeFinalizeTournamentMatch(
    tournamentsById,
    emitTournament,
    startNextMatch,
  );

  const getTournamentForSocket = (): Tournament | null => {
    const tid = (socket.data?.tournamentId as string | undefined) ?? undefined;
    if (!tid) return null;
    return tournamentsById.get(tid) ?? null;
  };

  // TOURNAMENT_HANDLERS
  socket.on('tournament:create', (arg1?: unknown, arg2?: unknown) => {
    const config = (
      arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
    ) as { username?: unknown; userId?: unknown };
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as any;
    try {
      const username = normalizeUsername(config.username ?? socket.data?.username);
      const userId = normalizeUserId(config.userId ?? socket.data?.userId);
      socket.data.username = username;
      socket.data.userId = userId;

      const id = makeId('t');
      const lobbyCode = makeCode(4);

      const players: TournamentPlayer[] = [{
        socketId: socket.id,
        username,
        userId,
      }];

      const t: Tournament = {
        id,
        lobbyCode,
        hostSocketId: socket.id,
        status: 'lobby',
        players,
        matches: [],
        currentMatchIndex: 0,
        standings: initStandings(players),
        activeMatchId: null,
        activeRoomCode: null,
      };

      (globalThis as any).__tournamentsById.set(id, t);
      (globalThis as any).__tournamentsByCode.set(lobbyCode, id);

      socket.data.tournamentId = id;
      socket.join(`tourn:${id}`);

      cb?.({ ok: true, id, lobbyCode });
      // broadcast lobby state
      io.to(`tourn:${id}`).emit('tournament:lobby:update', { players: t.players, lobbyCode, hostSocketId: t.hostSocketId });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'create_failed';
      console.warn('[tournament:create] failed', e);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('tournament:join', (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const lobbyCode = String(argCode ?? '');
    const config = (
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? arg2 : {}
    ) as { username?: unknown; userId?: unknown };
    const cb = (typeof arg2 === 'function' ? arg2 : arg3) as any;
    try {
      const code = String(lobbyCode ?? '').trim().toUpperCase();
      const tid = (globalThis as any).__tournamentsByCode.get(code) as string | undefined;
      if (!tid) return cb?.({ ok: false, error: 'not_found' });

      const t = (globalThis as any).__tournamentsById.get(tid) as Tournament | undefined;
      if (!t) return cb?.({ ok: false, error: 'not_found' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });

      if (!t.players.some((p) => p.socketId === socket.id)) {
        const username = normalizeUsername(config.username ?? socket.data?.username);
        const userId = normalizeUserId(config.userId ?? socket.data?.userId);
        socket.data.username = username;
        socket.data.userId = userId;
        t.players.push({ socketId: socket.id, username, userId });
        t.standings[socket.id] = {
          socketId: socket.id,
          username,
          played: 0,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
      }

      socket.data.tournamentId = tid;
      socket.join(`tourn:${tid}`);

      cb?.({ ok: true, id: tid, lobbyCode: t.lobbyCode });
      io.to(`tourn:${tid}`).emit('tournament:lobby:update', { players: t.players, lobbyCode: t.lobbyCode, hostSocketId: t.hostSocketId });
    } catch (e) {
      cb?.({ ok: false, error: 'join_failed' });
    }
  });

  socket.on('tournament:add_bot', (arg1?: unknown, arg2?: unknown) => {
    const cb = (typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : undefined) as AckFn | undefined;
    cb?.({ ok: false, error: 'bots_disabled' });
  });

  socket.on('tournament:remove_bot', (arg1?: unknown, arg2?: unknown) => {
    const cb = (typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : undefined) as AckFn | undefined;
    cb?.({ ok: false, error: 'bots_disabled' });
  });

  socket.on('tournament:start', (cb?: any) => {
    try {
      const t = getTournamentForSocket();
      if (!t) return cb?.({ ok: false, error: 'no_tournament' });
      if (socket.id != t.hostSocketId) return cb?.({ ok: false, error: 'not_host' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });
      // Tournament bots are disabled; prune any stale bot entries before start.
      const humanPlayers = t.players.filter(
        (p) => !p.isBot && !p.socketId.startsWith('bot:fritz:') && !p.username.startsWith('Fritz'),
      );
      t.players = humanPlayers;
      t.standings = Object.fromEntries(
        Object.entries(t.standings).filter(([socketId]) =>
          humanPlayers.some((player) => player.socketId === socketId),
        ),
      ) as typeof t.standings;

      if (t.players.length < 2) return cb?.({ ok: false, error: 'need_2' });

      t.status = 'running';
      t.matches = buildRoundRobinMatches(t.players);
      t.currentMatchIndex = 0;
      t.activeMatchId = null;
      t.activeRoomCode = null;

      emitTournament(t);
      startNextMatch(t);

      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: 'start_failed' });
    }
  });

  return maybeFinalizeTournamentMatch;
}

export const __legacyTournamentTestUtils = {
  getLegacyTournamentStorage,
  createEmitTournament,
  createStartNextMatch,
  createMaybeFinalizeTournamentMatch,
};
```

---

## Full source — new test file

`server/src/legacyTournament/registerLegacyTournamentHandlers.test.ts` — see repository file (353 LOC). Test coverage:

| Test | What it verifies |
|------|------------------|
| `createEmitTournament` — payload shape | `tournament:state` fields, sorted standings, nullable active fields |
| `createStartNextMatch` — completion | All matches done → `status: 'complete'`, clears active ids |
| `createStartNextMatch` — advancement | Activates pending match, creates room, roster, `tournament:match:assigned` |
| `createMaybeFinalizeTournamentMatch` — stale guard | `activeMatchId !== mid` → warn + no-op |
| `createMaybeFinalizeTournamentMatch` — happy path | Applies result, advances index, calls emit + startNext |
| `tournament:create` ack | `{ ok: true }`, joins `tourn:*` room |
| `tournament:join` not_found | Unknown lobby code |
| `tournament:add_bot` / `remove_bot` | `bots_disabled` |
| `tournament:start` not_host | Non-host rejection |
| Hook return type | Returns function for `finalizeTournamentMatchHook` assignment |

---

## Build and test results

### Baseline (before extraction — sub-phase 4 after-numbers)

| Metric | Value |
|--------|-------|
| Test files | **64** |
| Tests | **469** |
| Build | Pass (`npm run build --prefix server`) |

**Discrepancy check:** Baseline matches sub-phase 4 report exactly. No drift detected before starting.

### After extraction

| Metric | Value |
|--------|-------|
| Test files | **65** (+1) |
| Tests | **479** (+10) |
| Build | **Pass** (`npm run build --prefix server`) |
| Duration | ~3.2s |

**Commands run:**

```bash
npm test --prefix server
npm run build --prefix server
```

---

## Confirmation table — untouched systems

| System | Status | Notes |
|--------|--------|-------|
| `createGameOverPersistScheduler` | ✅ Untouched | Still passed to `initRoomSession` `onGameOver` |
| Matchmaking room-shell hydration (`roomShellHydration.ts`) | ✅ Untouched | `tryHydrateMatchmakingRoomShell`, `waitUntilMatchmakingRoomSocketsReady` still in `initRoomSession` deps |
| Chat/emote handlers (`registerRoomChatEmoteHandlers.ts`) | ✅ Untouched | Still called per connection |
| Presence system (`registerPresenceHandlers.ts`) | ✅ Untouched | Still called per connection |
| Daily warmup scheduling (`scheduled/dailyWarmup.ts`) | ✅ Untouched | No changes |
| Global `SOCKET_EVENT_LIMITS` / `installSocketRateLimit` | ✅ Untouched | Still applied before legacy tournament registration |
| `io` / `Server` / CORS setup | ✅ Untouched | No changes |
| `registerMatchmakingHandlers` | ✅ Untouched | Still called per connection |
| `initScheduledTournaments` / `scheduledTournament/**` | ✅ Untouched | New scheduled tournament system — separate code path |
| `client/` | ✅ Untouched | Per task scope |

---

## Remaining risks / follow-ups

1. **`finalizeTournamentMatchHook` last-connection-wins** — Documented but not fixed (by design). If legacy tournaments are re-enabled in production, consider whether reassignment should be made explicit (e.g. single shared hook factory) in a future behavior-change task.
2. **`globalThis` tournament Maps** — Intentionally preserved; evaluate hot-reload vs. module-scope Maps separately.
3. **Sub-phase 6** — `createGameOverPersistScheduler` extraction remains the final Phase 2 piece in `index.ts`.