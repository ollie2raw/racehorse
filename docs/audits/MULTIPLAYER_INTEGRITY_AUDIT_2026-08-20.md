# Multiplayer Integrity Audit — 2026-08-20

Fresh pass. Findings were re-derived from current code and tests only. Prior ranked list (PR-MP-A…D / [PR-MP-D tournament apply](828d6c1f-c33a-4dea-a91b-a2ab71f07c14)) is used **only** in §7 for the diff.

**Scope:** connection/disconnect, game-over/result persistence, action apply/rollback, tournament bracket advancement, matchmaking/lobby, private room lifecycle, reconnect/resume, spectator.

**Bar per finding:** failure mode · proving test (exact `it(...)` quote or none) · severity.

**No fixes in this pass** — ranked list only.

---

## 1. Architecture baseline (current)

| Store | Location | Durable? |
|-------|----------|----------|
| Live room + `GameState` | `server/src/rooms.ts` `Map` | Live snapshot → `room_live_sessions` (best-effort) |
| Socket ↔ seat roster | `roomSession.ts` | No (rehydrated from live session when present) |
| Reconnect seat holds | `reconnectSeatsByCode` (5 min) | No |
| Disconnect grace timers | `disconnectGrace.ts` | No |
| Matchmaking queue | `QueueService` in-memory | No |
| Tournament bracket | Supabase `scheduled_tournament_*` | Yes |
| Ranked / match history | `ranked_games`, match logs, `matchmaking_matches` | Yes (paths vary) |

Private, quick-match, and tournament live play share the same room/action/disconnect machinery. Differences are mostly terminal side effects (ratings vs `applyMatchResult` vs MM `recordMatchEnd`).

---

## 2. Area reviews

### 2.1 Connection / disconnect fairness

**Mechanism:** `onActivePlayerSocketDisconnect` → 30s grace → if still disconnected and on turn: durability gate → snapshot → `act` PASS/DRAW → flush → rollback if not recoverable → durability retries (6×10s) → pause (no forfeit) or commit + `disconnectExpiries`; second successful expiry → `applyActiveMatchForfeit(..., 'disconnect_timeout')`.

**Failure modes if broken:** unfair auto-pass/forfeit while DB lag; memory ahead of clients; opponent sees move that never stuck; or (after pause) permanently stuck match.

**Proving tests (exist):**

- `it('rolls back auto-act and emits stall retry when flush is not durably recoverable')` — `disconnectGrace.test.ts`
- `it('recovers mid-retry: flush fails once then succeeds — commits once, no forfeit from failed attempt')`
- `it('skips act and emits stall when durability already blocks gameplay')`
- `it('pauses after durability retry ceiling with no further timers or forfeit')`
- `it('covers full disconnect and forfeit lifecycle on second expiry')`
- `it('clears grace timer on reconnect before timeout and performs no auto action')`
- `it('tracks grace timers per seat so reconnecting one player does not clear another player timer')`

**Residual finding D1 — disconnect durability pause has no resume path**

| | |
|--|--|
| **Failure mode** | After retry ceiling, match pauses forever in-process (`DISCONNECT_STALL_PAUSED_MESSAGE`). No timer restarts when durability becomes healthy again; players must leave/forfeit or wait for process/room death. |
| **Proving test** | Pause behavior proven by `it('pauses after durability retry ceiling with no further timers or forfeit')`. **NO PROVING TEST** that recovery after pause re-enables auto-act or unlocks play. |
| **Severity** | **P1** — stuck state, honest messaging; not silent wrong result. Intentional tradeoff from PR-MP-A. |

Leave vs disconnect: `leaveTrackedRoom` forfeits mid-game unless `preserveSeat: true` (disconnect path). Covered by:

- `it('does not forfeit when leaveTrackedRoom is called with preserveSeat during active game')`
- `it('sets abandonedAt and emits room:match_abandoned when leaving during active game')`
- `it('does not forfeit lobby room:leave when room.state is null')`

---

### 2.2 Game-over / result persistence integrity

**Mechanism:** On `gameOver` broadcast, `roomSession` schedules `createGameOverPersistScheduler` once (`idle` → `pending`). `matchLogged` / `succeeded` only after a successful attempt. 4 attempts `[0,400,1200,2800]ms`. Give-up → `failed`, emit `match:result_persist_failed`, funnel `private_game_over_persist_failed`. Rematch blocked while `pending`; allowed after `succeeded` **or** `failed`.

Tournament branch: `applyTournamentGameOverFromRoom` must succeed or throw; never latch success without bracket apply. Ops: `docs/ops/tournament-apply-match-result-repair.md`.

**Proving tests (exist):**

- `it('sets matchLogged only after a successful persist attempt')` — `gameOverPersistence.test.ts`
- `it('retries appendMatch failures then gives up without latching matchLogged')`
- `it('recovers mid-retry: fails then succeeds — latches matchLogged once')`
- `it('tournament apply give-up: 4 failures → terminal failed + tournament copy, no matchLogged')`
- `it('tournament apply mid-retry recovery: fail then succeed — latches once, no give-up emit')`
- `it('tournament missing winnerUserId: does not latch success — gives up with tournament copy')`
- `it('blocks rematch while game-over persist is still pending (R1)')` — `registerRematchPregameHandlers.test.ts`
- `it('allows rematch after persist give-up (failed status) so seats are not stuck forever')`

**Residual finding G1 — rematch after give-up abandons the unsaved result**

| | |
|--|--|
| **Failure mode** | After persist ceiling, both seats can rematch. First match ratings/history/bracket apply are never retried. Players may believe “we rematched so we’re fine” while profiles never updated. |
| **Proving test** | Intentional unlock proven by rematch-after-failed test above. **NO PROVING TEST** that a later rematch re-attempts the prior result. |
| **Severity** | **P1** for ranked/history trust; **P0-class** for tournament if give-up happened (bracket stuck — see T1 / ops). Product choice from PR-MP-B/D. |

**Residual finding G2 — tournament forfeit marks abandoned before `applyMatchResult`**

| | |
|--|--|
| **Failure mode** | `applyActiveMatchForfeit` sets `abandonedAt` then awaits `applyMatchResult`. If apply throws, `leaveTrackedRoom` logs and continues. Room looks forfeited to players; bracket may not advance. |
| **Evidence** | `roomForfeit.ts` sets `abandonedAt` before `await applyMatchResult(...)`; attach leave catches forfeit errors. |
| **Proving test** | Happy path: `it('forfeits a scheduled tournament match through applyMatchResult')`. **NO PROVING TEST** for apply failure after local abandon latch. |
| **Severity** | **P0** — false terminal UX + stuck bracket (same class as game-over give-up, but **silent** to seats: they get abandon emit, not tournament persist-failed copy). |

---

### 2.3 Core action application / rollback

**Mechanism (`game:action`):** durability assert → idempotency → `captureRoomGameplaySnapshot` → `act` → flush → if not recoverable: `rollbackRoomGameplayCommit` → ack `{ ok:false, uncertain:true }` (not cached) → no broadcast. Client resyncs on uncertain.

**Proving tests (exist):**

- `it('rolls back memory and returns uncertain when flush is not durably recoverable')` — `registerGameplayActionHandlers.test.ts`
- `it('consecutive flush failures: each attempt rolls back; board/turn stay at baseline')`
- `it('does not cache uncertain acks so same requestId can re-execute after rollback')` — `gameActionIdempotency.test.ts`
- `it('steps 1–6: happy move → forced flush fail → silent B → A retry → recover')` — `gameActionPersistRollback.integration.test.ts`
- `it('game:action with duplicate requestId mutates only once and replays ack')`
- `it('blocks gameplay actions after room persistence failure')`

**New finding A1 — `hand:ready` / `nextHand` / `startGame` mutate-then-flush without rollback**

| | |
|--|--|
| **Failure mode** | `nextHand` / `startGame` / pregame start commit memory then `flushCommittedRoomStateOrThrow`. On throw, state stays advanced; `readyForNextHand` schedules advance with `.catch` that only logs. Clients can disagree on hand number / deal; ready set already cleared. |
| **Evidence** | `rooms.ts` `nextHand` mutates then flush-or-throw; advance `.catch` logs only; `hand:ready` handler does not snapshot/rollback. Contrast: `game:action` always rollbacks. |
| **Proving test** | Hand race coverage exists (`it('does not corrupt state when a late game:action races hand:ready at hand boundary')`) but **NO PROVING TEST** that flush failure rolls back a new hand or keeps both seats on the prior hand-over board. |
| **Severity** | **P1** — desync / stuck mid-hand transition under DB blips (same architectural hole PR-MP-C closed for MOVE/DRAW/PASS, still open for hand lifecycle). |

---

### 2.4 Tournament bracket integrity + applyMatchResult retry/give-up

**Mechanism:** Game-over persist requires successful `applyTournamentGameOverFromRoom` → `applyMatchResult`. Idempotent if `status === 'completed'`. Give-up emits tournament-specific copy + funnel `kind: 'tournament_apply'`. Ops re-run is safe.

**Proving tests (exist):**

- `it('applyMatchResult is idempotent — replay does not re-fire completed')` — `engine.test.ts`
- `it('applyMatchResult is idempotent after game_over completion')` — `engine.gameOver.test.ts`
- `it('uses scheduledTournamentMatchId without room lookup')` / `it('falls back to room code when in-memory match id is missing')`
- `it('tournament apply give-up: 4 failures → terminal failed + tournament copy, no matchLogged')`
- Bracket lifecycle: `it('drives 8 players through QF → SF → Final, one tournament:completed fires')`

**Residual / new:**

| ID | Finding | Severity |
|----|---------|----------|
| T1 | Give-up still requires ops (`docs/ops/tournament-apply-match-result-repair.md`); players cannot self-heal. | **P1** residual (honest UX) |
| G2 | Forfeit path can abandon room without durable apply (above). | **P0** |
| T2 | Multi-instance race on non-atomic complete+advance still noted in older DB audits; single Render process today mitigates. | **P2** (deployment-contingent) |

---

### 2.5 Matchmaking / lobby

**New finding M1 — `handleMatched` can orphan a reserved room after dequeue**

| | |
|--|--|
| **Failure mode** | `QueueService.tick` leaves both players, then `onMatched`. `createReservedRoom` is outside `try`; catch only logs. Players are out of queue with no `queue:matched`; empty room may linger until unrelated cleanup. |
| **Evidence** | `queueService.ts` leave-then-`onMatched`; `matchmaking/index.ts` `handleMatched`. |
| **Proving test** | **NO PROVING TEST**. Nearby: `it('emits private_lobby_created with sourceType quick after matchmaking records the match')` (happy path only). |
| **Severity** | **P1** in practice (`recordMatchStart` rarely throws — it swallows DB errors); **structural P0** if any throw after create. |

**New finding M2 — `recordMatchStart` / `recordMatchEnd` swallow DB failures**

| | |
|--|--|
| **Failure mode** | Match still plays with a local `matchmakingMatchId`. After restart, `tryHydrateMatchmakingRoomShell` finds no `in_progress` row → players cannot resume via MM shell. History row missing. Silent durability lie. |
| **Evidence** | `matchmaking/persistence.ts` comment: “Persistence failures are swallowed… the match itself still plays.” |
| **Proving test** | **NO PROVING TEST** that failure is surfaced or that hydrate miss is tied to swallowed insert. |
| **Severity** | **P1** |

**New finding M3 — unlocked concurrent `tryStartMatchIfReady`**

| | |
|--|--|
| **Failure mode** | Check `!room.state` then await `initiatePregameDrawOrStart` with **no** `withRoomGameplayLock`. Pregame path overwrites `preGameDraw` / shell state without “already started” guard. Concurrent ready/auto-start can double-deal. |
| **Evidence** | `matchStartReady.ts`; `initiatePregameDrawOrStart` (no lock). |
| **Proving test** | Sequential only: `it('emits private_match_started only when the match actually starts')`. **NO PROVING TEST** for concurrent start. |
| **Severity** | **P1** (P0 if reproduced under dual ready race — trust/deal corruption). |

**New finding M4 — MM shell hydrate has no matched-player ACL**

| | |
|--|--|
| **Failure mode** | After deploy, hydrate creates empty reserved room from `select=id` only. Anyone who knows `roomCode` can `room:join` and take seats; DB `player_a_id` / `player_b_id` unused. |
| **Evidence** | `roomShellHydration.ts`. |
| **Proving test** | Hydrate happy path: `it("returns 'hydrated' and sets matchmakingMatchId on the reserved shell")`. **NO PROVING TEST** for join ACL. |
| **Severity** | **P1** (needs room code; still seat-steal after restart). Escalate if codes are guessable/leaked. |

**New finding M5 — empty reserved MM rooms never enter cleanup**

| | |
|--|--|
| **Failure mode** | `createReservedRoom` leaves `players: []`. Cleanup only via `evaluateRoomLifecycle` on leave/join. If neither client joins after match (or `handleMatched` fails after create), room sits forever in-process (often with an `in_progress` DB row). |
| **Proving test** | **NO PROVING TEST** |
| **Severity** | **P1** |

**New finding M6 — MM auto-start proceeds after socket-sync timeout**

| | |
|--|--|
| **Failure mode** | `waitUntilMatchmakingRoomSocketsReady` returns after 5s with no error; caller still `tryStartMatchIfReady`. Deal can start while a seat socket never joined the Socket.IO room → partial broadcast / false UI. |
| **Evidence** | `roomShellHydration.ts` wait falls through; `roomSocketAttach.ts` still starts. |
| **Proving test** | Timeout proven by `it('stops polling after MATCHMAKING_JOIN_SYNC_MAX_MS even if sockets never join')` — **does not** assert start is refused. **NO PROVING TEST** for “do not start if sync fails”. |
| **Severity** | **P1** |

**New finding M7 — `createReservedRoom` code collision returns existing room**

| | |
|--|--|
| **Failure mode** | If `makeRoomCode()` collides, second MM match reuses in-memory room / can overwrite `matchmakingMatchId`. |
| **Proving test** | **NO PROVING TEST** |
| **Severity** | **P2** (rare) |

**Well covered:**

- `it('rejects a second queue:join from same userId while first is awaiting rating fetch')`
- `it('rejects duplicate userId join')`
- `it('never pairs the same userId with itself')`
- `it('rejects authenticated queue userId spoofing')`

---

### 2.6 Private room creation / lifecycle

**Create/join/leave:** `registerRoomLifecycleHandlers` / join handlers / `leaveTrackedRoom`. Live session scheduled on create. Cleanup after grace when no connected seats (or game over + later empty).

**New finding P1 — guest reconnect allocates a new seat when room not full**

| | |
|--|--|
| **Failure mode** | Reconnect hold is found, but code always `allocatePlayerSeatId()` + `joinRoom` first; reclaim only runs if join throws “Room is full”. Solo guest host disconnect → reconnect while one seat still listed → **zombie seat + new seat** → room full with one live human. Friend cannot join; host may see wrong roster. |
| **Evidence** | `roomSocketAttach.ts` (~367–415). `identityMatchesReconnectSeat` also refuses generic names (`guest`/`player`), so many guests never reclaim by username even when full. |
| **Proving test** | **NO PROVING TEST** for guest reclaim when `players.length < 2`. Related auth tab takeover: `it('gives the new socket sole authority over a claimed seat and rejects the superseded old socket')`. |
| **Severity** | **P0** for guest private lobbies (false capacity / orphaned seat). Lower for authenticated users (userId migration path). |

**New finding P2 — concurrent rematch dual-start / rematch vs cleanup**

| | |
|--|--|
| **Failure mode** | Both seats can pass `bothReady` and await persist outside the gameplay lock; lock only wraps reset body — dual rematch reset possible. Separately, `gameOver` schedules cleanup; if both disconnect during rematch wait, room archives under them. |
| **Proving test** | Persist gates covered; **NO PROVING TEST** for concurrent rematch or rematch-vs-cleanup. |
| **Severity** | **P1** |

**New finding P3 — guest reconnect identity = shared username when full**

| | |
|--|--|
| **Failure mode** | When room is full and reclaim runs, `identityMatchesReconnectSeat` matches username equality for guests (both lack `userId`). Two guests with the same non-generic name can steal each other’s hold. |
| **Proving test** | **NO PROVING TEST** |
| **Severity** | **P1** (auth `userId` path is safer) |

**New finding P4 — `leaveExistingSocketRooms` fire-and-forget forfeit/leave**

| | |
|--|--|
| **Failure mode** | Join/create/spectate clears prior rooms with `void leaveTrackedRoom` (async forfeit) while attach continues — overlapping forfeit + new attach race. |
| **Proving test** | `it('leaveExistingSocketRooms clears socket.data.roomId after leaving prior rooms')` does not assert await/forfeit ordering. **NO PROVING TEST** for race. |
| **Severity** | **P1** |

Private config sanitization is covered (`privateRoomConfig.test.ts`). Lifecycle smoke: `it('room:create acks with a new room code and host seat')`.

---

### 2.7 Reconnect / resume

- Seat holds: 5 minutes (`RECONNECT_GRACE_MS`).
- Authenticated userId migration + supersede: covered.
- Live session hydration: extensive (`roomLiveHydration.test.ts`).
- Client: `LAST_ROOM` + recovery machine + uncertain resync.

Residual: guest path (P1 / P3 above); MM shell after swallowed start (M2); process restart without durable live row → lose mid-game (known process-local limit, mitigated by live sessions when healthy).

---

### 2.8 Spectator

- Feature-flagged. Multiplayer projection only for **matchmaking** rooms (`matchmakingMatchId`, not private/tournament/abandoned) on the discoverable path.
- In-room `room:spectate` joins the Socket.IO room without an engine seat; hands masked via broadcast path.
- Hand contents / boneyard order stripped on public snapshots; tests assert forbidden keys.
- `room:spectate` rejects abandoned rooms: `it('rejects spectate on abandoned rooms')`.
- Daily Fritz spectator accepts **client-published** snapshots (owner-gated) — out of PvP trust path but not server-authoritative.

**Finding S1:** Daily Fritz broadcast trust model is client-sourced — **P2** for spectator integrity (not competitive PvP).

**Finding S2 — `room:spectate` can forfeit an active match**

| | |
|--|--|
| **Failure mode** | Spectate calls `leaveExistingSocketRooms()` → `leaveTrackedRoom` without `preserveSeat` → mid-game forfeit if the socket was seated in another live room. |
| **Evidence** | `registerRoomSpectateHandlers.ts`; forfeit gate in `leaveTrackedRoom`. |
| **Proving test** | `it('acks successful spectate with roster snapshot and socket room membership')` / abandon reject only. **NO PROVING TEST** that spectate does not forfeit a prior active seat. |
| **Severity** | **P1** |

---

## 3. Severity-ranked list (this pass)

| Rank | ID | Item | Severity | Area |
|------|----|------|----------|------|
| 1 | G2 | Tournament **forfeit** latches `abandonedAt` before durable `applyMatchResult`; apply failure → false abandon + stuck bracket | **P0** | Tournament / leave |
| 2 | P1 | Guest private **reconnect seat fork** when room not full | **P0** | Private lobby / reconnect |
| 3 | A1 | `hand:ready` / `nextHand` / `startGame` **no rollback** on flush fail | **P1** | Core lifecycle |
| 4 | M3 | Unlocked concurrent **match start** / double deal | **P1** | Lobby / private + MM |
| 5 | M2 | MM **`recordMatchStart` swallow** → silent miss on hydrate/history | **P1** | Matchmaking |
| 6 | M4 | MM shell hydrate **open seating** (no player ACL) | **P1** | Matchmaking resume |
| 7 | M1 | `handleMatched` **orphan room / no requeue** on throw | **P1** | Matchmaking |
| 8 | M5 | Empty reserved MM rooms **never cleaned** | **P1** | Matchmaking |
| 9 | M6 | MM **auto-start after socket-sync timeout** | **P1** | Matchmaking |
| 10 | S2 | **`room:spectate` can forfeit** prior active seat | **P1** | Spectator / leave |
| 11 | G1 | Rematch after persist **give-up** never retries prior result | **P1** | Game-over |
| 12 | D1 | Disconnect durability **pause with no resume** | **P1** | Disconnect |
| 13 | P2 | Concurrent rematch / rematch vs cleanup | **P1** | Private rematch |
| 14 | P3 | Guest reconnect **username seat steal** when full | **P1** | Private reconnect |
| 15 | P4 | `leaveExistingSocketRooms` **fire-and-forget** forfeit race | **P1** | Room attach |
| 16 | T1 | Tournament apply give-up → **ops-only** repair | **P1** residual | Tournament |
| 17 | T2 | Multi-worker bracket race (if scaled) | **P2** | Tournament |
| 18 | M7 | MM room-code collision reuse | **P2** | Matchmaking |
| 19 | S1 | DF spectator client-trusted snapshots | **P2** | Spectator |

---

## 4. What is in good shape (do not re-open casually)

| Area | Status | Anchor tests |
|------|--------|--------------|
| Disconnect durability gate + rollback | Fixed (PR-MP-A) | disconnectGrace stall/rollback/recover/ceiling tests |
| `matchLogged` only after persist success | Fixed (PR-MP-B) | gameOverPersistence latch/retry/give-up tests |
| `game:action` mutate→flush→rollback + uncertain retry | Fixed (PR-MP-C) | registerGameplayActionHandlers + idempotency + integration |
| Tournament game-over apply retry/give-up + honest toast | Fixed (PR-MP-D) | tournament give-up / mid-retry / missing winner tests |
| Action idempotency (success only cached) | Solid | gameActionIdempotency tests |
| Queue identity / duplicate join | Solid | queueService / pendingJoins / identity tests |
| Leave forfeit vs preserveSeat | Solid | abandon / leaveTrackedRoom tests |
| Live hydration fences | Solid | roomLiveHydration tests |
| Spectator masking for MM | Solid | spectatorRegistry tests |

---

## 5. Test honesty notes

- Filenames alone are insufficient. Several suites prove the **happy path** of a feature named in the file while missing the failure mode called out above (MM hydrate, handleMatched, hand flush, guest reconnect).
- Integration test `gameActionPersistRollback.integration.test.ts` is one of the few that proves a **two-client** silent-B / retry story for actions — hand lifecycle has no equivalent.

---

## 6. Suggested action order (for when you pick work)

Not implementing now — recommendation only:

1. **G2** forfeit-before-apply (tournament trust)
2. **P1** guest reconnect seat reclaim
3. **A1** hand lifecycle rollback (complete PR-MP-C’s cousin)
4. **M3** lock match start (+ **M6** refuse start if socket sync timed out)
5. **M2/M4/M1/M5** MM durability + ACL + orphan handling + empty-room TTL
6. **S2 / P4** spectate/leave path must not forfeit without intent

---

## 7. Diff vs prior ranked list (PR-MP-A…D)

Prior ordering from [PR-MP-D tournament apply](828d6c1f-c33a-4dea-a91b-a2ab71f07c14) “honest single ordering”:

| Prior rank | Prior item | Fix PR | Still holds? | Notes this pass |
|------------|------------|--------|--------------|-----------------|
| 1 | **matchLogged-before-persist** | PR-MP-B | **Yes** | Latch only after success; give-up emits `match:result_persist_failed`; rematch gated on pending. Residual: rematch after failed does not retry (G1). |
| 2 | **disconnect auto-act bypass** | PR-MP-A | **Yes** | Same durability gate + rollback + stall UX. Residual: pause has no resume (D1). |
| 3 | **mutate-then-persist without rollback** | PR-MP-C | **Yes for `game:action`** | MOVE/DRAW/PASS covered. **Gap remains** for `hand:ready`/`nextHand`/`startGame` (A1) — not on original list as a separate item. |
| 4 | **tournament gameOver-before-applyMatchResult** | PR-MP-D | **Yes for game-over path** | Retry/give-up + tournament copy + ops doc. **Gap:** forfeit path (G2) still abandons before apply — adjacent, not fixed by D. |
| (+ give-up) | **applyMatchResult retry/give-up** | PR-MP-D | **Yes** | Four attempts; funnel `kind: tournament_apply`; ops repair doc. |

### New vs prior list (especially lobby / private)

Prior list focused on in-match commit + terminal rating/bracket. **Not explicitly ranked before:**

| ID | New item |
|----|----------|
| P1 | Guest private reconnect seat fork |
| P3 / P4 | Guest username hold steal; leaveExistingSocketRooms forfeit race |
| M1–M7 | handleMatched orphan; recordMatchStart swallow; unlocked start; hydrate ACL; empty-room leak; start-after-sync-timeout; code collision |
| A1 | Hand lifecycle mutate without rollback |
| G2 | Tournament forfeit abandon-before-apply |
| P2 | Concurrent rematch races |
| S2 | room:spectate can forfeit prior active seat |

These are the main reason this pass’s top of queue is no longer “re-do A–D.”

Lobby/private deep-dive also recorded in [Audit private+lobby gaps](9821849c-011a-4935-8d8f-e93d034627b6) (merged into this doc).

---

## 8. Sources consulted (code / tests / ops)

Primary modules: `disconnectGrace.ts`, `registerGameplayActionHandlers.ts`, `gameActionIdempotency.ts`, `gameOverPersistence.ts`, `gameOverPersistPolicy.ts`, `roomSession.ts`, `roomSocketAttach.ts`, `roomForfeit.ts`, `rooms.ts`, `matchStartReady.ts`, `matchmaking/index.ts`, `matchmaking/persistence.ts`, `matchmaking/roomShellHydration.ts`, `scheduledTournament/engine.ts`, `spectatorRegistry.ts`, `registerRoomSpectateHandlers.ts`.

Ops: `docs/ops/tournament-apply-match-result-repair.md`.

Prior audit conversation used **only** for §7 mapping: [PR-MP-D tournament apply](828d6c1f-c33a-4dea-a91b-a2ab71f07c14).

Supporting inventories: [Explore multiplayer server](6bf9b8d9-5743-42a6-824b-1817b646268a), [Explore multiplayer client](3944d6bf-7ce3-4cb5-a350-d161a1852db3).

---

*End of audit. Findings only — no code changes in this pass.*
