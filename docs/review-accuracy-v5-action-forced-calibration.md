# Review accuracy v5 — action-level forced recalibration

**Date:** 2026-09-22  
**Branch / PR:** `fix/review-production-integrity` / #300  
**Status:** **V5 CALIBRATION: BLOCKED**

Mechanical Phase C recalibration was run under the corrected action-level
forced predicate. Production constants (`CALIBRATED_K`,
`LOSS_BAND_BOUNDARIES`) are **not** updated — the fitted candidate fails a
locked Phase C acceptance check, and the percentile band fit produces a
degenerate Best boundary that contradicts the method’s own documented intent.

Supporting machine output:
`docs/review-accuracy-v5-action-forced-calibration.raw.json`

---

## Corpus

### Frozen inputs (declared before fit outcomes)

| Input | Value |
| --- | --- |
| `reviewEngineVersion` | `review-engine-v1` (`REVIEW_ENGINE_CONTRACT_VERSION`) |
| Candidate `accuracyModelVersion` | `accuracy-model-v5-action-forced-2026-09-22` |
| Search budget (fixtures) | `maxNodes=200000`, `maxHiddenStateSamples=100`, `maxPlyDepth=2`, seed `calibrate-accuracy-model-fixtures` |
| Coverage gate | `0.02` |
| Recorded corpora | `packages/review-engine/fixtures/recorded-self-play` + `recorded-client-policy` (2026-09-17 committed revision; 12,973 decisions) |
| Fixture IDs | all `REVIEW_FIXTURE_CORPUS` IDs (53 fixtures) |
| Calibration algorithm | Phase C / `calibrateAccuracyModel.ts`: `fitKLeastSquares` (grid + golden-section) + `fitBoundaries` (p75 / p75 / p10) |
| Fitting objective | SSE vs targets strong→95, poor→15 |
| Acceptance checks | ordinary PVF predicted ∈ **[65, 85]**; poor &lt; 60 and &gt; 0; monotonicity; forced invariance; optimal ceiling = 100 |

### Phase C category mapping (unchanged)

1. Oracle self-play / exact endgame — still covered by optimal-ceiling property test (no full oracle self-play trajectory corpus; known C0 gap).
2. Strong policy — `daily-fritz-master` / `strong-policy-top-tier`.
3. Ordinary PVF — `pvf-bot-match` / tier `standard` (validation, not k-fit).
4. Deliberately poor — `REVIEW_FIXTURE_CORPUS` `deliberately_poor`.
5. Forced-move fixtures — `forced_move` category (excluded from loss fit; used for invariance).

No cherry-picking. Hard/master PVF tiers remain informational only (wall-clock nondeterminism).

---

## Forced correction — candidate exhaustiveness

### Proven: yes

`evaluation.candidates` is the **exhaustive root legal-action set**:

- Exact / midgame / heuristic solvers build candidates by mapping **every**
  `snapshot.legalActions` entry (`solveExactEndgame`,
  `solveMidgameDeterminization.buildCandidates`, `solveHeuristicOpening`).
- F4b wall-clock overrun **preserves** candidates/ranking and only sets
  `search.complete = false` (`evaluateReviewPosition.ts`).
- Regression:
  `packages/review-engine/src/__tests__/forcedCandidateExhaustiveness.test.ts`
  - every fixture: `candidates` ↔ `legalActions` identity match
  - incomplete midgame cannot turn multi-action into FORCED
  - same-tile multi-placement remains NOT forced under overrun

**Canonical forced source (production):** `isForcedDecision(evaluation.candidates)`
≡ `countDistinctLegalActions(candidates) <= 1`, which is equivalent to
`snapshot.legalActions.length <= 1` whenever candidates are produced by the
live dispatcher (proven above). Recorded corpus rows store evaluations only;
capture-time candidates inherit the same exhaustiveness invariant.

Forced is **not** “one evaluated survivor.”

---

## Forced correction — old vs new accounting

| Metric | Tile-level (old) | Action-level (new) |
| --- | ---: | ---: |
| Total decisions | 12,973 | 12,973 |
| Forced | 6,182 | 4,064 |
| Exact scored | (in scorable) | (in scorable) |
| Search scored | (in scorable) | (in scorable) |
| Scorable denominator (exact+search, non-forced) | **3,798** | **5,538** |
| Heuristic estimate (non-forced) | (remainder) | (remainder) |
| Mean loss (scorable) | 0.661 | 0.496 |
| Median loss | 0 | 0 |
| p75 / p90 / p95 loss | 0.41 / 2.00 / 4.00 | 0.02 / 1.50 / 3.06 |

Wrongly forced before: **2,118 (16.3%)**.  
Of which exact/search newly entering scorable: **1,740**.

Per-game accuracy under **current (v4) K** (100 recorded games):

| Semantics | Median | p10 | p90 | Mean |
| --- | ---: | ---: | ---: | ---: |
| Tile-forced + old K | 88.6 | 79.7 | 93.9 | 87.7 |
| Action-forced + old K | 91.1 | 85.3 | 94.9 | 90.7 |

(All 100 games remain `status: partial` / no global letter grade under product
rules — heuristic non-forced decisions exist in every recorded game.)

---

## Newly scored population (1,740 exact/search)

| Breakout | Value |
| --- | --- |
| Same-tile / multi-placement share | **1,740 / 1,740 (100%)** |
| By source | search 1,682 · exact 58 |
| By tier | standard 655 · master 610 · hard 475 |
| Mean / median / p75 / p90 / p95 loss | 0.135 / 0 / 0 / 0.051 / 0.771 |

Label distribution under **old** bands:

| Best | Inaccuracy | Mistake | Blunder |
| ---: | ---: | ---: | ---: |
| 1,575 | 78 | 84 | 3 |

Under **candidate v5** bands (see below): Best 1,561 · Inacc 34 · Mistake 142 · Blunder 3.

**Why calibration moved:** the newly included decisions are almost entirely
near-zero-loss same-tile placement choices that were incorrectly excluded as
“forced.” That dilutes mean loss and inflates predicted accuracy for every
corpus category that contains them.

---

## Aggregate calibration

| | Value |
| --- | --- |
| Method | Phase C `fitKLeastSquares` — unchanged |
| Targets | strong mean → 95; poor mean → 15 |
| Old K (v4) | `0.19770906562806756` |
| Candidate v5 K | `0.20094184929012865` |
| Strong mean loss (action-level scorable) | 0.359 → predicted **93.04** |
| Ordinary PVF mean loss | 0.629 → predicted **88.13** |
| Poor / worst_legal mean loss | 9.292 → predicted **15.46** |

### Acceptance

| Check | Result |
| --- | --- |
| Ordinary PVF predicted ∈ [65, 85] | **FAIL** (88.13 &gt; 85) |
| Poor play &lt; 60 and &gt; 0 | PASS (~15.5) |
| Strong near 92–98 band midpoint | PASS (~93.0) |

---

## Loss bands

| Boundary | Old (v4) | Candidate v5 (mechanical) |
| --- | ---: | ---: |
| `bestTolerance` = p75(strong) | 0.13 | **0** |
| `inaccuracyToMistake` = p75(ordinary) | 0.79 | 0.2475 |
| `mistakeToBlunder` = p10(poor) | 5.98 | 5.98 |

Strictly increasing: yes (0 &lt; 0.2475 &lt; 5.98).

**Not applied.** Reasons:

1. Ordinary validation band fails (above).
2. `bestTolerance = 0` is a **degenerate** Best band: the harness comment and
   Phase C wording require a non-zero “within search tolerance of top,” not
   bit-exact `moveLoss === 0`. Expanded zero-inflated strong-policy mass
   drives p75 to exactly 0; shipping that would reclassify many tiny
   search-tolerance losses as Inaccuracy without a product-validated method
   change.

---

## Accuracy distributions (action-level, candidate v5 K)

| Category | Scorable n | Mean loss | Predicted accuracy |
| --- | ---: | ---: | ---: |
| Strong policy (k-fit) | 292 | 0.359 | **93.04** |
| Ordinary PVF standard (validation) | 1,834 | 0.629 | **88.13** |
| Deliberately poor / worst_legal | 44 | 9.292 | **15.46** |
| Informational: ordinary-tier self-play | — | — | ~90.1 |
| Informational: PVF hard / master | — | — | ~92.1 / ~91.4 |

Per-game (100 games, action-level, candidate K): median **90.9**, p10 **85.1**, p90 **94.8**.

---

## Grade audit

Existing `gradeFromAccuracy` cutoffs (S≥92, A≥82, B≥72, C≥60, else D) remain
meaningful on the same semantic 0–100 exponential scale.

**No grade-boundary change attempted** — calibration did not reach PASS, so
there is no new production accuracy mapping to re-audit grades against.

Product presentation rules (unchanged on #300):

- full calibrated non-forced coverage → accuracy + grade
- any heuristic estimate in non-forced population → scored accuracy only; **no** letter grade
- unavailable non-forced → Incomplete; **no** letter grade

---

## Acceptance tests

| Invariant | Status |
| --- | --- |
| Candidate exhaustiveness / incomplete ≠ forced | **PASS** (new tests) |
| Forced invariance / monotonicity / optimal ceiling / poor floor | Existing suite still green under current published constants |
| Ordinary PVF ∈ [65, 85] under **fitted** candidate | **FAIL** |
| Heuristic Estimate excluded from scored accuracy | PASS (product #300) |
| Partial presentation / historical freeze | PASS (product #300) |
| Tile-level re-fit reproduces published K/bands; action-level breaks [65,85] | **PASS** (provenance regression) |

---

## Phase C contract provenance audit

Supporting machine output:
`docs/review-accuracy-v5-phase-c-provenance-audit.raw.json`  
Diagnostic script:
`packages/review-engine/src/devtools/auditPhaseCCalibrationProvenance.ts`  
Regression:
`packages/review-engine/src/__tests__/phaseCCalibrationProvenance.test.ts`

### Published model provenance

| Constant / target | Value | Introducing commit | Methodology / source | Corpus revision | Forced semantics |
| --- | --- | --- | --- | --- | --- |
| Forced / `isScorable` | `dedupeCandidatesByTile(...).length === 1` | `d545cd15` (C1) | Phase C0 §2a literally coded tile-dedupe | n/a | **A. tile-level** |
| `CALIBRATED_K` (first) | `0.1657…` | `48b85258` (C2b) | `fitKLeastSquares` strong→95, poor→15 | early 5-game + n=2 poor | **tile-level** (via live `isScorable`) |
| `CALIBRATED_K` (v3/v4 published) | `0.19770906562806756` | `ac7be98f` (v3; unchanged in `943f5612` v4) | same fit; poor corpus expanded to n=44 | recorded trees as of v4 | **tile-level** |
| `bestTolerance` | `0.13` | C2b → retained through v4 | p75(strong scorable losses) | same | **tile-level** |
| `inaccuracyToMistake` | `0.895` → **`0.79`** | v3 → v4 `943f5612` | p75(ordinary PVF); moved when standard sample widened 5→30 | v4 recorded trees | **tile-level** |
| `mistakeToBlunder` | `10.251` → **`5.98`** | v2 → v3 | p10(poor); moved with poor expansion | v3+ fixtures | **tile-level** |
| Ordinary band `[65,85]` | hardcoded | `48b85258` | **Not in C0/parent scoping docs.** Harness field `pvfBotMatchStandardBand`. Commit message: ordinary ~85.9 “just outside… reported, not forced.” | C2b corpus | Evaluated under **tile-level** |
| Strong target 95 | harness | `48b85258` | Comment: midpoint of “~92–98” — that band itself is harness commentary, not C0 numeric lock | — | — |
| Poor target 15 | harness | `48b85258` | Comment: “comfortably below &lt;25” — also harness commentary | — | — |

**Answer to §2:** the published v4 K, bands, and acceptance checks were calibrated / evaluated using **A. tile-level forced exclusion**. Proven from `reviewAccuracy.ts` history (`dedupeCandidatesByTile` from C1 until `86db51b2` on this PR) and from exact re-fit reproduction under tile-level today.

That means the corrected action-level population is being judged against targets that **encode the old denominator**, not a neutral semantics-free contract. This does **not** by itself authorize changing the targets — it establishes provenance for the project lead.

### Historical reproduction

Recorded corpus trees at `943f5612` (v4) vs `HEAD`:

- `recorded-self-play` tree SHA: **identical**
- `recorded-client-policy` tree SHA: **identical**
- Fixture IDs: **identical** (54)
- `fitKLeastSquares` / `fitBoundaries` / targets: **no method drift**

Re-fit with **tile-level** forced on today’s identical recorded trees + live `deliberately_poor` re-eval:

| | Published | Reproduced | Δ |
| --- | ---: | ---: | ---: |
| K | `0.19770906562806756` | `0.19770906571710167` | `~9×10⁻¹¹` (float) |
| bestTolerance | `0.13` | `0.13` | 0 |
| inaccuracyToMistake | `0.79` | `0.79` | 0 |
| mistakeToBlunder | `5.98` | `5.98` | 0 |
| Ordinary predicted (fitted K) | — | **84.60** ∈ [65,85] | — |

**Historical calibration reproduced: YES** (bands exact; K within float epsilon).

### Corpus drift

Independent of forced semantics: **no recorded-corpus drift** between v4 publish and HEAD. Engine code gained F4b deadline plumbing after v4, but recorded evaluations are frozen JSONL — histograms for K/band fit from records are unaffected. Live fixture re-eval for poor-play still recovers published bands.

### Forced-semantic dependency

| Config | Scorable denom | Ordinary mean loss | Fitted K | Ordinary pred | In [65,85]? | Best band |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Historical(=current) + **tile** | 3,798 | 0.846 | 0.197709… | **84.60** | YES | 0.13 |
| Historical(=current) + **action** | 5,538 | 0.629 | 0.200942… | **88.13** | NO | **0** |

Because historical recorded corpus ≡ current, cells “historical×…” and “current×…” are the same for recorded data.

### 2×2 counterfactual

Same table as above (corpus identity collapses historical/current). Root attribution:

1. **Primary:** forced-semantic correction (tile → action)
2. **Not primary:** corpus drift (none on recorded trees)
3. **Not primary:** harness/method drift (none)

### Best-band degeneracy

`bestTolerance = p75(strong scorable losses)`.

| Forced mode | Strong scorable n | Zero-loss share | p75 |
| --- | ---: | ---: | ---: |
| Tile | 211 | 71.1% | **0.13** |
| Action | 292 | **75.7%** | **0** |

Action-level adds 81 strong-policy scorable decisions that were tile-forced (same-tile multi-placement). Enough additional exact-zero losses push zero mass past 75%, so p75 becomes exactly 0. This is **expected mathematical behavior** of the locked percentile rule on a more zero-inflated population — not a coding bug — and it violates the method’s own documented intent (“not `=== 0` exactly”).

### Newly scored 1,740 composition (diagnosis only; forced rule unchanged)

| Metric | Count / share |
| --- | --- |
| Exact zero loss | **1,561 (89.7%)** |
| Tiny positive ≤ published Best 0.13 | 14 |
| Above tiny | 165 |
| All placement values exactly equal | **956** |
| Played tied for best value | **1,561** |
| Nonzero loss p50 / p90 | 0.75 / 3.30 |

Equal values do **not** make a decision forced. They do explain the calibration shift: the newly included population is overwhelmingly zero-loss / tied-best placement choice.

### Ordinary PVF acceptance provenance

`[65, 85]` classification: **post-hoc empirical validation range / manually chosen product expectation**, hardcoded in the C2b harness — **not** a formally derived Phase C0 objective, and **not** present in `phase-c-accuracy-model-spec.md` or the parent oracle-upgrade scoping doc.

Evidence: `calibrateAccuracyModel.ts` `pvfBotMatchStandardBand`; commit `48b85258` message explicitly notes ordinary ~85.9 was already outside and “reported, not forced.”

Strong→95 and poor→15 are likewise harness-authored anchors referencing undocumented commentary bands (~92–98, &lt;25), not C0 numeric locks.

### Decision required (project lead)

Mechanically knowable (done):

- Original publish used **tile-level** forced
- Today’s harness + identical recorded corpus **reproduces** v4 under tile-level
- Break under action-level is **semantics**, not corpus/harness drift
- Best=0 is percentile math on &gt;75% zero mass
- `[65,85]` is harness-empirical, already soft at introduction

**Not** uniquely specified by Phase C without new policy:

- Whether `[65,85]` remains binding after correcting the denominator that produced the ordinary distribution it was watching
- How to replace degenerate Best=0 while preserving “search tolerance ≠ exact zero”
- Whether a new signed-off Phase C revision should re-derive acceptance ranges under action-level

Phase C does **not** uniquely specify a valid v5 calibration that both (a) uses action-level forced and (b) satisfies the historical `[65,85]` check without a lead decision.

---

## Final recommendation

Do **not** publish candidate K / bands into production.

Leave `CALIBRATED_K` / `LOSS_BAND_BOUNDARIES` at the signed-off **v4** numeric
values. Keep `accuracyModelVersion = accuracy-model-v5-action-forced-2026-09-22`
as the version stamp for **action-level forced semantics** already shipping on
#300 (denominator change), with explicit documentation that **numeric
recalibration is blocked** pending project-lead decision on the provenance
items above (historical empirical acceptance ranges vs corrected denominator;
degenerate Best percentile).

# V5 CALIBRATION: BLOCKED
