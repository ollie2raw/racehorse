# Audit B: Multiplayer hand boundary and S1 fallback (#518, #519, #520)

Audit date: 2026-11-17 to 11-19. Branch `audit/2026-11-17`, based on `origin/main` at `ebd5e0b9`.
Scope: #519 `MP_HAND_BOUNDARY_FAST` (5d705ce9), #520 client resends `hand:ready` after a reconnect (60eedc63), and #518 S1 entries-write fallback (96e8b00d).
Method: a pre-mortem over restart, disconnect, duplicate and ordering interleavings. Each claim carries one of these labels:

- **confirmed (test)**: a tests-only reproduction in this branch passes.
- **read from code**: based on reading the code, with file:line references.
- **guess**: not verified.

No production code was changed.

New tests-only files. Both pass; they pin the current behaviour.

- `server/src/multiplayer/auditHandBoundaryStrand.test.ts`: 6 cases. 5 runs gave 6/6 after a race in the setup was fixed (see B2).
- `client/src/match/session/handReveal/auditHandReadyAck.test.tsx`: 2 cases.

Existing suites re-run and green: `handBoundaryFast.test.ts`, `handReadyDuplicateAfterRestart.test.ts`, `roomLivePersistence.logEntries.test.ts` (75 passed, 1 skipped).

---

## HIGH

### B1. The client treats a failed `hand:ready` ack as acknowledged. A failed hand start then leaves the room hand-over until someone reconnects

**Evidence**

- `client/src/match/session/handReveal/useHandRevealSequence.ts:191-195`: `emitHandReady(...).then(() => dispatch({type:'readySettled', ok:true, ...}))`. The response is never read.
- `emitWithAck` resolves with whatever the server acks (`client/src/multiplayer/roomTransport.ts:171-193`). It rejects only on the 8 s timeout. So `{ok:false, uncertain:true, error:"Hand update couldn't be saved — try again."}` and `{ok:false, error:'new_hand_blocked'}` both count as "acked".
- `handLifecycleMachine.ts` `recoveryStep` then treats the hand as handled on this connection (`readyAckedFor/readyAckedConnection`). Nothing else in the client sends `hand:ready`: grep shows a single call site.
- Server side: after an uncertain new hand, `nextHand` rolls back to the snapshot it took after both marks (`server/src/rooms.ts:930, 957-963`). The room is then hand-over with both seats in `nextHandReady`, and `nextHandStartsByRoom` is cleared (`rooms.ts:1091-1097`). For human seats, nothing on the server starts the hand again. The only automatic `readyForNextHand` callers are the bot auto-ready (`roomSession.ts:1006-1020`) and the tournament turn clock.
- So the room waits for a reconnect: only a new `connectionKey` makes the client resend (#520).
- **confirmed (test)**:
  - Server: `auditHandBoundaryStrand.test.ts` "AUDIT B1", with entries off and on.
  - Client: `auditHandReadyAck.test.tsx`. There is exactly one send, no toast, across 50 s of state echoes. A second send happens only after the connection id changes.

**How #519 makes this reachable on the happy path of a transient DB error**

- With the flag on, the first player's mark is only a debounced write (`rooms.ts:327-333`).
- If that write is in flight when the second player readies, `nextHand` → `commitLifecycleAfterMutate` → `flushScheduledLiveRoomPersistence` → `persistLiveRoomSessionNow` returns the existing in-flight promise (`roomLivePersistence.ts:1182-1183`).
- If that mark write fails, the loop returns `false` (`:1198-1206`). The new-hand snapshot was taken out of `pendingPersistByRoomCode` (`:1356-1357`) and is never written.
- `nextHand` then rolls back and reports uncertain.
- The PR's own reasoning, "a degraded room may start the hand because the start is itself the write that heals it" (`rooms.ts:335-344`), does not hold when the start joins the failing write.
- The existing test "the new-hand write fails ... then a retry starts it" (`handBoundaryFast.test.ts:425-442`) passes only because the test sends the retry by hand. The real client never sends it.

**Repro**

1. Flag on. The first player readies.
2. Within one database latency after the 75 ms debounce, the second player readies.
3. The first player's mark write gets a 503 or a timeout.
4. The second player's ack is uncertain. Both clients sit on the hand-over view.

The same strand happens with the flag **off** whenever the second player's mark or the new-hand write fails (pre-existing).

**Impact**: a private match freezes between hands. Leaving and rejoining, or a network blip, fixes it. Nothing on screen tells the player this.

**Suggested fix (client)**: in `sendReady`, read the response. Treat `ok:false && (uncertain || code/error not in {stale_or_duplicate_hand_ready})` as `readySettled ok:false`. That path already retries at once and shows `warnReadyFailed`. A backoff is needed so a persistent `new_hand_blocked` does not loop. Optionally, the server could also schedule one re-advance after an uncertain rollback when every seat is still ready.

### B2. A lifecycle write that commits but whose response is lost puts the room in `failed`. It is then stranded for the rest of the process (entries off; production default)

**Evidence**

1. A ready-mark (flag off) or new-hand write lands, then `supabaseFetch` times out (`supabaseUtils.ts:209-210`, 15 s default) → `degraded`.
2. `commitLifecycleAfterMutate` rolls memory back (`rooms.ts:315-320`). `rollbackRoomLifecycleCommit` calls `notifyLiveRoomStateCommitted` (`rooms.ts:299`), which schedules a debounced persist of the rolled-back room.
3. That snapshot has a **lower** `(game_state_sequence, last_event_sequence)` than the row that landed.
4. The monotonic fence refuses it with `room_live_session_stale_write` (`supabase/migrations/2026-10-16_room_live_session_generation_fence.sql:184-187`). `fencedLiveSessionWrite` maps that to `failed` (`roomLivePersistence.ts:943-949`).
5. In `failed`, `new_hand`, `gameplay_action` and `reconnect_existing_player` are all refused (`roomDurabilityPolicy.ts:116-159`). The fast path never lets `failed` through (`rooms.ts:342`).
6. The fence's own comment, rule R3, expects a response-loss retry to "re-apply at the same sequence". The rollback's own write gets there first, 75 ms later, and has a lower tuple.

**confirmed (test)**: `auditHandBoundaryStrand.test.ts` "AUDIT B2". The fake DB emulates the fence and a commit followed by a timeout.

- Flag off, entries off: the lost response is the second player's mark. Result: `failed`, `stale_write`, retry → `new_hand_blocked`.
- Flag on, entries off: the lost response is the new-hand write. Same result.
- Entries **on**: #518's same-persist full-row fallback rewrites the same snapshot at the same tuple (accepted by R3), and the hand starts. #518 accidentally fixes this, but only when the RPC is the attempt whose response is lost. If the fallback full-row write is the one whose response is lost, B2 applies again (read from code).

**Note**: in one early run of the flag-on case, the lost response hit the first player's in-flight mark write instead. That room healed, because the rollback snapshot was newer than what had landed. The test now waits for the mark to land first so the case is deterministic.

**Leaked or different deal?** The database holds hand N+1 (deal A), which was never broadcast. Broadcast happens only after `isLiveRoomDurablyRecoverable` (`registerGameplayActionHandlers.ts:336-337`). So nothing leaks to players. Suppose the room is later rehydrated from the database (after a restart, or eviction after everyone disconnects; see Unproven U2). Players then get deal A. Nobody has seen it, so this is acceptable.

**Impact**: under a slow or overloaded Supabase (exactly when 15 s timeouts happen), a match can freeze for good with "Gameplay is paused" or "reconnect unavailable" until the server restarts.

**Suggested fix**: on `RoomLifecyclePersistUncertainError`, do not persist the rolled-back snapshot. Reasoning: when uncertain, the database is either equal to or ahead of memory. Options:

- (a) Cancel the scheduled persist after rollback and mark the room "needs rehydrate". Reload the row on the next command.
- (b) When a `stale_write` follows an uncertain commit, treat it as "the database is ahead" and rehydrate from the row instead of failing.
- (c) Keep the post-mutation state and retry the same snapshot (the R3 equal-tuple path), as #518 already does for entries mode.

---

## MEDIUM

### B3. With the flag off, a room left `degraded` at hand over cannot start the next hand and never heals (pre-existing; #519 fixes it only for private rooms with the flag on)

**Evidence (read from code)**

- Move writes do not roll back (MP-JIT-1), so the hand-ending move's failed persist leaves `durability.status='degraded'` (`roomLivePersistence.ts:1198-1206`).
- Nothing retries a degraded room: no timer, and a grep for `'degraded'` shows only policy checks.
- At hand over there are no more moves. `hand:ready` fails `assertNewHandAllowed` before any mutation, so it writes nothing that could heal the room (`registerGameplayActionHandlers.ts:320`, `roomDurabilityPolicy.ts:100-106`).
- The client treats `new_hand_blocked` as acked (B1). Even after a reconnect the resend fails the same way. The room is stuck for as long as it stays in memory.

**Applies to**: scheduled-tournament rooms always (they never take the fast path, `handBoundaryFast.ts:28-33`), and private rooms while the flag is off (production today).

**Suggested fix**: retry the persist for a degraded room on a backoff timer. Alternatively, let `hand:ready` in a degraded room trigger a flush-and-recheck before refusing.

**guess**: severity depends on how often a hand-ending write fails. Production numbers are needed.

### B4. #518 fallback doubles the worst-case write time held under the room gameplay lock

**Evidence (read from code)**: `persistLiveSessionForRoom` waits for the RPC (up to 15 s), then the full-row write (up to 15 s) (`roomLivePersistence.ts:1059-1083`). Lifecycle commits await this under `withRoomGameplayLock` (`rooms.ts:985, 1071`).

When the database hangs:

- The client's 8 s ack timeout rejects (`roomTransport.ts:12, 159-170`), which dispatches `readySettled ok:false`.
- The client resends at once with a new request id. That queues behind the lock.
- Every 8 s a new hand:ready queues, while each lock holder takes up to 30 s. The queue grows, and the player sees a toast every 8 s.

Before #518 the hold was 15 s, which also exceeded 8 s, so this existed already; #518 worsens it.

**Suggested fix**: give the fallback a shorter timeout, or skip the fallback when the RPC failed by timeout (the database is slow, not broken). Add client backoff on resend.

---

## LOW

### B5. `hand:ready` receipt row written before the mark is durable (flag on)
- `withGameActionIdempotency` persists the `room_command_receipts` row immediately unless `deferReceiptPersistUntilDurable` is passed (`gameActionIdempotency.ts:311-337`). The `hand:ready` handler does not pass it (`registerGameplayActionHandlers.ts:368-373`). The comment at `gameActionIdempotency.ts:262-264` says hand:ready is "already durable", which is no longer true with the flag on.
- After a hard kill, the restarted process hydrates the receipt (`roomLivePersistence.ts:1609-1620`) without the mark.
- Latent only. The client creates a fresh request id on every send (`roomTransport.ts:258-262`), so a resend re-executes. If any caller ever retries with the same id, that player's mark is permanently swallowed for the 5 min TTL. **read from code**; the same-id replay itself is shown in `handReadyDuplicateAfterRestart.test.ts:355-362`.
- Fix: pass `deferReceiptPersistUntilDurable` for the fast path, or fix the comment.

### B6. SIGTERM during the fast window
`schedulePersistLiveRoomSession` does not arm a timer while shutting down (`roomLivePersistence.ts:1319`). A fast mark acked after `flushAllPendingLiveSessions` has taken its snapshot of pending rooms may never be written. #520's resend covers this. **read from code; guess** that the window is reachable in practice.

### B7. RUM `mp.hand_ready_ack` records failed acks as successes
`useHandRevealSequence.ts:193`. This skews the latency metric that #519 is judged by.

### B8. `hand:ready` with no `handNumber` applies to whatever hand is current
`rooms.ts:995` checks the hand only when it is a number. A late send with an undefined hand number can ready the player for a newer hand. The client computes `reveal?.handNumber ?? hand?.handNumber`, which is normally defined. **read from code**.

### B9. `liveSessionsTableAvailable=false` is sticky process-wide
Once a write sees "room_live_sessions ... does not exist", every later persist in the process returns `failed` with no re-probe. Nothing resets the flag except the test reset (`roomLivePersistence.ts:806-812, 839-846, 1045`). Pre-existing; relevant to half-applied or renamed migrations. **read from code**.

---

## Refuted / checked and OK

- **Double start** (#519): refuted. The mark phase and the advance both run under the room lock. `nextHandStartsByRoom` coalesces, and the advance re-checks `handOver && size === players` (`rooms.ts:1004-1007, 1071-1081`). The existing test "rapid actions" gives one `hand_started`.
- **Next deal leaked before it is durable**: refuted. The broadcast follows `nextHand` → `commitLifecycleAfterMutate` (`rooms.ts:957, 1082-1083`). Uncertain paths roll back and do not broadcast (`registerGameplayActionHandlers.ts:352-363`).
- **Re-dealing different tiles to players who saw a deal**: refuted for broadcast deals, because a deal is broadcast only once durable, and a restart rehydrates that deal. An unbroadcast deal may be replaced (B2 note); nobody saw it.
- **Resend after restart for a stale hand** (#520): ignored by the `handNumber` mismatch (`rooms.ts:995-997`). The test `handReadyDuplicateAfterRestart.test.ts:272`.
- **Duplicate `hand:ready`**: `alreadyReady` → ignored (`rooms.ts:1009-1019`). The "everyone ready, nothing in flight" case re-schedules, as intended.
- **Out-of-turn play around the boundary**: no path found. The fast path changes only the mark commit and the degraded new-hand gate. Gameplay was already allowed while degraded.
- **#518 fence bypass**: refuted.
  - Every fence (`stale_writer`, `stale_write`, `stale_generation`, `retired_match`, `terminal_regression`, `owes_completion`) is raised by BEFORE INSERT/UPDATE triggers (`generation_fence.sql:86-125, 155-209`). They fire for both the RPC and the PostgREST upsert, so a full-row fallback is refused by the same trigger.
  - All six names are in `FENCED_LIVE_SESSION_WRITE` (`roomLivePersistence.ts:943-944`). Even a fence error the regex missed would be re-refused on the full row and classified `failed` there.
- **#518 lost or duplicate log entries**: refuted (read from code).
  - The fallback forgets confirmed lengths (`:1081`), so the return to entries mode resends from index 0, with idempotent upserts (`generation_fence.sql:266-269`).
  - Hydration follows the row's own `logStorage` marker and reads only `idx < count` (`roomLivePersistence.ts:1098-1175`).
  - A late commit of a timed-out RPC either lands at an equal tuple (consistent row plus entries in one transaction) or is refused by the fence and rolled back whole.
- **#518 half-applied migration**:
  - RPC missing: 10 min of full rows, then a retry.
  - Entries table missing: the RPC errors, then the fallback writes the full row with a 60 s cooldown, so the room keeps playing.
  - Old 2-arg RPC with restore: PGRST202, then the full row (no restore intent; the generation guard may refuse a retired match, which is fail-closed).
  - No permanent degradation found from these, apart from B9.

## Unproven: needs device or production access

- **U1**: how often Supabase writes from Render commit but time out client-side (B2), and how often a hand-ending move write fails (B3). This needs production `private_durability_degraded` / `private_durability_failed` funnel counts and the `stale_write` log rate.
- **U2**: whether a `failed` room is ever evicted and rehydrated without a restart.
  - Room cleanup archives via `finalizeAndDeleteLiveRoomSession`. Its terminal write would carry the lower tuple, be refused, and return early (`roomLivePersistence.ts:1291-1292`).
  - Whether the in-memory room is then dropped so a rejoin rehydrates the database row (deal A) was not traced end to end.
- **U3**: #520 on real iOS Safari or WebKit backgrounding. It assumes a reconnect gives a new `socket.id` and that `socket.connected` flips in a React render cycle, because the hook deps are `socket?.id` and `socket?.connected` (`useHandRevealSequence.ts:276-277`). If a resume reuses the transport without a React re-render, the resend may not fire until the next state echo.
- **U4**: whether PostgREST cancels the transaction when the client aborts (this decides whether B2's commit-after-timeout happens at all on Supabase's pooler), and whether error bodies from a missing relation inside the RPC ever contain the text `persist_room_live_session`. If they do, `isMissingPersistFunction` misclassifies them as RPC missing (10 min instead of 60 s; harmless).
- **U5**: real latency under the fast path with the gameplay lock contended by the review sweep (#515). This was not measured: perf work is out of scope here.
