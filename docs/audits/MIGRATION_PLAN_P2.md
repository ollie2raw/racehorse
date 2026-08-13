# ARCH-P2: Extract `roomSession` module

**Status:** Implemented.

## Goal

Extract multiplayer room lifecycle, roster/seat mapping, state broadcast, cleanup/grace wiring, and Socket.IO room handlers from `server/src/index.ts` into testable modules without changing matchmaking, Fritz/bot, tournament, puzzle, or single-player logic.

## New files

| File | Responsibility |
|------|----------------|
| [`server/src/multiplayer/roomSession.ts`](server/src/multiplayer/roomSession.ts) | Roster maps, seat helpers, reconnect/cleanup lifecycle, masking/broadcast, `broadcastStateUpdate`, `buildMatchStartDeps` |
| [`server/src/multiplayer/registerRoomSessionHandlers.ts`](server/src/multiplayer/registerRoomSessionHandlers.ts) | `registerRoomSessionHandlers`, `handleRoomPlayerDisconnect` |

## Dependency injection (`RoomSessionDeps`)

`initRoomSession(io, deps)` wires:

- `persistRoomMatchLog` — room archive before cleanup/rematch
- `onGameOver` — `createGameOverPersistScheduler` in `index.ts` (ranking, league, Fritz resolve, matchmaking `recordMatchEnd`, scheduled tournament Supabase)
- `finalizeTournamentMatch` — in-socket round-robin `finalizeTournamentMatchHook`
- `resolveSocketIdentity`, `normalizeUsername`, `normalizeUserId`
- `tryHydrateMatchmakingRoomShell`, `waitUntilMatchmakingRoomSocketsReady` (unchanged in `index.ts`)
- `onAfterMatchStarted` — Fritz pending insert when applicable
- `notifyRoomPlayersInGame` — presence `in_game` for seated sockets
- `maybeFinalizeTournamentMatch` — tournament bracket advance on `game:action` / `hand:ready`

## What stayed in `index.ts`

- Express REST, daily modes, ghost, league, auth
- Matchmaking: `registerMatchmakingHandlers`, hydrate/sync helpers
- Presence/friends/chat/emote/stats socket handlers
- In-socket tournament lobby (`tournamentsById`, `startNextMatch`, …)
- Fritz disconnect loss block on `disconnect` (after `handleRoomPlayerDisconnect`)
- `createGameOverPersistScheduler` (game-over I/O, lines formerly 4578–4818)

## `onGameOver` contract

`broadcastStateUpdate` sets `room.matchLogged = true`, builds roster/scores, then:

```ts
scheduleDeferredMatchPersist = deps.onGameOver({ room, cfg, aId, bId, a, b, scoreA, scoreB, winnerSeatId });
```

`createGameOverPersistScheduler` returns `() => { void (async () => { ... })(); }` — same deferred shape as before. Realtime emits run first; `setImmediate(() => scheduleDeferredMatchPersist?.())` runs after `state:update`.

## Circular dependency avoidance

- `roomSession.ts` → `rooms`, `disconnectGrace`, `matchStartReady`, `roomEvents`, `game/*`
- `registerRoomSessionHandlers.ts` → `roomSession.ts` (no import of `index.ts`)
- `index.ts` → both modules; domain hooks only via `deps`

## Approximate line reduction

- `index.ts`: ~6287 → ~4950 lines (~1300 removed net; game-over block retained in index)

## Verification

- `npm run build --prefix server` — pass
- `npm run build --prefix client` — pass
- `npm test` in `server/` — **148 passed**
