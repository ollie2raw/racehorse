# Bounded exact: can the "exact-enumeration" branch of the review be bounded? (experiment, 2026-11-07)

**Laptop only, bot play only, no production behaviour change.** Everything here is devtools and this document; no variant is reachable from the server or the client (every variant is "off" by construction). Every conclusion is labelled **measured**, **read from code** or **guess**. Data: the recorded self-play corpus (two bot policies, 5 games each, 840 non-forced decisions); tuning = games 0 to 2 of each file (6 games), held-out = games 3 and 4 (4 games), the split of `docs/review-performance-measurement-2026-11-07.md`. Intervals are 95% bootstrap (2,000 resamples). Timings are a fast laptop, cold, two niced shards. Companion documents: `review-performance-measurement-2026-11-07.md` (the cold run, the 180 s kill) and `review-quality-baseline-2026-11-02.md` (depth match, rollout calibration).

## Headline (measured)

1. **The branch is not an enumeration.** It draws C(n,k) seeded random hands *with replacement* and so sees only about 63% of the distinct hands (recorded coverage 66.2% on the 520 decisions), at 3 plies. Its own output disagrees with the true value over every hand on **16% to 19% of non-Best grades** (held-out 84.1% [72.7, 93.2], tuning 80.8% [72.6, 89.0] grade agreement; top move 93.2% / 87.7%). **Judged against production, no cheaper method can reach the 90% grade bar on non-Best decisions, because production does not.**
2. **Judged against the true exact value, a bounded variant is more accurate than production and about 25 to 30 times cheaper.** Held-out, non-Best decisions: production grade 78.7% [66.0, 89.4], top move 91.5% [83.0, 97.9] at a mean 554 ms; the **tuned bounded variant (random order without replacement, sequential stopping on (best minus played) and the top-move margin, racing) 95.7% [89.4, 100.0] and 97.9% [93.6, 100.0] at a mean 24 ms** (p99 474 ms, max 534 ms against production's 10,048 and 14,521). It meets the owner's bars (grade at least 90%, top move at least 95% on non-Best) against the truth, on both the tuning and the held-out games.
3. **The exact-path cost is in a narrow slice** (hidden-hand count 3,000 to 8,000: 24% of exact-path decisions, 78% of its time, 27 of the 29 exact-path decisions that would be killed at a 40x slowdown). Bounding removes the tail: exact-path p99 10,048 ms to 299 to 474 ms.
4. **Depth matters more than sampling (Q1):** true 2-ply and true 3-ply enumeration disagree on 57% to 69% agreement of the grade on non-Best decisions. 2-ply costs about 4.3x less (mean 184 ms against 794 ms). There is **no significant independent evidence that 3 plies is better**: the depth match (51.6% over 62 games, interval 39 to 64%) cannot tell, and my rollout check on the 42 decisions where the top move differs leans toward 3-ply but not significantly (+0.62 points [-0.01, 1.33]; the whole-hand view prefers 3-ply's move in 11, 2-ply's in 6, neither in 25).
5. **The locked-yard outlier is one decision (Q4):** of 19 locked-yard decisions, one takes 8.64 million nodes (21 s on the laptop); a 1,000,000-node cap (about the 180 s line at a guessed 40x) triggers on only that one and changes no top move and no grade. But today a capped result would be labelled "Exact analysis / high" regardless (`adaptExactEndgameResult` ignores `complete`).
6. **`exact-complete` feeds nothing player-visible (Q5):** no consumer outside review-engine's devtools reads the convergence reason.

## Step 0. Reconciling the two facts

**Fact 1: 2.3% exact versus 62% "exact enumeration" (read from code and measured).** They are two different solvers.

- **2.3% (19 of 840) is `solveExactEndgame`** (`solveExactEndgame.ts:133`), reached when `boneyard.drawableCount === 0` (a locked yard: `evaluateReviewPosition.ts:269-283`). It enumerates every opponent hand once, exhaustively to the hand's real end (no depth cutoff: `isCutoff: handOver || gameOver`, `solveExactEndgame.ts:171`). Evidence label `exact`.
- **62% (520 of 840) is the midgame sampler running C(n,k) samples.** The branch is `adaptiveEvaluateReviewPosition.ts:239-296`: when the hidden-hand space `C(n,k)` is above 0 and at most 8,000 (`EXACT_ENUMERATION_STATE_SPACE_THRESHOLD`, `:71`) the tier ladder is skipped and `evaluate(snapshot, exactBudget, ...)` is called with `maxHiddenStateSamples = C(n,k)` (`:259-265`). `evaluate` is the dispatcher, which for a position with tiles still to draw calls `solveMidgameDeterminization` (`evaluateReviewPosition.ts:283`). That solver draws sample *i* with `sampleHiddenAllocation(snapshot, `${seed}:${i}`)`, a fresh random shuffle per seed (`sampleHiddenAllocation.ts`), so the C draws are **independent, with replacement**. Evidence label `search` / `medium` ("Review Engine search"), not `exact`.
- **Measured:** on the 520 decisions the recorded coverage averages **66.2%** (median 63.4%; 1 - 1/e = 63.2% is what C draws with replacement give); only the 19 locked-yard decisions are `source: exact`. The convergence-reason string `exact-complete` is attached by the adaptive function at `:282` and `:300` to every decision that takes this branch (493 of the 520, plus the 19 locked-yard ones), whatever the solver did.
- **Why 62% now versus 2.3% before:** the earlier figure counted `evidence.source === 'exact'` (locked yard only). The branch at `:239` is keyed on the *size of the hidden-hand space*, which is small whenever the opponent holds few tiles, a large share of real decisions.

**Fact 2: depth and the 30-minute ceiling (read from code).** The branch is **depth-limited, not exhaustive**: `exactBudget.maxPlyDepth: 3` (`adaptiveEvaluateReviewPosition.ts:262`), and the solver cuts the search at `depth >= maxPlyDepth` (`solveMidgameDeterminization.ts:221`), valuing the leaf as the current score difference. The 30-minute ceiling is `exactBudget.maxWallClockMs: 1_800_000` (`:264`), a leftover from when the review ran in-process with resumable passes. The server's worker is killed externally at 180 s (`REVIEW_COMPLETION_POSITION_TIMEOUT_MS`, `productionCompletionConfig.ts:52`), so the in-process ceiling can never fire first.

## Step 1. Cost anatomy of the exact path (measured)

520 decisions (cold run; the 19 locked-yard ones are inside this set by `C(n,k)`): 515 s, **81% of all cold time**; mean 990 ms, median 82, p90 2,612, p99 10,829, max 42,516; the top 5% hold 51% of the exact-path time. Per sampled hand the work is mean 988 nodes (median 69, p90 375, max 411,511); 4.5 microseconds per node (median).

| hidden hands C(n,k) | n | mean ms | median | p90 | p99 | max | share of exact time | over 4.5 s |
|---|---|---|---|---|---|---|---|---|
| 1 to 20 | 128 | 8 | 5 | 17 | 57 | 71 | 0% | 0 |
| 21 to 164 | 129 | 343 | 25 | 181 | 1,809 | 33,905 | 9% | 1 |
| 165 to 999 | 111 | 418 | 171 | 1,033 | 2,491 | 3,234 | 9% | 0 |
| 1,000 to 2,999 | 28 | 834 | 541 | 2,141 | 4,592 | 4,592 | 5% | 1 |
| **3,000 to 4,999** | 117 | **2,707** | 1,844 | 6,094 | 11,774 | 16,057 | **62%** | **23** |
| **5,000 to 8,000** | 7 | **11,836** | 7,240 | 42,516 | 42,516 | 42,516 | **16%** | **4** |

By tiles in hand: 4 to 6 tiles hold 63% of the time (18 of the 29 over the line); by legal actions: 4 to 5 hold 48%; by drawable tiles: 10 or more hold 62% (20 over the line) and 4 to 6 hold 26% (8 over). **The 3.9% of decisions that would exceed 180 s at a guessed 40x slowdown (33 decisions above 4.5 s on the laptop; 29 of them on this path, 4 on the tier ladder) come from the C = 3,000 to 8,000 buckets (27 of the 29)**, mostly C = 3,060 (opponent holds 4 of 18 hidden tiles, 12 tiles still to draw: 20 decisions) and C = 5,005 or 6,435 with 4 to 6 drawable tiles. One over-the-line decision is the locked-yard outlier of Q4 (C = 21, 8.6 million nodes). Script: `exactPathAnatomy.ts`.

## Step 2. The bounded variants (built; devtools only)

`packages/review-engine/src/devtools/boundedExactSolver.ts` (not imported by production code), tests in `boundedExactSolver.test.ts` (11 pass):

- **A. Randomized order, without replacement, paired statistics.** Every distinct opponent hand once, in a seeded random permutation (`handOrder`, tested to be a permutation: each hand exactly once); per candidate and per pair of candidates, running n, sum and sum of squares of the paired difference; every interval carries the finite-population correction (N - n) / (N - 1) (so it is exactly zero when every hand has been visited).
- **B. Sequential stopping.** After 20 hands, check every 10; stop when the interval of (best minus played) lies inside one grade band or has half-width under 0.25 points (z = 1.96), optionally also requiring the top move resolved (the interval of top1 minus top2 excludes 0 or has half-width under 0.25), or at a cap (hands or time). A finished enumeration is exact over the hands.
- **C. Candidate racing.** A candidate whose paired interval against the current best has its upper end below zero at z = 2.58 stops being searched; the best and the played move are never dropped.
- **D. Anytime output.** A hand cap or a time budget ends with the best-so-far verdict, its interval and `partial: true`, never "no result".
- The same engine runs live (the real game-tree search per hand, 3 plies) and on a recording of every hand's values; a test proves a complete live run equals the same run replayed from its recording. Differences from production, by design: production's draws are replaced by the distinct hands; the boneyard order inside a hand is one seeded shuffle per hand (as the sampler does), so the result is exact over opponent hands and sampled over boneyard orders.

## Step 3. Validation (measured; tuning 6 games, held-out 4 games)

501 exact-path decisions with tiles still to draw (tuning 308, held-out 193; the 19 locked-yard decisions are Q4). Non-Best = the reference grade is not Best (held-out 44 against production, 47 against the truth).

**3a. The reference's own error** (production against the true value over every distinct hand):

| | all: top / grade | non-Best: top / grade | kappa non-Best | MAE non-Best |
|---|---|---|---|---|
| held-out | 96.9% [94.3, 99.0] / 94.3% [90.7, 97.4] | 93.2% [84.1, 100.0] / **84.1% [72.7, 93.2]** | 0.72 [0.51, 0.89] | 0.299 |
| tuning | 94.8% [92.2, 97.1] / 94.2% [91.6, 96.8] | 87.7% [79.5, 94.5] / **80.8% [72.6, 89.0]** | 0.62 [0.45, 0.77] | 0.282 |

**3b. Against production as the reference (as the brief asked).** Tuning sweep (6 tuning games, loss + top move with racing, z in {1.64, 1.96, 2.58} x half-width in {0.15, 0.25, 0.35}): **no setting meets the bar** (grade on non-Best 74.0% to 78.1%, top 75.3% to 82.2%), which is what 3a predicts. Held-out, selected rows (full table in the appendix of the run; every row has the same columns):

| variant | exact-path ms mean / p99 / max | non-Best top-move | non-Best grade | kappa non-Best |
|---|---|---|---|---|
| production today | 554 / 10,048 / 14,521 | | | |
| B loss-only, server cap | 12 / 136 / 177 | 84.1% [72.7, 93.2] | 75.0% [61.4, 88.6] | 0.59 |
| B loss + top move, server cap | 19 / 299 / 556 | 90.9% [81.8, 97.7] | 75.0% [61.4, 88.6] | 0.59 |
| B + C loss + top, racing | 16 / 220 / 351 | 90.9% [81.8, 97.7] | 75.0% [61.4, 88.6] | 0.59 |
| D cap 160 hands, no stop | 46 / 342 / 492 | 88.6% [79.5, 97.7] | 75.0% [61.4, 88.6] | 0.58 |
| D cap 640 hands, no stop | 149 / 1,375 / 2,078 | 93.2% [84.1, 100.0] | 81.8% [70.5, 93.2] | 0.69 |
| **tuned: B + C, z = 2.58, half-width 0.15** | 24 / 474 / 534 | 90.9% [81.8, 97.7] | 79.5% [68.2, 90.9] | 0.65 |

Against production the best of these reaches 79.5% grade and 90.9% top move on held-out non-Best: **below the 90% / 95% bar, but at the ceiling the truth itself reaches against production (3a: 84.1% / 93.2%)**.

**3c. Against the TRUE exact value** (the honest reference; non-Best by the true grade):

| held-out | exact-path ms mean / p99 / max | 60-decision game, exact-path decisions only | non-Best top-move | non-Best grade | kappa | MAE |
|---|---|---|---|---|---|---|
| production today (C draws, 3 plies) | 554 / 10,048 / 14,521 | 33.2 s | 91.5% [83.0, 97.9] | 78.7% [66.0, 89.4] | 0.65 | 0.302 |
| B loss-only, server cap | 12 / 136 / 177 | 0.7 s | 89.4% [80.9, 97.9] | 85.1% [74.5, 95.7] | 0.76 | 0.246 |
| B loss + top move, server cap | 19 / 299 / 556 | 1.2 s | **97.9% [93.6, 100.0]** | 85.1% [74.5, 95.7] | 0.76 | 0.207 |
| B + C loss + top, racing | 16 / 220 / 351 | 0.9 s | 97.9% [93.6, 100.0] | 85.1% [74.5, 95.7] | 0.76 | 0.207 |
| D time 50 ms, no stop | 29 / 52 / 54 | 1.7 s | 95.7% [89.4, 100.0] | **95.7% [89.4, 100.0]** | 0.93 | 0.085 |
| **tuned: B + C, z = 2.58, half-width 0.15** | 24 / 474 / 534 | 1.4 s | **97.9% [93.6, 100.0]** | **95.7% [89.4, 100.0]** | 0.93 | 0.154 |

| tuning | exact-path ms mean / p99 / max | 60-decision game, exact-path only | non-Best top-move | non-Best grade |
|---|---|---|---|---|
| production today | 970 / 8,053 / 36,732 | 58.2 s | 90.1% [83.1, 97.2] | 83.1% [74.6, 91.5] |
| B loss + top move, server cap | 35 / 570 / 992 | 2.1 s | 93.0% [85.9, 98.6] | 87.3% [78.9, 94.4] |
| D cap 160 hands, no stop | 77 / 567 / 1,108 | 4.6 s | 95.8% [90.1, 100.0] | 91.5% [84.5, 97.2] |
| D time 50 ms, no stop | 32 / 53 / 60 | 1.9 s | 90.1% [81.7, 95.8] | 93.0% [85.9, 98.6] |
| **tuned** | 43 / 804 / 1,286 | 2.6 s | 94.4% [88.7, 98.6] | **91.5% [84.5, 97.2]** |

**Adoption bars against the truth (grade at least ~90% and top move at least ~95% on non-Best):** the tuned variant meets them on held-out (95.7% / 97.9%) and on tuning for grade (91.5%) with top move 94.4% (about 95%); the plain stopping rule (B loss + top) meets the top-move bar but not the grade bar (85.1% / 87.3%); a **fixed cap of 160 hands** gets 89.4% / 95.7% held-out and 91.5% / 95.8% tuning (46 to 77 ms mean), and **320 hands** 89.4% / 97.9% and 94.4% / 94.4% (82 to 145 ms). The stopping rule alone is below the bar on grade because it stops early on Best-looking decisions: tightening it (z = 2.58, half-width 0.15) is what the tuning picks. (The held-out intervals are wide: 44 to 47 non-Best decisions.)

**Time reduction, before and after (measured):**

| | exact-path mean | exact-path p99 | exact-path max | 60-decision game, all 840-decision mix | all-decision p99 / max | decisions over 4.5 s |
|---|---|---|---|---|---|---|
| held-out, production | 554 ms | 10,048 | 14,521 | 33.4 s | 8,263 / 33,905 | 9 |
| held-out, B loss + top move | 19 ms | 299 | 556 | 14.2 s | 1,516 / 33,905 | 2 |
| held-out, tuned | 24 ms | 474 | 534 | 14.4 s | 1,516 / 33,905 | 2 |
| tuning, production | 970 ms | 8,053 | 36,732 | 44.6 s | 8,053 / 36,732 | 21 |
| tuning, B loss + top move | 35 ms | 570 | 992 | 11.2 s | 3,353 / 12,519 | 3 |
| tuning, tuned | 43 ms | 804 | 1,286 | 11.5 s | 3,353 / 12,519 | 3 |

The whole-mix game cost falls from 33 to 45 s to 11 to 14 s: the rest is the 339 decisions off this path (the tier ladder and the locked-yard outlier, whose 33.9 s is the all-decision max after bounding). For the exact-path decisions alone, 60 decisions fall from 33 to 58 s to 1.2 to 2.6 s. A game where the exact-path cost is the cost would therefore move from about 40 s to about 2 s on the laptop.

## Step 4. What a capped version costs on a device (laptop ms; phone = laptop x 2 to 5, a guess)

Exact-path decisions only (60 of them), held-out; the agreement columns are against the true value.

| variant | laptop s | phone x2 / x5 s (guess) | non-Best grade | non-Best top |
|---|---|---|---|---|
| D cap 20 hands | 0.4 | 0.8 / 2.0 | 68.1% | 87.2% |
| D cap 40 hands | 0.8 | 1.6 / 4.0 | 76.6% | 85.1% |
| D cap 80 hands | 1.5 | 3.0 / 7.5 | 83.0% | 91.5% |
| D cap 160 hands | 2.7 | 5.4 / 13.5 | 89.4% | 95.7% |
| D time 25 ms per decision | 1.0 | 2.0 / 5.0 | 85.1% | 93.6% |
| D time 50 ms per decision | 1.7 | 3.4 / 8.5 | 95.7% | 95.7% |
| B + C + D loss + top, 50 ms cap | 0.7 | 1.4 / 3.5 | 80.9% | 93.6% |
| B loss + top, server cap | 1.2 | 2.4 / 6.0 | 85.1% | 97.9% |
| tuned B + C | 1.4 | 2.8 / 7.0 | 95.7% | 97.9% |

Whole-game figures (all 840-decision mix, held-out) are 13.8 to 18.9 s on the laptop for every variant because the 339 off-path decisions are unchanged (see Step 3). **A 3 s phone budget for these decisions is met by the plain stopping rule and the tuned rule at about 2.4 to 2.8 s if the phone is 2x the laptop, and not at 5x (6 to 7 s); the time-capped variants at 25 ms per decision fit (2 to 5 s) with grade 85.1% and top move 93.6%.** (Guess: the multiplier. Measured: everything on the laptop.)

---

# The owner's five extra questions

## Q1. Depth: 3-ply (production) against 2-ply TRUE enumeration

501 exact-path decisions with both recordings (each distinct hand once, random order). Production = C seeded draws, 3 plies.

| held-out | n all / non-Best | top all | grade all | top non-Best | grade non-Best | kappa non-Best | MAE non-Best |
|---|---|---|---|---|---|---|---|
| 2-ply true enum. vs production 3-ply | 193 / 44 | 91.2% [87.0, 94.8] | 85.5% [80.3, 90.2] | 88.6% [79.5, 97.7] | **59.1% [45.5, 72.7]** | 0.28 [0.07, 0.50] | 0.916 |
| 3-ply true enum. vs production 3-ply (production's own error) | 193 / 44 | 96.9% [94.3, 99.0] | 94.3% [90.7, 97.4] | 93.2% [84.1, 100.0] | 84.1% [72.7, 93.2] | 0.72 [0.51, 0.89] | 0.299 |
| 2-ply true enum. vs 3-ply true enum. (the depth effect alone) | 193 / 47 | 92.7% [88.6, 96.4] | 86.0% [80.8, 90.7] | 87.2% [76.6, 95.7] | **57.4% [44.7, 72.3]** | 0.33 [0.12, 0.52] | 0.729 |

| tuning | n all / non-Best | top all | grade all | top non-Best | grade non-Best | kappa non-Best | MAE non-Best |
|---|---|---|---|---|---|---|---|
| 2-ply true enum. vs production 3-ply | 308 / 73 | 89.3% [85.7, 92.5] | 89.0% [85.4, 92.5] | 76.7% [67.1, 86.3] | 64.4% [53.4, 75.3] | 0.39 | 0.569 |
| 3-ply true enum. vs production 3-ply | 308 / 73 | 94.8% [92.2, 97.1] | 94.2% [91.6, 96.8] | 87.7% [79.5, 94.5] | 80.8% [72.6, 89.0] | 0.62 | 0.282 |
| 2-ply true enum. vs 3-ply true enum. | 308 / 71 | 90.9% [87.7, 93.8] | 90.9% [87.7, 93.8] | 78.9% [69.0, 88.7] | 69.0% [57.7, 78.9] | 0.43 | 0.518 |

**Cost per decision (ms, all 501, measured):**

| | mean | median | p90 | p99 | max |
|---|---|---|---|---|---|
| production 3-ply (C draws, with replacement) | 810 | 70 | 2,349 | 8,053 | 36,732 |
| 3-ply true enumeration | 794 | 67 | 2,358 | 7,870 | 34,970 |
| **2-ply true enumeration** | **184** | 24 | 585 | 1,600 | 5,327 |

True enumeration costs the same as production's draws (visiting every distinct hand once is about the cost of C draws with replacement); **2 plies is about 4.3x cheaper** (p99 5x, max 6.6x).

**The paired disagreement (2-ply against 3-ply, both true enumeration), by the 3-ply loss of the played move:**

| 3-ply loss of the played move | n | top move changes | grade changes | mean abs(loss(3) - loss(2)) |
|---|---|---|---|---|
| Best (up to 0.13) | 383 | 21 (5%) | 13 (3%) | 0.017 |
| inaccuracy (0.13 to 0.79) | 41 | 11 (27%) | **23 (56%)** | 0.295 |
| mistake (0.79 to 5.98) | 70 | 9 (13%) | 17 (24%) | 0.648 |
| blunder (above 5.98) | 7 | 1 (14%) | 2 (29%) | 1.930 |

Grade changes: 40 of 426 decisions within 0.25 points of a band edge (9%), 15 of 75 elsewhere (20%). The depth effect is concentrated in decisions whose played move is a small-to-medium mistake (one in two inaccuracies, one in four mistakes change grade) and is not a near-the-edge artefact: **the depth changes the answer on a third of the decisions that matter**.

**Is there evidence that 3 plies is better? Judged against something independent of both:**

- `reviewDepthMatch` (`review-quality-baseline-2026-11-02.md`, section 3): the 3-ply player won **51.6% of 62 games (interval 39 to 64%, sign test p = 0.90)**, mean margin +0.7 points: **no evidence either way**; an edge of up to about 13 points of win rate for the deeper search is not ruled out, a large one is.
- Rollout calibration (section 5 there) validates the review's *grade* against whole-hand rollouts (correlation 0.53, 73% of Mistake grades confirmed) but was run at 2 plies only and does not compare depths.
- **New, measured, on these decisions:** on the 73 decisions where 2-ply and 3-ply differ in the top move (42) or the grade (55), I played every candidate to the end of the hand against 200 sampled opponent hands (`depthRolloutCheck.ts`, the Fritz "standard" policy as the existing calibration does). Of the 42 top-move disagreements, the whole-hand view prefers **3-ply's move in 11, 2-ply's in 6, neither within 2 standard errors in 25**; the mean rollout advantage of the 3-ply move is **+0.62 points [-0.01, 1.33]**, and it has the higher rollout mean in 57.1% [42.9, 71.4] of them. For the loss figure, the mean absolute gap to the whole-hand loss is 1.15 points (3-ply) against 1.09 (2-ply): **no difference** (2-ply error minus 3-ply error -0.06 [-0.49, 0.38]).
- **Reading (guess where marked):** **there is no significant evidence that 3 plies is better**; the one hint is the top-move check, borderline (the interval just reaches zero) and with a noisy yardstick (single-decision rollout standard error about 0.6 points here). It does not distinguish the depths enough to justify 4.3x the compute; it does say they are *different*, so choosing between them is a product decision about which one the review should be consistent with. Note also (read from code) that production already mixes depths: the tier ladder is 2 plies (tiers 1 to 3, `SEARCH_ESCALATION_TIERS`) while this exact-path branch is 3.

## Q2. Cost of true 2-ply enumeration where C <= 300 (measured)

| bucket | n | mean ms | median | p90 | p99 | max |
|---|---|---|---|---|---|---|
| **C <= 300, 2-ply true enumeration** | 247 | **7** | 2 | 18 | 71 | 151 |
| C 1 to 20 | 112 | 1 | 0 | 2 | 5 | 16 |
| C 21 to 100 | 69 | 11 | 3 | 22 | 151 | 151 |
| C 101 to 300 | 66 | 15 | 10 | 31 | 88 | 88 |
| (production 3-ply, same decisions) | 247 | 25 | 4 | 63 | 354 | 696 |

C <= 300 is 247 of the 501 decisions; their total 2-ply enumeration time is **1.8 s** against 6.2 s for production's 3-ply on the same decisions. True enumeration is cheap here (at most 151 ms for any decision): the cost problem is not in this slice.

## Q3. C > 300: fixed N = 100, 200, 400 hands (random order, no replacement, prefix-resumable) against the pooled reference

254 decisions with C > 300 (tuning 167, held-out 87). **Pooled reference** = the two 2,500-sample passes of the Phase B study combined (seeds `B-ref` and `B-alt`, 2 plies, with replacement: 5,000 samples). The N hands are the first N of the 2-ply true enumeration in its seeded random order, so a result at N = 100 can be resumed to 200 or 400 with no repeated work. Note that this compares 2-ply with 2-ply: it measures the sampling error of N hands, not the depth question of Q1.

| held-out (87 decisions, 27 non-Best by the pooled reference) | top all | grade all | top non-Best | grade non-Best | kappa non-Best | MAE non-Best |
|---|---|---|---|---|---|---|
| N = 100 | 97.7% [94.3, 100.0] | 97.7% [94.3, 100.0] | 96.3% [88.9, 100.0] | **92.6% [81.5, 100.0]** | 0.83 | 0.124 |
| N = 200 | 97.7% [94.3, 100.0] | 98.9% [96.6, 100.0] | 100.0% [100.0, 100.0] | 96.3% [88.9, 100.0] | 0.91 | 0.086 |
| N = 400 | 100.0% [100.0, 100.0] | 98.9% [96.6, 100.0] | 100.0% [100.0, 100.0] | 96.3% [88.9, 100.0] | 0.92 | 0.052 |
| (complete 2-ply enumeration vs the pooled reference) | 100.0% | 98.9% | 100.0% | 96.3% | 0.92 | 0.019 |

| tuning (167 decisions, 41 non-Best) | top all | grade all | top non-Best | grade non-Best | kappa non-Best | MAE non-Best |
|---|---|---|---|---|---|---|
| N = 100 | 96.4% [92.8, 98.8] | 97.0% [94.6, 99.4] | 87.8% [75.6, 97.6] | 87.8% [78.0, 97.6] | 0.77 | 0.158 |
| N = 200 | 96.4% [93.4, 98.8] | 97.0% [94.0, 99.4] | 90.2% [80.5, 97.6] | 87.8% [78.0, 97.6] | 0.77 | 0.084 |
| N = 400 | 97.0% [94.0, 99.4] | 99.4% [98.2, 100.0] | 95.1% [87.8, 100.0] | **97.6% [92.7, 100.0]** | 0.95 | 0.064 |
| (complete 2-ply enumeration vs the pooled reference) | 98.8% | 97.6% | 97.6% | 90.2% | 0.81 | 0.032 |

Against the complete 2-ply enumeration instead: N = 100 gives held-out non-Best 100% top move and 96.2% grade, tuning 94.7% and 97.4%. **Cost per decision at fixed N (ms, C > 300):**

| | mean | median | p90 | p99 | max |
|---|---|---|---|---|---|
| N = 100 | 16 | 12 | 35 | 69 | 106 |
| N = 200 | 33 | 23 | 70 | 142 | 210 |
| N = 400 | 65 | 45 | 140 | 281 | 423 |
| complete 2-ply enumeration | 356 | 179 | 866 | 1,757 | 5,327 |
| (production 3-ply, same decisions) | 1,573 | 569 | 4,159 | 14,437 | 36,732 |

**Reading (measured):** at 2 plies, N = 100 already reaches 88% to 93% grade agreement on non-Best and N = 400 reaches 96% to 98% (the 90% / 95% bars), at 16 and 65 ms mean (24x and 97x cheaper than production's 1,573 ms on these decisions). 8 of the 254 decisions have C <= 400, so N = 400 is exact for them.

## Q4. The true-endgame outliers (drawable = 0): a node cap with an anytime answer

**Read from code:** `solveExactEndgame` enumerates every allocation in lexicographic order under one cumulative node budget; when the budget is hit mid-allocation that allocation is discarded and the loop stops (`solveExactEndgame.ts:194-225`), so a capped result is an average over a **lexicographic prefix** (a biased slice), `complete: false`, `coverage < 1`. Production's budget on this path is 100,000,000 nodes (the exact-path budget, `adaptiveEvaluateReviewPosition.ts:260`), so it never caps in practice. **`adaptExactEndgameResult` (`evaluateReviewPosition.ts:91-118`) labels the result `exact` / `high` / "Exact analysis" whatever `complete` says**, so a capped result would be presented as exact.

**Measured (`endgameNodeCapStudy.ts`):** 19 locked-yard decisions with more than one legal action (all bot play): median 855 nodes, p90 458,882, **max 8,641,730 (C = 21, 10 legal actions, 5 tiles in hand, 21.2 s)**; the second-largest is 458,882 nodes (0.95 s); 17 of 19 are under 50,000 nodes. Our full pass picks the same top move as `solveExactEndgame` on 19 of 19. Capped replays against the full enumeration (counts out of 19; at 4.5 microseconds per node, a cap in seconds at a guessed 40x slowdown is nodes x 4.5e-6 x 40):

| node cap | about this long at 40x (guess) | decisions cut short | lexicographic prefix (today's behaviour at a cap): same top / same grade | random-order anytime, `partial = true`: same top / same grade |
|---|---|---|---|---|
| 50,000 | 9 s | 2 of 19 | 18 / 19 | 18 / 19 |
| 100,000 | 18 s | 2 of 19 | 18 / 19 | 18 / 19 |
| 250,000 | 45 s | 2 of 19 | 19 / 19 | 18 / 19 |
| 500,000 | 90 s | 1 of 19 | 19 / 19 | 18 / 19 |
| **1,000,000** | **180 s** | **1 of 19** | **19 / 19** | **19 / 19** |
| 2,000,000 | 360 s | 1 of 19 | 19 / 19 | 19 / 19 |

(Same grade is 19 / 19 at every cap for both orderings.) **Proposal (not built into production): a node cap of about 1,000,000 nodes**, the point at which a machine 40x slower would reach the worker's 180 s kill, with the random-order enumeration and an anytime `partial = true` answer, plus the label rule that a `partial` result must not say "Exact analysis" (it should fall to the "search" label, or say so). On this corpus it triggers on **1 of 19 locked-yard decisions (5%), which is 1 of 840 decisions (0.1%)**, and changes **neither the top move nor the grade of any of the 19**. Lower caps (50,000 to 250,000) trigger on 2 of 19 and change the top move in 1 of 19 with only 19 decisions the evidence is thin (a count, not a rate; no intervals are meaningful at this size). The lexicographic prefix does as well as the random order at the higher caps here, but it is biased by construction (the first tiles in canonical order) and nothing in this corpus is large enough to show the bias.

## Q5. Does the convergence reason "exact-complete" feed any label, confidence, second opinion or explanation? (read from code)

**No. It has no consumer outside review-engine's devtools. Relabelling it would not change any player-visible output.**

- **Where it is produced:** `adaptiveEvaluateReviewPosition.ts:89` (the field `convergenceReason?: string` on `AdaptiveEvaluateResult`), `:282` and `:300` (`'exact-complete'`, the exact branch: both locked-yard decisions and the C <= 8,000 midgame decisions), `:234` and `:349` (`'forced'`), `:368` (the stability/tier reason), `:427` (progressive), `:476` (the terminal fall-through, via `decideSearchConvergence`). The type union `ConvergenceAcceptReason` (`evaluationConvergence.ts:18-23`, exported at `index.ts:47`) *lists* `exact-complete` but **`decideSearchConvergence` never returns it** (`:52, :67, :83, :94, :101` return the other four): only the adaptive function writes the string.
- **Who reads `convergenceReason`** (whole-repo grep, client, server and packages): `packages/review-engine/src/devtools/coverageSoakLib.ts:391-393` (a histogram), `runCoverageSoakShardWorker.ts:89-90`, `runCoverageSoakShards.mjs:153-154`, `productionEquivalentSoak.test.ts:88-89`, `generatedLegalGameCoverage.test.ts:101-102`, `__tests__/forcedFastPath.test.ts:30` (asserts `'forced'`), and my `devtools/reviewColdWorker.ts:36`. `validateMidgameConvergenceGate.ts:532-587` and `docs/review-convergence-gate-validation.md` use the words "exact-complete validation positions" for a validation set, not the field. **Nothing under `client/src`, `server/src` or any non-devtools package source reads it.** The sibling diagnostic string `eval-convergence:<reason>` (written at `evaluateReviewPosition.ts:301`) is read only at `adaptiveEvaluateReviewPosition.ts:353` and `:412`, to fill that same field.
- **What actually drives labels, confidence, second opinion and explanations is `evaluation.evidence.source` / `.confidence`, which is set by the adapters, not by the reason:** `exact` / `high` / "Exact analysis" in `adaptExactEndgameResult` (`evaluateReviewPosition.ts:101`, locked yard only) and `search` / `medium` / "Review Engine search" in `adaptMidgameDeterminizationResult` (`:126-135`, every midgame decision including the C <= 8,000 branch). Consumers (non-test, with file:line):
  - **Second-opinion eligibility:** `secondOpinion.ts:51` (`source !== 'search'` returns null) and `:53` (`drawableCount <= 0` returns null); attached in the completion phase only (`adaptiveEvaluateReviewPosition.ts:118-130`, `withSecondOpinion`).
  - **Scored / completion logic:** `adaptiveEvaluateReviewPosition.ts:131` (`isEngineScored`), `completeReviewEvaluations.ts:45, 56, 138, 186`, `finalizeReviewEvaluations.ts:26, 63`, `durableReviewCompletionRuntime.ts:368, 774`, `client/src/modules/review/gameReviewReplayArtifact.ts:78`.
  - **Labels and badges:** `client/src/analyzer/GameReviewer.tsx:380` (`displayLabel` and `confidence` in the header), `useMoveSearchTier.ts:32` (the "Search" row badge: `source !== 'search'` returns null), `useMoveHeuristicClassification.ts:34`, `reviewPresentationRecord.ts:50`.
  - **Explanations ("close call" and "not clear-cut" wording):** `reviewCoachingFacts.ts:231, 379, 415` (`isPreciseTier = exact || search`), `reviewCoachingProse.ts:424, 576-587` (the heuristic-only branch) and the value-gap headline "not clear-cut" at `reviewCoachingProse.ts:275`; the label softening itself is the second opinion's.
  - **Accuracy and accounting:** `client/src/analyzer/gameAccuracyModel.ts:75`, `packages/review-engine/src/gameAccuracyModel.ts:101`, `reviewAccuracy.ts:52`, `client/src/modules/review/applyCalibratedHandAccuracies.ts:30`, `reviewDecisionAccounting.ts:78`, `logReviewWorkerBatchDiagnostics.ts:26-27`.
  - I found no presentation-consistency assertion that reads the reason.
- **What WOULD change output (and why this matters for the bounded variants):** changing `evidence.source` of the C <= 8,000 decisions from `search` to `exact` would disable their second opinion (`secondOpinion.ts:51`), replace the "Review Engine search" label and the "Search" badge with "Exact analysis / high", and mark them as exact when coverage is about 63%. Conversely a **bounded result with `partial = true` should keep `search`/`medium` or say partial**, and the locked-yard `partial` case needs the label fix noted in Q4. Relabelling only the *reason* string (for example to `sampled-with-replacement`) changes nothing a player sees; it would change the soak tools' histograms.

---

## Guesses (not measured)

- The phone multiplier of 2 to 5 (Step 4) and the 40x slowdown used to convert nodes and milliseconds into the 180 s line (Q4, Step 1).
- That a 3 s phone budget is a plausible target for this path.
- That the bounded variant's advantage over production against the truth would hold on human games (all data here is two bot policies; humans make more non-Best moves and leave different hidden-hand shapes).
- That the borderline rollout lean toward 3-ply (Q1) would survive a longer rollout run: the yardstick is a noisy policy-dependent rollout.

## What this experiment did not do

No production code was touched and nothing is wired in (no flag was needed: the variants live in devtools). The two decisions this leaves for the owner: (1) which depth the review should use and be consistent with (Q1: no significant evidence either way; 2 plies is 4.3x cheaper), and (2) whether to adopt a bounded exact path and, if so, with which parameters (Step 3c: the tuned rule meets the bars against the truth at about 24 to 43 ms per decision). **Stopped here: nothing in production will be touched without a go-ahead.**

## Reproduce

```
npx tsx packages/review-engine/src/devtools/exactPathAnatomy.ts 40
npx tsx packages/review-engine/src/devtools/recordExactPass.ts out3.jsonl <shard> 2           # 3-ply, with production's reference; run both shards
npx tsx packages/review-engine/src/devtools/recordExactPass.ts out2.jsonl <shard> 2 100000 2  # 2-ply true enumeration
npx tsx packages/review-engine/src/devtools/boundedExactStudy.ts out3_s0.jsonl out3_s1.jsonl   # Steps 2 to 4
npx tsx packages/review-engine/src/devtools/boundedExactQuestions.ts out3_s0.jsonl out3_s1.jsonl -- out2_s0.jsonl out2_s1.jsonl   # Q1 to Q3
npx tsx packages/review-engine/src/devtools/depthRolloutCheck.ts out3_s0.jsonl out3_s1.jsonl -- out2_s0.jsonl out2_s1.jsonl 200   # Q1 rollout check
npx tsx packages/review-engine/src/devtools/endgameNodeCapStudy.ts                              # Q4
```
