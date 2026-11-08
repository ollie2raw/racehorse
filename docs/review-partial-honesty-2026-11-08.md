# Honest labelling of cut review verdicts (REVIEW_CUT_HONESTY_ENABLED)

2026-11-08. A small PR from the findings of `docs/review-single-depth-design-2026-11-08.md` section 4.3. **Off by default; with the flag off every output is what it was** (the flag-off golden of #502 still passes, and a new test compares a cut result with and without the option). Laptop measurements, bot play only; each statement is labelled *measured*, *read from code* or *guess*.

## 1. The defect (read from code; production facts from #503)

On the free Render instance (about 0.15 CPU, roughly 45 times slower than the laptop) a decision can be cut short by the wall-clock ceiling (tier 1: 2,000 ms) or by a node budget. A real game had 4 ceiling hits, each solved from 45 hidden hands instead of the 100 asked for. What the engine did with such a result:

- It kept the verdict and set `search.complete = false`; the player-facing label did not change. `lossBandLabelForEvaluation` draws the badge from the loss alone, and the header shows `{displayLabel} · {confidence} confidence`, so a cut verdict read "Review Engine search · medium confidence" with a full severity badge, exactly like an uncut one. `search.complete` is read only by server logs and one owner-only metric.
- For 32 to 49 hands the convergence gate accepted the result as `stability-converged` **with no test behind it**: the stability comparison needs the halfway checkpoint (sample 50 of 100), a run cut before it keeps the defaults (`sameTopAction: true`, deltas 0), and those pass.
- A locked-yard decision (the exact solver) that was cut still shipped as "Exact analysis, high confidence": the solver averages over the allocations solved so far (and over none, every value 0, if it solved none).

## 2. What changes with the flag on

1. **A cut sampled verdict carries `partialSearch`** (additive and optional): `partial: true`, `reason` (`wall-clock` or `budget`), `samplesSolved` of `samplesRequested`, and a 95% `lossInterval` of the played move's loss.
2. **The badge rule.** A severity badge (or "Best") is shown for it only when that interval lies inside one grade band (`severityBadgeAllowed`, the rule #502 introduced for capped locked yards, extended to this field). Otherwise the evidence confidence drops to `low` (the header then reads "Review Engine search · low confidence") and there is no badge; the presentation record treats a null label as qualitative (no loss figure, no severity word), and `assertPresentationConsistency` and the corpus consistency test still pass.
3. **The vacuous window is closed.** A run cut before its halfway sample is no longer accepted as `stability-converged`; it is accepted as `partial-interval` (new convergence reason), and the interval above is the evidence. It is still accepted, not sent to the heuristic: a verdict with an honest interval is more useful than none.
4. **A cut locked-yard `exact` result** gains `partialSearch` with an **unbounded** interval, so no badge (not even "Best") is shown for it. A forced decision (one legal action) is left alone: it has no verdict to mislead.
5. Second opinion still runs on every one of these results (it is attached after this step, unchanged).

Nothing changes for a result that ran to its sample budget, nor for one whose run merely finished past the ceiling (all requested hands solved): those are returned byte-identical (tested).

## 3. The interval (and its limits)

The sampler used to keep only per-action totals, which carry no variance. With the option on it also accumulates, per action `a`, the sum and sum of squares of `value(a) - value(played)` over the hands solved (`PairedSampleStats`, a new optional field of the sampler's own result; off by default, so a default call returns what it always did). The true loss is `L = max(0, max_a mu_a)`, where `mu_a` is the mean paired advantage of `a` over the played move; each `mu_a` gets a normal 95% interval and the interval for `L` is `[max(0, largest lower bound), max(0, largest upper bound)]`. With fewer than 2 hands: `[0, 1,000,000]` (unbounded, as in #502).

Limits (*read from code / guess*):
- A normal approximation at tens of hands (here 33 to 94 for tier 1). Fine at 30+; it is only a guess how it behaves at 8 to 30 (those results are not accepted by the convergence gate anyway).
- The largest upper bound over the alternatives is conservative; the largest lower bound is *selected* (the maximum of several noisy bounds is biased upward), so an interval can be a little too eager to sit above 0. Not corrected for multiple comparisons.
- The sampler draws hands with replacement, so no finite-population correction applies (unlike #502's without-replacement path).
- The locked-yard exact solver enumerates in a fixed order, not a random one, so no honest finite interval exists for it: hence unbounded.

## 4. Enabling it

Set `REVIEW_CUT_HONESTY_ENABLED` to exactly `true` on the Render server and restart; `GET /health` then shows `reviewCutHonesty: true`. To roll back, unset it and restart. The worker logs `partialReason`, `partialSamples` and `partialInterval` for each cut decision, so the next real game shows what it did. No migration, no client release (the badge rule is in the client bundle already shipped with this PR; a client older than this PR ignores the new field and shows the badge as before). The flag composes with `REVIEW_BOUNDED_EXACT_ENABLED` and `REVIEW_SWEEP_ENABLED` (the kill switch is untouched).

## 5. Contract and version (read from code)

`partialSearch` is an additive optional field of `ReviewEvaluationV1`, like #502's `boundedSearch`. **`REVIEW_ENGINE_CONTRACT_VERSION` is not bumped** (still `review-engine-v2`). Reason: #502 bumped it because its type gained a field, but the version string is part of the canonical snapshot serialization, so a bump changes the position hash of every snapshot captured afterwards (nothing is invalidated or re-run; reads do not filter by version; see #502's analysis) and gains nothing here: the field only exists when the flag is on, v2 consumers ignore unknown optional fields, and older saved evaluations simply lack it. If you prefer one bump per added field, it is a one-line change in `packages/game-core/src/reviewContracts.ts` (the flag-off golden normalizes the version string, so it would still pass); say so and I will make it. *This departs from "bump with every additive field" and is yours to overrule.*

## 6. Tests (which fail on main)

`packages/review-engine/src/devtools/cutHonesty.test.ts` (18), `client/src/analyzer/gameAccuracyModel.test.ts` (4 new), `server/src/reviewCompletion/reviewCutHonestyFlag.test.ts` (5) and a case in `registerHealthRoutes.test.ts`. Run against main's versions of the changed source files (measured): 6 of the 17 engine tests that existed at that point fail (the new-behaviour ones: cut with a spanning interval has no badge and confidence low; cut with an interval inside one band keeps its badge with `partial = true`; the wall-clock cut carries `partialSearch`; the cut before the halfway sample is `partial-interval`; the requireCheckpoint gate; the cut locked yard); 2 of the 4 new client tests fail (the others assert "no change when the field is absent" and pass on purpose), and the new health test fails. The tests that document today's defect, the flag-off equalities and the math of the new module pass on both (by design). Real corpus positions (bot play), cut by a node budget that leaves about 50 of 100 hands solved, plus a deterministic fake clock for the wall-clock cut.

## 7. Measured: what changes under a simulated 40x slowdown

Method (*measured*): every decision of the 10 recorded games (1,212 decisions, 840 with a badge today) through `adaptiveEvaluateReviewPosition` exactly as the server calls it (completion phase, second opinion on), every wall-clock ceiling divided by 40 (#503's emulation; the real ratio is about 45), flag on. One run gives both sides: with the option on, the search and its acceptance are the ones that run today, so **today's badge is the label of the same evaluation with `partialSearch` removed**. `devtools/cutHonestyEmulation.ts`, `cutHonestySummary.ts`; data in `review-partial-honesty-2026-11-08.data.txt` (summary) and `.cut-rows.jsonl` (the cut decisions).

| measure | count | share |
|---|---:|---:|
| decisions cut short | 26 (24 sampled, 2 locked-yard) | 2.1% of 1,212; 2.9% of the 840 with a badge |
| cut by the ceiling / by a node budget | 25 / 1 | |
| **badges that disappear** | **1** | **0.1% of badged decisions (1 of 840); 4.2% of the cut ones (1 of 24)** |
| any other badge change | 0 | |
| results dropped to confidence `low` | 1 | |
| cut before the halfway sample, accepted as `partial-interval` | 8 | 7 of them keep their badge |

Transitions: Best 546 to Best, Mistake 116 to Mistake, Good 104 to Good, Inaccuracy 65 to Inaccuracy, Blunder 8 to Blunder, **Inaccuracy to no badge 1**. The one lost badge: `demo-strong-policy-1:2#86`, tier 1, 36 of 100 hands, loss 0.53, interval [0.00, 1.73], which spans Best, Inaccuracy and Mistake. Of the 24 cut sampled results: 17 tier 1 (33 to 94 hands of 100), 6 tier 2 (578 to 1,770 of 2,500) and 1 in the exact-enumeration ladder; 17 of the 24 have a zero-width interval (every alternative clearly behind, or all hands agree).

**Today** (flag off): all 24 cut verdicts with a badge ship with it and with "medium confidence", nothing marking them as cut; 0 badges change.

Reading (*measured*, then *guess*): on this corpus the rule is gentle. A cut verdict is usually decisive (most intervals are narrow and inside one band), so only about 1 cut verdict in 24 loses its badge, 0.1% of all badges. The larger effect is that **every cut verdict is now machine-readable** (`partial = true`, an interval, the reason) and 8 acceptances no longer pretend to a stability test. Whether 40x is a good model of the production machine is a *guess*: the real game had 4 hits in 64 decisions, the emulation 1.1 per seat on average (#503). Two of the 26 rows were forced locked-yard decisions that carried the marker in the run; the final code skips forced decisions (tested), which changes no badge number.

## 8. Left alone (listed, not fixed)

- **The header text of a cut locked-yard result** still reads "Exact analysis, high confidence": the evidence type is a literal union in the contract (`exact` / `high` / "Exact analysis"), so changing it is a non-additive contract change. The badge is withheld; the text is not. Needs a decision.
- **The accuracy percentage** still counts a cut decision at its point estimate of the loss (review-engine's `gameAccuracyModel`, which works from the loss, not the label).
- **No visible "cut short" mark in the UI** beyond "low confidence" and the missing badge. A short note on the card ("analysis was cut short") is a small client change; held back so this PR stays small.
- **The ceiling is checked coarsely** (production tier-1 decisions with 45 hands took 2.4 to 5.7 s against a 2 s ceiling): not changed, as instructed (no budget changes).
- The owner-only `avgMoveQuality` already withholds a game with any ceiling hit (`reviewedMoveQuality.ts:127`); unchanged.

## 9. Re-running

```
npx vitest run src/devtools/cutHonesty.test.ts            # in packages/review-engine
npx tsx packages/review-engine/src/devtools/cutHonestyEmulation.ts out.jsonl 0 1 40    # about 15 minutes on a laptop shared with another job, one niced shard
npx tsx packages/review-engine/src/devtools/cutHonestySummary.ts out.md out.jsonl
```
