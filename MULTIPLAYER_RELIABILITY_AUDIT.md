# Multiplayer Reliability Audit

Date: 2026-07-09

Verdict: **Beta-ready**

This is not chess.com-level hardened yet.

The codebase already has several strong reliability primitives:

- server-authoritative live game state in memory (`server/src/rooms.ts`, `server/src/multiplayer/roomSession.ts`)
- client-side recovery and replay gates (`client/src/multiplayer/recoveryMachine.ts`, `client/src/multiplayer/socketEventBus.ts`, `client/src/multiplayer/useRoomSocketSync.ts`)
- move idempotency and room-level serialization (`server/src/multiplayer/gameActionIdempotency.ts`, `server/src/multiplayer/roomGameplayLock.test.ts`)
- live-room persistence and restart hydration (`server/src/multiplayer/roomLivePersistence.ts`, `server/src/multiplayer/applyLiveSessionRoom.ts`)
- some meaningful reconnect E2E coverage (`client/e2e/multiplayer-in-match-reconnect.spec.ts`)

But the system still has authority splits, silent persistence degradation, and several recovery edges that can leave a player in a degraded or incorrect state after the wrong timing.

## 1. Multiplayer architecture map

### Client entry points, routes, screens, hooks

- App bootstrap:
  - `client/src/App.tsx`
  - `client/src/AppRoutes.tsx`
- Multiplayer hub / mode routing:
  - `client/src/multiplayer/MultiplayerModeController.tsx`
  - `client/src/matchmaking/MatchmakingScreen.tsx`
  - `client/src/multiplayer/PrivateMatchLobbyScreen.tsx`
  - `client/src/match/LiveMatchScreen.tsx`
  - `client/src/matchmaking/MatchFoundOverlay.tsx`
- Core multiplayer runtime / connection:
  - `client/src/multiplayer/useMultiplayerConnection.ts`
  - `client/src/multiplayer/useMultiplayerResync.ts`
  - `client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts`
  - `client/src/multiplayer/registerMultiplayerConnectionGameplaySocketHandlers.ts`
  - `client/src/multiplayer/useRoomSocketSync.ts`
  - `client/src/multiplayer/joinAckCoordinator.ts`
- Client state machines:
  - session lifecycle: `client/src/multiplayer/session/sessionReducer.ts`
  - recovery lifecycle: `client/src/multiplayer/recoveryMachine.ts`
- Tournament multiplayer reuse:
  - `client/src/tournament/useTournament.ts`
  - `client/src/match/session/tournament/*`

### Server entry points, services, and ownership

- Socket bootstrap:
  - `server/src/index.ts`
- Core live authority:
  - `server/src/rooms.ts`
  - `server/src/multiplayer/roomSession.ts`
  - `server/src/multiplayer/registerRoomSessionHandlers.ts`
  - `server/src/multiplayer/roomSocketAttach.ts`
- Reliability / recovery:
  - `server/src/multiplayer/disconnectGrace.ts`
  - `server/src/multiplayer/roomLivePersistence.ts`
  - `server/src/multiplayer/applyLiveSessionRoom.ts`
  - `server/src/matchmaking/roomShellHydration.ts`
  - `server/src/multiplayer/gameActionIdempotency.ts`
  - `server/src/multiplayer/roomMatchLogPersistence.ts`
- Matchmaking:
  - `server/src/matchmaking/index.ts`
  - `server/src/matchmaking/persistence.ts`
- Match completion / downstream writes:
  - `server/src/realtime/gameOverPersistence.ts`
  - `server/src/scheduledTournament/*`

### Supabase tables and persistence modules

- Live resumable snapshots:
  - `supabase/room_live_sessions.sql`
  - written/read by `server/src/multiplayer/roomLivePersistence.ts`
- Archived terminal logs:
  - `supabase/room_match_logs.sql`
  - written by `server/src/multiplayer/roomMatchLogPersistence.ts`
- Matchmaking durable rows:
  - `supabase/migrations/2026-05-13_matchmaking.sql`
  - written by `server/src/matchmaking/persistence.ts`
- Presence:
  - `server/sql/social/001_player_presence.sql`

### Who owns match state

- **Live authoritative match state:** server memory, specifically `rooms` map in `server/src/rooms.ts`
- **Transport mirror:** Socket.IO events from `server/src/multiplayer/roomSession.ts`
- **Durable recovery snapshot:** `room_live_sessions`
- **Terminal archive:** `room_match_logs`
- **Client display state:** masked projections plus local shell state

### Duplicated / unclear authority

There are three overlapping authority layers on the client:

- session reducer (`client/src/multiplayer/session/sessionReducer.ts`)
- recovery machine (`client/src/multiplayer/recoveryMachine.ts`)
- UI render predicates (`client/src/multiplayer/MultiplayerModeController.tsx`)

The code even documents this risk in `client/src/multiplayer/recoveryAuthorityContract.ts`. It is not fully eliminated in practice.

## 2. State machine audit

### Client session phases

From `client/src/multiplayer/session/sessionTypes.ts`:

- `idle`
- `connected`
- `in_lobby`
- `match_starting`
- `in_match`
- `match_ended`
- `leaving`

### Client recovery states

From `client/src/multiplayer/recoveryMachine.ts`:

- `idle`
- `connecting`
- `joining`
- `resyncing`
- `failed`

Policies:

- `auto`
- `manual_only`
- `disabled`

### Queue UI states

From `client/src/matchmaking/useMatchmaking.ts`:

- `idle`
- `searching`
- `matched`
- `timeout`

### Durable live-session statuses

From `supabase/room_live_sessions.sql`:

- `lobby`
- `playing`
- `hand_over`
- `game_over`
- `abandoned`

### Transition notes

- `SOCKET_DISCONNECTED` while a room is still tracked does **not** advance the client session into an explicit recovery phase; it keeps the previous snapshot intact (`client/src/multiplayer/session/sessionReducer.ts:42-49`).
- `ROOM_SESSION_SUPERSEDED` is a no-op in the session reducer (`client/src/multiplayer/session/sessionReducer.ts:77-78`).
- Recovery state is therefore carried outside the session reducer, not inside a single unified state machine.

### Transition risk summary

- Most gameplay transitions have success paths and duplicate guards.
- Several recovery transitions rely on "best effort" async repair instead of a single authoritative state machine.
- The riskiest transitions are:
  - disconnect during active match
  - duplicate-tab session takeover
  - process restart when durable live persistence is unavailable or stale
  - quick-match match-start race before both sockets are actually ready

## 3. Stuck-screen audit

### `Starting match…`

Source:

- `client/src/multiplayer/MultiplayerModeController.tsx:329-344`
- `client/src/multiplayer/useMultiplayerResync.ts:157-176`

Exit condition:

- `state` becomes truthy, or `joinedRoom` clears, or route changes

If exit never arrives:

- after 4 seconds the client emits a resync and possibly re-sends ready state

Timeout:

- yes, 4 seconds

Retry:

- automatic resync only

Manual escape:

- not from this view itself

Risk:

- still vulnerable to quick-match start races because the server can start a match even after the socket-readiness wait times out

### Private room reconnect banners

Source:

- `client/src/multiplayer/PrivateMatchLobbyControlPanel.tsx`

States:

- `Reconnecting…`
- `Syncing room…`
- `Reconnect failed`

Exit:

- recovery state changes, retry, or leave room

Timeout:

- yes, recovery machine bounded attempts

Retry:

- yes, manual retry CTA

Manual escape:

- yes, leave room / home navigation

### Matchmaking search

Source:

- `client/src/matchmaking/useMatchmaking.ts`

Exit:

- `queue:matched`
- `queue:timeout`
- cancel
- disconnect
- join-ack watchdog failure

Timeout:

- 22s join-ack watchdog on `queue:join`

Manual escape:

- yes, cancel

### Opponent disconnect banner

Source:

- `client/src/multiplayer/useRoomSocketSync.ts:626-649`

Exit:

- `player:reconnected`
- `player:reconnect_timeout`

Timeout:

- driven by server grace timer

Manual escape:

- no direct one from the banner

## 4. Disconnect / reconnect audit

### Refresh during active turn

Supported path:

- room code persisted locally
- reconnect via `room:join`
- server can hydrate room from `room_live_sessions`

Files:

- `client/src/match/recovery/matchRecovery.ts`
- `client/src/multiplayer/useMultiplayerConnection.ts`
- `server/src/multiplayer/roomLivePersistence.ts`

Assessment:

- works if live persistence is healthy
- degrades badly if persistence is unavailable

### Tab close during match

Supported path:

- seat reserved on disconnect
- reconnect grace timer
- delayed room cleanup

Files:

- `server/src/multiplayer/registerRoomSessionHandlers.ts`
- `server/src/multiplayer/disconnectGrace.ts`
- `server/src/multiplayer/roomSession.ts`

Assessment:

- decent for one disconnected seat
- not hardened for multi-seat disconnect overlap

### Network drop during move submit

Strengths:

- server action idempotency by request id
- room-level serialization

Files:

- `server/src/multiplayer/gameActionIdempotency.ts`
- `server/src/multiplayer/registerGameplayActionHandlers.ts`

Gap:

- no E2E found for "server committed move, client lost ack, client retries after reconnect"

### Missed realtime event

Strengths:

- projection gates detect stale regressions
- resync path exists

Files:

- `client/src/multiplayer/useRoomSocketSync.ts`
- `client/src/multiplayer/socketEventBus.ts`
- `client/src/multiplayer/useMultiplayerResync.ts`

Gap:

- no direct E2E found for dropped initial `state:update` or dropped terminal update

### Stale room code in local storage

Behavior:

- auto-join attempts `room:join`
- on failure it clears storage and toasts "Saved room is no longer available."

Files:

- `client/src/multiplayer/useMultiplayerConnection.ts:304-313`

Assessment:

- safe fallback to lobby
- no result recovery for completed/offline case

### Duplicate tabs

Behavior:

- new authenticated socket forcibly disconnects old socket
- old client receives `room:session:superseded`

Files:

- server takeover: `server/src/multiplayer/roomSocketAttach.ts:235-245`
- client handling: `client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts:191-200`
- recovery effect: `client/src/multiplayer/recoveryMachine.ts:695-715`

Assessment:

- not hardened; current client behavior on supersede is actively risky

### Completed match while offline / abandoned while offline

Behavior:

- terminal live row is written then deleted
- rejoin to room returns `match_completed` / `match_abandoned`
- client clears saved room and returns to lobby

Files:

- `server/src/multiplayer/roomLivePersistence.ts:498-514`
- `server/src/multiplayer/roomSocketAttach.ts:220-225`
- `client/src/multiplayer/useMultiplayerConnection.ts:304-313`

Assessment:

- result-state recovery is not present

## 5. Race-condition audit

### Good coverage / mitigations present

- duplicate move submissions: `server/src/multiplayer/gameActionIdempotency.ts`
- concurrent room actions: `server/src/multiplayer/roomGameplayLock.test.ts`
- hand boundary races: `server/src/multiplayer/handReadyGameplayLock.test.ts`
- stale state projections: `client/src/multiplayer/projection/projectionGates.ts`

### Remaining high-risk race areas

- duplicate-tab ownership handoff
- quick-match autostart after readiness wait timeout
- dual disconnects in the same room
- persistence outage during live match / restart window

## 6. Database and Supabase audit

### Strengths

- `room_live_sessions.room_code` is primary key
- `room_live_sessions.match_id` is unique
- RLS blocks client writes to live and archived room tables

### Missing / weak constraints

- `matchmaking_matches.room_code` is not unique (`supabase/migrations/2026-05-13_matchmaking.sql:4-19`)
- no check that `player_a_id <> player_b_id`
- no check that `winner_id` equals either `player_a_id` or `player_b_id`
- no check that `ended_at` is present when `status` is terminal
- no check that only one `in_progress` row exists per room code
- live room snapshots keep critical invariants in JSONB:
  - `game_state`
  - `room_shell`
  - `roster`
  - `events`

That JSONB layout is operationally useful, but it means the database is not enforcing most game-shape invariants.

## 7. Invariant checklist

These should hold for a hardened system:

- exactly one authoritative live room per active `room_code`
- exactly one active socket owner per authenticated player seat
- completed or abandoned matches reject further actions
- every active live room has 2 valid participant seats before gameplay starts
- `winner_id` must be one of the participants
- terminal matches must have terminal persistence
- recovery from DB snapshot must not depend on realtime replay
- realtime must never be the only source of truth
- duplicate move submissions must be idempotent
- stale async responses must not overwrite newer authoritative state

Current status:

- some of these are enforced in code
- too many are not enforced in the database
- duplicate-tab ownership and restart recovery still depend on best-effort coordination

## 8. Test coverage audit

### Current coverage that matters

- reconnect / refresh / supersede E2E:
  - `client/e2e/multiplayer-in-match-reconnect.spec.ts:27-143`
- hub chaos smoke:
  - `client/e2e/multiplayer-chaos.spec.ts:16-81`
- live-room hydration:
  - `server/src/multiplayer/roomLiveHydration.test.ts`
- action idempotency:
  - `server/src/multiplayer/registerGameplayActionHandlers.test.ts`
- hand boundary lock tests:
  - `server/src/multiplayer/handReadyGameplayLock.test.ts`

### Missing certification coverage

#### State machine tests

- disconnect -> reconnect -> supersede -> reconnect loop ownership
- session reducer + recovery machine combined assertions, not in isolation

#### Recovery tests

- process restart while `room_live_sessions` write is missing or stale
- completed match while client is offline, then reload
- abandoned match while client is offline, then reload

#### Realtime tests

- dropped first `state:update` after quick-match autostart
- dropped game-complete update
- ack-lost move submit followed by retry

#### Route transition tests

- leave route during reconnect in progress
- duplicate-tab takeover followed by original tab auto-reconnect attempt

#### Chaos tests

- both players disconnect within the same grace window
- server restart during match-starting
- Supabase failure during match start and match end

#### Database invariant tests

- reject same-user matchmaking row
- reject winner outside participants
- reject duplicate active rows for same room

## 9. Severity-ranked findings

### 1. Critical — disconnect grace is keyed per room, not per disconnected seat

- Files:
  - `server/src/multiplayer/disconnectGrace.ts:12-13`
  - `server/src/multiplayer/disconnectGrace.ts:66-77`
  - `server/src/multiplayer/disconnectGrace.ts:80-91`
- Exact risk:
  - the second disconnect in a room cancels the first player's grace timer
- Reproduction:
  1. Player A disconnects on turn.
  2. `onActivePlayerSocketDisconnect` starts a room-scoped timer.
  3. Before it expires, Player B disconnects or A reconnects while B is now tracked.
  4. `clearDisconnectGrace(roomCode)` clears the existing timer for the room.
  5. The original disconnected seat is no longer protected by an active timeout path.
- Why it matters:
  - this is not robust for overlapping disconnects, reconnect storms, or duplicate-tab churn
- Recommended fix:
  - track disconnect grace per `(roomCode, playerSeatId)`, not per room
- Scope:
  - architecture-level

### 2. Critical — superseded-session handling tells the displaced client to recover back into the room

- Files:
  - `server/src/multiplayer/roomSocketAttach.ts:240-245`
  - `client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts:191-200`
  - `client/src/multiplayer/recoveryMachine.ts:695-715`
  - `client/src/multiplayer/session/sessionReducer.ts:77-78`
- Exact risk:
  - the old tab is told "Session moved to this device. Syncing…" and immediately enters recovery instead of standing down
- Reproduction:
  1. Open two tabs as the same authenticated player.
  2. Second tab joins the active room.
  3. Server emits `room:session:superseded` to the first tab and disconnects it.
  4. Client dispatches `SESSION_SUPERSEDED`, which transitions recovery to `connecting`.
  5. The displaced tab is now encouraged to reconnect and potentially steal the seat back.
- Why it matters:
  - this creates ownership thrash risk and unstable duplicate-tab behavior
- Recommended fix:
  - superseded session should disable auto-recovery on the displaced client and clear local room authority
- Scope:
  - architecture-level

### 3. High — quick-match autostart ignores readiness-wait timeout and can start before both sockets are actually ready

- Files:
  - `server/src/matchmaking/roomShellHydration.ts:39-50`
  - `server/src/multiplayer/roomSocketAttach.ts:341-349`
  - `client/src/multiplayer/MultiplayerModeController.tsx:329-344`
  - `client/src/multiplayer/useMultiplayerResync.ts:157-166`
- Exact risk:
  - server starts the match even if `waitUntilMatchmakingRoomSocketsReady` timed out and never confirmed both sockets had joined the Socket.IO room
- Reproduction:
  1. Two players are paired.
  2. One client is slow to finish room join / subscription.
  3. Server waits up to 5 seconds, then returns from the wait loop with no success signal.
  4. `tryStartMatchIfReady` still runs.
  5. First authoritative `state:update` can be missed by the late socket.
  6. Client falls into `Starting match…` and depends on later resync.
- Recommended fix:
  - make socket-room readiness wait return success/failure and do not autostart until readiness is confirmed or an explicit recovery path is chosen
- Scope:
  - localized logic with architectural impact

### 4. High — live persistence can silently degrade to "no restart recovery"

- Files:
  - `server/src/multiplayer/roomLivePersistence.ts:414-446`
  - `server/src/multiplayer/roomLivePersistence.ts:637-659`
  - `server/src/matchmaking/roomShellHydration.ts:5-9`
- Exact risk:
  - if `room_live_sessions` is missing or persist/load fails, the server just logs and keeps going
- Reproduction:
  1. Supabase table missing, temporarily unavailable, or POST/GET fails.
  2. Live match continues in memory.
  3. Process restarts or redeploys.
  4. `ensureRoomHydrated` cannot restore state.
  5. Matchmaking fallback only recreates a shell, explicitly not full game state.
- Recommended fix:
  - make live persistence a required production dependency, with health checks and fail-closed behavior for ranked multiplayer
- Scope:
  - architecture-level

### 5. High — matchmaking durable record writes are best-effort only

- Files:
  - `server/src/matchmaking/persistence.ts:5-10`
  - `server/src/matchmaking/persistence.ts:39-56`
  - `server/src/matchmaking/persistence.ts:75-91`
- Exact risk:
  - `recordMatchStart` and `recordMatchEnd` swallow persistence failures and still report success to the live system
- Reproduction:
  1. Matchmaking row POST or PATCH fails.
  2. Match still proceeds live.
  3. Restart recovery, analytics, or matchmaking terminal state now diverge from reality.
- Recommended fix:
  - classify durable start/end writes by match type; for ranked production matches this should not be best-effort
- Scope:
  - architecture-level

### 6. Medium — completed or abandoned matches cannot recover result state after offline reload

- Files:
  - `server/src/multiplayer/roomLivePersistence.ts:498-514`
  - `server/src/multiplayer/roomSocketAttach.ts:220-225`
  - `client/src/multiplayer/useMultiplayerConnection.ts:304-313`
- Exact risk:
  - offline users lose the final match surface and are bounced back to lobby
- Reproduction:
  1. Player goes offline near game end.
  2. Match completes or is abandoned.
  3. Live row is archived then deleted.
  4. Reloaded client auto-joins saved room.
  5. Server rejects with `match_completed` or `match_abandoned`.
  6. Client clears storage and shows "Saved room is no longer available."
- Recommended fix:
  - add archived-match recovery path from `room_match_logs` or equivalent result snapshot endpoint
- Scope:
  - architecture-level

### 7. Medium — `matchmaking_matches` does not enforce core relational invariants

- Files:
  - `supabase/migrations/2026-05-13_matchmaking.sql:4-19`
  - `server/src/matchmaking/roomShellHydration.ts:17-21`
- Exact risk:
  - impossible or ambiguous states are permitted in the DB
- Specific gaps:
  - no `player_a_id <> player_b_id`
  - no `winner_id in (player_a_id, player_b_id)`
  - no terminal `ended_at` consistency check
  - no uniqueness for active `room_code`
- Why it matters:
  - room-shell hydration queries `room_code + status=in_progress + limit=1`; duplicate active rows would be ambiguous
- Recommended fix:
  - add relational checks and a partial unique index for active room codes
- Scope:
  - architecture-level

### 8. Low — live-session hydration resets `eventLogVersion` instead of restoring it

- Files:
  - `server/src/multiplayer/applyLiveSessionRoom.ts:40`
  - `server/src/multiplayer/roomLivePersistence.ts:305`
- Exact risk:
  - event-log versioning is not faithfully restored after hydration
- Reproduction:
  - hydrate a room from DB after any future event-log version bump
- Recommended fix:
  - restore `row.event_log_version` instead of hardcoding `1`
- Scope:
  - localized

## 10. Final verdict

### Rating

**Beta-ready**

### Why not higher

It is better than a typical hobby realtime app. It already has:

- server authority
- reconnect logic
- restart hydration
- idempotent action handling
- some E2E chaos coverage

But it is not production-ready with confidence for chess.com-level multiplayer because:

- duplicate-tab ownership is not stable
- disconnect grace is not modeled per seat
- persistence failure is tolerated too quietly
- quick-match startup still has a missed-first-state race
- offline terminal recovery is incomplete
- core DB invariants are still enforced mostly in code, not in storage

### What would move it to the next tier

To reach **Production-ready with risks**:

- fix findings 1 through 4
- make ranked matchmaking persistence required, not best-effort
- add tests for dropped initial `state:update`, move-ack loss, and duplicate-tab takeover stability

To reach **Hardened**:

- add archived-result recovery
- enforce DB invariants with constraints and partial unique indexes
- unify client recovery/session authority more explicitly

To reach **Chess.com-level hardened**:

- treat persistence and recovery as first-class production dependencies with health gating
- prove the failure matrix in automated chaos tests
- remove remaining best-effort authority edges where stale client state can survive without an explicit degraded mode
