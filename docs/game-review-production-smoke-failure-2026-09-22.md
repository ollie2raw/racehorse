# Game Review production smoke failure — 2026-09-22

**Status: `ADMIN-COHORT LAUNCH READINESS: BLOCKED — production smoke failed`**

Do **not** mark Game Review validated. Do **not** broaden rollout.

## Screenshot-observed defects

| # | Observation | Severity |
|---|-------------|----------|
| 1 | Summary: 75–28, accuracy 90.9%, grade A, `36 of 65 moves analyzed` | Ambiguous accounting |
| 2 | Game Review header: `LEGACY HEURISTIC ESTIMATE · LOW CONFIDENCE` on a fresh modern game | P0 provenance |
| 3 | Timeline IDs sparse (`#1`, `#5`, `#49`…) vs ~65 / ~112 uncertainty | Numbering / unit confusion |
| 4 | Selected move: `BLUNDER` + Est. + “weakest option” + WHAT HAPPENED: `Best move… matches Fritz's read` | **P0 truth** |
| 5 | BEST / GOOD / MISTAKE badges contradict WHY / coaching prose | P0 consistency |
| 6 | Precise accuracy + mixed SEARCH/EST badges + global LEGACY | Provenance contradiction |

## Root causes (mechanically proven)

### 1. `BLUNDER` + `Best move` (heuristic dual-reference)

**Proven.** After D2, coaching facts use **Fritz as primary** at heuristic tier (`reviewCoachingFacts.ts` → `referenceSource: 'fritz'`, prose “Best move” when played === Fritz). Sidebar classification used `classifyHeuristicResult(evaluation)` with **oracle-max `rawScore` among candidates**, ignoring Fritz. Player matching Fritz but not the oracle-heuristic max → Blunder badge + Best-move prose.

**Fix:** `classifyHeuristicResult(..., { primaryReferenceAction })` + `buildReviewPresentationRecord` so classification, WHY, coaching, and board Best share one primary.

### 2. Fresh-game `LEGACY` header with 90.9% / A

**Proven — Outcome B (stale header).** `PostGameReviewPrompt` received `exposedPostGameAnalysis` (merged `accuracyModel` + `evidence` → `deriveReviewEvidence` → Oracle / Review Engine). `openReviewGameFromPrompt` / `openHandScopedReview` set `currentAnalysis` from **raw** `postGameAnalysis` **without** the merge → GameReviewer fell back to `LEGACY_ANALYSIS_DISCLOSURE`.

**Fix:** open paths + sync effect use `exposedPostGameAnalysis`. Modern partial coverage labels `Review Engine analysis`, never Legacy solely because some moves are heuristic.

### 3. Meaning of `36 of 65 moves analyzed`

**Proven — not forced moves.**

```
scorableCount = totalNonForcedMoveCount - heuristicMoveCount
coverageText = `${scorableCount} of ${totalNonForcedMoveCount} moves analyzed`
```

So **36 = exact|search non-forced** and **65 = all non-forced evaluations** (exact+search+heuristic). The **29 gap = heuristic-tier non-forced decisions**, already excluding forced from both sides via `computeGameAccuracyModel`.

### 4. Why raw IDs exceed / mismatch review counts

`AnalyzedMove.moveNumber` is the **full move-log index** (includes opponent actions and non-decision telemetry spacing). Sidebar previously rendered `#{move.moveNumber}`. Snapshot `actionNumber` can also diverge from `moveNumber` on multi-draw turns (documented in `correlateSnapshotsToMoveLog.ts`). User-facing unit is now **sequential player-decision index** `#1…#N`.

### 5. WHY vs badge contradictions (BEST + “0 points behind”, MISTAKE + “solid option”)

**Proven.** For calibrated (exact/search) results, WHY copy used **`current.rating` (legacy classifyMove)** instead of the calibrated label from `lossBandLabelForEvaluation`, while the sidebar showed the calibrated badge. Also `formatGap(0)` rendered “0 points”.

**Fix:** `calibratedRatingCoachingCopy` + `formatScoreGapForDisplay` (null at 0; `less than 0.1 point` for tiny positive).

### 6. Human decisions silently lost?

**From accounting identity on fixtures: no silent drop of analyzedMoves rows.** Gaps vs worker evaluations are **unavailable** (missing correlation / capture / analysis failure) or **estimate** (heuristic), not deleted sidebar rows. Production “29 of 65” were estimates, not missing forced. True missing snapshots remain a **separate incompleteness** surface (now `Unavailable` + completeness qualification).

## Count-accounting identity

```
totalDecisions (= analyzedMoves / player decisions)
  = scored (exact|search, non-forced)
  + estimate (heuristic, non-forced)
  + forced
  + unavailable
  (+ pending while batch runs)
```

Summary copy shape: `N scored · E estimate · F forced · U unavailable · T total decisions`.

## Classification / reference invariant

One canonical `ReviewPresentationRecord` per decision:

- primary reference source/action
- loss vs primary (oracle-calibrated for exact/search; qualitative for heuristic)
- classification
- evidence tier
- contested

Hard rules A–G from the integrity brief are enforced in presentation builders + tests (`reviewProductionIntegrity.test.ts`, `GameReviewer.productionIntegrity.e2e.test.tsx`).

## Accuracy model version (v5)

Forced predicate corrected from tile-level to **action-level**. Corpus audit
(recorded-client-policy + recorded-self-play, 12,973 decisions):

| Metric | Value |
| --- | --- |
| Wrongly forced (tile=1, actions>1) | **2,118 (16.3%)** |
| Of which exact/search tier | 1,740 |
| Scorable denom before → after | 3,798 → **5,538 (+45.8%)** |

`accuracyModelVersion` bumped to `accuracy-model-v5-action-forced-2026-09-22`
for **new** analyses only. Numeric recalibration under Phase C methodology was
attempted and **BLOCKED** — see
`docs/review-accuracy-v5-action-forced-calibration.md` (ordinary PVF predicted
88.1 ∉ [65, 85]; degenerate `bestTolerance=0`). `CALIBRATED_K` /
`LOSS_BAND_BOUNDARIES` remain v4 signed-off values. Historical artifacts
untouched.

## Historical review

No production backfill. No rewrite of old artifacts. New reviews persist evaluations + coaching as today; reopen reproduces stored facts. Presentation policy applied at read time from stored evaluations/facts.

## Fixes made (this branch)

- Fritz-primary heuristic classification
- Canonical presentation record + consistency asserts
- Player-decision ledger + summary accounting copy
- Sequential decision numbering; Forced / Unavailable labels
- WHY copy classification-aware + numeric display rules
- Board Best uses coaching primary reference
- Provenance open-path + modern label
- Regression + production-shaped E2E tests
- This document

## Deterministic reproduction evidence

- `client/src/analyzer/reviewProductionIntegrity.test.ts`
- `client/src/analyzer/GameReviewer.productionIntegrity.e2e.test.tsx`
- Updated PostGameReviewPrompt / deriveReviewEvidence / heuristic display tests

## Remaining uncertainties

- Exact production row payloads for the smoked game were **not** queried (no prod DB). Root causes above are source-proven and match screenshots; admin may optionally export one game’s `replay_artifact` + evaluations JSON if further forensic confirmation is needed.
- Contested Fritz nondeterminism (wall-clock Master search) remains a known engine property; presentation now stays self-consistent within one review instance.

## Closeout status

**`ADMIN-COHORT LAUNCH READINESS: BLOCKED — production smoke failed`**

Merge of the integrity PR is **held for project-lead review** even if CI is green.
