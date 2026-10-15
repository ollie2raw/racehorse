# Backend process lifecycle reliability — local review

Base: `origin/feat/app-store-candidate` at `fc864689f541032844887e978a9932a98d27fae4` (fetched and verified). Worktree: `/private/tmp/racehorse-backend-lifecycle`; branch: `audit/backend-lifecycle-reliability`. Production and corrected BRIDGE are reference-only. No push, integration, production access, deployment or migration.

**Verdict: BACKEND LIFECYCLE RELIABILITY PASS READY FOR REVIEW.** The shutdown/reservation fixes pass regression tests and the terminal-completion restart boundary (formerly R1) is closed by the durable replay owner described below, proven by a real PostgreSQL/PostgREST crash matrix and a real-process SIGKILL test.

## Process lifecycle map

All listed timers now use process-owned admission/cancellation, except request deadlines/debounce timers, which must remain live to finish admitted work. The default total shutdown budget is 25 seconds; no individual drain gets a fresh 25 seconds. This is an application deadline, not evidence of a queried production hosting setting. Hosting must allow at least that much termination grace.

| Owner / entry point | Startup / cadence / enablement | Stop and in-flight ownership | Durable boundary and restart owner | Drain limit / limitation |
|---|---|---|---|---|
| `index.ts`, HTTP server | Listen after synchronous route registration | Global middleware rejects new requests with 503; listener closes immediately; current response and DB work counted; final connections force-closed | Individual route transaction/receipt contracts | Shared 25s; HTTP response closure does not itself prove all arbitrary detached route work completed |
| Socket.IO / registrars | Per connection; existing handshake shutdown guard | Packet middleware rejects late packets; registered async handler promises counted; shutdown-generated disconnect handlers suppressed | Stable seats, room fences and command receipts | Shared deadline; no replacement-created forfeit |
| Room manager / `roomSession.ts` | Cleanup 5m, bot/animation/readiness timers on demand | Recurring/delayed gameplay and cleanup callbacks stopped; admitted async callbacks counted | `room_live_sessions`, roster, fences, action receipts; on-demand rehydration | Pending debounce flushed only after admitted mutations settle |
| Live room persistence | 75ms coalescing debounce; single-flight per room | Shutdown stops scheduling new debounce timers, keeps pending rooms, waits mutations then flushes | Snapshot and, when enabled, transactional entry stream | Remaining global budget; false writes reported as failures; timeout is incomplete, never success |
| Matchmaking queue / presence | Queue tick 2s; online count broadcast 10s | Queue service stopped; process-owned broadcast timer cancelled; detached `handleMatched` promise counted | Match row committed before `queue:matched`; stable UUID retry | Four attempts, 4.4s retry delay plus requests; can exceed shutdown deadline |
| Reservation cleanup | 60s tick; 5m unused reservation grace | At most 100 expiry attempts/run; no new expiry after closing; pending terminal PATCH counted; per-room expiry exclusion | First-terminal-writer conditional PATCH now precedes deletion; failure retains room and retry owner | Already committed response can be retried safely; restart can hydrate still-in-progress reservation on demand |
| Game-over persistence | On completed room; max 4 attempts | Entire detached retry lifetime tracked, including delay gaps | Stable match/source IDs, unique insert keys, atomic rating receipts | R1 closed: terminal snapshot carries `completionPending`; boot/periodic `terminalCompletionRecovery` replays it idempotently |
| Ranked catch-up | Boot 20s; 15m; weekly | Boot/interval cancelled; cron task stopped; admitted sweep counted; existing service single-flight retained | Pending ranked rows plus atomic claim/receipt; boot sweep re-discovers unprocessed rows | 100-row scan; shared shutdown deadline; process-local backoff resets on restart |
| Weekly decay | Sunday 00:00 UTC | Cron stopped; admitted run counted; no new decay starts while closing | Per-profile conditional/idempotent updates | Shared deadline; missed weekly invocation has no durable scheduler ledger; next scheduled run remains owner (R2) |
| Daily Fritz recovery | Boot 20s; 15m | Both timers cancelled; admitted sweep promise counted; existing single-flight retained | Durable attempt checkpoint, authority ledger and completion receipts | Scan 100; recoverable incomplete work remains discoverable after restart |
| Daily Fritz advance verification | Detached after advance-first response | Whole verification continuation counted | Durable advance/checkpoint and authority reconciliation | Shared deadline; existing reconciliation/eligibility tests preserved |
| Review completion | Explicit `REVIEW_SWEEP_ENABLED=true`; 15s, idle backoff 120s | Sweep/heartbeat/funnel timers stopped; search aborted on stop; admitted sweep/kick counted; no next job while closing | Durable job/claim generation; 60s lease, expired-claim restart recovery | Position budget 180s normally; shutdown abort plus global deadline overrides waiting |
| Fritz warmup | Nightly 00:02 Pacific; optional boot after 12s, off by default | Timers cancelled; admitted generation tracked; recursive rescheduling immediately cancelled while closing | Immutable published run/challenge; next warmup/on-demand start reuses it | Cache work may be abandoned; immutable publish is retry-safe |
| Room retention | On unless disabled; boot 10m, then daily | Timers cancelled; admitted two-delete run counted | Cutoff predicates and live-room exclusions; next run retries | 15s/request; still uncapped affected-row count (R2) |
| Deferred Ghost training | Registered synchronously under completion owner | Detached promise additionally held in process work accounting | Existing source receipts/atomic completion protect persisted game/rating effects | Deadline may abandon a training tail; no new durable training queue introduced |
| Telemetry / resource log / watchdog | Hourly usage, loop-lag sampler and heartbeat | Usage timer cleared; watchdog stop/termination promise counted | Metrics are disposable; next process starts fresh | Shared deadline; no per-room success spam added |
| Startup DB probes | Once after listen | Shared DB request tracking covers headers through body | Read-only; rerun after restart | Existing 15s body-inclusive request timeout |
| Optional self-ping | 10m when server URL configured | Timer stopped; active fetch bounded to 10s | None | Disposable |
| Tournament orchestration | OFF; unchanged | Existing orchestrator drain hook remains bounded by common budget | Existing lease model; not redesigned | No tournament enablement or architecture work |

## R0 / R1 findings

### Fixed: admission/flush race and unbounded shutdown

Previously `runGracefulShutdown` stopped only new socket connections and debounce scheduling. Existing sockets could still mutate, cron/recovery timers could still run, and `io.close()` had no deadline. A flush could finish before a subsequently admitted mutation. `process.once` also left a repeated identical signal able to invoke Node's default exit behavior during the first drain.

Fix: one synchronous process admission transition; cancel owned timers and cron; reject HTTP keepalive work and late socket packets; retain async socket callbacks, DB bodies, completions, reservation creation, Fritz verification and deferred Ghost tails in accounting. Drain admitted work before the final room flush, then close sockets/HTTP. All phases share one deadline. Persistent signal handlers share one promise. Failed/timed-out phases produce exit 1 and a structured incomplete summary.

### Fixed: reservation teardown before its durable terminal write

`reservedRoomCleanup.ts` previously deleted the room and tracking entry before launching a detached best-effort `recordMatchEnd`. A failure discarded the retry owner while leaving an in-progress durable row that could recreate the supposedly abandoned reservation.

Expiry now marks the room as expiring, awaits a conditional terminal PATCH with error propagation, then deletes it without another await. `joinRoom` rejects seating during the uncertain interval. A failed or lost response retains the reservation; next sweep safely retries the same first-terminal-writer PATCH. Concurrent sweeps skip an expiring code. Shutdown does not start fresh expiry work; an admitted write is counted through its response.

A crash before terminal commit leaves an in-progress durable reservation that is still legitimately recoverable, rather than a room already torn down as terminal. A commit followed by response loss leaves a terminal row which shell hydration excludes. No memory-only instruction is required to recreate a committed reservation. Unvisited old reservation rows can still accumulate; a durable expiry policy/boot sweep remains an operational R2, distinct from deleting before acknowledgment.

### CLOSED R1: terminal room snapshot now has a durable completion replay owner

**Root cause.** The terminal snapshot (`status=game_over`, `matchLogged=false`) is durable before `onGameOver` runs, but nothing durable recorded that completion was *owed*. After a hard crash, hydration (correctly) refuses terminal snapshots and no worker consumed them.

**Durability invariant.** If a terminal snapshot is durable and the result is not durably logged, the `room_live_sessions` row says so (`room_shell.completionPending=true`), is never deleted by cleanup/retention/finalize, and a restarted process can finish the completion from that row alone.

**Durable owner (no migration).** The existing `room_live_sessions` row. `buildLiveSessionRow` sets `completionPending` from `roomOwesTerminalCompletion` (game over or rated forfeit, non-tournament, two players, not `matchLogged`). Forfeits also persist `abandonedForfeitReason`; the abandoned snapshot is written *before* ranked rows (write-ahead). Foreground success calls `markTerminalCompletionLogged` (`matchLogged=true`, `completionPending=false`, CAS on `updated_at`).

**Recovery (`multiplayer/terminalCompletionRecovery.ts`).** Separate from hydration: hydration still returns `snapshot_terminal` and never makes the room playable. Recovery materializes a *detached* room (`createDetachedRoom`, unregistered), and replays through the same pipeline (`replayGameOverCompletion`, shared `completeRatedForfeit`) with stable `sourceMatchId = matchId`, so every write is idempotent (ranked `(player_id, source_match_id)`, matches unique, activity dedupe, ghost matchId, first-writer `recordMatchEnd`, rating receipts). The archive row is inserted with `ignore-duplicates`, then the session row is deleted conditionally on `matchLogged=true`.

| Boundary | Result |
|---|---|
| A. crash before terminal snapshot is durable | not terminal; mid-game hydration owns it (unchanged) |
| B. snapshot durable, nothing else | recovered: one completion |
| C. partial ranked (one of two rows committed) | replay completes the rest; no duplicates |
| D. ranked committed, marker unwritten | replay is a no-op through idempotency keys; row marked and archived |
| E. marker written, archive/delete pending | `already_logged` path finishes archive + delete |
| F. hard process kill during replay | next process converges (real-process `replay-crash` scenario) |

**Bounded sweep.** Single-flight; lightweight projection (`room_code,match_id,status,updated_at`); order `(updated_at, room_code)` with keyset paging (25/page, 4 pages, 25 rows/sweep); min age 30s; row isolation; failed replays bump `updated_at` (backoff + no starvation); 5 durable failures or any structural problem quarantine the row (`quarantinedAt`, retained for operators, never rescanned); rating-cutover quiescence defers without counting an attempt; live in-memory rooms are skipped unless their foreground persist is `failed`. Request budget: 0 stranded = 1 request; one stranded <= 8; 100 already-logged = 1; 100 stranded drain over 4 sweeps, oldest first. Boot delay 15s, interval 15m, `TERMINAL_COMPLETION_RECOVERY_ENABLED=false` disables.

**Cleanup interaction.** `finalizeAndDeleteLiveRoomSession` retains a `completionPending` row; the reaper uses two simple-filter DELETEs (`completionPending=is.null` and `=eq.false`). A single `or=` over the JSON path returns 400 on PostgREST 12.2.3 (found by the real-DB test). A rematch after a foreground give-up is refused (`MATCH_RESULT_RETRYING_MESSAGE`) until replay logs the result, because the terminal row is keyed by room code. Reservation cleanup never touches terminal rows.

**Mode matrix** (all covered on real PG): ranked and unranked H2H, authenticated and guest Fritz, disconnect forfeit, ordinary forfeit (half-weight parity), guest forfeit (not scanned), tournament rooms (excluded), live room skip/takeover.

**Migration:** none. The pipeline depends on migrations already pending for the candidate (`2026-10-13` incl. ghost contract, `2026-10-15`). Optional: a partial index on `room_live_sessions(updated_at, room_code) where status in ('game_over','abandoned')`; the terminal scan is a seq scan at current volumes.

No R0 found in the reviewed lifecycle paths. This is not a claim that unrelated systems were audited.

## Shutdown model and timeout ownership

1. Synchronously close process admission, stop queued maintenance/room timers and the matchmaking service, and prevent new debounce scheduling.
2. Announce server replacement. Existing socket packets receive `server_shutting_down`; new HTTP work receives 503. Shutdown's own socket disconnection does not invent a forfeit.
3. Stop the listener without awaiting websocket closure. Drain admitted foreground/background/persistence work, including orchestration; reserve up to 5s of the total budget for the final flush.
4. Flush pending room snapshots and await in-flight upserts; report false writes, not just timeouts.
5. Close sockets, force-close remaining HTTP connections, and finish within the remaining common budget.
6. Emit one structured summary: signal, admission closure, active rooms/sockets, dirty count, work present at admission/exit, completed/timed-out phases, duration and outcome. Exit 0 only for a completed drain; exit 1 for timeout/error/failed room persistence.

Database requests retain their existing 15s response-body-inclusive deadline. The shutdown deadline is a waiting bound, not a promise to cancel a database transaction. A committed atomic RPC remains committed and its receipt owns retry. Pending ranked/DF/review work is durable and can be rediscovered. Cache, probes, telemetry and immutable warmup generation can be abandoned. Dirty unconfirmed room writes cannot be declared safe to abandon; timeout explicitly reports incomplete. Completion work lost to the deadline or a crash is owned by the durable terminal replay (R1 closed), so shutdown drain is not relied on for it.

## Socket / reconnect result

Actual local process replacement restores persisted stable seats, snapshots and command replay receipts. The committed-response test rejects a late packet and replays the same original command after restart without a second state advance. Both clients converge and play four more moves. Existing client `server:shutdown` handling deliberately disables automatic recovery and displays a manual rejoin toast (`registerMultiplayerConnectionSocketHandlers.ts`); this pass does not silently turn that into automatic reconnect or redesign client UX. Manual rejoin is tested. Two-node overlap/multi-node Socket.IO is outside this single-process pass.

## Retention

Remains R2: two cutoff/exclusion-filtered DELETEs return room codes only, not checkpoint JSON, but affected rows are uncapped. Existing documented scale is thousands of small rows, not a reproduced locking/runtime failure. No speculative batching RPC, schema or index migration. A future bounded-delete RPC is appropriate if measured deletion volume warrants it.

## Failure injection and validation

Final counts are copied from local command outputs; opt-in production/dev-network tests remain disabled.

- Focused lifecycle, actual ranking/Fritz scheduler wiring, room flush/hydration, reservation failure/race, game-over/forfeit, catch-up budgets, Daily Fritz recovery and cleanup/log-entry regressions: **195/195**, **19/19 files**.
- Full server: **2,036 passed**, **40 skipped**, **1 todo**, **299 passed / 5 skipped files** across four shards. Shard pass counts: **488 / 605 / 497 / 446**. No failures. The terminal-gap fixture passes by asserting safe terminal refusal; it is evidence of missing replay ownership, not a regression test claiming that R1 fixed.
- Architecture: **22/22**, responsive-shell policy PASS.
- Server build/typecheck (including game-core/review-engine prebuild): PASS. Script typecheck: PASS.
- `git diff --check`: PASS.
- Changed production-file ESLint: **9 pre-existing no-console errors, 123 existing warnings**. With only the baseline no-console rule disabled: **0 errors, 123 warnings**. No unrelated lint cleanup or permanent rule change. Final lint recheck recorded with handoff if file set changes.
- Fake-clock/barrier cases include idle shutdown, pending dirty flush, admitted work, inter-request continuation, timer after closure, recursive warmup, repeated SIGTERM/SIGINT, failed final snapshot, hung work/orchestration/socket callback, keepalive rejection, and reservation DB-failure/held-response/concurrent-seating exclusion. Actual ranking and Daily Fritz scheduler tests verify cancellation and an admitted scan's drain, not only a generic work label.

### Real local processes

Owned PostgreSQL `127.0.0.1:55439/racehorse_runtime_upgrade`; owned PostgREST `127.0.0.1:55445`; synthetic Auth/REST loopback fixture `127.0.0.1:55447`. No production credentials or production calls. Actual server runs on local chaos ports. The existing scripts refuse known production Supabase targets; the new after-commit barrier additionally requires the exact owned loopback fixture and SIGTERM.

- Multiplayer hard restart: PASS, both clients rehydrate and continue; no sequence regression in this run.
- Multiplayer SIGTERM restart: PASS, exit 0, rejoin and continued play.
- After-commit/before-response SIGTERM with full-row persistence: PASS. Pre-signal observed sequence **15**, PostgreSQL committed **17** (HTTP 200 held), restart recovered **17**, late mutation rejected, same command replayed once, four subsequent moves, final sequence **25**, both clients agree.
- Ranked hard restart, full-row mode: PASS; two ranked rows and complete contiguous archive; zero synthetic cohort leftovers.
- Ranked hard restart, incremental entries: PASS; two ranked rows and contiguous archive; zero synthetic cohort leftovers.
- Incremental after-commit SIGTERM: PASS, exit 0, recovered committed sequence **18**, original command replayed once, final sequence **25**, clients converged. Initial fixture only held the full-row POST; it missed the incremental RPC and failed to reach the barrier. This was a harness error, not evidence of a server correctness failure. The proxy now holds `persist_room_live_session` after its committed upstream response too.

The original multiplayer chaos harness compared clients immediately after an ACK; ACK and state broadcasts are separate packets. It initially failed final agreement despite successful restoration. The harness now waits on actual matching sequence/board state before evaluating agreement. It still fails if clients do not converge; no correctness assertion was removed. The optional SIGTERM/held-response path is additive; SIGKILL remains the default.

Test logs and the owned fixture are under `/private/tmp/lifecycle-*`. Production artifacts, candidate and BRIDGE refs remain unchanged. Local synthetic JSONL test output is restored before committing.

## Outstanding certification limits

Not every enabled worker has a real-process interruption matrix at every database boundary: review/retention/warmup stop semantics have unit/regression coverage and shared admission tests, not the complete real-process matrix used for room writes. HTTP response close is not a universal ownership primitive for arbitrary unregistered detached continuations. The explicitly identified completion, verification, reservation, Ghost and DB tails are tracked; this is not an assertion that every possible future detached task is safe.

## R1 validation (terminal-completion restart)

- New real PostgreSQL 16 + PostgREST 12.2.3 integration (`terminalCompletionRecovery.postgres.integration.test.ts`): **28/28** (built from real migrations by `scripts/setupTerminalCompletionTestDb.sh`; loopback only).
- New mocked unit tests: terminalCompletion + recovery + scheduler wiring (**24**), plus updated rematch/match-log/retention/forfeit/game-over tests.
- Real process SIGKILL (`scripts/terminalCompletionHardRestart.ts`): `boundary-b` and `replay-crash` PASS; fresh process finalizes: ranked 2, receipts 2, matches 1, archive 1, live row deleted, rejoin returns `match_terminal`.
- Existing chaos: `multiplayerProcessRestartChaos` PASS; `rankedRestartChaos` PASS (full-row and `LIVE_SESSION_LOG_ENTRIES=true`).
- Full server (4 shards): **508 / 599 / 507 / 453 passed**, 0 failed (42+23+3 skipped, 1 todo; DB tests skip without the env gate).
- Architecture 22/22; server build, scripts typecheck, `git diff --check` PASS; changed-file lint: 7 pre-existing `no-console` errors (none added), 0 new.
- `gracefulShutdown.test.ts`: a pre-existing flaky exact `timeoutMs: 1_000` assertion (about 5/16 failures at baseline) now asserts `0 < timeoutMs <= 1000`.
- Known benign: `activity_feed` 409 duplicate warnings on replay (`on_conflict` not sent) and the Fritz+ghost move-log path relying on matchId-idempotent RPCs.
