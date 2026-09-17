# Phase C0 — Accuracy Model Spec

**Status:** Draft, C0 deliverable. No code, no UI, no calibrated constants.
**Parent doc:** `docs/scoping/game-review-oracle-upgrade-2026-09-13.md`, Phase C section.
**Purpose:** this is the contract `C1` (`accuracyFromEvaluations`) is built against. Every field name below was checked against the real, current code on `main` as of this writing — not the parent doc's illustrative sketch — and any place the real code has diverged from that sketch is called out explicitly in its own section at the end.

Phase B (Oracle) and Phase D (Coaching) are unaffected by this document and do not depend on it. Nothing here changes `moveAnalyzer.ts`'s existing legacy scoring, which stays live and untouched until `C4` actually cuts over.

---

## 1. Loss definition

**Quantity:** expected final point differential, from `ReviewEvaluationV1.loss.expectedPointDifferential`. Win probability (`ReviewEvaluationV1.loss.winProbability`) is a secondary signal, used only when present.

**Exact real shape today** (`packages/game-core/src/reviewContracts.ts`):

```ts
readonly loss: {
  readonly expectedPointDifferential: number;
  readonly winProbability: number | null;
};
```

Both fields are **always present as keys** — `winProbability` is typed `number | null`, not an optional key. This differs from a literal reading of the parent doc's design sketch, which listed `winProbability?` (optional key) on the *coaching facts* object (`ReviewCoachingFacts.deltas`), not on `ReviewEvaluationV1.loss` itself. D0 (`reviewCoachingFacts.ts`) already resolved this exact ambiguity for its own purposes — it omits the `winProbability` key from `ReviewCoachingFacts.deltas` when the source value is `null`, and includes it only when real. **C1 follows the same convention**: treat `loss.winProbability === null` as "not provided by this tier," never as `0`, and never impute a value.

**Where `expectedPointDifferential` is a real, non-placeholder number** (traced directly in the solver source, not assumed from a doc comment):

- `solveExactEndgame.ts`: `expectedPointDifferential: totals[index] / solvedAllocations` — a true average over exhaustively enumerated feasible hidden-hand allocations, played out to real hand-end score differentials.
- `solveMidgameDeterminization.ts`: `expectedPointDifferential: totals[index] / solvedCount` — a true average over sampled determinizations to the search's cutoff depth (`maxPlyDepth`). Real, not a placeholder — but a truncated-depth estimate, not a full-hand playout like the exact tier.
- `solveHeuristicOpening.ts` (heuristic tier): `value.expectedPointDifferential` is **always `0` by design** — not a real point-differential estimate at all (confirmed already in D0's own code comments, unchanged here). `loss.expectedPointDifferential` for a heuristic-tier decision is therefore always `0 - 0 = 0` and **must never be treated as a real loss value**. This is exactly why heuristic-tier decisions are excluded from the aggregate entirely (§2) rather than contributing a real-but-small loss.

**Move loss, as C1 will compute it, per decision:**

```
moveLoss = evaluation.loss.expectedPointDifferential
```

No further transformation at this stage — `loss` is already `best.value.expectedPointDifferential − played.value.expectedPointDifferential` (computed once, in `evaluateReviewPosition.ts`'s `computeLoss`, confirmed identical on both the exact and search dispatch branches). C1 does not need to re-derive it from `played`/`best`/`candidates` itself; it reads the precomputed field.

---

## 2. Exclusion rules

Two categories are excluded from the headline accuracy aggregate. Both use the **same mechanic** — excluded from the denominator entirely, not scored as some neutral placeholder value — so the spec and the eventual implementation only need one exclusion code path, not two.

### 2a. Forced / no-choice decisions

**Rule: excluded from the denominator.** Not scored `100`, not scored at all.

**Justification:** a `100`-and-included approach would let a hand with many forced positions inflate a player's accuracy for reasons that have nothing to do with their decision quality — a different but equally artificial distortion to the "80-cap penalty" the parent doc is retiring. Denominator-exclusion means forced decisions genuinely don't move the number in either direction, which is the actual meaning of "no decision to be accurate or inaccurate about." It also means forced and heuristic-only decisions (§2b) share one exclusion mechanic instead of two, which keeps `accuracyFromEvaluations` simpler to implement and to test (one "is this decision scorable at all" predicate, not two different neutral-value conventions).

**Detection — reuses existing, tested logic, does not reinvent it:**

```ts
import { dedupeCandidatesByTile } from '../analyzer/classifyHeuristicResult';
// forced when:
dedupeCandidatesByTile(evaluation.candidates).length === 1
```

This is the exact same primitive D0's `buildReviewCoachingFacts` already uses for its own `missKind: 'forced'` classification (`reviewCoachingFacts.ts`) — not a new detection path. Equivalently, if a `ReviewCoachingFacts` object has already been built for that decision (as D2's coaching panel already does per-move), C1 may just check `facts.missKind === 'forced'` directly rather than recomputing `dedupeCandidatesByTile` itself. Either is correct; they're the same underlying computation.

### 2b. Heuristic-only decisions

**Rule: excluded from the headline accuracy denominator entirely**, shown separately as "Fritz's read" (per the parent doc's own wording — this UI treatment already exists today, unrelated to C-phase work: `evidence.displayLabel` is literally `'Heuristic estimate'` for this tier already).

**Detection:**

```ts
evaluation.evidence.source === 'heuristic'
```

Read directly off `ReviewEvaluationEvidence` (`packages/game-core/src/reviewContracts.ts`), the real, already-shipped discriminated union:

```ts
export type ReviewEvaluationEvidence =
  | { readonly source: 'exact'; readonly confidence: 'high'; readonly displayLabel: 'Exact analysis' }
  | { readonly source: 'search'; readonly confidence: 'high' | 'medium' | 'low'; readonly displayLabel: 'Review Engine search' }
  | { readonly source: 'heuristic'; readonly confidence: 'low'; readonly displayLabel: 'Heuristic estimate' };
```

**No separate confidence/coverage check is needed.** The parent doc's layering table says search-tier results should only count toward headline accuracy "if coverage ≥ threshold." Verified directly in `evaluateReviewPosition.ts`'s real dispatcher: a search result whose `coverage` falls below `coverageThreshold` is **already routed to the heuristic fallback path** by the dispatcher itself (`heuristicFallbackReason: 'coverage-below-threshold'`), before `evaluateReviewPosition` ever returns. That means **any** `ReviewEvaluationV1` that comes back with `evidence.source !== 'heuristic'` has, by construction, already cleared the coverage gate — checking `evidence.source` alone is sufficient and correctly implements the doc's coverage rule; C1 does not need to independently re-check `search.coverage` or `evidence.confidence`.

### Summary predicate

```ts
function isScorable(evaluation: ReviewEvaluationV1, candidates: readonly ReviewCandidateEvaluationV1[]): boolean {
  const forced = dedupeCandidatesByTile(candidates).length === 1;
  const heuristicOnly = evaluation.evidence.source === 'heuristic';
  return !forced && !heuristicOnly;
}
```

`accuracyFromEvaluations` computes its aggregate only over decisions where `isScorable` is true. Denominator = count of scorable decisions. If the denominator is `0` (every decision in scope was forced or heuristic-only), C1 returns "no scorable decisions" rather than fabricating a `0` or `100` — this is a real edge case (a very short hand, or a hand played entirely in the opening/high-uncertainty zone) and must be representable, not silently defaulted.

---

## 3. Aggregate mapping

**Aggregation basis: mean loss over scorable decisions, not sum.**

Justification: sum would scale with hand/game length in a way that has nothing to do with decision quality — a longer hand with the same *average* decision quality as a shorter one would score worse under a sum-based aggregate purely because it had more decisions. Mean avoids this and directly continues the legacy system's own convention (`moveAnalyzer.ts`'s existing `accuracy` is already `mean(scores)`), so this is a genuine continuation of an established idea, not a new one.

```
meanLoss = sum(moveLoss for each scorable decision) / scorableDecisionCount
```

**Mapping shape: bounded exponential decay**, monotonically decreasing in `meanLoss`:

```
accuracy = clamp(100 * exp(-k * meanLoss), 0, 100)
```

Where `k` is a single positive free constant, **not fixed here** — `k` is exactly the number C2's calibration harness fits against real loss histograms. This functional form is proposed now, with its free parameter left open, per the instruction that C0 pins the shape, not the numbers.

**Why this shape, concretely:**

- **Monotonic by construction**: `d(accuracy)/d(meanLoss) = -100k * exp(-k * meanLoss) < 0` for all `meanLoss ≥ 0` and `k > 0` — no piecewise seams to separately prove monotonic, one continuous derivative check covers the whole domain.
- **Naturally bounded**: `meanLoss = 0` (played the top-scoring line every scorable decision) → `accuracy = 100` exactly, satisfying the "optimal-game ceiling" acceptance test C2 must publish, with no separate clamp-at-the-top logic needed. As `meanLoss → ∞`, `accuracy → 0` asymptotically; the explicit `clamp(..., 0, 100)` exists only to guard float error at the tail, not to do real work.
- **One free parameter**: a single `k` is the entire calibration surface C2 has to fit (versus a piecewise function's multiple breakpoints-plus-slopes) — smaller, more falsifiable calibration target, and easier to version (`accuracyModelVersion` bumps whenever `k` — or the functional form itself — changes).
- **Precedented pattern**: this is the same general shape (bounded exponential decay of a loss quantity) used by established move-accuracy tools in other turn-based games, so it's a well-understood family to calibrate against, not a novel invention this project would be validating from zero.

`accuracyModelVersion` is a plain string constant (mirroring `reviewEngineVersion`'s own convention) that C1 stamps onto its output whenever `k` or the functional form changes — never silently.

**This section does not ship a value for `k`.** C2 fits it against the fixture-corpus + recorded-log loss histograms (§5) and its own acceptance tests are what actually justifies a specific number.

---

## 4. Label bands

Labels are derived from `moveLoss` (§1) plus context — never treated as synonyms for "matched the exact-tier candidate," per the parent doc's explicit instruction.

### 4a. Loss-band labels (Best / Inaccuracy / Mistake / Blunder)

These are **ordinal bands over `moveLoss`**, boundaries calibrated by C2 against the same histograms as `k` (§3) — not fixed here:

| Label | Condition (shape, not numbers) |
|---|---|
| **Best** | `moveLoss` within a small, calibrated tolerance of `0` (i.e., "within search tolerance of top," per the parent doc — a tolerance band, not `moveLoss === 0` exactly, since floating-point solver output and truncated-depth search estimates should not require bit-exact equality to count as "the top line") |
| **Inaccuracy** | `moveLoss` above the Best tolerance, below a calibrated Inaccuracy→Mistake boundary |
| **Mistake** | `moveLoss` above the Inaccuracy boundary, below a calibrated Mistake→Blunder boundary |
| **Blunder** | `moveLoss` above the Mistake boundary |

Three calibrated boundary constants (`bestTolerance`, `inaccuracyToMistake`, `mistakeToBlunder`) are C2's job, versioned under the same `accuracyModelVersion` as `k`. **This spec fixes that there are three boundaries producing four ordinal bands** — it does not fix where they sit.

These labels only apply to **scorable** decisions (§2) — a forced or heuristic-only decision gets no loss-band label at all (it's excluded from the aggregate, and per D1's own established convention, `ReviewCoachingFacts.missKind`/prose already covers "forced" and "unknown" honestly without needing a loss-band label layered on top).

### 4b. Positive tags (Brilliant / Great)

**Explicitly not "matched the top candidate."** Per the parent doc: these require **uniqueness**, **sacrifice**, or **swing**. This section pins down what real, already-available data each of those three would be detected from — detection logic itself is not built in C0, but the data dependency is fixed here so C1/C2 aren't left guessing later.

- **Uniqueness** — the played move (`moveLoss` ≈ 0, i.e. it's a `Best`-band decision) was the *only* real good option: the gap between the best candidate's value and the **second-best** candidate's value is unusually large. Data needed: `evaluation.candidates[].value.expectedPointDifferential` for every candidate (already present, per-candidate, on `ReviewCandidateEvaluationV1` today) — sort by value, compare best-to-second-best gap. No new capture required.
- **Sacrifice** — the played move gave up something measurable *right now* (lower `immediatePoints` than an available alternative) in exchange for a larger overall gain (higher `value.expectedPointDifferential` than that same alternative). Data needed: per-candidate `immediatePoints` **and** `value.expectedPointDifferential` together (both already present on `ReviewCandidateEvaluationV1` today) — compare the played candidate against at least one candidate with strictly higher immediate points but strictly lower overall value.
- **Swing** — the move produced an unusually large shift in the position's evaluated value *relative to the position's own recent trend*, not relative to other candidates at this one decision. This is the one tag that needs data **beyond a single `ReviewEvaluationV1` record**: it requires comparing this decision's resolved value to the **same player's previous decision's** resolved value in the same hand. That comparison is not a new capture requirement — `reviewWorkerBatch.resultsByDecisionId` (already shipped, D2) already holds every resolved `ReviewEvaluationV1` for a hand, keyed by `decisionId`, and `decisionIdByMoveNumber`/`correlateSnapshotsToMoveLog` (already shipped, D0/D2) already provide the move-number ordering needed to find "the same player's previous decision." No new field needs to exist on `ReviewEvaluationV1` itself for this — it's a cross-decision comparison C1/C2 perform over data that's already there.

**Constraint carried from D0/D1's own established discipline, restated here for C1:** uniqueness/sacrifice/swing detection only ever runs on **precise-tier** (`exact`/`search`) evaluations. Heuristic-tier `rawScore` values are explicitly documented (`reviewContracts.ts`) as not real point differentials and must never be compared for magnitude — the same reason `classifyHeuristicResult.ts` coarsens to 3 buckets instead of 6, and the same reason D1's `reply_risk`/`correct` prose only cites real deltas. Brilliant/Great are precise-tier-only tags; a heuristic-tier decision can be `Best`-equivalent (`missKind: 'correct'`, per D0) but never `Brilliant`/`Great`.

---

## 5. Calibration process

Restated in structured form from the parent doc's own process description (not copy-pasted):

1. **Freeze** `engineVersion` (review-engine's own version string) and `accuracyModelVersion` (this model's version string) together — a calibration run is only valid for one exact pairing of the two.
2. **Compute loss histograms** — run every fixture in the categories below (plus any recorded self-play logs) through the real, current `evaluateReviewPosition` dispatcher at the frozen `engineVersion`, collect `moveLoss` (§1) for every scorable decision (§2), bucket into a histogram per category.
3. **Fit the monotonic map** — solve for `k` (§3) and the three loss-band boundaries (§4a) against the combined histograms.
4. **Publish acceptance tests**, checked into the repo as real, running tests (not just a report):
   - **Monotonicity**: `accuracyFromEvaluations` never returns a higher score for a strictly worse set of decisions.
   - **Forced-move invariance**: adding or removing forced decisions from an evaluation set never changes the resulting accuracy (proves the denominator-exclusion in §2a is actually wired correctly, not just specified).
   - **Optimal-game ceiling**: an evaluation set where every scorable decision has `moveLoss = 0` produces `accuracy = 100` exactly.
   - **Poor-play floor**: a deliberately-poor/random-legal evaluation set produces a score meaningfully separated from the optimal-game ceiling, with no floor inflation (i.e., "everyone gets at least a 60" is exactly the failure mode this test exists to catch).
5. **Product/data review** signs off on the *observed* distribution (not just that the tests pass) before any UI is allowed to claim a percentage. This is a human checkpoint, not an automatable one — it exists because a monotonic, passing-all-tests model can still be miscalibrated in a way no unit test catches (e.g., everything landing in a narrow 70–95 band that doesn't feel like it differentiates play quality).

### Real gap check: which fixture categories already exist

The parent doc names five categories C2 needs. Checked directly against `packages/game-core/src/reviewFixtureCorpus.ts` as it exists today (9 fixtures total, spanning 8 `ReviewFixtureCategory` values: `opening`, `scoring_chain`, `forced_move`, `block`, `nested_branches`, `near_win_defense`, `hidden_information_ambiguity`, `exact_endgame`):

| Doc's C2 category | Exists today? | Evidence |
|---|---|---|
| Oracle self-play / exact-endgame fixtures | **Partial.** `exact_endgame` category exists (`locked-yard-five-tile-endgame`, `locked-yard-feasible-endgame`) — but these are single hand-crafted *positions*, not a full **self-played game** using the oracle's own best move repeatedly. "Exact-endgame position" coverage exists; "oracle self-play trajectory" coverage does not. |
| Strong policy play (Master Fritz without tier noise, recorded) | **Does not exist.** No fixture or recorded-log source matches this — the corpus is entirely hand-constructed synthetic positions (`FixtureStrategy: 'first_legal' | 'branch_builder'`), not recorded real play at any tier. |
| Ordinary PVF-tier play | **Does not exist.** Same reason — no recorded-log ingestion path exists anywhere in the corpus today. |
| Deliberately poor / random-legal play | **Does not exist** as a named category. No fixture is tagged or constructed as "deliberately weak" specifically. |
| Forced-move fixtures | **Exists.** `forced_move` category, one fixture (`forced-single-play-midgame`). |

**Net: 2 of 5 required categories have any real representation today, and both of those are single synthetic positions, not recorded game trajectories.** C2 cannot be executed as scoped by the parent doc without first building: (a) a way to ingest or record real self-play/PVF-tier logs (a new capture concern, not just new fixtures), and (b) at minimum a "deliberately poor" fixture category. This is a genuine, concrete gap for whoever picks up C2 — not a formality this spec is glossing over.

---

## 6. C4's cutover condition, made concrete

**Revised 2026-09-17 (C4 follow-up, post-shipping investigation):** the parent doc's original all-or-nothing trigger below shipped in C4, then was investigated against the full 100-game recorded corpus (`packages/review-engine/fixtures/recorded-self-play` + `recorded-client-policy`, spanning `daily-fritz-master` and `pvf-bot-match` standard/hard/master tiers). Finding: **zero of the 100 real games ever reached `status: 'complete'`** under the original trigger. This is structural, not a bug — `evaluateReviewPosition`'s coverage-vs-threshold dispatch (§5) concentrates heuristic-tier fallback at the start of every hand (largest hidden-information space), and a real game replays that worst case once per hand; the original trigger required *zero* heuristic decisions across an *entire* multi-hand game, an AND over 60-90+ decisions that real games never clear. `accuracy`/`grade` are therefore decoupled from `status` below — `status` stays as originally defined (diagnostic only, describing whether *every* non-forced decision was solver-scorable), while `accuracy`/`grade` now populate whenever coverage clears a floor derived from real data, independent of `status`.

The parent doc's original `C4` acceptance: *"Switch `GameAnalysis` accuracy/grade to the new model only when all moves in aggregate have non-heuristic evidence, else show 'partial / Fritz's read'."* This is now superseded by the coverage-floor condition below; kept here for history.

**`status`, precisely (unchanged from the original trigger, now diagnostic-only):** among all decisions in the analyzed scope that are **not forced** (§2a — forced decisions are silently excluded either way and don't affect this check), if **any** decision has `evidence.source === 'heuristic'`, `status` is `'partial'`. Only when **zero** non-forced decisions are heuristic-tier is `status` `'complete'`. `status` no longer gates whether `accuracy`/`grade` populate — see below.

**`coverageFraction`, precisely:** `scorableNonForcedCount / totalNonForcedMoveCount`, where `scorableNonForcedCount` is the count of non-forced decisions that are *not* heuristic-tier (i.e. `totalNonForcedMoveCount - heuristicMoveCount`). `0` when `totalNonForcedMoveCount === 0` (nothing to score). This is the "how much of the game did we actually get to precisely solve" signal, in the direction that reads naturally with a floor comparison (higher is better) — deliberately not a reuse of `heuristicMoveCount`, which runs the opposite direction and was already scoped for a different purpose ("why is this partial").

**`MINIMUM_COVERAGE_FLOOR`, precisely and its derivation:** `accuracy`/`grade` populate whenever `coverageFraction >= MINIMUM_COVERAGE_FLOOR`, regardless of `status`. The floor is `0.46808510638297873` — the 5th percentile of per-game `coverageFraction` across the 100-game recorded corpus (real games from `daily-fritz-master` and `pvf-bot-match` standard/hard/master tiers; corpus snapshot 2026-09-17, same one `accuracyModelCalibration.ts`'s constants are fit against). Distribution observed: min `0.365079`, p5 `0.468085`, p10 `0.485714`, p25 `0.527273`, median `0.561404`, p75 `0.6`, max `0.696970`, mean `0.558783`. The 5th percentile was chosen over the true minimum (which would trivially pass every game seen so far and prove nothing) and over a parametric choice like mean-minus-two-stddev (which assumes normality this 100-game sample doesn't need to justify) — it is a direct, nonparametric statement about the real data: **95% of real games already clear it**, and it still excludes the worst ~5% (games where scorable decisions never reached even roughly half of the reviewable moves) from getting a numeric accuracy stamped on too little real signal. Re-derive from a re-recorded or meaningfully expanded corpus the same way `accuracyModelCalibration.ts`'s constants are re-derived — never by hand-picking a rounder number.

**Revised data shape** — `GameAccuracyModelResult` is now a single flat type, not a discriminated union split on `status`, because `status` no longer determines which fields are present:

```ts
export type GameAccuracyModelResult = {
  readonly status: 'complete' | 'partial'; // diagnostic only -- see above. Does NOT gate accuracy/grade.
  readonly accuracyModelVersion: string;
  readonly accuracy: number | null; // populated whenever coverageFraction >= MINIMUM_COVERAGE_FLOOR
  readonly grade: 'S' | 'A' | 'B' | 'C' | 'D' | null; // derived from the new accuracy, not the legacy one
  /** How many non-forced decisions were heuristic-tier. */
  readonly heuristicMoveCount: number;
  /** Total non-forced (scorable-or-heuristic) decisions in scope, for "X of Y moves" copy. */
  readonly totalNonForcedMoveCount: number;
  /** scorableNonForcedCount / totalNonForcedMoveCount; 0 when totalNonForcedMoveCount is 0. The gate for accuracy/grade above. */
  readonly coverageFraction: number;
};

export type GameAnalysis = {
  // ...existing fields, unchanged...
  /** C4: the new accuracy model's result, additive alongside the legacy accuracy/grade fields above until cutover. */
  accuracyModel?: GameAccuracyModelResult;
};
```

**What a consumer (D2's panel, or any future renderer) does with this, concretely:**

- `accuracyModel === undefined` → this `GameAnalysis` predates C4 shipping (or C4 hasn't shipped yet at all) — render exactly as today, no behavior change.
- `accuracyModel.accuracy !== null` → render the new `accuracy`/`grade` as the headline number, regardless of `status`. `status === 'partial'` alongside a populated `accuracy` is expected and normal (the common case on real data) — it means some decisions were heuristic-tier but coverage was still high enough to trust the aggregate; it is not a reason to suppress the number.
- `accuracyModel.accuracy === null` → render "Partial / Fritz's read" (the parent doc's own words) plus a concrete, real count — e.g. "N of M moves reviewed" using `totalNonForcedMoveCount - heuristicMoveCount` of `totalNonForcedMoveCount` — never a fabricated percentage standing in for the real one. `status` may still be checked here for finer copy (e.g. distinguishing "some coverage, just not enough" from the 0-of-0 "nothing to review" case) but is not required to decide whether to show a number at all.

This section fixes the **contract shape**; it does not implement `accuracyModel`'s population (that's `C4`'s own code, not C0's). No UI work has consumed this shape yet — this revision is still contract + computation only.

---

## 7. Explicitly out of scope for this document

- No code. No new files under `client/src` or `packages/`.
- No calibrated numeric constants — `k` (§3), the three loss-band boundaries (§4a), and any uniqueness/sacrifice/swing thresholds (§4b) are all C2's job, fit against real data, not guessed here.
- No UI changes.
- No changes to `moveAnalyzer.ts`'s existing legacy scoring — `classifyMove`'s `99/92/80/60/38/18` constants, `AnalyzedMove.score`/`.rating`, and `GameAnalysis.accuracy`/`.grade` all stay exactly as they are today until `C4` actually cuts over.

---

## 8. Divergences from the parent doc's original sketch, found while writing this

Checked every field this spec references against the real, current code rather than the parent doc's illustrative type sketch. Two real divergences found:

1. **`winProbability?` (optional key) vs. `winProbability: number | null` (always-present, nullable key).** The parent doc's `ReviewCoachingFacts` design sketch showed `winProbability?` as an optional field on the *facts* object. The real `ReviewEvaluationV1.loss.winProbability` field is always present as a key, typed `number | null` — never actually optional at that layer. D0 already made the correct call for its own object (omit the key on `ReviewCoachingFacts.deltas` when the source is `null`); this spec adopts the same convention for `accuracyFromEvaluations`'s inputs rather than introducing a second convention.
2. **`ReviewCoachingMissKind` has 8 values today, not 7.** The parent doc's original design sketch (and the earliest D0 implementation) listed 7 `missKind` values; a `'correct'` value was added afterward (D0 follow-up, catching a case that had been incorrectly folding into `'unknown'`). This spec's forced-detection reasoning (§2a) is written against the 8-value type as it exists today; it does not depend on which of the 8 values apply to any given decision, only on the separate `dedupeCandidatesByTile` primitive, so this divergence doesn't actually affect anything above — noted here only because the instruction was to flag every divergence found, not just the ones that matter to this document's own conclusions.

No divergence was found in `ReviewEvaluationEvidence`, `ReviewEvaluationV1`'s top-level shape, or `reviewFixtureCorpus.ts`'s category list — all match what a reader of the parent doc alone would expect.
