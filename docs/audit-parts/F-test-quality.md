# Audit part F: test quality, mutation checks on PRs since #507 (2026-11-17)

Method: for each guard, break the source with one targeted edit (a perl substitution), run only the guarding test file with `nice -n 19 npx vitest run <file>` from `client/` or `server/`, record pass/fail, then restore immediately with `git checkout -- <file>`. Runner: `/private/tmp/claude-501/-Users-olivermorid-racehorse-dominoes/bfe677b4-f01d-427d-b089-94184f69ef6c/scratchpad/mutate.sh`. Raw log: `.../scratchpad/mutations.log`; per-run output: `.../scratchpad/M*.out`.
Baseline before mutating: all 8 target files passed (client 4 files, 83 tests; server 4 files, 116 tests).
At the end, `git status` shows **no modified tracked files**. Only untracked audit files remain, some of them from other agents.

**Process caveat (important for the lead):** other audit agents were writing into the **same worktree** during this run (`auditHandReadyAck.test.tsx`, `auditHandBoundaryStrand.test.ts`, `reviewLivePlayYield.audit.test.ts`, `rum.audit.test.ts`, `B-`/`D-` docs appeared mid-run). Each mutation was live for the length of one targeted test run, a few seconds. M5b was the exception: about 3 minutes (see below). If another agent ran `reviewLivePlayYield*` tests around 17:58-18:02 local time, its results from that window may reflect my mutated `reviewLivePlayYield.ts` and should be re-run.

## Results

| ID | PR | Guarded behaviour | Mutation | Test file | Result |
|---|---|---|---|---|---|
| M1 | #518 | A fence rejection never falls back to the whole-row upsert | `!result.ok && status==='degraded'` → `!result.ok` (`roomLivePersistence.ts:1072`) | `roomLivePersistence.logEntries.test.ts` | **bites** (6 fail) |
| M2 | #518 | A timeout is not reported as "RPC missing" | drop the timeout/circuit early `return false` (`:958`) | same | **bites** (2 fail) |
| M3a | #519 | Scheduled-tournament rooms always await ready marks | `usesFastHandBoundary` → `return true` (`handBoundaryFast.ts`) | `handBoundaryFast.test.ts` | **bites** (2 fail) |
| M3b | #519 | A `failed` (fenced) room is never let through the new-hand gate | `assertNewHandAllowed`: skip for any status when the flag is on (`rooms.ts`) | same | **bites** (2 fail) |
| M4 | #520 | An ack from an earlier connection does not settle the hand after a reconnect | `readyAckedConnection === view.connectionKey` → `true` (`handLifecycleMachine.ts:161`) | `handLifecycleMachine.test.ts` | **bites** (2 fail) |
| M5a | #515 | The sweep claims nothing while a game is live | `if (shouldDeferClaims()) return …` → `if (false)` (`reviewCompletionWorker.ts:376`) | `reviewLivePlayYield.test.ts` | **bites** (3 fail; one by a 60 s timeout) |
| M5b | #515 | The starvation guard opens a 5 s slice every 60 s after 10 min | slice condition → `if (false)` (`reviewLivePlayYield.ts:158`) | same, `-t "opens for 5 s\|bounded too\|about 8%"` | **bites** (3 fail). See the note on hangs. |
| M6a | #525 | No RUM row is published for fewer than 5 summaries per metric | `h.reports >= minReports` → `>= 1` (`rumAggregator.ts:123`) | `rum.test.ts` | **bites** (1 fail) |
| M7 | #517 | The checkpoint window is not restarted by later moves | restart the timer on every change (`useDailyFritzSessionPersistence.ts:145`) | `useDailyFritzSessionPersistence.test.tsx` | **bites** (2 fail) |
| M8 | #517 | A failed post keeps the snapshot pending and retries | `??= snapshot` → `return` (`:118`) | same | **bites** (2 fail) |
| M11 | #517 | Hiding the tab flushes | `'hidden'` → `'visible'` (`:357`) | same | **bites** (1 fail) |
| M12 | #517 | Unmount flushes | remove `flushPendingRef.current()` from the cleanup (`:373`) | same | **bites** (1 fail) |
| M9 | #508 | No early next-hand unless the screen holds the hand as over | drop `!settled.handOver` (`useHandLifecycle.ts:806`) | `useHandLifecycle.test.tsx` | **bites** (1 fail) |
| M10 | #508 | No early next-hand when the hand ended the game | drop `settled.gameOver` (`useHandLifecycle.ts:805`) | `useHandLifecycle.test.tsx` | **DOES NOT BITE** (34/34 pass) |
| — | #523 | Docs-only diffs skip E2E and Server Validation (deny-by-default allow-list) | — | **no test exists** | **unguarded** |

13 of 14 mutations were caught.

## Findings, ranked

### F1. Medium: no test guards the CI docs-only path filter (#523)
**Evidence.** The classifier is inline shell inside `.github/workflows/ci.yml` (the `changes` job, "Determine which heavy jobs this diff needs"). `git show d462426a` touches only `ci.yml`, and no script or test in the repo exercises it. Searched `client/scripts`, `server/src`, `scripts` and `.github`: no hits outside the workflows.
**Impact.** This classifier decides whether **Server Validation and Playwright are skipped**, and a skipped job counts as passing for a required check. Suppose one edit drops the `docs/architecture/*) docs_only=false` line or the `*/*) docs_only=false` catch-all. Then a code change could merge with no server tests and no E2E, and CI would still be green. The comments promise deny-by-default; nothing enforces it.
**Repro.** Delete the `*/*) docs_only=false ;;` line and push a diff touching `server/src/x.ts` plus `docs/a.md`. Nothing local or in CI fails until a real server regression ships. Not run, since that needs a push.
**Suggested fix.** Move the `case` into `scripts/ci/classify-diff.sh`, call it from the workflow, and add a table test (bats, or a vitest that spawns the script). Cases: `docs/a.md` → skip; `docs/architecture/x.json` → run; `README.md` → skip; `client/README.md` → run; `server/src/a.ts docs/a.md` → run; empty diff → run.

### F2. Low: the "game over" early-request test passes for a different reason than its guard (#508)
**Evidence.** M10 removed `settled.gameOver` from the early-request guard (`client/src/modules/match/hooks/useHandLifecycle.ts:805`). The test "asks for nothing early when the hand ended the game" still passed. The reason (read from code): the reveal scheduler never calls `onRevealShown` when `match.gameOver` (`client/src/modules/match/hand-lifecycle/useHandRevealScheduler.ts:165-169`). So the test pins the scheduler, not this guard.
**Impact.** Today the guard is redundant defence in depth. A game-ending early request would not be catastrophic either: the server answers 409 "finalize via record-game" after persisting the receipt (`dailyFritzNextHandRoute.ts:405-453`). Two risks remain. If the scheduler ever starts firing `onRevealShown` on game-ending hands, this guard is the only thing stopping a `/next-hand` for a game-ending hand. And the advance-time path's game-over handling would then see a cached 409.
**Suggested fix.** Add a unit test that calls the early-request path directly with a `gameOver` match, or a scheduler-independent test that drives `handleRevealShown` with `matchRef.current.gameOver = true`.

### F3. Low: a broken yield or starvation guard hangs the suite instead of failing it (#515)
**Evidence.** M5a's failing test hit the **60 s** timeout ("claims nothing while a game is live … 60010ms"). M5b (starvation slice disabled), run over the whole file, made no progress for more than 3 minutes before I stopped it. The test "a held decision on a permanently lagging server is released after the starvation point (the real wait loop, simulated clock)" loops forever when the guard is broken. Re-run with a `-t` filter that skips that test, the three decision tests fail cleanly.
**Impact.** CI would show a hung or timed-out job rather than a named failing assertion, which is slower to diagnose. It does still fail, eventually, via the job timeout.
**Suggested fix.** Give the wait-loop test an explicit iteration cap or a `{ timeout: 5_000 }`, and make the sweep test's fake sleep throw after N iterations.

## What was not mutated (and why)
- `useHandLifecycle.earlyBody.test.tsx` (#508, byte-for-byte early body vs advance body). It uses the real engine and builders. A meaningful mutation (building the body one command early) is what its own fourth test already constructs and rejects. Not separately mutated.
- `handReadyDuplicateAfterRestart.test.ts` (#520 server side). The client half (M4) was checked. The server's duplicate-ignore path predates #519/#520.
- RUM ingestion 400/413 and the privacy tests (#525). Only the aggregation floor (M6a) was checked. Another agent's `rum.audit.test.ts` covers RUM.
- Server Daily Fritz checkpoint tests. #517 changed no server code.

## Unproven: needs device or production
- The #517 tests use jsdom `visibilitychange` and a stubbed `sendBeacon`. Whether a real iOS WebView delivers the beacon on an app-switcher kill is not covered by any test (see part A, item 2).
- The #519/#520 tests use an in-process restart simulation. A real Render restart (process kill in the ~75 ms debounce window) is not exercised.
