# Backend process lifecycle reliability — local review

Base: `origin/feat/app-store-candidate` at `fc864689f541032844887e978a9932a98d27fae4` (fetched and verified). Worktree: `/private/tmp/racehorse-backend-lifecycle`; branch: `audit/backend-lifecycle-reliability`. Production and corrected BRIDGE are reference-only. No push, integration, production access, deployment or migration.

**Verdict: BACKEND LIFECYCLE REMEDIATION INCOMPLETE.** The shutdown/reservation fixes below pass regression tests, but the terminal-completion restart boundary remains R1. Passing mid-game restart and atomic-rating tests does not close that gap.

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
| Game-over persistence | On completed room; max 4 attempts | Entire detached retry lifetime tracked, including delay gaps | Stable match/source IDs, unique insert keys, atomic rating receipts | **R1: terminal room before completion insert has no restart completion owner** |
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

### OPEN R1: terminal room snapshot has no completion replay owner

Exact sequence:

1. The final gameplay state is persisted in `room_live_sessions`, with `status=game_over`, stable `match_id`, and `room_shell.matchLogged=false`.
2. `roomSession.ts:broadcastStateUpdate` schedules `deps.onGameOver`; `gameOverPersistence.ts` has not yet inserted its durable completion/ranked rows.
3. Hard crash, or global shutdown deadline before that insert succeeds.
4. On restart, `roomLivePersistence.ts:validateLiveRoomHydrationRow` returns `snapshot_stale/snapshot_terminal` before applying the room.
5. Ranked catch-up scans `ranked_games`; the not-yet-inserted row is absent. No enabled boot worker consumes the terminal room as a pending completion.

The added terminal-snapshot fixture persists this exact false `matchLogged` state, resets live persistence, then demonstrates terminal hydration refusal. Normal terminal join refusal must remain: blindly reopening completed rooms would introduce another correctness defect. A durable completion handoff/replay owner is required, with source identity, final roster/logs and correct application ordering. Merely lengthening shutdown or flushing a terminal snapshot does not solve it. This commit does **not** certify that interruption point or implement an unreviewed completion worker.

No R0 found in the reviewed lifecycle paths. This is not a claim that unrelated systems were audited.

## Shutdown model and timeout ownership

1. Synchronously close process admission, stop queued maintenance/room timers and the matchmaking service, and prevent new debounce scheduling.
2. Announce server replacement. Existing socket packets receive `server_shutting_down`; new HTTP work receives 503. Shutdown's own socket disconnection does not invent a forfeit.
3. Stop the listener without awaiting websocket closure. Drain admitted foreground/background/persistence work, including orchestration; reserve up to 5s of the total budget for the final flush.
4. Flush pending room snapshots and await in-flight upserts; report false writes, not just timeouts.
5. Close sockets, force-close remaining HTTP connections, and finish within the remaining common budget.
6. Emit one structured summary: signal, admission closure, active rooms/sockets, dirty count, work present at admission/exit, completed/timed-out phases, duration and outcome. Exit 0 only for a completed drain; exit 1 for timeout/error/failed room persistence.

Database requests retain their existing 15s response-body-inclusive deadline. The shutdown deadline is a waiting bound, not a promise to cancel a database transaction. A committed atomic RPC remains committed and its receipt owns retry. Pending ranked/DF/review work is durable and can be rediscovered. Cache, probes, telemetry and immutable warmup generation can be abandoned. Dirty unconfirmed room writes and completion work before durable handoff cannot be declared safe to abandon; timeout explicitly reports incomplete. The open R1 prevents a general no-loss claim.

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

The open terminal-completion R1 prevents readiness and any integration. Not every enabled worker has a real-process interruption matrix at every database boundary: review/retention/warmup stop semantics have unit/regression coverage and shared admission tests, not the complete real-process matrix used for room writes. HTTP response close is not a universal ownership primitive for arbitrary unregistered detached continuations. The explicitly identified completion, verification, reservation, Ghost and DB tails are tracked; this is not an assertion that every possible future detached task is safe.
