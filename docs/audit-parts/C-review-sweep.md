# Audit C: review sweep live-play yield gate (#515)

Audit date 2026-11-17, branch `audit/2026-11-17` (base `ebd5e0b9`, origin/main). Read-only: no production code changed.
Merge commit audited: `98b6c0cc perf(server): review sweep yields to live play (#515)`.

Evidence labels: **confirmed** = reproduced by a test in this branch; **read from code** = traced by reading, not executed; **guess** = plausible, not shown.

Reproductions: `server/src/reviewCompletion/reviewLivePlayYield.audit.test.ts` (written as `it.fails`: each asserts the behaviour we want and is expected to fail today, so the suite stays green. Run: `cd server && nice -n 19 npx vitest run src/reviewCompletion/reviewLivePlayYield.audit.test.ts`. Result: 1 passed, 3 expected fail. I also ran them with plain `it` to check each one fails on the assertion itself, not on a setup error: C1 `expected 0 to be greater than 0`, C2 `expected 2 to be 1`, C3 `expected 3 to be 1`.)

Constants used below (read from code): sweep tick `REVIEW_COMPLETION_SWEEP_INTERVAL_MS = 15_000`, lease 60 s, heartbeat 20 s, max attempts 5, position timeout 180 s (`packages/review-engine/src/productionCompletionConfig.ts:26-55`); gate: starvation after 10 min, slice 5 s of every 60 s, hold poll 1 s, stale observation 30 s (`server/src/reviewCompletion/reviewLivePlayYield.ts:26-41`); client poll 3-5 s (`client/src/modules/review/reviewCompletionClient.ts:131-139`); shutdown budget 25 s (`server/src/platform/gracefulShutdown.ts:14`).

---

## Findings (ranked)

### C1 — HIGH — A queued review can be starved for the whole stretch of live play: the starvation slice can be phase-locked away from the claim tick (confirmed)

**Evidence.**
- A queued (unclaimed) job is claimed only when `sweepOnce` calls `shouldDeferClaims()` and the gate says allowed (`reviewCompletionWorker.ts:376`). While play is live, that call happens only on the 15 s periodic tick (`:511-519`), on an enqueue kick (`:186-190`) or on a retry kick (`:219-223`). The client hides **Try again** while paused (`usePostGamePivotalReview.ts:492`, `postGameReviewView.ts:125`), so in practice only ticks and other players' enqueues remain.
- The slice is open for `starvingFor % 60_000 < 5_000`, where `starvingFor = now - continuousLiveSince - 600_000` (`reviewLivePlayYield.ts:158-159`). `continuousLiveSince` is set by **whichever observation first sees live play** (`:156`). Observations include the job **poll** handler (`reviewCompletionWorker.ts:652` calls `reviewYieldDecision(now)`), and the waiting player polls every 3-5 s.
- Ticks are 15 s apart, so they hit only 4 phases of each 60 s period. If the 10-minute clock was started by a poll at an offset of 5-15 s (mod 15 s) from the tick phase, no tick ever lands inside the 5 s window. Reproduction: the first live observation is a poll at t = 7 s, ticks every 15 s, polls every 5 s, 2 h of live play gives **0** claim opportunities (`reviewLivePlayYield.audit.test.ts`, "AUDIT C1"). With the clock started by a tick instead, ticks do land (the control test), and that is the only case the PR's tests cover (`reviewLivePlayYield.test.ts:134-170` observe every 1 s, the cadence of an already-held decision, not of a queued job).
- Only Node timer drift moves the phase, a few ms per tick (guess), so the lock can last hours.

**Impact.** This is the case the guard exists for: a busy evening or tournament with overlapping matches all the time. A player who finished a game sees "Paused while games are live: your review continues when they finish" indefinitely. The card never goes "stalled" because a paused poll resets the stall clock (`usePostGamePivotalReview.ts:354`), so the player gets no retry and nothing tells anyone it is stuck. The #515 body's promise "after 10 minutes ... opens 5 s out of every 60 s" holds for **running** jobs only (they poll every 1 s), not for **queued** ones. Note: one claim of up to 4 listed jobs per lucky moment (`sweepOnce(limit=4)`); after the first job runs, the next is deferred (`:388`). So even when the phase matches, each queued job needs its own slice.

**Repro.** Run the C1 test above. On production (needs access): during continuous play longer than 10 min, `/health` `reviewYield.starvationSlices` rises while `claimsDeferred` keeps rising and a queued job's poll keeps `stage: 'queued'`.

**Suggested fix (not applied).** Make the queued path independent of tick phase. Either (a) while `shouldDeferClaims` is true and claimable jobs exist, schedule a one-shot sweep at the next slice start (the gate can return `nextOpenAt`), or (b) have the 1 s hold loop also cover claiming: claim inside the sweep and hold before the first decision (a claim costs an attempt, but a hold never burns one). Or (c) only count tick and hold observations toward `continuousLiveSince` and leave polls out. That is weaker, because enqueue kicks are also off-phase.

### C2 — MEDIUM — A lease lost during a hold releases the decision into a full search on a lease nobody holds, during live play (confirmed; introduced by #515)

**Evidence.**
- `runReviewCompletionPass` checks `shouldAbort` (lease lost) only at the top of each wave, **before** calling `evaluatePosition` (`packages/review-engine/src/durableReviewCompletionRuntime.ts:539`). #515 put the hold **inside** `evaluatePosition` (`reviewCompletionWorker.ts:307-311`).
- During the hold the heartbeat can find the lease gone (`:443-450`: sets `passLeaseLost`, calls `searchRunner.abort`, which is a no-op because no search is in flight yet). `waitForReviewSlot`'s `shouldStop` then returns (`reviewLivePlayYield.ts:189`), and the wrapper goes on to call `evaluate(snapshot, options)` anyway (`reviewCompletionWorker.ts:310`).
- `ReviewSearchRunner.evaluateNow` strips `shouldAbort` before posting to the worker (`reviewSearchRunner.ts:134`), so nothing stops that search. It runs to completion or to the 180 s timeout, and its checkpoint is then refused by the fence (no corruption).
- Reproduction: `renewLease` returns false, a game starts after decision 1, and decision 2 is held. The evaluator is called **2** times (expected 1) ("AUDIT C2").

**Impact.** Up to 180 s of search CPU in the worker thread, at exactly the moment the gate decided play was live. Before #515 a lost lease killed the in-flight search and the next wave saw `shouldAbort`, so this is new. How likely it is depends on how often the lease is lost during a hold: a fenced renewal (another claimant, for example during a deploy overlap) or more than 60 s of failed renewals (guess: rare).

**Suggested fix.** In `withLivePlayYield`, after the wait: `if (passLeaseLost) throw new ReviewSearchWorkerExited('review lease lost')` (the decision becomes FAILED_RETRYABLE in memory, and the next wave's `shouldAbort` ends the pass). Or have `evaluatePosition` check `options.shouldAbort?.()` before posting.

### C3 — MEDIUM — Shutdown during a review pass keeps evaluating every remaining decision; the yield hold releases straight into it (confirmed; pre-existing, not fixed by #515)

**Evidence.**
- `runReviewCompletionPass` never checks `isProcessClosing`; its `shouldAbort` is only `leaseLost` (`reviewCompletionWorker.ts:436`, identical before #515 at `98b6c0cc^:…:410`). `sweepOnce` checks closing only **between jobs** (`:386`).
- At SIGTERM, `closeProcessAdmission` runs the stoppers: `searchRunner.abort` kills the in-flight search, the heartbeat interval is cleared, and the lag sampler stops and clears its samples. The pass then moves to the next decision. #515's hold exits at once on `isProcessClosing()` (`:309`), so each remaining decision goes straight to a fresh worker, **with the yield gate bypassed**.
- Reproduction: admission is closed during decision 1 of 3, and **3** evaluations run (expected 1) ("AUDIT C3").
- The sweep is tracked work (`processInterval` → `trackProcessWork`, `processLifecycle.ts:68-75`), so `drainProcessWork` waits for it. That drain phase gets `25 s − 5 s = 20 s` (`gracefulShutdown.ts:56-60`). Live-room persistence (`'rooms'`) then gets only the remaining ≥ 5 s, and the exit is coded "incomplete" (exit 1).

**Impact.** Deploys during play are the normal case, and live play is when held jobs exist. Shutdown time goes to review search instead of flushing live rooms, and room-persistence flush time shrinks from about 25 s to about 5 s (read from code; whether 5 s is enough is unproven). The heartbeat no longer renews during this (`processInterval` skips while closing), so the lease lapses and the next instance re-claims, burning an attempt (that happens anyway on restart).

**Suggested fix.** `shouldAbort: () => leaseLost || isProcessClosing()`. In `withLivePlayYield`, throw instead of evaluating when stopped (same fix as C2).

### C4 — LOW/MEDIUM — Long holds widen the window in which a restart burns an attempt (read from code)

A claim counts an attempt (`productionCompletionConfig.ts:41-47`). A held pass keeps its claim for as long as play lasts: minutes to hours, at about one decision per minute once in slices. Any restart (deploy, crash, OOM, Render recycle) during that window ends the pass, and the next claim is a new attempt. 5 restarts during one job's passes → `failed_fatal` → "Review unavailable / Analyze again" (the owner retry exists: `retryReviewCompletionJob`). Before #515 a pass lasted only its search time. Checkpointed decisions are kept, so only attempts are lost, not work. Fix idea: release the claim (without counting) when a hold exceeds N minutes, or don't count attempts for passes whose decisions were all held.

### C5 — LOW — Self-inflicted lag holds on a small host (guess / read from code)

The lag gate measures main-thread timer drift (`reviewLivePlayYield.ts:73-90`, max over 5 s). On a 0.1-vCPU Render instance the review worker thread shares the CPU quota with the main thread, so a decision's own search can push drift over 100 ms. The **next** decision is then held until the 5 s window clears, and each hold logs `review decision held for live play` at info (`:194`). No one is playing in this case, yet `/health` and the poll say `pausedForLivePlay: true` with copy "Paused while games are live". Bounded (about 5 s per decision; a lag-only stretch is also capped by the starvation guard), but the copy is untrue in this case and the hold counters are inflated. **Needs production `/health` samples** (`reviewYield.reason == 'event_loop_lag'` with `liveRoomsNow == 0`).

### C6 — LOW — The "paused" copy can mask the real cause (read from code)

`pausedForLivePlay` (`reviewCompletionWorker.ts:659`) is global, not per-job. It is true for a queued job that is actually stuck for another reason: `sweepError` (for example `rpc_missing`), retry backoff after a failure, or the C1 starvation. The client suppresses the stall note and the retry while it is true (`usePostGamePivotalReview.ts:354,492`), so a real setup failure reads as "paused" for as long as anyone is playing. Suggest: when `sweepError` is set, do not report paused.

### C7 — INFO — Minor observations (read from code)

- The job **poll** mutates gate state: `reviewYieldDecision` is not side-effect free (continuity, `starvationSlices`, `lastDecision`), so an authenticated user's polling cadence shapes the starvation clock (the root of C1).
- `/health` is unauthenticated and now exposes `liveRoomsNow` and the room scan (O(rooms) per request). Low information leak and low cost.
- `notePeriodicSweep(... + (yielded ? 1 : 0))` keeps a 15 s Supabase-free tick during play. No list call is made while deferred (`:376`), so no added DB cost. Confirmed by the PR's own test.

## Refuted / checked and fine

- **Attempt burn from deferral:** refuted. A deferred claim touches no row (`:376`, PR test at `reviewLivePlayYield.test.ts:227`).
- **Held job losing its lease in normal operation:** refuted. The heartbeat keeps renewing during a hold (`:442-455` is independent of the hold loop), and the hold re-checks every 1 s.
- **Job leak from a pass that never ends:** not found while the process lives. The hold always exits on an idle observation, a starvation slice, lease loss or shutdown. A pass held forever by C1 does not exist (C1 is about *unclaimed* jobs, which hold no resources).
- **Probe throwing:** fails open as documented (`reviewLivePlayYield.ts:148-152`).
- **Restored rooms with nobody connected:** not counted (`liveRoomProbe.ts:30-32`). Spectators **do** count as connected sockets (`registerRoomSpectateHandlers.ts:78` joins the room), so a spectated live match counts. That is correct.

## Unproven: needs device or production access

- How often C1's phase lock happens in production. Watch `/health reviewYield` (`continuousLiveMs > 600000`, `starvationSlices` rising, `claimsDeferred` rising, no `reviewSweepStatus.lastClaimedJob` change).
- Whether event-loop lag alone (C5) keeps the gate closed on the Render instance size in use.
- Whether a 5 s room-persistence window at shutdown (C3) is enough for the number of live rooms at a typical deploy.
- Lease-loss frequency during holds (C2) on real Supabase latency, and whether Render deploy overlap ever runs two sweeping instances.
- The starvation guard over a real match longer than 10 min (the PR's own "not measured").
