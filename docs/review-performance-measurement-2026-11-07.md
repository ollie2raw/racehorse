# Post-game review performance: measurement round (2026-11-07)

Scope: **measure, do not redesign.** No production behaviour changed in this round. The only production code added is **A3**: additive logging and `/health` fields (`reviewSweepStatus.decisionCost`, `.cpuThrottle`). Everything else is devtools and this report.

Every conclusion is labelled **measured** (I ran it, numbers below), **read from code** (file and line), or **guess**. **All data is bot play**: the recorded self-play corpus is two bot policies (an "ordinary" Fritz tier and a "strong" one), 5 games each, 840 non-forced decisions. Human play may differ (humans leave more hidden-hand uncertainty late, and make more non-Best moves). Timings are from a fast laptop (Apple silicon), two niced shards at a time.

**Split (fixed in `devtools/corpusSplit.ts`):** games 0 to 2 of each file are *tuning* (6 games, 518 non-forced decisions), games 3 and 4 are *held-out* (4 games, 322). Nothing was tuned (the owner's stopping-rule parameters are used as given); where both are reported, held-out is the one to read.

## Ranked conclusion: what explains the ~40x gap

The owner saw about 10 s per decision in production (9 of 76 decisions in about two minutes) against a laptop mean of 0.76 s cold (and 0.256 s warm-started). That is a factor of roughly **13 to 40 depending on which laptop figure you use** (guess: the opening decisions the owner watched are cheaper than the mean).

1. **CPU slowdown of the instance: most likely the dominant factor (guess, not yet measured on the instance).** The work per decision is measured and ordinary; nothing in the engine's own behaviour produces a 40x. The A3 benchmark (a fixed position at 100 samples, 20 runs, in the worker thread, about 30 s after boot) will give the slowdown directly: divide its median by the laptop's **20 ms** (measured: 19.7 to 20.7 ms over three runs). `cpuThrottle.nrThrottled` and `lastJob.throttle` say whether the container's CPU quota is the cause. The worker thread also runs at the lowest scheduling priority (`reviewSearchWorker.cjs:24`, `os.setPriority(0, 19)`, read from code), which only matters under contention.
2. **The exact-enumeration path is where the compute goes (measured and read from code), and it is what turns a slow CPU into failed decisions.** 520 of 840 decisions (62%) have a hidden-hand space of 8,000 or fewer and skip the tier ladder; they take **81% of all time** (mean 990 ms, p90 2.6 s, max 42.5 s on the laptop). Their ceiling is 30 minutes but the server kills any position at **180 s** (`productionCompletionConfig.ts:52`). On the laptop none exceeds 180 s; at a 40x slowdown (guess) **33 of 840 (3.9%) would**, each killed, retried from scratch and eventually failing the job after 5 attempts (`REVIEW_COMPLETION_MAX_ATTEMPTS = 5`, `productionCompletionConfig.ts:47`). That is a retry loop, but it is driven by the 180 s kill, **not** by the 2,000 ms ceiling (see A2).
3. **Tier escalation is not the main cost (measured), contradicting the external hypothesis.** Cold, 82.7% of decisions settle at tier 1, 16.7% at tier 2, 0.6% at tier 3. The reason is in the code: the production gate accepts on *stability* (the answer at half the samples equals the answer at all of them), with coverage of 2% only a secondary route (`evaluationConvergence.ts:36-70`). 313 decisions were accepted as `stability-converged` below the coverage threshold.
4. **Cold start and memory: unknown until A3 is deployed.** The worker's start-up time (`workerOnlineMs`), the first-decision delay (`claimToFirstDecisionMs`) and the worker's heap against its 256 MB cap (`memory.*`) are now reported. Nothing measured yet.
5. **Main-thread costs are negligible on the laptop (measured, A4)**: under 2 ms per step. At 0.1 vCPU they would be 10 to 40 times that (guess), still under 100 ms.

## A1. Cold run of the whole corpus (measured)

Every non-forced decision, evaluated cold exactly as the server's durable pass calls the evaluator (`adaptiveEvaluateReviewPosition(snapshot, { startTier: 1, maxTier: 4, phase: 'completion', allowProgressiveBeyondTier: true, progressiveSampleOffset: 0 })`), each in a worker thread killed at 180 s as the server does (`devtools/reviewColdCorpusRun.ts`; raw rows in `review-performance-measurement-2026-11-07.cold-run.csv`).

**A correction to the brief:** the server starts cold at **tier 1**, not tier 2. A job row is created with `tierReached: null` (`durableReviewCompletionRuntime.ts:341`) and the pass starts at `row.tierReached ?? 1` (`:584`); client-sent evaluations are dropped. (The client's own browser path uses `startTier: 2`.) I ran the server's call. In an earlier partial run the first 53 decisions took the same time at either start tier, because most take the exact path.

| | result |
|---|---|
| decisions | 840 finished, **0 killed** at 180 s |
| time per decision | **mean 759 ms**, median 76, p90 1,994, p99 9,224, max 42,516 |
| 60-decision game at the mean | **45.5 s** (the per-game first 60 decisions range from 11.7 s to 114.9 s) |
| share of total time | top 1% of decisions: **26%**; top 5%: **55%** |
| lifecycle / evidence | 840 SCORED; 821 `search`, 19 `exact` |
| `search.complete = false` | 0; wall-clock ceiling hit: 0 |

| tier reached | decisions | mean ms | median | p90 | max | mean samples | mean nodes |
|---|---|---|---|---|---|---|---|
| 1 (includes the exact path) | 695 (82.7%) | 750 | 45 | 2,080 | 42,516 | 782 | 185,169 |
| 2 | 140 (16.7%) | 725 | 409 | 1,057 | 12,519 | 2,500 | 159,582 |
| 3 | 5 (0.6%) | 2,926 | 2,330 | 8,263 | 8,263 | 12,000 | 664,780 |
| 4 | 0 | | | | | | |

| solver path | decisions | share of time | mean ms | median | p90 | max |
|---|---|---|---|---|---|---|
| exact enumeration (hidden-hand space of 8,000 or fewer) | 520 | **81%** | 990 | 82 | 2,612 | 42,516 |
| tier ladder | 320 | 19% | 384 | 73 | 773 | 12,519 |

Convergence reasons: `exact-complete` 493, `stability-converged` 313, `exhaustive-coverage` 18, `coverage-diagnostic` 16.

**Against the warm-started 256 ms:** that figure replays the recorded live result as the starting point; cold, the mean is **759 ms, 3.0x higher**, so cold start explains about 3x of the gap between "256 ms" and what production does (and my earlier hand-picked 40-decision sample gave 806 ms, consistent). It does not explain a 40x.

**Slowdown projections (guess; the factor `s` is unknown until the A3 benchmark runs):** from the measured per-decision times.

| slowdown s | 60-decision game | decisions over the 180 s kill | decisions over 2 s |
|---|---|---|---|
| 1 (laptop) | 46 s | 0 | 10% |
| 10 | 7.6 min | 2 (0.2%) | 38% |
| 20 | 15 min | 9 (1.1%) | 46% |
| 40 | 30 min | 33 (3.9%) | 56% |
| 100 | 76 min | 87 (10.4%) | 75% |

## A2. The escalation code path (read from code)

- **Tiers** (`adaptiveEvaluateReviewPosition.ts:24-67`): tier 1 = 200,000 nodes, 100 samples, 2 plies, **2,000 ms** wall-clock ceiling; tier 2 = 5,000,000 nodes, 2,500 samples, 2 plies, 120,000 ms; tier 3 = 25,000,000 nodes, 12,000 samples, 2 plies, 600,000 ms; tier 4 = 100,000,000 nodes, 50,000 samples, 3 plies, 1,800,000 ms. Each is 2,000 nodes per sample.
- **The escalation test** is `isEngineScored` (`:130-132`): the evaluation's evidence source is `exact` or `search`. `search` needs the dispatcher to accept the sampled result (stability, `evaluationConvergence.ts:57-70`: at least 32 samples, same top action, same top-2 ranking, loss and value deltas within ε = 0.065 between the halfway checkpoint and the end; or full enumeration; or coverage of 2% **and** the same top action, `:77`). A result that is not accepted falls through to the heuristic opener and the loop continues to the next tier (`:371`, `if (step.tier < maxTier) continue`).
- **The exact path** (`:239-296`, the exact budget at `:259`): if the hidden-hand space `C(n,k)` is above 0 and at most **8,000** (`EXACT_ENUMERATION_STATE_SPACE_THRESHOLD`, `:71`), the ladder is skipped: every hand is solved at **3 plies**, 100,000,000 nodes, **1,800,000 ms** ceiling. It is reported as "tier 1". This is where the time goes (A1).
- **`search.complete = false` or the wall-clock diagnostic:** `evaluateReviewPosition` sets them when the ceiling passes (`evaluateReviewPosition.ts:246-260`, default ceiling 2,000 ms at `:59`), keeping the candidates it had. Neither field is consulted by `isEngineScored`, so **a ceiling hit by itself neither retries nor escalates**: if the truncated result still has evidence `search` it is accepted as SCORED with fewer samples; if it does not, it escalates like any unconverged result. Only after *every* tier has run without an engine-scored result does the function return FAILED_RETRYABLE with reason `wall-clock-exhausted` / `node-exhausted` / `coverage-unreachable` (`:454-470`), which on the server is a retry. **So a slow CPU cannot turn the 2,000 ms ceiling into a loop.**
- **What can loop:** the per-position 180 s kill. `ReviewSearchRunner` terminates the worker at `REVIEW_COMPLETION_POSITION_TIMEOUT_MS = 180,000` (`reviewSearchRunner.ts:88,138`) and the pass records FAILED_RETRYABLE with `wall-clock-exhausted` (`durableReviewCompletionRuntime.ts:593-615`), `attemptCount + 1`, **keeping `tierReached`** (so the retry restarts the same expensive decision), after backoff, until `max_attempts_exceeded` makes the job `failed_fatal` (`:206`). A decision that needs more than 180 s at the instance's speed is therefore retried up to 5 times and then fails the whole job.
- **The node budget** (`solveMidgameDeterminization.ts:215`) is **one cumulative counter** across all samples and all legal actions (`searchGameTree(..., nodeBudget)` at `:261`). When it is exhausted mid-sample, that sample is discarded and the loop ends (`:263-270`: `sampleComplete = false` then `complete = false; break`). A position whose samples cost more than 2,000 nodes each therefore solves fewer than N samples at tier N. In the cold run **`search.complete = false` occurred 0 times** (measured), so on the laptop the node cap is not what escalates decisions.

## A3. Production instrumentation (additive, `/health` `reviewSweepStatus`)

Added, with tests (`reviewDecisionCost.test.ts`, `reviewSearchRunner.metrics.test.ts`, the health route test; 131 server tests pass):

- **Per decision** (log line `review decision evaluated`, and aggregated): tier (or `forced`), samples solved, wall ms, process CPU ms, **worker-thread CPU ms** (`process.threadCpuUsage`, Node 23.9 or later, else null), attempt number, `incomplete`, `ceilingHit`, worker heap MB.
- **`decisionCost.sinceBoot` and `.lastJob`:** tier histogram, mean and max ms, mean samples, CPU over wall ratios, incomplete count, **ceiling hits**. `lastJob` adds `throttle` (the cgroup counters sampled **before and after the job's pass**: `nrThrottledDelta`, `throttledMsDelta`) and `timeline`.
- **`cpuThrottle`:** the container's CPU quota in cores and cumulative `nr_throttled` / throttled ms, from `/sys/fs/cgroup/cpu.stat` and `cpu.max` (v2) or `/sys/fs/cgroup/cpu/cpu.stat` (v1); null off Linux.
- **`decisionCost.memory`:** process rss, worker heap used against its cap, **worker restarts** (every non-clean worker exit, including the 180 s kill) and **out-of-memory count**, and `workerOnlineMs` (spawn to the worker's first JavaScript).
- **`decisionCost.benchmark`:** one fixed hidden-hand midgame position (`server/workers/reviewBenchmark.snapshot.json`, exported from the corpus fixture `hidden-allocation-ambiguous-midgame`) at 100 samples, 200,000 nodes, 2 plies, run **20 times in the worker thread** about 30 s after boot, only when no sweep is in flight (retried every 30 s, up to 6 times); the median, min, max, **total ms** and thread CPU are reported. It runs off the event loop, so it cannot stall sockets; its total on the laptop is about 0.4 s, so at 40x about 17 s of worker time. **Laptop baseline (measured): median 20 ms** (`measureServerBenchmarkOnLaptop.ts`; the brief guessed about 10 ms).
- **Only numbers and short codes**, never raw error text. `bootAt` is reported too.

## A4. Main-thread cost of a 76-decision job (measured, laptop)

A fully scored job built from real corpus positions (52 SCORED, 24 FORCED), the production functions (`devtools/measureMainThreadCosts.ts`), median of 20 after a warm-up.

| step | ms | size | flag |
|---|---|---|---|
| POST `JSON.stringify` of the 76 snapshots (request body) | 0.59 | **243.7 KB** | **over the 200 KB line** |
| POST `sanitizeSnapshotForReview` x76 (with a JSON round trip) | 1.86 | | |
| GET `deriveReviewedMoveQuality(job)` | 0.20 | | |
| GET build response + `JSON.stringify` | 0.41 | 148.1 KB | under, but see below |
| GET `JSON.parse` of that payload (the store read) | 0.42 | | |

Nothing is near 20 ms. The one flag is the enqueue request body (243.7 KB, 3.2 KB per snapshot). **Read from code:** the poll (`reviewCompletionWorker.ts:592-645`) returns **every evaluation on every poll** (148 KB, about 1.75 KB each) and recomputes `deriveReviewedMoveQuality` each time, every 3 to 15 s while a review runs. At a 40x slowdown (guess) these are still tens of milliseconds, so they are not the bottleneck, but the poll payload does scale with the game.

## A5. What to read after one real game (once A3 is deployed)

You cannot read the instance from here; this is the exact procedure. Deploy, wait about 60 seconds, then:

1. **Benchmark (the single most important number):** open `https://racehorse.onrender.com/health`, read `reviewSweepStatus.decisionCost.benchmark.medianMs`. **Divide by 20** (the laptop median): that is the instance's slowdown factor. Also read `reviewSweepStatus.cpuThrottle`: `quotaCpus` (about 0.1 would explain a very large factor) and `nrThrottled` / `throttledMs`. If `benchmark` is still null after about 3 minutes, the sweep was busy or the flag is off; check `reviewSweep` is true.
2. **Play one Play vs Fritz game**, wait for the review to finish (or stall), then load `/health` again and read `reviewSweepStatus.decisionCost.lastJob`:
   - `timeline.enqueueToClaimMs` (waiting for a sweep tick or the instance to wake) and `timeline.claimToFirstDecisionMs` (worker start-up, module load and the first search); compare `timeline.enqueuedAt` with `decisionCost.bootAt` (a job enqueued just after boot means the instance had just woken).
   - `timeline.decisions[]`: for each decision `order`, `tier`, `wallMs`, `samplesSolved` and `endedAtMs` (ms after the claim). The **steady-state rate** is the difference between consecutive `endedAtMs`; **opening to endgame** is the trend of `wallMs` by `order`.
   - `byTier`, `meanWallMs`, `maxWallMs`, `ceilingHits`, `incomplete`, `cpuToWallRatio` and `threadCpuToWallRatio` (well under 1 means the thread was waiting for a CPU, not computing), `throttle.nrThrottledDelta` and `throttle.throttledMsDelta` (non-zero means the container was throttled during that job).
   - `memory.rssMb`, `memory.workerHeapUsedMb` against `memory.workerHeapLimitMb`, `memory.workerRestarts`, `memory.workerOomCount`, `memory.workerOnlineMs`.
3. **Render logs** (Dashboard, Logs, search `review decision evaluated` and `review cpu benchmark`): one JSON line per decision with `jobId`, `attempt`, `tier`, `samplesSolved`, `wallMs`, `cpuMs`, `threadCpuMs`, `workerHeapMb`, `incomplete`, `ceilingHit`. Useful if `/health` was restarted between the game and the read (the counters are in memory and reset on every restart or deploy).

Note: `lastJob.timeline` holds up to 200 decisions (about 18 KB), so `/health` is larger while a recent job is held; the uptime monitor should keep hitting `/ping`.

## B1. How many sampled hidden hands does a verdict need? (measured, bot play)

Hidden-hand decisions (tiles still to draw, more than one legal action): 821 (tuning 510, **held-out 311**; 83 held-out decisions are non-Best, 27%). Two passes at the 2,500-sample cap per decision (reference seed and an alternative seed); the study replays the solver's sampling loop offline and is **proved equal to `solveMidgameDeterminization`** (`reviewSamplingStudyLib.test.ts`: same samples solved, same best action, same values). Verdict = best move and the grade of the played move by the calibrated loss bands. "Prefix" compares the first N samples of the reference pass with the full reference (a cheap run that resumes later); "independent" compares N samples from a different seed with the reference (what a device result versus a server result would differ by). 95% bootstrap intervals (2,000 resamples). Non-Best = the reference grade is not Best. Near-edge = the reference loss is within 0.25 points of a band edge.

**Held-out, independent seed:**

| N | top-move all | top-move non-Best | grade all | grade non-Best | grade near-edge | kappa non-Best | MAE loss non-Best | mean ms |
|---|---|---|---|---|---|---|---|---|
| 25 | 92.0% [89.1, 94.9] | 90.4% [84.3, 96.4] | 92.3% [89.4, 95.2] | 80.7% [72.3, 88.0] | 93.4% [89.9, 96.5] | 0.62 [0.48, 0.76] | 0.304 | 2.9 |
| 50 | 94.9% [92.3, 97.1] | 96.4% [91.6, 100.0] | 93.2% [90.4, 95.8] | 84.3% [75.9, 91.6] | 93.0% [89.5, 96.1] | 0.68 [0.53, 0.82] | 0.204 | 5.8 |
| 100 | 95.2% [92.6, 97.4] | 94.0% [89.2, 98.8] | 95.2% [92.6, 97.4] | 89.2% [81.9, 95.2] | 94.6% [91.9, 97.3] | 0.78 [0.64, 0.90] | 0.154 | 11.7 |
| 200 | 96.1% [93.9, 98.1] | 95.2% [90.4, 98.8] | 95.8% [93.6, 98.1] | 90.4% [83.1, 96.4] | 95.3% [92.6, 98.1] | 0.80 [0.67, 0.92] | 0.123 | 23.4 |
| 400 | 97.7% [96.1, 99.4] | 95.2% [90.4, 98.8] | 97.4% [95.5, 99.0] | 91.6% [85.5, 97.6] | 97.3% [95.3, 99.2] | 0.83 [0.70, 0.94] | 0.092 | 46.9 |

**Held-out, prefix** (the same N as the first N of the reference pass): grade non-Best 74.7% (N=25), 85.5% (50), 90.4% (100), 90.4% (200), 96.4% (400); top-move non-Best 94.0%, 91.6%, 95.2%, 97.6%, 97.6%; kappa non-Best 0.51, 0.70, 0.79, 0.80, 0.92. The tuning games give the same picture (independent seed, non-Best: grade 77.7%, 88.5%, 90.8%, 90.8%, 90.8%; top move 87.7%, 90.0%, 92.3%, 96.2%, 97.7%).

**Reading it (measured):** agreement on the non-Best decisions climbs until about **N = 100 to 200 and then plateaus around 90 to 92%** (grade) and 95 to 97% (top move) against an *independent* reference. The plateau is the sampling noise of the 2,500-sample reference itself, not a weakness of small N, so N of about 100 is already near what two independent full runs would agree on. Most disagreement does sit near band edges (the near-edge column is as high as "all", because 258 of 311 held-out decisions are within 0.25 points of an edge: the loss bands are narrow relative to the noise). The overall figures are inflated by the 73% of decisions that are Best, as the brief warned: the non-Best columns are the ones to read.

## B2. Standard-error sequential stopping prototype (measured, offline, off by default; production untouched)

Rule: after 20 samples, check every 10; stop when the 95% interval of (best minus played), on paired per-sample differences, lies inside one grade band or has half-width under 0.25 points; the **loss + top move** variant also requires the top move resolved (the interval of top1 minus top2 excludes 0 or has half-width under 0.25); cap 400 (device) or 2,500 (server). The coverage gate is not involved (the prototype does not use the dispatcher). Judged on an independent-seed pass against the 2,500-sample reference.

**Held-out (311 decisions, 83 non-Best):**

| rule | cap | mean N | median N | p90 N | mean ms | grade all | grade non-Best | top-move all | top-move non-Best | adoption bar (grade >= 90% and top >= 95% on non-Best) |
|---|---|---|---|---|---|---|---|---|---|---|
| loss only (as briefed) | 400 | 43 | 20 | 70 | 5.1 | 94.9% | 83.1% [74.7, 91.6] | 93.2% | 85.5% [78.3, 92.8] | **below** |
| loss + top move | 400 | 63 | 20 | 190 | 7.1 | 95.2% | 88.0% [80.7, 95.2] | 95.2% | 92.8% [86.7, 97.6] | **below** |
| loss only | 2,500 | 55 | 20 | 70 | 6.5 | 95.5% | 85.5% [78.3, 92.8] | 93.2% | 85.5% [78.3, 92.8] | **below** |
| loss + top move | 2,500 | 82 | 20 | 190 | 9.1 | 95.8% | 90.4% [83.1, 96.4] | 95.5% | 94.0% [88.0, 98.8] | **below** (grade meets 90%, top 94.0% is 1 point under 95%; the intervals straddle both) |

Tuning games: loss + top move (server cap) 89.2% grade, 94.6% top move on non-Best; loss-only 84.6% and 83.8%. **Verdict: the briefed loss-only rule does not meet the bar; the stricter loss + top-move rule gets close (about 88 to 90% grade, 93 to 94% top move on non-Best) but does not clearly meet it on this corpus.** The median decision stops at the 20-sample minimum (the Best decisions with a clear margin); the cost is in the unresolved ones (p90 N 150 to 190). For comparison, **fixed N = 100 independent** gives 89.2% grade and 94.0% top move on non-Best at a mean 11.7 ms: the stopping rule is about as accurate for fewer samples on average (mean N 63 to 82), not clearly more accurate than a fixed N near 100.

## B3. Cost per game (measured on the laptop; projections are guesses)

A 60-decision game of hidden-hand decisions, mean ms per decision times 60, held-out decisions:

| | laptop |
|---|---|
| reference, 2,500 samples (2 plies) | 17.6 s |
| fixed N = 25 / 50 / 100 / 200 / 400 | 0.18 / 0.35 / **0.70** / 1.41 / 2.81 s |
| SE rule, device (cap 400), loss only / loss + top | 0.30 / 0.43 s (mean N 43 / 63) |
| SE rule, server (cap 2,500), loss only / loss + top | 0.39 / 0.54 s (mean N 55 / 82) |

Projections (**guess**): a phone at 2x to 5x the laptop: 1 to 3 s for the loss + top rule. Render: multiply by the instance's slowdown from the A3 benchmark (unknown until deployed); at the guessed 40x that is about 17 to 22 s for the same rule, against the 30 minutes (45.5 s x 40) the current path would take at that factor. These samples are the ordinary sampled path; the exact-enumeration path (62% of corpus decisions, 81% of today's time) is a different solver and is **not** reduced by sampling fewer hands: it enumerates every hidden hand. That is the main thing a sample-count change does not touch.

## Guesses (not measured)

- The instance's slowdown factor (13x to 40x or more); to be replaced by the A3 benchmark.
- That the 180 s kill is what fails real jobs at that slowdown (the projection table).
- That human games differ from bot games in the share of non-Best decisions and in exact-path cost.
- That the lowest-priority worker thread makes a CPU-starved instance slower still.
- Phone costs of 2x to 5x.

## What this round did not do (asking before starting any of these)

1. Deterministic fixed sample-count budgets with a recorded engine version and resumable sufficient statistics (n, sum, sum of squares per action per decision).
2. Win-probability loss in place of point loss.
3. The advantage graph from per-decision values.
4. Any learned leaf value.

Two findings the owner may want to weigh before those: the dominant cost in this corpus is the **exact-enumeration path**, not the sampled path the stopping-rule work targets; and the A3 benchmark will say, in one request after the next deploy, how much of the gap is simply the instance.

## Reproduce

```
npx tsx packages/review-engine/src/devtools/reviewColdCorpusRun.ts 1 cold.jsonl 0 2   # A1, shard 0 of 2 (run shard 1 too)
npx tsx packages/review-engine/src/devtools/summarizeColdRun.ts cold_s0.jsonl cold_s1.jsonl
npx tsx packages/review-engine/src/devtools/measureMainThreadCosts.ts self-play:demo-strong-policy-1:1 76   # A4
npx tsx packages/review-engine/src/devtools/measureServerBenchmarkOnLaptop.ts 20                           # laptop benchmark baseline
npx tsx packages/review-engine/src/devtools/reviewSamplingStudy.ts out.jsonl 100000 0 2                    # B1 and B2, shard 0 of 2 (and 1)
npx tsx packages/review-engine/src/devtools/reviewSamplingStudy.ts --report out_s0.jsonl out_s1.jsonl
```
