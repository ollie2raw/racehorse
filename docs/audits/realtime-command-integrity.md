# Realtime command protocol & session integrity — local review

Base: `origin/feat/app-store-candidate` `fe48fee9d495e0474625a04d360dabc0db7d9988`. Branch `audit/realtime-command-integrity`.
Local only: no push, no integration, no production access. Evidence: `server/scripts/realtimeCommandProbe.ts` (REAL server
process + raw Socket.IO clients + owned local PostgreSQL/PostgREST, failure injection at the HTTP boundary) and
`server/src/multiplayer/realtimeCommandIntegrity.test.ts` / `commandMatchBinding.test.ts` / `gameActionIdempotency.test.ts`.

## Mutation inventory (client -> server)

All socket events pass `installSocketRateLimit` first (per event, per verified user id, else IP/socket; reject before the
handler runs). Seat authority is `resolveActorSeatId`: the roster must say THIS socket currently owns the seat (a
superseded socket is disconnected by the takeover, and cannot resolve to a seat even while its transport tears down).

| Event | Authn | Seat / room authorization | Generation binding | Idempotency / ordering | Validation | Limit |
|---|---|---|---|---|---|---|
| `presence:identify` | token verified; or claimed non-UUID guest label (unverified) | none (no room state) | n/a | idempotent | identity resolver | default |
| `room:create` | optional token | creates; leaves prior rooms (socket-owned seats only) | new match | not idempotent by design | `sanitizePrivateRoomConfig` | 10/min |
| `room:join` | token, or guest label + HMAC reconnect capability | roster identity; guest reclaim needs capability; blocks list; full/terminal rejected | n/a | rejoin migrates seat atomically before old socket is dropped | code/identity normalized | 30/min + failed-lookup limiter |
| `room:spectate` | requires a userId (guest label passes) | only spectatable room kinds; never joins the engine | n/a | idempotent | code | 30/min |
| `room:leave` | n/a | socket-bound membership | n/a | idempotent | typeof string | default |
| `player:ready`, `game:start` | seat | seat / host / readiness | current game | `waiting_for_ready` | code | 120/min (ready) |
| `game:action` | seat | seat owner, turn owner (engine) under the room gameplay lock | optional `matchId` (this pass) + request-id receipts | **requestId + payload fingerprint** (this pass); legality; per-room lock | shape gate `isWellFormedGameAction` (this pass) + engine legality | 240/min |
| `hand:ready` | seat | seat | optional `matchId` | requestId receipts + handNumber + fingerprint; no receipt for no-ops (this pass) | numeric handNumber | 120/min |
| `game:rematch` | seat | seat, game over, durable persist gate, both seats | optional `matchId`; new `matchId` per game | duplicate ready is a set add | code | default |
| `game:pregame_draw_pick` | seat | seat, phase, slot unrevealed | current draw | stale/duplicate pick ignored | slotId | default |
| `room:abandon_match` | verified account, or guest **seat-owner socket** (this pass) | seat resolved from roster | optional `matchId` | latched once (`abandonedAt`) | roomCode | default |
| `room:emote:send` | seat | membership | n/a | none (cosmetic) | emote id | 60/min |
| `queue:*` | token or guest label | n/a | n/a | queue is single-entry per socket | identity | join 10/min |
| `friend:invite*`, `presence:online` | verified user | friend graph | n/a | n/a | ids | 20/min |
| disconnect / grace timer | server-owned | server-owned | seat-keyed timer | `actIfCurrent` decides inside the room lock | n/a | n/a |
| tournament `register/withdraw/get_bracket/attach_assigned_match` | verified user | tournament rules | n/a | RPC-level | n/a | tournaments OFF |

HTTP: no HTTP route mutates live multiplayer gameplay (room routes are read-only; Daily Fritz is a separate single-player engine).

## Findings

### R1 - guest impersonation: any socket could resign another guest's seat (FIXED)
`presence:identify` stores a CLIENT-CHOSEN non-UUID `userId` on `socket.data.userId` without a token (guest labels are
intentionally unverified), and `room:abandon_match` resolved the seat by `roster.find(userId === socket.data.userId)`.
Every player in a room sees every roster `userId`. Reproduction (probe `guestimp`): guest B (or any outsider who learns the
label) identifies as `guest-a-probe`, sends `room:abandon_match` for A's room -> `{ok:true, winnerId:'guest-b-probe'}`, A's
match is forfeited. Fix: a guest label proves nothing, so for non-UUID ids the abandoning seat must be the seat THIS socket
owns; verified accounts are unchanged (any of their sockets may resign). Regression: handler test + probe.

### R1 - previous game's request id executes in the next game (FIXED)
`game:rematch` cleared the whole receipt cache. A command whose response was lost in game A and retried (same request id)
after the rematch started was no longer recognised and ran as a NEW action in game B whenever it was legal there.
Reproduction (probe `rematch`): final move of game A, rematch, replay the id with a legal-in-B payload -> `{ok:true}`, state
advanced. Fix: receipts are no longer cleared on rematch (they expire after 5 min; ids are random per command), so the id
keeps resolving to its original result or fails closed.

### R1 - same request id, different payload reported as a duplicate success (FIXED)
Receipts were keyed `(room, seat, requestId)` only. Re-using an id with another payload returned `{ok:true, duplicate:true}`
(state unchanged but the client was told its NEW command applied), also after a restart. Fix: receipts carry a payload
fingerprint (`fingerprintGameCommand`: type, tile pips, position, hand number - never the id), persisted in the snapshot and
the durable receipt row (`ack.fp`, no migration). Mismatch -> `{ok:false, error:'request_id_conflict', code:'request_id_conflict'}`
without executing. Receipts written before this change have no fingerprint and keep the old id-only behavior.

### R1 - retry of the FINAL move after response loss got "Game is over" (FIXED)
Current-state checks ran before the receipt lookup, so a legitimate retry of the winning move returned a rejection instead of
the original logical result. A receipt lookup now precedes the state gates.

### R2 - malformed MOVE shapes reached the engine and leaked JS error text (FIXED)
`move:'x'`, `move:[]`, `tile:{}` produced `Cannot read properties of undefined (reading 'high')` to the client. A shape gate now
rejects with `code:'malformed'`; errors that carry infrastructure detail are replaced by a generic message (`internal_error`).
No crash, no state change existed before the fix (verified by the 24-case fuzz).

### R2 - `hand:ready` no-ops wrote a durable receipt per unique request id (FIXED)
Up to 120/min/user rows in `room_command_receipts`. Valid no-ops (hand not over / game over) no longer consume a receipt.

### R2 - optional match (generation) binding added
`matchId` (optional) on `game:action`, `hand:ready`, `game:rematch`, `room:abandon_match`: a command composed for another
match is refused with `stale_match` before any state is touched. Clients do not send it yet (see Deferred).

### R3 - fixed opportunistically
`queue:*` handlers called a junk ack argument (`ack?.()` on an object) and threw through to `uncaughtException`/Sentry.

## Verified without change

* Two sockets, one identity: takeover migrates the seat BEFORE the old socket is dropped; the old socket is disconnected and cannot act; its disconnect does not forfeit the replacement; reconnect during the 30 s disconnect grace cancels auto-act (36 s probe). Guests: capability required to reclaim a seat; forged capability is refused and does not displace the owner.
* Authorization: non-member, spectator, forged `playerId/seatId/userId` fields, guest claiming an account UUID without a token - all rejected; no state change.
* Out of order: legality + turn ownership under the per-room gameplay lock is sufficient (a late C1 after C2 is "not your turn"/illegal); no sequence numbers added.
* Atomicity: mid-hand moves ack after in-memory commit and persist asynchronously; the receipt is gated on the snapshot being durable, so a lost snapshot + hard kill leaves no receipt and the same id re-applies exactly once (probe `persistloss`); terminal/hand-over moves persist synchronously and roll back (existing tests). After a hard kill a retried id is a duplicate (probe `restart`).
* Races: move vs forfeit fired concurrently, 6 rounds: each had one coherent outcome (move applied then forfeit; later gameplay `match_abandoned`; ranked rows exactly 2). `applyActiveMatchForfeit` checks and latches `abandonedAt` in one synchronous block; `actUnlocked` has no `await` after its abandon check.
* Cost: illegal `game:action` flood (2000) = 1760 rate-limited, 0 database requests; `game:rematch`/`game:start`/non-member abandon/leave/spectate = 0 database requests; non-member `room:join` = 1 `user_blocks` read per attempt, capped at 30/min.

## Deferred

* R3: other handlers still call `cb?.()` on a non-function cb argument; asynchronous ones are caught by `trackSocketHandlers` (logged), none crash.
* R3: a terminal move whose synchronous persist fails is rolled back; an abandon that arrived in that window is answered `match_completed` and not applied.
* R3: `room:spectate` accepts a guest label as "authenticated".

## Match-generation binding (closed in the follow-up pass)

Client -> server path. The authoritative current match id is `roomMatchIdRef` (fed by the server's `eventMeta.matchId` on the
join ack and every state update, reset per joined room). `App.tsx` registers a reader over that SAME ref with
`roomTransport.setRoomMatchIdReader`; the transport keeps no identity of its own.
* `game:action` (play/draw/pass): the match id is captured when the logical command is CREATED
  (`resolveLogicalActionRequestId` -> `LogicalGameplayAction.matchId`) and every emission of that command sends it. A retry
  reuses the stored id even after the session already reports game B; it is only "not a retry" if the session positively reports
  a different match. A payload that carries the key (even `null`) is never re-stamped at emit time.
* `hand:ready`, `game:rematch` (`(code, {matchId}, ack)`), `room:abandon_match` (`matchId` in the payload): stamped from the
  current match at the user action. When unknown the legacy wire shapes are sent unchanged.
* Server: `staleMatchAck` compares to `room.matchId`; request-id idempotency stays separate and is consulted FIRST for
  `game:action`/`hand:ready`, so a legitimate response-loss retry of a game-A command (same id, same payload, game-A match id)
  still returns its original result after game B started, a changed payload is `request_id_conflict`, and a never-applied game-A
  command is `stale_match`.

Compatibility window: a missing `matchId` is still accepted by default because already-deployed web/PWA/iOS builds do not send it
yet; a PRESENT id is always compared, so every updated client is protected immediately. After the supported-client floor includes
this release, set `COMMAND_MATCH_ID_REQUIRED=true` to fail closed (`match_id_required`) for unbound match-scoped commands.

Review of `fe48fee..c779b74` (regressions only), fixed: the internal-detail filter matched `econn` inside `reconnect_unavailable`
(a legitimate rejection became `internal_error`); durability rejections (`room_degraded`, `*_blocked`, `reconnect_unavailable`)
are now `not_active`; the fingerprint ignored the legacy `end` alias that the engine honours. Checked and acceptable: guest abandon
now needs seat-socket ownership (a hydrated-but-not-rejoined guest must rejoin first), receipts retained across rematch cannot
collide with a new game because the client no longer reuses a logical request id across matches and ids are random per command.
