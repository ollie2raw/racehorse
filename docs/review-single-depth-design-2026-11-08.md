# Single-depth review pipeline: reconciliation, design, and what the real game showed (2026-11-08)

**Laptop only, bot play only, no production change.** Devtools code and this document; nothing here is imported by the server or the client. Every conclusion is labelled **measured** (laptop, the recorded corpus: two bot policies, 10 games, 1,212 decisions of which 372 forced, 501 exact-path, 320 ladder, 19 locked yard), **measured in production** (numbers read by the owner from `/health` after one real game on release `d2897828`, supplied with the brief), **read from code** (file:line) or **guess**. Intervals are 95% bootstrap (2,000 resamples). Raw outputs: `docs/review-single-depth-design-2026-11-08.data.txt`. Nothing is built; the end of this document lists what I would ask before building.

## Contents

0. [What production told us, and how well the laptop reproduces it](#0-what-production-told-us-and-how-well-the-laptop-reproduces-it)
1. [Item 1: #501 against #502, and why the numbers differ](#1-item-1-501-against-502-and-why-the-numbers-differ)
2. [Item 2: how reproducible today's verdicts are](#2-item-2-how-reproducible-todays-verdicts-are)
3. [Item 3: the single-depth pipeline (design, not built)](#3-item-3-the-single-depth-pipeline-design-not-built)
4. [Additions (a), (b), (c): Render, the sampled path, and ceiling hits](#4-additions-a-b-c-render-the-sampled-path-and-ceiling-hits)
5. [Item 4: win-probability loss and the advantage graph (proposal)](#5-item-4-win-probability-loss-and-the-advantage-graph-proposal)
6. [Limits, guesses, and what I would ask before building](#6-limits-guesses-and-what-i-would-ask-before-building)
7. [Reproduce](#7-reproduce)

## Headlines

1. **(Item 1, measured)** On the 501 exact-path decisions the shipping bounded path **runs to full enumeration on 24.4%, stops early on the sequential rule on 75.6%, and never hits a cap (0%)**; of 19 locked yards 18 finish and 1 hits the 1,000,000-node cap. Against the full enumeration of the same decision it agrees on **97.5% [94.2, 100.0] of non-Best top moves and 95.0% [90.9, 98.3] of non-Best grades** (all decisions: 98.6% / 97.8%). #501's 95.7% / 97.9% and #502's 83.2% / 79.0% are not in conflict: they use different references (same recording vs another seed), different non-Best sets (by the reference vs "either run non-Best"), and one of them is a lower draw; section 1 reproduces both.
2. **(Item 2, measured)** Today's production verdicts are **reproducible on 93.8% of grades and 96.2% of top moves over all exact-path decisions, but on only 82.9% [75.2, 88.9] of the grades and 92.3% of the top moves of non-Best decisions**: about 1 non-Best badge in 6 would change if the same decision were reviewed again with another seed.
3. **(Item 3, measured + design)** A single-depth (3-ply) pipeline built on fixed work units is **the most reproducible and the closest to the expectation of everything measured**: at N = 400 units on the exact path it agrees with a 2,000-unit reference on 92.9% [89.5, 95.8] of non-Best grades (production today 84.5% [79.8, 89.1], the shipping bounded path 89.1%, a full enumeration 90.3%) and with itself on 88.6% (production 82.9%). **Whole game, one seat, laptop: 2.9 s at N = 100, 10.9 s at N = 400**, against 26.0 s today and 6.3 s with the bounded flag. On the free Render instance (x45) one seat would cost 130 s at N = 100: **the server cannot be the first-pass engine; the device must, and the server verifies.** Verification of 3 random decisions at the N = 100 checkpoint costs about 4 s per game on Render.
4. **(Addition b/c, measured + read from code)** The real game's cost was the sampled ladder; on the laptop it is 77 to 80% of the time once the bounded flag is on. The ceiling hits are real and **invisible to the player**: a verdict cut at 45 samples ships as `Review Engine search · medium confidence` with a badge, exactly like an uncut one (read from code; emulated, all 22 ceiling-hit decisions ship that way), and for 32 to 49 samples the convergence check is vacuous (read from code, seen in the emulation). The verdicts themselves are not much worse (87.0% of non-Best grades at 45 samples against 90.2% at 100), so the defect is the labelling, not the accuracy.
5. **(Item 4, proposal)** Win-probability loss and an advantage graph can be built from the per-decision values that exist (`expectedPointDifferential`, with `winProbability` already a null field in the contract); what is missing is a calibration of score and state to win probability. Section 5.

## 0. What production told us, and how well the laptop reproduces it

**Measured in production** (supplied with the brief; one real Play vs Fritz game on release `d2897828`, before #502 and before the bounded flag, i.e. the old path):

| fact | value |
|---|---|
| fixed benchmark (100 samples, 20 runs, inside the worker) | median 894.4 ms (min 695.3, max 3,111.5) against 20 ms on the laptop: **about 45x slower** |
| CPU | quota 0.15 CPU; 237,187 periods, 6,472 throttled, 792,588 ms throttled |
| the job | 64 decisions (37 tier 1, 9 tier 2, 18 forced), **mean 7,681 ms per decision, max 123,527 ms**, 4 ceiling hits, 4 incomplete |
| tier 2 (C > 8,000, 2,500 samples) | about 46 s each, nine of them: about 7 of the job's roughly 8 minutes |
| tier 1 with 45 samples solved | 2.4 to 5.7 s each |
| memory | fine (rss 125 MB, worker heap 18 of 304 MB, 0 restarts, 0 OOM) |

**How I emulate it on the laptop (measured method).** `wholeGameRun.ts` runs every decision of every game through `adaptiveEvaluateReviewPosition` exactly as the server calls it (completion phase, second opinion on). With `slow = 45` it divides **every wall-clock ceiling of the pipeline** by 45 (tier ceilings 2 s, 120 s, 600 s, 1,800 s; the progressive chunk; the exact branch's and the bounded path's 1,800 s), so the same positions hit the ceilings a 45x slower machine would hit; node and sample budgets, and every verdict that does not depend on a clock, are untouched. Multiplying the laptop milliseconds by 45 then gives the Render time.

**Does it look like the real game? (measured, one real game against 20 emulated seats.)** One review covers one seat. Per seat the corpus has 60.6 decisions (real: 64). Composition per seat: forced 18.6 (real 18), tier 2 about 7 (real 9), exact branch plus tier 1 about 34 (real 37). The real job is equivalent to **about 10.9 s of laptop time**, which is at about the 25th percentile of the 20 emulated seats (2.5 s to 60.1 s, median 18.7 s, flag off, ceilings /45). Ceiling hits: real 4; emulated mean 1.1 per seat, 10 of 20 seats have at least one (so 4 is on the high side of one sample, not outside it). **Guess:** this particular human game had cheaper exact-path positions than the average bot-vs-bot game (the emulated flag-off seat costs a mean of 17.9 s per decision on Render against the real 7.7 s, driven by the exact path at 79% of its time). The tier-2 and forced counts match, and the ranking of the costs (tier-2 sampled ladder dominates a cheap-exact-path game; exact path dominates an expensive one) is the same.

## 1. Item 1: #501 against #502, and why the numbers differ

Data: the 501 exact-path midgame decisions (tuning 308, held-out 193) each run twice with different seeds by the shipping code (`boundedPathRepeatability.ts`); the 19 locked yards run once. Bot play, laptop.

### 1.1 How the shipping bounded path ends a decision (measured)

| set | decisions | (a) ran to full enumeration | (b) stopped early by the sequential rule | (c) hit a cap | mean share of the distinct hands visited |
|---|---|---|---|---|---|
| all | 501 | **122 (24.4%)** | **379 (75.6%)** | **0 (0.0%)** | 40% |
| held-out | 193 | 57 (29.5%) | 136 (70.5%) | 0 (0.0%) | 46% |
| tuning | 308 | 65 (21.1%) | 243 (78.9%) | 0 (0.0%) | 37% |

| distinct hands C(n,k) | decisions | complete | resolved | share of hands visited |
|---|---|---|---|---|
| 1 to 20 | 112 | 112 | 0 | 100% |
| 21 to 164 | 126 | 10 | 116 | 47% |
| 165 to 999 | 111 | 0 | 111 | 18% |
| 1,000 to 2,999 | 28 | 0 | 28 | 12% |
| 3,000 to 4,999 | 117 | 0 | 117 | 6% |
| 5,000 to 8,000 | 7 | 0 | 7 | 4% |

**Locked yards (19):** 18 finish, 1 hits the 1,000,000-node cap (the 8.6-million-node outlier of #501 Q4). In the whole-game run with the flag on: complete 140 (122 midgame + 18 locked), resolved 379, cap 0, node-cap 1, wall-clock 0 (measured). So the "cap" column is empty for the midgame because the stop rule resolves first or the enumeration is short; the only cap that fires is the locked-yard node cap, once in 520.

### 1.2 Agreement with the full enumeration of the same decision (a deterministic reference) (measured)

The reference is `evaluateBoundedExact` run to completion on the same decision with the same seed (every distinct hand once, the same boneyard order per hand: deterministic, and by the test of #502 exactly the full enumeration). Non-Best = the **reference** grade is not Best.

| set | decisions / non-Best | top move, all | grade, all | top move, non-Best | grade, non-Best | kappa, non-Best |
|---|---|---|---|---|---|---|
| **all (seed 1)** | 501 / 121 | 98.6% [97.4, 99.6] | 97.8% [96.4, 99.0] | **97.5% [94.2, 100.0]** | **95.0% [90.9, 98.3]** | 0.90 |
| all (seed 2) | 501 / 115 | 98.2% [96.8, 99.2] | 98.4% [97.2, 99.4] | 98.3% [95.7, 100.0] | 93.9% [89.6, 98.3] | 0.88 |
| held-out (seed 1) | 193 / 47 | 99.5% [98.4, 100.0] | 96.9% [94.3, 99.0] | 100.0% [100.0, 100.0] | 95.7% [89.4, 100.0] | 0.92 |
| held-out (seed 2) | 193 / 46 | 97.9% [95.9, 99.5] | 98.4% [96.4, 100.0] | 100.0% [100.0, 100.0] | 93.5% [84.8, 100.0] | 0.88 |
| tuning (seed 1) | 308 / 74 | 98.1% [96.4, 99.4] | 98.4% [96.8, 99.7] | 95.9% [90.5, 100.0] | 94.6% [89.2, 98.6] | 0.89 |
| tuning (seed 2) | 308 / 69 | 98.4% [96.8, 99.7] | 98.4% [96.8, 99.7] | 97.1% [92.8, 100.0] | 94.2% [88.4, 98.6] | 0.87 |

The two splits and both seeds meet the owner's bars (non-Best grade about 90%, top move about 95%) against the same-decision full enumeration.

### 1.3 Why #501 says 95.7% / 97.9% and #502 says 83.2% / 79.0%

Three differences, all measurable here; none is an error in either document's arithmetic.

| | #501 (tuned rule replayed on a recording) | #502 "figures" (83.2% / 79.0%) |
|---|---|---|
| the run being judged | the stopping rule replayed on the **recorded hands** | the shipping code run **live** |
| the reference | the **complete pass of the same recording** (same hands, same boneyard orders): only the hands the rule skipped can differ | a full enumeration with **another seed**: different boneyard orders on every hand, so the two differ by the boneyard noise as well |
| which decisions count as "non-Best" | non-Best by the **true** (reference) grade | the decisions where **either run** is non-Best (a decision where the bounded run says Mistake and the reference says Best counts as a disagreement by construction) |
| which decisions | held-out only, 44 to 47 | all 501, about 125 |

What each change does to the same bounded run (measured, grade on non-Best):

| comparison | reference seed | non-Best defined by | top move | grade |
|---|---|---|---|---|
| B (seed 1) vs F (seed 1) | same | reference | 97.5% | **95.0%** |
| B (seed 1) vs F (seed 1) | same | either run | 97.6% | 91.3% |
| B (seed 1) vs F (seed 2) | other | reference | 94.8% | 90.4% |
| B (seed 1) vs F (seed 2) | other | either run | 90.4% | **83.2%** |
| B (seed 2) vs F (seed 1) | other | reference | 90.9% | 81.0% |
| B (seed 2) vs F (seed 1) | other | either run | 91.1% | **79.0%** |
| F (seed 1) vs F (seed 2): a full enumeration against itself | other | reference (F2) / (F1) | 97.4% / 92.6% | 90.4% / 86.0% |

So, step by step: same seed to other seed costs about 5 points of grade (95.0 to 90.4) because the reference is a different random draw; "either run non-Best" instead of "reference non-Best" costs about 7 more (90.4 to 83.2), because it adds the decisions where only the bounded run is non-Best; and 81.0 against 90.4 is two draws of the same quantity (the bounded runs of seed 1 and seed 2 against the two references; their intervals overlap: [73.6, 87.6] and [84.3, 95.7]). #501's 95.7% / 97.9% is the same-seed, reference-defined, held-out cell (reproduced here with the shipping code: 95.7% and 100.0%). **The honest summary:** the bounded path agrees with the same draw of the truth on about 95% of non-Best grades, with a different draw on 81 to 90% (the full enumeration itself agrees with another draw on 86 to 90%), and the exact figure depends on which of those three questions is asked. The #502 PR text already said the bounded path is "no more and no less accurate than production"; this section is the reconciliation behind it.

## 2. Item 2: how reproducible today's verdicts are

**Measured.** Production today (`solveMidgameDeterminization`, C draws with replacement, 3 plies, the exact-branch seed `racehorse-review-exact-enum`) run twice on the same decision with two seeds, 501 exact-path decisions. Non-Best defined by the first run.

| set | decisions / non-Best | top move, all | grade, all | top move, non-Best | grade, non-Best | kappa, non-Best |
|---|---|---|---|---|---|---|
| **all** | 501 / 117 | 96.2% [94.4, 97.8] | **93.8% [91.6, 95.8]** | 92.3% [87.2, 96.6] | **82.9% [75.2, 88.9]** | 0.67 |
| held-out | 193 / 44 | 96.9% [94.3, 99.0] | 93.3% [89.6, 96.4] | 97.7% [93.2, 100.0] | 84.1% [72.7, 95.5] | 0.71 |
| tuning | 308 / 73 | 95.8% [93.5, 97.7] | 94.2% [91.2, 96.8] | 89.0% [80.8, 95.9] | 82.2% [72.6, 90.4] | 0.64 |

Counting every decision where either run is non-Best (128): top move 86.7% [80.5, 92.2], grade 75.8% [68.0, 82.8].

**Reading:** over all exact-path decisions 6.2% of grades and 3.8% of top moves change when the same decision is reviewed again with another seed; among the decisions that carry a badge other than Best, **17% of grades and 8% of top moves change**. That is the reproducibility of what a player sees today on the exact path. For comparison (same set, first run defines non-Best): the shipping bounded path agrees with itself on 79.8% [72.6, 86.3] of non-Best grades, a full enumeration with itself on 86.0% [79.3, 91.7]; all three overlap, with the enumeration the highest. The floor for a method that visits every hand once is not 100%: it is about 86%.

## 3. Item 3: the single-depth pipeline (design, not built)

### 3.1 The idea in one paragraph

Review every decision at **one depth (3 plies)** with **one engine version**, and make the work **a function of (decision, seed key, N)** so that it can be split, resumed, merged and checked. The unit of work is hand index *i* of a decision; the result is the running sufficient statistics of units 0..N-1; the verdict is computed from the statistics. The device does the first pass at N = 100 straight after the game, extends to N = 400 in idle time by running units 100..399 and **adding** the statistics; the server never runs a first pass, it recomputes a few random decisions and checks that the numbers are exactly what it gets.

### 3.2 The work unit (prototype: `devtools/singleDepthPrototype.ts`, 4 tests)

- **Unit *i* of a decision = one hidden opponent hand AND one boneyard order**, both a pure function of `(seedKey, i)`, with `seedKey = <decisionId>:<salt>`. It does not depend on N, on which units ran before, on the machine or on the order of execution (tested: units computed backwards equal units computed forwards).
- **Positions with at most 8,000 distinct hidden hands** walk a seeded permutation of them (each hand exactly once per cycle) and **cycle again when N exceeds the count, with a new boneyard order each cycle**. So N = 400 means 400 independent boneyard draws even for a position with 14 distinct hands. This is the fix for the noise floor found in #502 (the boneyard order, not the hand sampling, dominates the disagreement; a hand enumeration gives one boneyard order per hand).
- **Larger positions** draw unit *i* from `sampleHiddenAllocation(snapshot, "${seedKey}:${i}")`, the sampler the ladder uses today, so nothing new is needed there.
- **Locked yards** (no tile left to draw) are not unit-based: they stay exhaustive to the hand's end over a seeded permutation of the allocations under the 1,000,000-node cap of #502, which is also additive (units = allocations).
- **Forced decisions** need no search.
- **Depth is 3 plies**, a field of the record, never inferred. Nothing in the pipeline has a 2-ply mode.

### 3.3 The record (additive; one JSON object per decision)

```
engine:     "single-depth-v1"            // the code that produced it; results of different engines are never merged
depth:      3
seedKey:    "<decisionId>:<salt>"
unitsFrom:  0, unitsTo: 100              // the range these statistics cover (an extension carries 100..400)
n:          100                          // units in the range
actionKeys: [...]                        // canonical keys, in snapshot order
sum:        [..per action..]             // sum of the unit values
sumsq:      [..per action..]
pairSum:    [[..]]  pairSumsq: [[..]]    // for a < b: sum and sum of squares of (value_a - value_b)
nodes:      123456                       // work done, for the cap and for the verifier's budget
```

About A² + 2A numbers per decision (A = legal actions, usually 2 to 8), about 1.5 KB of JSON and 90 KB per game before compression. The loss, the grade, the top move and the interval are **computed from the statistics at read time** (`verdictOf`), so a band change needs no re-run. Because the values are integer score differences, the sums are exact in a double: **two machines that run the same units get bit-identical statistics.**

### 3.4 Resumable and mergeable (measured)

`stats(0..100) + stats(100..400)` equals `stats(0..400)` **exactly on all 821 decisions** with tiles to draw (`singleDepthStudy.ts`, `resumeOk`; also a unit test on an exact-path and a ladder position). So the device quick pass and its idle extension are one computation done in two steps, and the server can extend a decision (or check any range) without redoing the rest.

### 3.5 What the extension changes for the player (measured)

Upgrading a decision from N = 100 to N = 400 (same seed key, a prefix extension, all 821 decisions): **grade changes on 3.7% (30 of 821; about 3 badges in an 82-decision game)**, top move on 3.9%; among the decisions that are non-Best at N = 400, 10.2% (21 of 206) had a different grade at N = 100; **1.3% of quick Bests (8 of 614) become an error**. N = 200 to 400: 1.9% grades, 0.3% of Bests. For comparison, the 2-ply N = 100 quick pass to 3 plies changes 11.0% of badges (#502's flip matrix). The interval of the verdict (which comes with the statistics) can hold the badge back where the verdict is not yet placed in a band: reuse the partial-result rule of #502 (a badge only if the interval lies inside one grade band), so the 3.7% that move are mostly decisions that were already unsettled at N = 100.

### 3.6 Quality and cost of fixed N (measured)

Reference: pooled 2 x 1,000 units (exact path, over hands AND boneyard orders), pooled 2 x 2,500 3-ply samples (ladder). Two runs per decision with different seed keys; non-Best defined by the reference ("vs reference") or by the second run ("self"). Full table: data file.

| path | N | self: grade, non-Best | vs reference: top move, non-Best | vs reference: grade, non-Best | kappa | laptop ms per decision: mean / p99 / max |
|---|---|---|---|---|---|---|
| exact | 100 | 78.6% [71.4, 85.7] | 93.7% [90.3, 96.6] | 85.7% [81.1, 89.9] | 0.72 | 49.6 / 406 / 1,219 |
| exact | 200 | 81.5% [74.2, 87.9] | 95.0% [92.0, 97.5] | 89.1% [84.9, 92.9] | 0.78 | 98.7 / 791 / 2,400 |
| exact | 400 | **88.6% [82.9, 94.3]** | 97.5% [95.4, 99.2] | **92.9% [89.5, 95.8]** | 0.86 | 197 / 1,577 / 4,812 |
| ladder | 100 | 86.6% [79.4, 92.8] | 96.2% [92.9, 98.9] | 94.0% [90.8, 97.3] | 0.86 | 91.6 / 925 / 4,204 |
| ladder | 200 | 94.6% [89.1, 98.9] | 96.2% [92.9, 98.9] | 95.1% [91.8, 97.8] | 0.89 | 182 / 1,871 / 8,312 |
| ladder | 400 | 95.5% [91.0, 98.9] | 96.7% [94.0, 98.9] | 95.1% [91.8, 97.8] | 0.89 | 363 / 3,712 / 16,652 |
| all | 100 | 82.1% [77.1, 87.0] | 94.8% [92.4, 96.7] | 89.3% [86.3, 92.2] | 0.78 | 65.9 / 524 / 4,204 |
| all | 400 | 91.5% [87.7, 95.3] | 97.2% [95.5, 98.8] | 93.8% [91.2, 96.0] | 0.87 | 262 / 2,191 / 16,652 |

**The methods that exist today against the same reference (exact path, 1,002 runs, non-Best 238):**

| method | top move, non-Best | grade, non-Best | kappa |
|---|---|---|---|
| production today (C draws with replacement) | 91.6% [87.8, 95.0] | 84.5% [79.8, 89.1] | 0.70 |
| the shipping bounded path | 92.9% [89.5, 96.2] | 89.1% [84.9, 92.9] | 0.78 |
| full enumeration of the distinct hands | 94.1% [91.2, 97.1] | 90.3% [86.6, 93.7] | 0.81 |
| fixed N = 100 units | 93.7% [90.3, 96.6] | 85.7% [81.1, 89.9] | 0.72 |
| fixed N = 200 units | 95.0% [92.0, 97.5] | 89.1% [84.9, 92.9] | 0.78 |
| **fixed N = 400 units** | **97.5% [95.4, 99.2]** | **92.9% [89.5, 95.8]** | **0.86** |

**Reading (measured):** this reference averages over hands and boneyard orders, so it is the right yardstick for "close to the expectation", which #502 could not provide. Production today is the farthest from it (84.5%); the bounded path and the full enumeration are closer (89.1%, 90.3%); **fixed N = 400 units is the closest (92.9%) and the most self-consistent (88.6%)**, at 197 ms mean per exact-path decision (production 784 ms, bounded 42 ms). Fixed N = 100 is about as good as production today (85.7% against 84.5%) at 1/16 of its cost. The differences between neighbouring rows are within the intervals; the ordering production < bounded <= enumeration < fixed N = 400 is consistent across top move, grade and kappa.

### 3.7 Whole-game cost through the shipping path and through fixed N (measured on the laptop, projected)

Whole game = the sum over all decisions of one game (both seats); **one seat is what a review covers** (one player's decisions). 10 games, 20 seats; with n = 10 or 20, "p90" is the second-largest and "p99" the largest value (read as worst games). The shipping paths are `adaptiveEvaluateReviewPosition` exactly as the server runs it (completion phase, second opinion on); the fixed-N rows replace the search of every decision with tiles to draw by N units at 3 plies and keep the shipped cost of forced decisions and locked yards.

| path | unit | mean | p90 | p99 | min | max | phone x2 (guess) | phone x5 (guess) | Render free x45 (measured ratio) |
|---|---|---|---|---|---|---|---|---|---|
| shipping today (flag off) | game | 51.9 s | 109.3 s | 109.3 s | 11.4 s | 109.3 s | 103.8 s | 259.6 s | 2,336 s |
| shipping today (flag off) | **one seat** | **26.0 s** | 52.7 s | 76.8 s | 2.6 s | 76.8 s | 51.9 s | 129.8 s | 1,168 s |
| shipping, bounded flag on | game | 12.6 s | 26.9 s | 26.9 s | 3.8 s | 26.9 s | 25.1 s | 62.8 s | 566 s |
| shipping, bounded flag on | **one seat** | **6.3 s** | 12.0 s | 23.9 s | 1.6 s | 23.9 s | 12.6 s | 31.4 s | 283 s |
| fixed N = 100, 3 plies | game | 5.8 s | 10.3 s | 10.3 s | 1.5 s | 10.3 s | 11.6 s | 28.9 s | 260 s |
| fixed N = 100, 3 plies | **one seat** | **2.9 s** | 5.9 s | 8.2 s | 0.7 s | 8.2 s | 5.8 s | 14.4 s | 130 s |
| fixed N = 200 | one seat | 5.6 s | 11.8 s | 16.1 s | 1.3 s | 16.1 s | 11.1 s | 27.9 s | 251 s |
| fixed N = 400 (100 now + 300 later) | game | 21.8 s | 40.1 s | 40.1 s | 5.8 s | 40.1 s | 43.7 s | 109.2 s | 983 s |
| fixed N = 400 (100 now + 300 later) | **one seat** | **10.9 s** | 23.5 s | 32.0 s | 2.6 s | 32.0 s | 21.8 s | 54.6 s | 491 s |

Per decision on the laptop, shipping with the flag on: forced 0.2 ms, locked yard mean 189 ms (p99 2.4 s), exact path mean 42.5 ms (p99 476 ms, max 2.1 s), **ladder mean 315 ms (p99 4.0 s, max 11.8 s)**; the ladder is **80% of the time** once the exact path is bounded. Flag off: exact path 784 ms mean and 76% of the time. (One caveat on the comparison: the shipping ladder is a 2-ply search; the fixed-N rows are 3 plies, which costs about 4.4x at the same N, see #502's pre-report; they are cheaper here because the tier ladder spends far more than N = 100 on the decisions it escalates.)

**Device (guess for the multipliers, measured for the laptop numbers):** the quick pass at N = 100 costs **one seat 2.9 s on the laptop, 5.8 to 14.4 s on a phone**; extending to N = 400 in idle time adds 8.0 s on the laptop (16 to 40 s of idle CPU on a phone) and ends at 10.9 s (21.8 to 54.6 s). The heaviest seat is 8.2 s at N = 100 on the laptop (16 to 41 s on a phone).

### 3.8 Server verification: a light verifier, not the first-pass engine

**What the server does (design):**
1. **Accept the record** and check it is internally consistent (n equals the range length; `sumsq >= sum²/n`; pair statistics consistent with the singles). Pure arithmetic, milliseconds.
2. **Choose k decisions at random after receipt** (server-side randomness the client cannot predict), preferring decisions whose claimed `nodes` are below a verification budget, and **recompute their statistics for the claimed range** with the same engine; require **exact equality** (integer sums). Mismatch means reject, count, and fall back to the server running that decision itself.
3. Optionally **recompute the first 10 units of every decision** against per-unit values the client also uploads for those units (a prefix check on all decisions, cheap because the prefix is short).
4. The played action stays client-asserted (`reviewedMoveQuality.ts` trust note): verification protects the engine numbers, not the move.

**Cost per game on Render (x45, measured laptop cost scaled; the scaling is a guess for a decision-by-decision mix):**

| step | laptop | Render free x45 |
|---|---|---|
| recompute one decision at N = 100 (mean over all 821) | 66 ms | 3.0 s |
| recompute one decision at N = 400 | 262 ms | 11.8 s |
| the same, picking only decisions whose N = 100 cost is at most 100 ms (85% of decisions): N = 100 | 28.8 ms | 1.3 s |
| the same: N = 400 | 114.7 ms | 5.2 s |
| **k = 3 cheap decisions at the N = 100 checkpoint** | 87 ms | **3.9 s** |
| k = 3 cheap decisions at N = 400 | 344 ms | 15.5 s |
| prefix check of 10 units of every decision of a seat (about 0.1 of the N = 100 pass, 2.9 s) | 0.29 s | 13 s |
| an unlucky pick, one decision at N = 100, p99 | 524 ms | 23.6 s |
| the worst decision at N = 100 / N = 400 (the cap must bound this) | 4.2 s / 16.7 s | 189 s / 749 s |

**Against what the server does today** (the first-pass engine, measured by emulating the free instance): one seat costs a mean of **1,168 s** (19.5 min) of Render time with the flag off, **283 s** with the flag on, with ceilings (emulated, all ceilings /45): **1,086 s and 234 s**; the real game took about 8 min. The light verifier is **about 4 to 17 s per game: 17 to 72x less than the bounded first pass and 69 to 300x less than today's**. The server stays inside what a 0.15 CPU instance can do.

**What a lying client can and cannot do (guess):** with k random full checks a client that fabricates a fraction f of its decisions is caught with probability 1 - (1 - f)^k: 27% at f = 10% and k = 3, 66% at f = 30%; the prefix check on every decision raises the bar for any fabrication that is wrong in its first units. This is enough while the number is owner-only and not ranked or rewarded (as `reviewedMoveQuality.ts` already requires); if it ever becomes shareable, k and the prefix size should rise or the server should run a hash commitment over per-unit values.

### 3.9 Hard bounds the design needs (read from the measurements)

- **A per-decision node cap with an anytime `partial` result and a 95% interval**, as #502 did for locked yards, applied to unit-based decisions as well: the worst laptop decision at N = 100 is 4.2 s (189 s at x45, past the 180 s kill) and at N = 400 16.7 s. The cap is a node count, so the same cap means the same result on every machine; a decision that hits it ships `partial=true`, a wider interval, and no badge unless the interval lies in one band.
- **No wall-clock input to the verdict.** Today's ceilings make a verdict depend on machine speed (section 4.3); the design replaces them by unit and node caps.
- **Engine version in the record, merge refuses a mismatch**, and `search.depth` carries 3.

### 3.10 Build outline (guess for effort; nothing started)

1. Engine module and the record type in the contract (additive optional field, `reviewEngineVersion` bump; the effects are those analysed in #502: nothing invalidated or re-run).
2. Device runner: a Web Worker running N = 100 per decision at game end, then 50-unit idle chunks; progressive badges via the interval rule.
3. Server verifier route and its flag; random challenge; exact-equality check; fallback to server-run.
4. Cut over: keep the server's first-pass engine only as the fallback and for clients without the device pass.

## 4. Additions (a), (b), (c): Render, the sampled path, and ceiling hits

### 4.1 (a) Projection onto the measured ratio and onto a phone

See the table in 3.7. In one line per path, **one seat**:

| | laptop | phone x2 / x5 (guess) | Render free x45 |
|---|---|---|---|
| shipping today | 26.0 s | 51.9 / 129.8 s | 1,168 s |
| shipping, bounded flag on | 6.3 s | 12.6 / 31.4 s | 283 s |
| single-depth N = 100 | 2.9 s | 5.8 / 14.4 s | 130 s |
| single-depth N = 400 | 10.9 s | 21.8 / 54.6 s | 491 s |
| **single-depth server verifier (k = 3, N = 100 checkpoint)** | 0.09 s | 0.2 / 0.4 s | **3.9 s** |

Render can run one seat's worth of the N = 100 single-depth pass in about 2 minutes, but the free instance would be doing it for every player; as a verifier of 3 decisions it needs 4 seconds.

### 4.2 (b) The sampled path (C > 8,000) as a bounded fixed-N variant

Measured on the 320 ladder decisions: today's ladder costs a mean of **315 ms per decision (p99 4.0 s, max 11.8 s)** and is 80% of the whole-game time once the exact path is bounded (flag on) and 20% before. The fixed-N 3-ply variants:

| ladder variant | mean | p99 | max | non-Best grade vs the 3-ply reference |
|---|---|---|---|---|
| shipping ladder (2-ply tiers, converge) | 315 ms | 4.0 s | 11.8 s | 77.2% [68.5, 85.9] (top move 88.0%) |
| fixed N = 100, 3 plies | **92 ms** (3.4x cheaper) | 925 ms | 4.2 s | **94.0% [90.8, 97.3]** |
| fixed N = 200, 3 plies | 182 ms (1.7x cheaper) | 1.9 s | 8.3 s | 95.1% [91.8, 97.8] |
| fixed N = 400, 3 plies | 363 ms (1.15x dearer) | 3.7 s | 16.7 s | 95.1% [91.8, 97.8] |

The 2-ply ladder verdict is the weak one against a 3-ply reference (77.2%, #502 pre-report and the same here for the whole shipping ladder), because it is a different depth, not because of the sample count (more samples did not help: 2-ply N = 200 77.2%). Whole-game effect (one seat, laptop, 3.7): replacing the ladder and bounding the exact path by fixed N = 100 takes the seat from **6.3 s to 2.9 s**, N = 200 to 5.6 s, N = 400 to 10.9 s. **Guess:** the exact path should not be given its own variant; one unit definition covers both.

### 4.3 (b), (c) What a ceiling hit or an incomplete result means today

**Production facts:** 4 ceiling hits and 4 incomplete in the real job; tier-1 decisions with 45 samples solved took 2.4 to 5.7 s each (the 2,000 ms tier-1 ceiling is checked coarsely, so the stop can come late).

**How the engine treats a decision cut at tier 1 (read from code, then seen in the emulation).**

1. `evaluateReviewPosition` stops the sample loop when the ceiling fires, keeps the samples solved so far, and **adds the diagnostic `wall-clock safety ceiling exceeded` and sets `search.complete = false`** (`evaluateReviewPosition.ts:258-259`). It does not fail the decision.
2. The convergence gate `decideSearchConvergence` (`evaluationConvergence.ts`) then decides whether to accept it:
   - **fewer than 8 samples, or 8 to 31 samples with coverage under 2%** (every position with more than 8,000 hands: 45 of 10,000 hands is 0.45%): not accepted, the dispatcher falls back to the **heuristic** (`evaluateReviewPosition.ts:304`, `heuristicFallbackReason: coverage-below-threshold`), evidence `heuristic` / `low`, **no badge**.
   - **32 to 49 samples (tier 1 asks for 100): accepted as `stability-converged` with no real test.** The stability test compares the running totals at the halfway sample (`halfway = floor(100 / 2) = 50`, `solveMidgameDeterminization.ts:227`) with the final ones; a run cut before sample 50 never records the checkpoint (`:276-277`) and gets the default `{ sameTopAction: true, valueDelta: 0, lossDelta: 0, rankingStable: true }` (`:313-317`), which passes (`evaluationConvergence.ts:57-58`, `hiddenStateSamples >= 32`). **Exactly the production case: the 4 ceiling hits solved 45 samples each.**
   - 50 to 99 samples: a real stability test between sample 50 and the cut; accepted if stable or if the secondary coverage rule holds.
3. Accepted, the result is `SCORED` / `search` / `medium` / "Review Engine search" (`evaluateReviewPosition.ts:139`), the completion phase attaches the **second opinion** (`adaptiveEvaluateReviewPosition.ts`, `withSecondOpinion`), and the provenance records the tier. **Nothing the client reads is changed by the cut:** `lossBandLabelForEvaluation` (`client/src/analyzer/gameAccuracyModel.ts`) draws the badge from the loss; the header shows `{displayLabel} · {confidence} confidence` (`GameReviewer.tsx:380`) = "Review Engine search · medium confidence" for a cut and an uncut verdict alike; `search.complete` and the ceiling diagnostic are read only by the server's logs and cost counters (`reviewCompletionWorker.ts:278-279`, `logReviewWorkerBatchDiagnostics.ts:29`) and by one owner-only metric (`reviewedMoveQuality.ts:127`: a game with any ceiling hit gets no `avgMoveQuality`, reason `wall-clock-truncated`). **So the owner-only number is withheld for a truncated game but the player-facing badges are not.** The only player-visible softening is the second opinion (an unconfirmed verdict is shown one grade softer), which applies equally to cut and uncut.

**Emulated on the corpus (measured; every ceiling /45, one pass, 840 scored decisions, flag off):** 22 ceiling hits (1.8% of the 1,212 decisions, 2.6% of the 840 scored) and 24 incomplete (the 22 plus 2 forced decisions); of the 22: tier 1 with 34 to 98 samples (17) and tier 2 with 602 to 1,805 samples (5); **all 22 shipped as `search` / `medium` with a badge, none as a heuristic fallback**; **3 of the 17 tier-1 cuts (34, 38, 44 samples) are in the vacuous window** (the real job had 4 at 45). With the bounded flag on: 20 ceiling hits and 23 incomplete (the 20, 2 forced decisions and the node-capped locked yard); the 20 ceiling hits and the node-capped yard (21 of the 23) shipped as search/medium. 24 decisions (2.9%) would exceed the 180 s worker kill on the free instance with the flag off, all of them exact-path decisions that the bounded path removes; with the flag on 1 remains (a tier-3 ladder decision with 12,000 samples, 308 s at x45).

**What the cut verdicts are worth (measured, 2-ply, the production tier-1 and tier-2 streams, an independent pooled 2 x 1,000-sample 2-ply reference, 320 ladder decisions, non-Best 92):**

| stream | samples kept | top move, non-Best | grade, non-Best | kappa | mean abs error of the loss, non-Best |
|---|---|---|---|---|---|
| tier 1 | 16 | 90.2% [83.7, 95.7] | 84.8% [77.2, 91.3] | 0.66 | 0.274 |
| tier 1 | 32 | 90.2% [83.7, 95.7] | 88.0% [81.5, 94.6] | 0.72 | 0.191 |
| tier 1 | **45** | 92.4% [87.0, 97.8] | **87.0% [80.4, 93.5]** | 0.69 | 0.166 |
| tier 1 | 64 | 92.4% [87.0, 96.7] | 88.0% [81.5, 94.6] | 0.72 | 0.149 |
| tier 1 | 100 (uncut) | 94.6% [89.1, 98.9] | 90.2% [83.7, 95.7] | 0.77 | 0.124 |
| tier 2 | 600 | 98.9% [96.7, 100.0] | 95.7% [91.3, 98.9] | 0.90 | 0.051 |
| tier 2 | 1,800 | 98.9% [96.7, 100.0] | 96.7% [92.4, 100.0] | 0.92 | 0.036 |
| tier 2 | 2,500 (uncut) | 97.8% [94.6, 100.0] | 96.7% [92.4, 100.0] | 0.92 | 0.035 |

Against the unscaled laptop run of the same decision, the cut decisions' verdicts differ in 0 of 22 grades (flag off) and 1 of 21 (flag on); none changes the top move.

**Reading (c):** the cut verdicts themselves are not much worse than the uncut ones in this corpus (a 45-sample tier-1 verdict agrees with the reference on 87.0% of non-Best grades against 90.2% for the full 100; tier-2 cuts at 600 or more samples are practically as good as 2,500), so the 4 production ceiling hits probably produced verdicts of nearly normal quality. **The defect is that they are indistinguishable to the player from a full verdict and that the stop between 32 and 49 samples skips the convergence test altogether.** Nothing "low-sample dressed as confident" at the 8-to-31-sample end (those fall back to the heuristic and carry no badge); the confident-looking low-sample cases are 32 to 99 samples at tier 1 and any tier-2 cut. The single-depth design removes the problem at the root: no wall-clock input to the verdict, a `partial` flag and an interval on anything cut by a node or unit cap, and the badge rule of #502.

## 5. Item 4: win-probability loss and the advantage graph (proposal)

**What exists (read from code).** Every candidate carries `value.expectedPointDifferential` (the net swing in score difference from the decision point at the search's horizon, `solveMidgameDeterminization.ts`) and `value.winProbability`, which is `null` everywhere today (`reviewContracts.ts`, `loss.winProbability` the same). The loss of the played move is best minus played in points. Grade bands are in points (`LOSS_BAND_BOUNDARIES`: 0.13, 0.79, 5.98).

**Why points are not enough (measured on the corpus).** A point of loss is worth more near the end of a game to 60. Over the 840 scored decisions the share of decisions in each stage is even (24% when the closer player still needs 46 or more points, 25% at 31 to 45, 22% at 16 to 30, 23% at 15 or fewer), and Mistake or Blunder is 14.7%, 20.7%, 18.3%, 18.3% of them: the point loss is the same size at the start and at the end (mean loss of a non-Best move 1.28, 2.18, 1.96, 1.78; max 5.5 to 12.6) while its effect on who wins is not.

**The proposal (nothing built).**

1. **A win-probability model** `WP(scoreDiffAfter, myPointsToGo, theirPointsToGo, handState)` mapping a position to the probability that the player to move wins the game: a logistic or monotone (isotonic) regression on a small set of public features (score difference, both players' points to the target, tiles in each hand, boneyard size, whose turn). **Calibration data is the missing piece:** the 10 recorded games are too few (1,212 positions in 10 outcomes). It needs a corpus of bot-vs-bot games with outcomes (a few thousand games; the engine plays a game in seconds on the laptop; **guess:** a few hours of two niced shards). Acceptance: Brier score and a reliability curve on a held-out set of games, monotone in the score difference, and no worse than a one-variable baseline.
2. **Win-probability loss** = WP(best) - WP(played) with `scoreDiffAfter = scoreDiffBefore + expectedPointDifferential` for each candidate. It uses only values the review already computes; the contract's `winProbability` fields (candidate and loss) are already there and null. Grade bands in WP points (for example Best up to 1, Inaccuracy up to 5, Mistake up to 15, Blunder above; **guess**, to be fitted like the point bands) replace or sit beside the point bands. An error at 55-0 would stop being a Blunder and a 5-point slip at 55-50 would become one.
3. **Uncertainty carries over:** map the loss interval of the single-depth statistics through the model (the model is monotone, so the interval maps end to end); the badge rule (interval inside one band) works unchanged in WP bands.
4. **Advantage graph.** One point per decision, the WP of the position under best play for the human player (WP(best) from the mover's view, flipped for the other seat), connected across the game; a bar or marker for each decision where the mover's WP loss is above a threshold (the swings), hand boundaries where the real scores change, and the final result. It needs no extra search: it is the same per-decision values. Where a decision has only a heuristic verdict, the graph leaves a gap, not an invented point.
5. **Contract and cost:** populate the existing `winProbability` fields (a semantic change, so a `reviewEngineVersion` bump and a flag); the client renders; no server work beyond what the review already does; the model is a small table or a few coefficients shipped with the engine.
6. **Risks (read and guess):** the values are horizon-limited (3 plies, not to the end of the hand), so WP is only as good as the horizon; the grade repeatability measured in item 2 (83% for non-Best) bounds how crisp WP bands can be; a WP-based grade is a product change (it rescales every badge), so it needs the same flip-matrix report as #502 before it is turned on.

## 6. Limits, guesses, and what I would ask before building

- **Measured, bot play only;** one real game is the only production sample. The 45x ratio is the owner's benchmark; applying it to everything is a **guess** (the throttling is bursty; the 0.15 quota may be worse for bursts).
- **Guess:** the phone multipliers 2 to 5; the effort estimates; the detection probabilities of the verifier.
- **Read from code, not run:** the heuristic fallback below 32 samples (not seen in the 840 emulated decisions); the badge path for a cut result (traced by reading, one test of the emulated records).
- **The emulation divides ceilings by 45 but not the cost of the second opinion or fixed overheads;** the 5 to 8 minutes of the real job are matched to within the spread of 20 emulated seats (section 0), not to the second.
- **Wall-clock cut verdicts depend on the machine,** which is why even the emulation's counts are one draw of a machine-speed-dependent process.

**What I would ask before building:**

1. Go for the single-depth pipeline as the plan, device-first with a light server verifier? If yes, in what order: contract/engine (devtools to production), device runner, verifier. Is N = 100 then 400 the right pair, and 3 plies for everything (including the 2-ply ladder)?
2. Until then, the cheap defects found here could ship alone: (i) make a result cut by a ceiling carry a visible `partial` flag and no badge unless its interval lies inside a band (the rule of #502 applied to wall-clock cuts), (ii) close the vacuous convergence window (do not accept below 50 samples when the halfway checkpoint is missing). Do you want those as a separate small PR, flag off?
3. Win probability: should I start with the calibration corpus (self-play with outcomes), since nothing else can be decided without it?

## 7. Reproduce

```
npx tsx packages/review-engine/src/devtools/boundedPathRepeatability.ts <shard> <shards> <rep.jsonl>            # the 501 decisions x {production, bounded, full} x 2 seeds
npx tsx packages/review-engine/src/devtools/boundedReconcile.ts <rep.jsonl>...                                  # items 1 and 2
npx tsx packages/review-engine/src/devtools/wholeGameRun.ts <out.jsonl> <shard> <shards> <slow> <bounded 0|1>  # whole games through adaptiveEvaluateReviewPosition; slow 45 = ceilings / 45
npx tsx packages/review-engine/src/devtools/wholeGameSummary.ts <label> <slow> <run.jsonl>... [-- <baseline.jsonl>...]
npx tsx packages/review-engine/src/devtools/singleDepthStudy.ts <out.jsonl> <shard> <shards>                    # the prototype: N = 100/200/400, two seeds, reference
npx tsx packages/review-engine/src/devtools/singleDepthSummary.ts --sd ... --ladder ... --rep ... --wg1 ... --wg0 ...
npx tsx packages/review-engine/src/devtools/recordLadderCutPass.ts <out.jsonl> <shard> <shards>                 # tier-1 / tier-2 streams + 2-ply reference
npx tsx packages/review-engine/src/devtools/cutVerdictQuality.ts <cut.jsonl>...
npx tsx packages/review-engine/src/devtools/scoreContextStats.ts <wholeGame run.jsonl>...                      # item 4 context
```
