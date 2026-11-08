# Bounded exact path: the two pre-reports, the build, and what the version bump does (2026-11-07)

The owner approved the bounded path from `docs/review-bounded-exact-2026-11-07.md` (PR #501). This PR builds it **behind a flag that is off by default**. Nothing is enabled. Every conclusion is labelled **measured** (laptop, bot play, the recorded corpus: two bot policies, 10 games, 840 non-forced decisions), **read from code** (file:line) or **guess**. Tuning = games 0 to 2 of each recorded file, held-out = games 3 and 4. Intervals are 95% bootstrap (2,000 resamples). Timings are the same laptop as #501, cold, at most two niced shards.

## Contents

1. [The flag, and exactly what the owner sets](#1-the-flag-and-exactly-what-the-owner-sets)
2. [Pre-report 1: the ladder path at 3 plies, N = 100 and 200](#2-pre-report-1-the-ladder-path-at-3-plies-n--100-and-200)
3. [Pre-report 2: the flip matrix, 2-ply N = 100 against 3 plies](#3-pre-report-2-the-flip-matrix-2-ply-n--100-against-3-plies)
4. [A correction to #501, and the repeatability measurement](#4-a-correction-to-501-and-the-repeatability-measurement)
5. [What this PR builds, requirement by requirement](#5-what-this-pr-builds-requirement-by-requirement)
6. [What the `reviewEngineVersion` bump does](#6-what-the-reviewengineversion-bump-does)
7. [Tests](#7-tests)
8. [Limits and guesses](#8-limits-and-guesses)
9. [Reproduce](#9-reproduce)

## 1. The flag, and exactly what the owner sets

| | |
|---|---|
| Name | `REVIEW_BOUNDED_EXACT_ENABLED` |
| Default | **off** (unset, empty, or anything other than the exact text `true`) |
| Kind | `flagTrue` in `server/src/envSchema.ts` (registered, so the boot check flags a misread value such as `1` or `TRUE`, which would be off) |
| Read in | `server/src/reviewCompletion/reviewBoundedExactFlag.ts`, applied in `reviewCompletionWorker.ts` where each position is handed to the search worker thread |
| Where to set it | on the Render service that runs the review sweep, the same one that has `REVIEW_SWEEP_ENABLED=true` |
| Needs | nothing else: no migration, no client release, no second variable. The client shows the new fields automatically |
| Check it took | `GET /health` now answers `reviewBoundedExact: true`; each `review decision evaluated` log line gains `boundedStop` and `boundedHands` |
| Roll back | unset it (or set anything but `true`) and restart; reviews already saved keep what they were saved with, nothing is re-run |

**To enable: set `REVIEW_BOUNDED_EXACT_ENABLED` to `true` on the review service and restart it.** That is the whole change. This PR does not set it.

Off, the code path is the one that existed: the worker passes the evaluation options on untouched (same object), and `adaptiveEvaluateReviewPosition` only looks at the new `boundedExact` option inside the exact-enumeration branch. Proof in the tests (section 7).

## 2. Pre-report 1: the ladder path at 3 plies, N = 100 and 200

*Question: what would the ladder (positions with more than 8,000 hidden hands, searched today at 2 plies by tiers 1 to 3) cost and agree on at 3 plies with N = 100 and 200 hands, against a 3-ply pooled reference?*

**Measured.** 320 ladder decisions (tuning 202, held-out 118). Reference: two independent 3-ply passes of 2,500 samples pooled (5,000 hands, seeds `bp-ref-a` and `bp-ref-b`); the test pass uses a third seed, so agreement is not inflated by shared samples. N = 100 and N = 200 are prefixes of one test pass. The 2-ply rows (seed shared with the 3-ply test pass) are today's tier 1 (N = 100) for comparison.

| test | decisions / non-Best | top-move all | grade all | top-move non-Best | grade non-Best | kappa non-Best | MAE non-Best | ms per decision: mean / median / p99 / max |
|---|---|---|---|---|---|---|---|---|
| **3-ply N = 100** | 320 / 92 | 96.3% [94.1, 98.1] | 97.5% [95.6, 99.1] | 95.7% [91.3, 98.9] | **94.6% [89.1, 98.9]** | 0.87 | 0.132 | **101 / 43 / 1,071 / 3,887** |
| **3-ply N = 200** | 320 / 92 | 98.1% [96.6, 99.4] | 98.4% [96.9, 99.7] | 97.8% [94.6, 100.0] | **95.7% [91.3, 98.9]** | 0.90 | 0.082 | **201 / 86 / 2,157 / 7,820** |
| 2-ply N = 100 (today's tier 1) | 320 / 92 | 89.1% [85.6, 92.2] | 89.4% [85.9, 92.5] | 84.8% [77.2, 91.3] | 77.2% [68.5, 85.9] | 0.48 | 0.452 | 23 / 13 / 207 / 416 |
| 2-ply N = 200 | 320 / 92 | 90.9% [87.5, 93.8] | 89.4% [85.9, 92.8] | 88.0% [81.5, 93.5] | 77.2% [68.5, 85.9] | 0.49 | 0.433 | 45 / 25 / 415 / 833 |

By split (non-Best, grade / top move): held-out 3-ply N = 100 91.4% [82.9, 100.0] / 97.1%, N = 200 91.4% / 100.0%; tuning N = 100 96.5% [91.2, 100.0] / 94.7%, N = 200 98.2% / 96.5%. The full per-split tables and the flip-matrix output are in `docs/review-bounded-path-prereport-2026-11-07.data.txt`.

**Reading.**

- **Measured:** at 3 plies, N = 100 already agrees with the 5,000-hand 3-ply reference on **94.6% of non-Best grades and 95.7% of non-Best top moves**; N = 200 on 95.7% and 97.8%. The adoption bar the owner set for the exact path (non-Best grade at least about 90%, top move at least about 95%) is met at both N.
- **Measured: the 2-ply tier 1 is the weak point, not the sample count.** Against the same 3-ply reference the 2-ply N = 100 pass reaches 77.2% of non-Best grades and doubling it to N = 200 does not help (77.2%): what disagrees is the depth, not the noise. (This is the depth effect of #501 Q1 seen from the ladder side.)
- **Measured cost:** 3 plies is about **4.4x the 2-ply cost** at the same N (mean 101 ms against 23 ms at N = 100; 201 against 45 at N = 200). The tails are heavy: p99 1.1 s and max 3.9 s at N = 100 (7.8 s at N = 200) against 207 and 416 ms at 2 plies. The held-out games have no long tail (max 222 ms), the tuning games hold it: a handful of mid-game positions with many drawable tiles.
- **Caveat (measured, section 4):** "agreement with the pooled reference" is agreement with another random draw of the same estimate. The reference itself has a floor, so these percentages are a measure of how close a sample gets to a large sample, not to the truth.
- **What this PR does with it:** nothing. The ladder is not touched; this is the number the owner asked for in order to decide whether a 3-ply ladder is worth about 4.4x the compute.

## 3. Pre-report 2: the flip matrix, 2-ply N = 100 against 3 plies

*Question: if a quick pass at 2 plies and N = 100 hands (the device quick review, today's tier 1) were upgraded to 3 plies, how many badges would change?*

**Measured.** 821 non-forced decisions of the corpus: 320 ladder decisions and 501 exact-path midgame decisions (the 19 locked-yard decisions are exact at any depth and are not in the matrix). The 3-ply verdict is the pooled 3-ply reference for ladder decisions and the full 3-ply enumeration of every distinct hand for exact-path decisions. The quick pass is the first 100 samples of a 2-ply pass (ladder) or the first 100 hands of the 2-ply enumeration (exact path; all hands when there are fewer than 100). A "badge" here is the grade of the played move from the loss bands (Best, Inaccuracy, Mistake, Blunder); the second-opinion softening is applied after and is not in this matrix.

**All decisions (821): rows = the quick pass's badge, columns = the 3-ply badge**

| quick \ 3-ply | best | inaccuracy | mistake | blunder | row total | badge changes |
|---|---|---|---|---|---|---|
| best | **586** | 19 | 7 | 0 | 612 | 26 (4%) |
| inaccuracy | 21 | **29** | 16 | 0 | 66 | 37 (56%) |
| mistake | 4 | 20 | **111** | 3 | 138 | 27 (20%) |
| blunder | 0 | 0 | 0 | **5** | 5 | 0 (0%) |

**Ladder path only (320)**

| quick \ 3-ply | best | inaccuracy | mistake | blunder | row total | badge changes |
|---|---|---|---|---|---|---|
| best | **215** | 8 | 1 | 0 | 224 | 9 (4%) |
| inaccuracy | 12 | **12** | 4 | 0 | 28 | 16 (57%) |
| mistake | 1 | 7 | **59** | 1 | 68 | 9 (13%) |
| blunder | 0 | 0 | 0 | **0** | 0 | 0 |

**Exact path only (501)**

| quick \ 3-ply | best | inaccuracy | mistake | blunder | row total | badge changes |
|---|---|---|---|---|---|---|
| best | **371** | 11 | 6 | 0 | 388 | 17 (4%) |
| inaccuracy | 9 | **17** | 12 | 0 | 38 | 21 (55%) |
| mistake | 3 | 13 | **52** | 2 | 70 | 18 (26%) |
| blunder | 0 | 0 | 0 | **5** | 5 | 0 |

**Summary and the sampling-only noise floor** (the same 3-ply verdict compared with a second 3-ply run at N = 100: no depth change, only the sample):

| group | decisions | badge changes | become harsher | become milder | non-Best quick badges that change | quick Bests that become an error | decisions that are Best at 3 plies |
|---|---|---|---|---|---|---|---|
| **2-ply N=100 vs 3-ply, all** | 821 | **11.0% [9.0, 13.0]** | 5.5% [4.0, 7.1] (45) | 5.5% [3.9, 7.1] (45) | **30.6% [24.4, 36.8]** (of 209) | **4.2% [2.6, 5.9]** (of 612) | 611 |
| ladder path | 320 | 10.6% [7.5, 14.1] | 4.4% (14) | 6.3% (20) | 26.0% [17.7, 35.4] (of 96) | 4.0% [1.8, 6.7] (of 224) | 228 |
| exact path | 501 | 11.2% [8.6, 14.0] | 6.2% (31) | 5.0% (25) | 34.5% [25.7, 43.4] (of 113) | 4.4% [2.6, 6.4] (of 388) | 383 |
| held-out games | 311 | 11.6% [8.4, 15.1] | 5.1% (16) | 6.4% (20) | 31.7% [22.0, 41.5] (of 82) | 4.4% [1.7, 7.4] | 229 |
| tuning games | 510 | 10.6% [8.0, 13.1] | 5.7% (29) | 4.9% (25) | 29.9% [22.0, 37.8] (of 127) | 4.2% [2.3, 6.3] | 382 |
| *noise floor, all (3-ply N=100)* | 821 | *3.4% [2.2, 4.8]* | *1.7% (14)* | *1.7% (14)* | *10.5% [6.7, 14.8]* | *1.0% [0.3, 1.8]* | 611 |

The top move differs between the 2-ply N = 100 pass and the 3-ply verdict on **10.0% [8.0, 12.1]** of decisions. Per game (82 non-forced decisions in a game on average, 10 games): **9.0 badges change per game** (median 9, max 14).

**Reading.**

- **Measured: upgrading a 2-ply quick pass to 3 plies would change about 1 badge in 9 (11.0% [9.0, 13.0]; about 9 badges in an 82-decision game).** About 3.4% of that is sampling alone (the noise floor), so about **two thirds of the flips are the depth**.
- **Measured: the flips are symmetric** (45 become harsher, 45 become milder), so a 3-ply upgrade is not a systematic softening or hardening; it moves the same number of moves each way.
- **Measured: it is the middle grades that move.** 56% of quick Inaccuracy badges change (to Best or to Mistake), 20% of quick Mistakes, 4% of quick Bests (26 of 612: 19 become Inaccuracy, 7 Mistake), and none of the 5 Blunders. The player-facing risk is the **4.2% of quick Bests that become an error** (a "Best move" the 3-ply view would withdraw) and the **30.6% of quick non-Best badges that change**.
- **Measured: no difference between the paths** (ladder 10.6%, exact path 11.2%): it is a property of the depth.
- **Not in the matrix:** the second-opinion softening (`presentedLabelForEvaluation`, `client/src/analyzer/gameAccuracyModel.ts:54`) is applied to the label after the grade, so a flipped grade can also be softened; this is a grade-level flip count, and the label-level count would be a little lower where the second opinion already softens an uncertain verdict.
- **Guess:** whether these flips are "corrections" or "noise" depends on which depth is closer to the truth; #501 Q1 found no significant independent evidence that 3 plies is better than 2.

## 4. A correction to #501, and the repeatability measurement

While validating that the code in this PR reproduces the numbers of #501 (the production bounded path against the 3-ply enumeration recorded there), the agreement came out lower than the offline replay (non-Best grade 89.0% rather than 93%). The cause is a measurement point #501 missed, and it changes how two of its numbers should be read.

**What was missed (read from code, then measured).** A hidden position has two kinds of unknown: the opponent's hand, and the order of the boneyard (the tiles drawn during the search). The "true enumeration" of #501 visits every distinct opponent hand once, but each hand gets **one** boneyard order (a seeded shuffle, as the sampler does). So that enumeration is itself one random draw of the quantity being estimated, and so is every other method. Two complete enumerations that differ only in the boneyard seed do not agree with each other everywhere. #501 treated the recorded enumeration as ground truth and reported production's disagreement with it (84% of non-Best grades) as production's own defect (drawing with replacement). Part of it is the shared floor, not a defect of production.

**Measured (this PR, `boundedPathRepeatability.ts`).** The 501 exact-path decisions, each method run twice with different seeds: P = production today (C draws with replacement, 3 plies), B = the bounded path (tuned defaults), F = the same engine run to completion (every distinct hand once).

**Cost per decision (ms, laptop, cold, the shipped code; 501 decisions):**

| method | mean | median | p90 | p99 | max |
|---|---|---|---|---|---|
| P production today (C draws with replacement) | 731 | 57 | 1,998 | 7,723 | 38,112 |
| **B bounded path (tuned defaults)** | **33** | 6 | 62 | **494** | **1,853** |
| F full enumeration of every distinct hand | 723 | 57 | 2,014 | 7,271 | 33,067 |

The bounded path visits a mean 40% of the distinct hands (stopped when resolved: 379 decisions; ran to the end: 122; **partial: 0**). **Measured: about 22x cheaper on average, 16x at p99, 21x at the maximum, with the tail removed** (the held-out and tuning splits alone: mean 20 / 39 ms, p99 305 / 571 ms, max 874 / 1,822 ms).

**Agreement, all 501 decisions, pairs of runs** (the set is the decisions where either run of the pair is non-Best, about 125 of 501; 95% intervals):

| pair | top move, non-Best | grade, non-Best | kappa |
|---|---|---|---|
| **F1 vs F2: a full enumeration against itself with another seed (the floor)** | 92.7% [87.9, 96.8] | **83.9% [77.4, 90.3]** | 0.70 |
| P1 vs P2: production against itself with another seed | 86.7% [80.5, 92.2] | 75.8% [68.0, 82.8] | 0.56 |
| B1 vs B2: the bounded path against itself with another seed | 87.3% [81.7, 92.9] | 78.6% [71.4, 85.7] | 0.62 |
| **B1 vs F1: bounded against the full enumeration, SAME seed** (only the hand sampling differs) | **97.6% [94.4, 100.0]** | **91.3% [86.5, 96.0]** | 0.84 |
| B1 vs F2: bounded against the full enumeration, OTHER seed | 90.4% [84.8, 95.2] | 83.2% [76.8, 89.6] | 0.69 |
| B2 vs F1: bounded (seed 2) against the full enumeration (seed 1) | 91.1% [85.5, 96.0] | 79.0% [71.8, 86.3] | 0.62 |
| P1 vs F1: production against a full enumeration | 86.6% [80.3, 92.1] | 78.0% [70.9, 85.8] | 0.61 |
| P1 vs F2: production against a full enumeration, other seed | 89.3% [83.6, 94.3] | 81.1% [73.8, 87.7] | 0.65 |
| P2 vs F1: production (seed 2) against a full enumeration | 91.4% [85.9, 96.1] | 81.3% [74.2, 87.5] | 0.66 |

(All decisions: top move 95.4 to 98.6%, grade 93.8 to 97.8% across all pairs. Per-split tables: `docs/review-bounded-path-repeatability-2026-11-07.data.txt`; the production-code check: `docs/review-bounded-path-production-check-2026-11-07.data.txt`.)

The production code against #501's recording (the 3-ply enumeration with the recorded boneyard orders), all 501: non-Best top move 92.4% [87.3, 96.6], grade 89.0% [83.1, 94.1], kappa 0.79; against the complete enumeration under the shipped code's own seed (the same boneyard orders): top move **97.5% [94.2, 100.0]**, grade **95.0% [90.9, 98.3]**, kappa 0.90 (held-out: 100.0% and 95.7%; tuning: 95.9% and 94.6%). Between the two: a complete enumeration under a different seed agrees with the recording on only 87.3% [81.4, 93.2] of non-Best grades.

**What this means (measured), and what it changes in #501:**

1. **There is a noise floor that no method can beat: about 84% of non-Best grades, 93% of non-Best top moves** (a complete enumeration against itself with another seed). It comes from the boneyard order, which a hand enumeration does not average over. Every "agreement with the truth" figure of #501 is capped by it.
2. **#501's headline "bounded 95.7% vs production 78.7%" was not a like-for-like comparison.** It compared the bounded path with the recorded enumeration it replays (same boneyard orders, so only hand sampling differs) and production with that recording (different boneyard orders, so hand sampling plus the floor). Compared fairly, **the bounded path and production are indistinguishable on agreement**: against a full enumeration with another seed the bounded path gets 83.2% / 79.0% of non-Best grades and production 78.0% / 81.1% / 81.3%; against themselves, 78.6% and 75.8% (the intervals overlap throughout). The honest statement is **"no less accurate within what can be measured here"**, not "more accurate".
3. **What stands, re-measured with the code that would ship:** the cost. Mean 723 to 33 ms (22x), p99 7.3 s to 0.5 s, max 33 s to 1.9 s, no partial result on the corpus. The adoption bar (non-Best grade about 90%, top move about 95%) **is met against the full enumeration of the same seed** (91.3% and 97.6%), and **cannot be met against anything that used other boneyard orders, by anyone** (floor 84% and 93%).
4. **What it points at (guess):** the dominant error is now the boneyard order, not the hand sampling. Averaging two or three boneyard orders per hand (about 2 to 3x the 33 ms) is the lever if the owner wants the grade to be more repeatable than 78 to 84%; it is not in this PR.
5. **Locked yards are unaffected** (no boneyard to draw from: the search is exhaustive to the hand's end), which is why the bounded locked-yard result equals `solveExactEndgame` exactly.


## 5. What this PR builds, requirement by requirement

| Owner requirement | Where, and how |
|---|---|
| Behind a flag, off by default; no behaviour change when off | Server `REVIEW_BOUNDED_EXACT_ENABLED` (section 1). Engine option `boundedExact` of `adaptiveEvaluateReviewPosition` is absent by default. Byte-identity test: `devtools/boundedExactFlagOff.test.ts` against a golden generated on `main` before this change |
| Depth is a parameter, recorded in `search.depth` | `BoundedExactOptions.plyDepth` (default 3, `BOUNDED_EXACT_PLY_DEPTH`); `evaluation.search.depth` and `boundedSearch.plyDepth` carry it (0 for a locked yard, which is searched to the hand's end, as `solveExactEndgame` does) |
| Seeded without-replacement permutation keyed by decisionId | `boundedExactSeed(snapshot)` = `bounded-exact-v1:<decisionId>`; `handOrder` is a seeded shuffle of the distinct hands, each exactly once; recorded as `boundedSearch.orderSeed` |
| A completed run equals full enumeration exactly | Tested against an independent brute force (lexicographic order, no engine, exact integer sums): every candidate value, the best and the loss are equal with `toBe`, the interval is exactly zero. Also tested for positions with at most 20 hands, which complete without being forced to |
| `partial=true` plus a confidence interval on capped results | `boundedSearch.partial` and `boundedSearch.lossInterval` (95%, Student-t multiplier below 30 hands, finite-population corrected, so it is exactly zero when every hand was seen; an unbounded side is 1,000,000 because JSON cannot carry Infinity). A run that saw one hand reports an unbounded interval, never a confident-looking zero width |
| 1,000,000-node cap for locked-yard outliers | `BOUNDED_LOCKED_YARD_NODE_CAP`; `lockedYardNodeCap` option. Locked yards visit the allocations in the seeded random order (so a capped answer is an unbiased sample, not a lexicographic prefix) under the shared node budget. Tested on the corpus outlier (8.6 million nodes to finish): stops at the cap, `partial=true`, label "search" |
| A partial result gets a severity badge only if its interval lies inside one grade band | `severityBadgeAllowed` (review-engine) applied inside `lossBandLabelForEvaluation` (`client/src/analyzer/gameAccuracyModel.ts`), which every badge path calls (`presentedLabelForEvaluation`, `useMoveHeuristicClassification`, `pivotalTurnSelector`, `reviewPresentationRecord`). A finished or resolved bounded result is never held back |
| `evidence.source` stays `'search'` (never `'exact'`) | Every midgame bounded result is `search` / `medium` / "Review Engine search", partial or not. **One deliberate exception to flag:** a locked-yard decision that finishes under the cap is the exact solver's answer (identical candidates, nodes and samples, tested) and keeps today's `exact` / "Exact analysis" label; a locked-yard decision cut by the cap is relabelled `search` (it is not exact), which is the label rule #501 Q4 asked for. This changes the label on about 1 decision in 840 (the corpus outlier) and only with the flag on |
| Additive optional field in the review contract, `reviewEngineVersion` bumped | `ReviewEvaluationV1.boundedSearch?` in `packages/game-core/src/reviewContracts.ts`; `REVIEW_ENGINE_CONTRACT_VERSION` `review-engine-v1` to `review-engine-v2`. What the bump does: section 6 |
| Second opinion still runs on bounded results | Bounded midgame results keep `source: 'search'` with tiles left to draw, the two conditions of `secondOpinion.ts:51` and `:53`; `withSecondOpinion` runs in `adaptiveEvaluateReviewPosition` exactly as before. Tested: whenever the unbounded path attaches one, the bounded path does too; none in the live phase |

Other behaviour of the bounded path (the tuned rule of #501 Step 3): sequential stopping after 20 hands, checked every 10, on the interval of (best minus played) (inside one grade band or half-width under 0.15 at z = 2.58) and of the top-move margin; candidate racing at 99% (the best and the played move are never dropped); no wall-clock input to the verdict (only hand and node caps; the shared 1,800,000 ms ceiling of the branch it replaces still applies and is reported as `wall-clock` with the usual diagnostic). Positions outside the branch (no feasible hand, or more than 8,000 distinct hands: the ladder) are untouched by the option.

**Also in this PR:** `/health` reports `reviewBoundedExact`; the decision log line gains `boundedStop` and `boundedHands` when (and only when) the evaluation is bounded; `devtools/boundedExactSolver.ts` (the offline study layer of #501) is now a thin layer over the production engine, so the studies and the shipped code are one engine; client test fixtures that hard-code the engine version moved to `review-engine-v2`; the bundle ratchet baseline moved (+8.1 kB in the `analyzer` chunk, +8.8 kB total of 3.44 MB: the review worker bundles `adaptiveEvaluateReviewPosition`, which now imports the bounded module; the client never enables it).

## 6. What the `reviewEngineVersion` bump does

*Read from code. The owner asked for every place that persists or compares the version, before bumping.* **Short answer: a bump invalidates nothing and re-runs nothing. Existing saved reviews keep opening unchanged. The only consequence is that a review saved after deploy is stored under a new key, so a game reviewed under both versions would have two rows.**

Where the version lives:

| Place | What it does with the version | Effect of v1 to v2 |
|---|---|---|
| `packages/game-core/src/reviewContracts.ts:23` (`REVIEW_ENGINE_CONTRACT_VERSION`) | stamped on every new snapshot (`:635`) and copied from the snapshot onto the evaluation (`evaluateReviewPosition.ts:100,130`, `solveHeuristicOpening.ts:542`, `boundedExactSearch.ts`) | new captures say v2; a stored snapshot or evaluation keeps the version it was captured with |
| `reviewContracts.ts:511` inside `canonicalizeReviewPositionSemantics`, hashed by `computePublicPositionHash` (`:569`, used at `:678`) | the version is part of the canonical text, so it is part of `integrity.positionHash` | the same position captured under v2 hashes to a different `positionHash` than under v1. Nothing compares hashes across versions: `adaptiveEvaluateReviewPosition.ts:180` and `durableReviewCompletionRuntime.ts:346` read the hash the snapshot already carries (or compute it from that same snapshot, consistently), and it is only echoed into job and evaluation provenance. A job in flight at deploy completes with v1 snapshots and v1 hashes |
| `game_reviews.review_engine_version` and the unique index `idx_game_reviews_idempotency (user_id, game_digest, review_engine_version, accuracy_model_version)` (`supabase/migrations/2026-09-17_game_reviews.sql:52-53`), written with `on_conflict=user_id,game_digest,review_engine_version,accuracy_model_version` (`server/src/reviewPersistence/insertGameReviewIdempotent.ts:33`) | part of the idempotency key | **a save after deploy inserts a new row; it does not overwrite the old one.** A client retrying a pre-deploy v1 payload conflicts with its own v1 row and is a no-op. A game saved under both versions (an old game reviewed again after deploy) has two rows |
| reads: `queryLatestGameReview` (`server/src/reviewPersistence/queryLatestGameReview.ts:72-79`: `order=created_at.desc&limit=1`), `queryGameReviewById`, `queryRecentGameReviews` | **no filter on the version** | an old v1 review is returned exactly as before; where two rows exist the newest wins. Nothing treats a v1 row as stale |
| `review_completion_jobs` unique `(user_id, game_digest)` (`supabase/migrations/2026-09-23_review_completion_jobs.sql:29-30`) | the version is not in the key | an existing job for a game is not re-queued or re-run by the bump |
| `computeGameDigest` (`client/src/modules/review/gameDigest.ts:21`) | hashes each decision's `authorityPostStateDigest`, not the version | the digest of a game is unchanged, so de-duplication by digest is unaffected |
| `server/src/reviewPersistence/gameReviewPayload.ts:77-80` | requires a non-empty string, nothing about its value | accepts v1 and v2 |
| `client/src/modules/review/usePostGamePivotalReview.ts:687,715`, `multiplayerReviewPersistence.ts:27` | send `evaluations[0].reviewEngineVersion` with the save | a review produced from v1 snapshots is saved as v1 |
| the recorded corpus fixtures (`packages/review-engine/fixtures/**/*.jsonl`) | carry `review-engine-v1` in their snapshots | untouched and still evaluated; the version is a type-level literal only (`reviewContracts.ts:97`), nothing checks it at runtime. The flag-off golden shows evaluations of v1 fixtures are byte-identical |

**Not found:** any cache, table, job or UI that invalidates, hides, migrates or re-runs a review because its `reviewEngineVersion` differs from the current one. I searched `reviewEngineVersion`, `review_engine_version`, `review-engine-v` and `REVIEW_ENGINE_CONTRACT_VERSION` across `client/src`, `server/src`, `packages/*/src`, `supabase/` and `docs/`; the hits are the ones above plus tests and fixtures.

**What the owner will observe:** after deploy, (a) new reviews are saved with `review_engine_version = 'review-engine-v2'`; (b) old reviews open as before; (c) in the `game_reviews` table the two values coexist; (d) mixed-version moments during a rolling deploy are harmless for the reasons in the table. **Mixed-version caveat (read from code):** a server on v2 evaluating a v1 snapshot from an in-flight job writes `evaluation.reviewEngineVersion = 'review-engine-v1'` (it copies the snapshot's), so such a game is saved as v1. **TypeScript:** hard-coded `'review-engine-v1'` in typed snapshot literals no longer compile (the type is the literal); four client test files and one test-fixture file were updated.

**Does the bump have to ship with the flag off?** The bump is unconditional (the constant), not behind the flag: it also ships the optional field's type. If the owner would rather not bump until the flag is switched on, the alternative is to keep v1 and add the optional field only (no version change). Nothing in the analysis above makes the bump unsafe; the brief asked for it, so it is in.

## 7. Tests

| Required test | Where |
|---|---|
| Flag off = byte-identical outputs on the recorded corpus | `packages/review-engine/src/devtools/boundedExactFlagOff.test.ts`: 59 decisions (5 forced, 6 cheap locked yards, 40 exact-enumeration, 8 ladder at tier 1) hashed and compared with `fixtures/bounded-exact-flag-off.golden.json`, **generated by `devtools/generateFlagOffGolden.ts` on `origin/main` at `de8d68c4`, the commit before this change** (contract version and the position hash derived from it normalized, nothing else). Both with no option and with `boundedExact: undefined` (what the server passes when the flag is off). With the option on, 46 of the 59 hashes differ (the 40 exact and 6 locked decisions gain the new field, the 13 others are untouched), so the test would notice a leak |
| A completed bounded run equals full enumeration exactly | `devtools/boundedExactSearch.test.ts`: independent brute force, `toBe` equality of every candidate value, the best, the loss; interval exactly zero; also the <= 20-hand case; locked yard equals `solveExactEndgame` (candidates, nodes, samples, label) |
| Partial results carry `partial=true` and an interval; severity badge only inside one band | same file (`cap`, single hand, wall-clock ceiling, `severityBadgeAllowed` over every band and edge) and `client/src/analyzer/gameAccuracyModel.test.ts` (the badge function: inside one band shows, two bands none, finished never held back) |
| `evidence.source` stays `'search'` | same file: finished, capped and resolved results; plus locked-yard capped results |
| Second opinion still runs on bounded results | same file, through `adaptiveEvaluateReviewPosition`; and `server/src/reviewCompletion/reviewBoundedExactFlag.test.ts` through the real search worker thread |
| The 1,000,000-node cap path | same file: the constant, a small cap, and the corpus outlier under the default cap (it stops at about 1,000,000 nodes, partial, with a finite valid interval) |
| The flag | `reviewBoundedExactFlag.test.ts` (off unless exactly `true`; off passes the same options object; on adds `boundedExact`; registered in the env schema; the real worker returns a bounded evaluation only when on), `registerHealthRoutes.test.ts` (`/health`), the existing `envSchema.test.ts` |

## 8. Limits and guesses

- **Measured, bot play only:** every number comes from two bot policies on a laptop. Human games have more non-Best moves and other hand shapes (guess).
- **Measured:** the production-code check (section 4) used the same 501 exact-path decisions that tuned the rule; the held-out split is 47 non-Best decisions, so its intervals are wide.
- **Read from code:** coverage on a bounded result is now the share of distinct hands visited (honest, 40% on average), not the 63% the draws gave; the only consumers are diagnostics (`logReviewWorkerBatchDiagnostics.ts:28`, the adaptive ladder's own fall-through at `adaptiveEvaluateReviewPosition.ts:491`).
- **Read from code:** the accuracy number uses the point estimate of the loss (`computeGameAccuracyModel`), also for a partial result; only the badge is held back. Partial results are rare (none of the 501 exact-path decisions; 1 of 19 locked yards).
- **Guess:** the 40x slowdown that turns a 1,000,000-node cap into the 180 s kill; the cap is a node count, so it behaves identically on any machine, only the seconds it corresponds to are a guess.
- **Not done:** the ladder (more than 8,000 hands) is unchanged; a 3-ply or bounded ladder is the owner's decision after section 2.

## 9. Reproduce

```
npx tsx packages/review-engine/src/devtools/recordLadderPass.ts <out.jsonl> <shard> <shards> 100000 2500      # pre-report 1 and the ladder half of 2
npx tsx packages/review-engine/src/devtools/boundedPathPrereport.ts <ladder.jsonl>... -- <exact3.jsonl>... -- <exact2.jsonl>...
npx tsx packages/review-engine/src/devtools/boundedPathProductionCheck.ts <exact3.jsonl>...                   # the shipped code against the recorded 3-ply enumeration
npx tsx packages/review-engine/src/devtools/boundedPathRepeatability.ts <shard> <shards> <out.jsonl>          # section 4
npx tsx packages/review-engine/src/devtools/boundedPathRepeatabilitySummary.ts <rep.jsonl>...
npx tsx packages/review-engine/src/devtools/generateFlagOffGolden.ts > golden.json                           # run on the commit BEFORE this change
```
(`exact3` and `exact2` are the recordings of `recordExactPass.ts`, see `docs/review-bounded-exact-2026-11-07.md`.)
