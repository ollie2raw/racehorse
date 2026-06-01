# Multiplayer / Private Games — Source-of-Truth Audit

**Audit date:** 2026-05-31  
**Scope:** Private 1v1 rooms, friend challenges, shared socket stack (Quick Match / tournament attach excluded except where they share code paths).  
**Mode:** Read-only mapping — no fixes applied in this pass.

---

## Executive summary

Private multiplayer is **Socket.IO–first** with **authoritative in-memory rooms** on a single Node process (`server/src/rooms.ts`). There is **no REST API for live play** (create/join/move/leave/rematch). Supabase stores **archives, ratings, matchmaking rows, and presence** — not live board sync.

The client orchestrates everything from **`App.tsx`** (~5.7k lines) plus three multiplayer hooks. Private lobby UI lives in **`PrivateMatchLobbyScreen.tsx`**, but in-game shell, move submission, reconnect, and rematch are all in `App.tsx`.

**Why it feels laggy:** Full `GameState` JSON on every `state:update`, monolithic React re-renders, draw-animation step timers, sequence/resync layers, and ack-waiting (no optimistic tile placement). **Why it feels fragile:** In-memory rooms (lost on deploy), overlapping reconnect/supersede/resync paths, guest identity without JWT, cosmetic lobby settings not wired to server, and concurrent async `game:action` handlers without per-room locking.

---

## 1. Main files involved

### Client — orchestration & in-game

| File | Owns |
|------|------|
| `client/src/App.tsx` | **Primary orchestrator:** `appMode`, `mpSubView` (`quick` \| `private`), room state, `GameState`, legal moves, move/draw/pass, reconnect/resync, rematch, hand reveal, game-over, localStorage recovery (`racehorse_last_room_code`), tournament attach guards |
| `client/src/multiplayer/PrivateMatchLobbyScreen.tsx` | Private hub UI: connect, create/join, waiting room, invite copy, **cosmetic** deal format / timed / rated toggles (local state only) |
| `client/src/multiplayer/useMultiplayerConnection.ts` | Socket connect/disconnect, backoff reconnect, global listeners (`hand:ended`, rematch, chat, tournament routing, `mp:ping` every 5s) |
| `client/src/multiplayer/useRoomSocketSync.ts` | `state:update`, draw animations, opponent disconnect grace UI, sequence watermark application |
| `client/src/multiplayer/useMultiplayerRoomActions.ts` | `room:create`, `room:join`, invite URL (`?room=CODE`), friend challenge send/accept, leave lobby |
| `client/src/multiplayer/useFriendChallenge.ts` | Friends-screen challenge button state |
| `client/src/multiplayer/useFriendSocketReachability.ts` | Polls `presence:online` every 15s for deliverable invites |
| `client/src/multiplayer/socketGuards.ts` | Sequence watermark / stale update rejection / regression resync threshold (10) |
| `client/src/multiplayer/boardSnapshotGuards.ts` | Projects server board snapshot for client rendering |
| `client/src/multiplayer/handIdentity.ts` | Detects hand/`you` mismatch after join |
| `client/src/multiplayer/drawAudit.ts` | Client-side forced-draw audit logging |
| `client/src/multiplayer/friendChallenge.ts` | Challenge invite IDs, expiry, copy |
| `client/src/multiplayer/IncomingFriendChallengeCard.tsx` | Global incoming challenge popup |
| `client/src/match/board/MatchLiveLayout.tsx` | In-game layout shell (shared with bot modes) |
| `client/src/components/Board.tsx` | Board rendering (heavy; shared) |
| `client/src/components/LeaveGameModal.tsx` | Confirmed forfeit → `room:abandon_match` |
| `client/src/components/GameOverModal.tsx` | Post-game, rematch CTA |
| `client/src/components/RoomReactions.tsx` | In-game chat/emotes |
| `client/src/friends/FriendsScreen.tsx` | Friend list; emits `friend:invite` with room code |
| `client/src/screens/TournamentScreen.tsx` | Tournament `room:spectate` entry (not private casual) |

### Client — shared hub chrome (not private-only)

| File | Owns |
|------|------|
| `client/src/matchmaking/MultiplayerTopBar.tsx` | Quick vs Private tab |
| `client/src/matchmaking/MatchmakingScreen.tsx` | Ranked queue (same socket stack) |
| `client/src/matchmaking/useMatchmaking.ts` | Queue socket events |

### Server — room engine & sockets

| File | Owns |
|------|------|
| `server/src/index.ts` | HTTP server, Socket.IO bootstrap, `resolveSocketIdentity`, friend invite/decline, presence, game-over persistence scheduler, room session init wiring |
| `server/src/rooms.ts` | In-memory `Map<RoomCode, Room>`; `createRoom`, `joinRoom`, `act`, `startGame`, hand/rematch state, ghost move logs |
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | **All private-room socket handlers:** create/join/leave/abandon/start/action/rematch/spectate/tournament attach |
| `server/src/multiplayer/roomSession.ts` | Roster, reconnect seats, cleanup timers, **`maskStateForRecipient`**, **`broadcastStateUpdate`**, lifecycle |
| `server/src/multiplayer/disconnectGrace.ts` | 30s turn grace; auto PASS/DRAW on timeout |
| `server/src/multiplayer/matchStartReady.ts` | Both seats `matchStartReady` before first deal |
| `server/src/multiplayer/botSeating.ts` | Fritz bot seats (tournament / bot-in-room) |
| `server/src/multiplayer/drawAudit.ts` | Server draw audit |
| `server/src/roomEvents.ts` | Append-only room event log on `Room` |
| `server/src/game/engine.ts` | Turn rules, legal moves, `applyMove`, draw/pass |
| `server/src/game/invariants.ts` | `assertValidGameState` on broadcast |
| `server/src/stats/recordPublicMatch.ts` | `matches` row for online H2H |
| `server/src/social/presence.ts` | `player_presence` upserts |

### Database / SQL

| File | Owns |
|------|------|
| `supabase/room_match_logs.sql` | Archived room events + snapshot |
| `supabase/migrations/2026-05-13_matchmaking.sql` | `matchmaking_matches` (queue; prefix `MM`) |
| `supabase/schema.sql` | `matches`, `profiles`, ghost tables |
| `server/sql/social/001_player_presence.sql` | Online/in-game presence |

### Docs & prior audits (reference only)

| File | Notes |
|------|-------|
| `MULTIPLAYER_README.md` | Matchmaking architecture; notes single-process queue |
| `MULTIPLAYER_HARDENING_MAP.md` | April 2026 bug map (some items since fixed — see §9) |
| `docs/agent-skills/multiplayer-socket-recovery.md` | Agent skill for socket/recovery changes |

### Tests & smoke

| File | Owns |
|------|------|
| `client/scripts/socketSmoke.mjs` | 13 end-to-end socket scenarios |
| `server/src/multiplayer/registerRoomSessionHandlers.abandon.test.ts` | Abandon + rejoin rejection |
| `server/src/multiplayer/registerRoomSessionHandlers.tournament.test.ts` | Tournament attach/join |
| `server/src/multiplayer/botSeating.test.ts` | Bot seat helpers |
| `server/src/matchmaking/pairing.test.ts` | Queue pairing (not private) |
| `server/src/game/__tests__/engine.test.ts` | Engine rules (63 tests) |

---

## 2. Current intended user loop (private)

```
Home → Multiplayer → Private tab
  → Connect socket (presence:identify)
  → Create lobby (room:create) OR Join code / ?room= URL / friend invite
  → Waiting room (2 players in roster; both in Socket.IO room)
  → Guest auto-emits player:ready on join (private path)
  → Host clicks "Start Match" (game:start) → both matchStartReady → startGame()
  → In-game: game:action (MOVE/DRAW/PASS) → state:update (masked per player)
  → Hand ends → hand:ended + hand:ready between hands
  → Game over → GameOverModal → game:rematch (both ready) → new deal
  → Leave lobby: room:leave (no forfeit)
  → Leave mid-match: room:abandon_match (forfeit)
```

**Invite paths:**

- **Room code:** 5-char alphanumeric (`makeCode`, charset excludes ambiguous chars)
- **URL:** `?room=CODE` → auto-join on connect
- **Friend challenge:** `friend:invite` → recipient `friend:invited` → accept → `room:join`

**Host rule:** `room.players[0]` seat is host; only host can `game:start`.

---

### Player identity / session handling

| Identity source | When | Server behavior |
|-----------------|------|-----------------|
| **Supabase JWT** (`authToken` on create/join) | Logged-in user | `resolveSocketIdentity` verifies JWT → trusted `userId` |
| **Guest UUID** | No auth | Client generates/stores in `racehorse_guest_identity_v1`; server accepts non-UUID usernames; UUID without JWT may be stripped |
| **Username** | Always on create/join | Display + seat reclaim fallback when `userId` missing on reconnect |
| **Socket binding** | `presence:identify` | Maps socket → user for friend invites and presence |

**Host/guest roles:** First player in `room.players` array (`players[0]`) is host. Only host may emit `game:start`. Guest typically auto-emits `player:ready` immediately after join (private path skips quick-match 2-player deferral in `trySchedulePlayerReady`).

---

## 3. Actual runtime state machine

### Client-visible phases

| Phase | Entry condition | Exit / next |
|-------|-----------------|-------------|
| **Disconnected** | No socket | Connect |
| **Connected / hub** | Socket up, no `joinedRoom` | Create or join |
| **Lobby waiting** | `joinedRoom` set, `state === null`, `< 2 players` or host hasn't started | Second player joins; host starts |
| **Lobby ready** | 2 players seated, `matchStarted === false` | `game:start` + both `matchStartReady` |
| **In hand** | `state` exists, `!handOver`, `!gameOver` | Hand ends |
| **Hand over** | `state.handOver` | `hand:ready` from both → next hand |
| **Game over** | `state.gameOver` | Rematch or leave |
| **Rematch pending** | One/both `game:rematch` | Both ready → `game:rematch:started` + new `state:update` |
| **Opponent disconnected** | `player:disconnected` | Rejoin or 30s grace auto-pass/draw |
| **Resyncing** | Sequence regression / projection invalid | `fetchGameState` → `room:join` ack |
| **Recovery failed** | Terminal join error | Clear localStorage, show error |
| **Abandoned** | `room:match_abandoned` or join `match_abandoned` | Game over UI, no rejoin |
| **Completed** | Join rejected `match_completed` (`gameOver` room) | Clear recovery, post-game only |

### Server room lifecycle

| State | Fields / markers |
|-------|------------------|
| **Empty lobby** | `state: null`, 1 player |
| **Full lobby** | `state: null`, 2 players, roster + socket room |
| **In progress** | `state` populated, `sequence` incrementing |
| **Hand over** | `state.handOver === true` |
| **Game over** | `state.gameOver === true`, triggers deferred persist |
| **Abandoned** | `abandonedAt` set; join rejected |
| **Cleanup scheduled** | Empty + `ROOM_CLEANUP_GRACE_MS` (env, default in `roomSession.ts`) → persist log + delete room |
| **Reconnect seat held** | `RECONNECT_GRACE_MS` = 5 min seat reservation on disconnect |

### Terminal states (not recoverable)

- `abandonedAt` set
- Join on `gameOver` room → `match_completed`
- Intentional post-game disconnect with `preventAutoRejoinRef`

---

## 4. Networking / realtime architecture

| Layer | Used for private? | Data |
|-------|-------------------|------|
| **Socket.IO** | **Yes — primary** | All live play: create/join/leave/action/state/rematch/chat/presence ping |
| **REST** | Archives only | `GET /api/room-events/:matchId`, `GET /api/mp-stats`; no live moves |
| **Supabase Realtime** | **No** for gameplay | Not used for board sync |
| **Supabase Postgres** | Persistence | `room_match_logs`, `matches`, ratings pipeline, `player_presence`, optional `matchmaking_matches` |
| **localStorage** | Recovery + identity | `racehorse_last_room_code` (active room recovery), `racehorse_guest_identity_v1` (stable guest UUID), `mp_debug=1` (verbose client logs) |
| **sessionStorage** | Minimal | Not primary for private recovery |
| **Server memory** | **Authoritative** | Full `Room` + `GameState` in process heap |
| **Optimistic client state** | **Effectively none** | `optimisticPlayedTile` exists but is never set on play; board waits for `state:update` |
| **Hybrid ack + broadcast** | Yes | `game:action` ack (8s timeout) then `state:update` broadcast to room |

### Spectator / friend-challenge hooks

| Feature | Private casual | Notes |
|---------|----------------|-------|
| **Friend challenge** | Yes | `friend:invite` from lobby or `FriendsScreen`; recipient gets `friend:invited` → join via `room:join` |
| **Spectators** | UI preview only | `PrivateMatchLobbyScreen` shows "Spectators: Off" toggle — **not wired** |
| **Tournament spectate** | Separate path | `room:spectate` handler in `registerRoomSessionHandlers.ts`; emits `state:spectate` with all hands masked empty (spectator sees board + counts only) |

### Complete server socket handlers (`registerRoomSessionHandlers.ts`)

`room:create`, `room:spectate`, `room:join`, `tournament:attach_assigned_match`, `room:leave`, `room:abandon_match`, `player:ready`, `game:start`, `mp:ping`, `game:action`, `hand:ready`, `game:rematch`, `player:dragging` (+ disconnect/reconnect wired via `roomSession.ts` lifecycle)

Friend invite/decline handlers live in `server/src/index.ts` (`friend:invite`, `friend:invite:decline`).

### Client → server events (private-relevant)

| Event | Purpose |
|-------|---------|
| `presence:identify` | Bind socket to user (with optional JWT) |
| `room:create` | New private room |
| `room:join` | Join / rejoin / resync (returns masked state in ack) |
| `room:leave` | Leave lobby (drops seat unless disconnect preserve) |
| `room:abandon_match` | Forfeit mid-game |
| `game:start` | Host starts (requires 2 socket-connected players) |
| `player:ready` | Marks seat ready; auto-start when both ready |
| `game:action` | `MOVE` / `DRAW` / `PASS` |
| `hand:ready` | Advance after hand-over |
| `game:rematch` | Post-game rematch vote |
| `friend:invite` / `friend:invite:decline` | Friend challenges |
| `player:dragging` | Cosmetic opponent hint |
| `room:chat:send` / `room:emote:send` | Reactions |
| `mp:ping` | Latency (client every 5s) |

### Server → client events

| Event | Purpose |
|-------|---------|
| `state:update` | Authoritative masked snapshot + legalMoves + canDraw |
| `room:update` | Roster changes |
| `hand:ended` | Hand reveal payload |
| `game:rematch:status` / `game:rematch:started` | Rematch UI + sequence reset |
| `game:draw_animation` | Forced/manual draw cosmetic chain |
| `player:disconnected` / `player:reconnected` / `player:reconnect_timeout` | Opponent grace |
| `room:match_abandoned` | Forfeit notice |
| `room:session:superseded` | Multi-tab takeover |
| `friend:invited` / `friend:invite:error` | Incoming challenge |
| `server:shutdown` | Deploy warning |

### Background polling (not game state)

| Interval | Event | Purpose |
|----------|-------|---------|
| 5s | `mp:ping` | Keepalive / latency |
| 15s | `presence:online` | Friend invite deliverability |
| 30s | `presence:online` | Home online count |
| 60s | stats fetch | Home weekly stats |

---

## 5. Database / schema audit

### Live rooms

**No `private_rooms` table.** Rooms exist only in server memory until archived or deleted.

### `public.room_match_logs`

| Column | Notes |
|--------|-------|
| `match_id` | PK (uuid) |
| `room_code` | Indexed with `archived_at` |
| `status` | `completed` \| `abandoned` |
| `events`, `state_snapshot`, `participants` | Full archive |
| `participant_user_ids` | GIN index; RLS: select own only |
| **RLS write** | **Denied to clients** (`room_match_logs_no_client_write`) |

### `public.matches`

Online H2H summary rows (`mode: 'online'`, `room_code`, winner/loser). RLS: participants can insert/select.

### `public.matchmaking_matches`

Queue matches only (`MM*****` rooms). Not used for casual private codes unless extended later.

### `player_presence`

Upserted on identify / in-game transitions. Used for friend reachability and home counts.

### Cleanup / expiry

| Mechanism | Duration |
|-----------|----------|
| Reconnect seat reservation | 5 min (`RECONNECT_GRACE_MS`) |
| Turn disconnect grace | 30s (`DISCONNECT_GRACE_MS`) |
| Empty room cleanup | `ROOM_CLEANUP_GRACE_MS` (env) |
| Friend challenge expiry | 60s (client) |
| Room codes | 5 chars from ~32 charset ≈ 33M space; no rate limit documented |

### Uniqueness assumptions

- One active room per code in memory
- One seat per `userId` in roster (supersede on rejoin)
- `matchLogged` flag prevents duplicate game-over persist (set synchronously before async IIFE completes — see §9)

---

## 6. API endpoint audit

### REST (multiplayer-adjacent)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/mp-stats` | Open | Process-local room/socket counts |
| `GET` | `/api/room-events/:matchId` | User JWT | Fetch archived `room_match_logs` for completed/abandoned room |
| `POST` | `/league/fixture/:id/live-room` | League | Creates reserved `LG-*` room (not private casual) |

**All live private play is Socket.IO only** (see §4).

### Socket ownership

Handlers registered in `registerRoomSessionHandlers.ts`, initialized from `index.ts` via `initRoomSession` / `registerRoomSessionHandlers`.

---

## 7. Real-time sync audit

### Board state to opponent

1. `game:action` → `rooms.act()` → mutates `room.state`, increments `sequence`
2. `broadcastStateUpdate(roomCode)` loops sockets in IO room
3. Per recipient: `maskStateForRecipient(state, recipientSeatId)` — opponent hands empty unless `handOver` or `gameOver`
4. Emits `state:update` with `you`, `state`, `legalMoves`, `canDraw`, optional forced-draw metadata

### Turn enforcement

- Server: `assertCurrentPlayer` in `engine.ts`; wrong turn throws
- `game:action` rejects spectators, missing state, `gameOver`
- Client: blocks actions when disconnected, recovering, or `pendingActionRef`

### Hand / hidden tile protection

- **Server masking** in `maskStateForRecipient` (centralized in `roomSession.ts`)
- `handCounts` exposed for opponent (count only, not tiles)
- Reveal all hands on `handOver` / `gameOver`

### Duplicate move prevention

- **No request-id dedupe** on `game:action`
- Relies on: turn check + engine rejecting illegal moves + client `pendingActionRef` (single in-flight action)
- `hand:ready` has stale/duplicate guard on server

### Stale subscriptions

- Socket listeners re-bound when `socket` changes in hooks
- `useRoomSocketSync` depends on memoized `params` object
- Old socket torn down on reconnect in `useMultiplayerConnection`

### Reconnect catch-up

1. Socket reconnect → `room:join` with stored code + identity
2. Server: migrate seat by `userId`, force-disconnect old socket if connected
3. Join ack returns full masked state + legal moves
4. Client: `fetchGameState` if sequence watermark rejects update (gap > 10 → full resync)
5. Resync buffers `state:update` while `resyncInFlightRef`

### Clock / order conflicts

- **`GameState.sequence`** monotonic per match (not reset on rematch — client resets watermark on `game:rematch:started`)
- Client rejects `incoming < watermark` (stale); large regression triggers resync
- Rematch ordering fix **in place:** `game:rematch:started` before `broadcastStateUpdate` (see `registerRoomSessionHandlers.ts` ~1207)

---

## 8. Performance / lag audit

### Likely causes (ranked)

| # | Cause | Evidence |
|---|-------|----------|
| 1 | **Full state payload every move** | `state:update` includes board, both player objects, boneyard, config |
| 2 | **Monolithic `App.tsx` re-renders** | Dozens of `useState` hooks; in-game shell not isolated |
| 3 | **No optimistic tile placement** | User waits for ack + broadcast before board updates |
| 4 | **8s ack wait on actions** | `emitWithAck` timeout; UI blocked via `pendingActionRef` |
| 5 | **Draw animation step timers** | Multiple `setFlyingTiles` updates per forced-draw chain |
| 6 | **Board projection on every update** | `projectMultiplayerGameState` runs each `state:update` |
| 7 | **Auto draw/pass effect** | Large dependency array in `App.tsx`; can re-fire frequently |
| 8 | **Duplicate state on rejoin** | Join ack + optional `broadcastStateUpdate` to room |
| 9 | **Socket.IO polling fallback** | Client allows `['polling', 'websocket']` — extra latency on poll transport |
| 10 | **Background presence polls** | 5s ping + 15s/30s presence (minor) |
| 11 | **Cold server / deploy** | In-memory rooms lost; MM shell hydration only for `MM*` codes |
| 12 | **Game-over persist IIFE** | Async Supabase writes on game over (non-blocking but adds server load) |

### Not primary lag sources

- Supabase Realtime (unused for play)
- REST polling for game state (none)

---

## 9. Fragility / race-condition audit

| Risk | Status / notes |
|------|----------------|
| **Start twice** | `tryStartMatchIfReady` no-ops if `room.state` already exists; `matchStartReady` cleared after start |
| **Join twice** | Same user migrates seat; supersede disconnects old socket (**fixed** vs older `already_connected` reject) |
| **Duplicate move submit** | No server idempotency; client single-flight guard only |
| **Out of turn** | Engine throws; surfaced as ack error |
| **Divergent boards** | Possible briefly during resync buffer or animation overlay; sequence watermark converges |
| **Lost tiles** | No global tile-count invariant assert (see hardening map) |
| **Expose opponent hand** | Masking centralized; smoke tests **do not** verify masking |
| **Stuck after leave/reconnect** | Complex: multiple refs (`reconnectShouldJoinRef`, `preventAutoRejoinRef`, terminal join errors) |
| **Refresh mid-game** | localStorage + auto `room:join`; works if room still in memory on same server instance |
| **Both act quickly** | Async `game:action` handlers can interleave on one Node process — **no per-room mutex** |
| **Host leaves** | `room:leave` drops seat from engine unless disconnect preserve; can orphan game |
| **Guest leaves** | Same |
| **Network drop mid-move** | 30s grace then auto pass/draw; client reconnects via join |
| **Two tabs** | New tab superseded old via force disconnect + `room:session:superseded` |
| **Orphan rooms** | Cleanup timer when empty; abandoned rooms persist until cleanup |
| **Rematch freeze** | **Mitigated:** emit order fixed (`game:rematch:started` before state) |
| **Double rating insert** | `matchLogged` set synchronously at start of game-over branch; idempotency on ranked INSERT still weak |
| **Lobby settings lie** | 7/14 tiles, timed, rated toggles in UI **not sent** to `room:create` / `game:start` |
| **Guest UUID spoof** | Without JWT, UUID claims dropped; non-UUID guest ids allowed |
| **Friend invite spoof** | `fromUserId` from payload; room existence only check |

---

## 10. Security / fairness audit

| Check | Finding |
|-------|---------|
| **Spoof moves** | Must be seated player; engine validates legality — **server authoritative** |
| **Illegal moves** | Rejected in `applyMove` / `canDraw` |
| **Hidden tiles** | Masked server-side before emit |
| **Room code guessing** | 5-char code; no documented join rate limit — brute force theoretically possible |
| **RLS on live play** | N/A — no live rows; archives protected |
| **Client-trusting areas** | Friend invite sender; queue `userId` (quick match); guest username collision on reconnect seat reclaim |
| **JWT on room join** | `authToken` verified → `userId`; without token, UUID stripped |
| **Scoring / turns** | Server-only via `engine.ts` |
| **Private rated games** | UI shows "Rated: On" but **not wired**; actual rating tied to game-over persist path for online matches (verify product intent for private) |

---

## 11. UX audit — confusing states

| State | User sees | Root cause |
|-------|-----------|------------|
| **Joining** | Spinner / pending | `joinInFlightRef`, ack wait |
| **Waiting for opponent** | Lobby with 1/2 players | Normal |
| **Waiting for ready** | Start fails silently? | Host `game:start` before guest `player:ready` — guest usually auto-readies on join |
| **Opponent disconnected** | Banner + grace timer | `player:disconnected` |
| **Reconnecting** | Toast / recovery banner | Custom reconnect + socket.io reconnect |
| **Invalid room code** | Error toast | `room:join` ack error |
| **Game already started** | Join to in-progress via code — should work via rejoin |
| **Game full** | Room full error; reconnect seat reclaim path |
| **Host left** | Opponent may see roster shrink; game may break |
| **Move failed** | Toast from ack error / timeout |
| **Stale board** | Rare; sequence guard + resync |
| **Rematch unavailable** | Tournament rooms block rematch |
| **Cosmetic settings** | User picks 14-tile / timed — **server uses defaults** |

---

## 12. Testing audit

### Existing automated coverage

| Suite | Count | Covers |
|-------|-------|--------|
| `client/scripts/socketSmoke.mjs` | 13 scenarios | Reconnect, room switch, seat migration, mid-hand actions, draw guards, forced draw, post-move stability, hand ready guards, guest reconnect, tokenless UUID, hand-ended replay, identity freeze, same-user takeover |
| `registerRoomSessionHandlers.abandon.test.ts` | Abandon, rejoin rejected |
| `registerRoomSessionHandlers.tournament.test.ts` | Attach, completed room join reject |
| `engine.test.ts` | 63 | Rules, not socket integration |
| `matchmaking/*` | Queue only |

### High-value missing tests

1. **Create private room + join + start + one legal move** syncs to both clients
2. **Illegal move rejected** on socket
3. **Hand masking:** opponent `hand === []` in `state:update`
4. **Duplicate `game:action`** fast double-click — single state advance
5. **Refresh/reconnect** mid-game preserves turn and board
6. **Host `room:leave` mid-game** — opponent experience
7. **Game over → rematch** full sequence (event order + playable state)
8. **Abandon → rejoin rejected**
9. **Completed room join rejected**
10. **Friend invite flow** (mock sockets)
11. **Stress loop:** 100 actions, tile invariant (when added)
12. **Private `game:start` with only host ready** — expect `waiting_for_ready`

---

## 13. Prioritized stabilization plan

**Do not implement in this pass.** Suggested order for the next stabilization prompt:

### P0 — Must fix before real users (reliability / data)

1. **Per-room action serialization** — prevent concurrent `game:action` interleaving
2. **Tile-count invariant** after every mutation (`assertTileCountInvariant`)
3. **Game-over persist idempotency** — unique key on ranked/match inserts; set `matchLogged` only after success
4. **Host leave mid-game policy** — explicit forfeit or seat preserve (product decision)
5. **Wire or remove lobby settings** — 7/14, timed, rated must match server or be removed from UI
6. **Hand-masking smoke test** — security-critical regression guard

### P1 — Major lag / reliability

7. **Split in-game shell from `App.tsx`** — reduce re-render blast radius
8. **Trim `state:update` payload** — deltas or hand-only diff for non-board fields
9. **Transport preference** — prefer websocket-only after connect
10. **Remove duplicate state delivery on rejoin** (ack vs broadcast)
11. **Consolidate reconnect paths** — document single recovery state machine
12. **Friend invite auth** — verify sender is in room

### P2 — UX polish

13. Clear **waiting_for_ready** / **waiting_for_players** copy on start failure
14. Opponent-left definitive modal
15. Recovery failed → actionable retry (not just toast)
16. Rate-limit / lockout on repeated failed joins

### P3 — Architecture (future)

17. **Redis / shared room store** for multi-instance + survive deploy
18. **Dedicated match route** (not only localStorage recovery)
19. **Request-id idempotency** on `game:action`
20. Extract private flow from shared quick/tournament `App.tsx` branch

---

## Suggested next stabilization prompt (copy-paste)

> Stabilize private multiplayer P0 only: (1) serialize `game:action` per room, (2) add tile-count invariant asserts in `act()`, (3) fix game-over persist idempotency, (4) add socket smoke tests for create/join/start/move/masking/abandon. Do not redesign UI. Do not refactor App.tsx structure yet. Do not change gameplay rules.

---

## Appendix A — Room code generation

```169:176:server/src/rooms.ts
function makeCode(len = 5): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // ...
}
```

## Appendix B — Rematch emit order (current)

```1206:1213:server/src/multiplayer/registerRoomSessionHandlers.ts
        await startGame(room.code, io, { allowRestart: true });
        io.to(room.code).emit('game:rematch:started', { roomCode: room.code });
        broadcastStateUpdate(room.code);
```

## Appendix C — Force disconnect on same-user rejoin (current)

```169:173:server/src/multiplayer/registerRoomSessionHandlers.ts
          if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
            oldSocket.emit('room:session:superseded', { reason: 'new_session', newSocketId: socket.id });
            oldSocket.disconnect(true);
```

## Appendix D — Cosmetic lobby settings (not sent to server)

```262:265:client/src/multiplayer/PrivateMatchLobbyScreen.tsx
  const [dealFormat, setDealFormat] = useState<7 | 14>(7);
  const [timedTurnsUi, setTimedTurnsUi] = useState<'untimed' | '30s'>('untimed');
  const ratedPreview = true;
```

---

*End of audit.*
