# F1c disagreement adjudication (D2)

**Date:** 2026-09-21  
**Corpus:** recorded self-play (10 games) + recorded client-policy (90 games) = **100 games**, 12,973 decisions  
**Scaffold provenance:** recovered `af04e762` / `647e8942` / `1dd791ee` on `devtools/f1c-disagreement-adjudication`; ported onto main after #289  
**Full machine output:** `/private/tmp/racehorse-f1c-final-results.json` (local; not committed — ~2.8MB rows)  
**Committed summary:** `f1c-disagreement-adjudication-2026-09-21.summary.json`

## Sign convention

`gap = oracleValue − fritzValue`  
Positive favors the **oracle**; negative favors **Fritz**.

- Exact path: `expectedPointDifferential` from a complete exact solve  
- Rollout path: actor−opponent hand-end score under matched seeds, then subtract

## Action freezing (#289 consistency)

For each adjudicated decision:

1. Oracle action frozen once from recorded `evaluation.best`  
2. Fritz action frozen once via `computeFritzReferenceMove`  
3. Those two actions reused across every continuation policy and paired sample  

Fritz resolutions observed: **8,909** once-per-examined multi-choice decision (including agreements that skip adjudication). Disagreements adjudicated: **3,447**.

## Continuation policies (D2 independence)

| Policy | Implementation | Fritz-derived? | Oracle review/search-derived? |
|---|---|---|---|
| `uniform-legal` | `getLegalMoves` + deterministic uniform pick | no | no |
| `immediate-score` | max `computePlayScore(simulatePlacement)`, uniform among ties | no | no |

Acceptance: ≥1 non-Fritz and ≥1 non-oracle — **satisfied**.

Fixed seeds: `d2-v1:${decisionId}:${sampleIndex}` allocation + `${seed}:${policy}` continuation.  
Paired rollouts per policy: **128** (precommitted in recovered scaffold; not retuned).

## Counts

| | |
|---|---:|
| Games | 100 |
| Decisions examined | 12,973 |
| Disagreements | 3,447 |
| Exact-adjudicated | 39 |
| Rollout-adjudicated | 3,401 |
| Excluded infeasible | 7 |
| Incomplete exact (fell through to rollout) | 21 |
| Total rollout samples (oracle+Fritz × policies × N) | 1,741,312 |

## Per-tier D2 table

| tier | disagreements | oracle wins | Fritz wins | ties/indistinguishable | mean oracle−Fritz gap | 95% CI | D2 result |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| exact | 60 | 16 | 6 | 38 | +0.907 | [−0.816, +2.817] | **indistinguishable** (contested-cap branch at aggregate; exact remains per-decision ground truth) |
| search | 1,902 | 302 | 35 | 1,565 | +0.553 | [+0.390, +0.772] | **oracle wins** (CI excludes 0) |
| heuristic | 1,485 | 47 | 185 | 1,246 | −0.590 | [−0.859, −0.355] | **Fritz wins** (CI excludes 0) |

Per-policy mean gaps (adjudicated rows):

| tier | uniform-legal | immediate-score |
| --- | ---: | ---: |
| exact | +0.852 | +0.962 |
| search | +0.455 | +0.651 |
| heuristic | −0.446 | −0.734 |

## D2 branches that fired

1. **exact:** aggregate CI includes 0 → indistinguishable branch. Exact solver remains authoritative for each exact-solvable decision; production must not apply a contested severity cap against exact ground truth (already true).  
2. **search:** oracle wins with CI excluding 0 → oracle is the reference for that tier’s disagreements; Fritz is second opinion.  
3. **heuristic:** Fritz wins with CI excluding 0 → Fritz is the reference for that tier’s disagreements; oracle is second opinion.

## Production implications (no behavior change in this PR)

Locked decision 1 already names oracle as search reference and Fritz as heuristic reference — **aligned with the D2 winners**.

Current production still marks search/heuristic engine disagreements as `contested` with an Inaccuracy severity cap (behind the default-off positional flag). Under D2’s “engine wins” branch, that contested/cap treatment for those tiers is no longer the correct final state.

**Follow-up required before Ship Gate (separate held PR):** apply the D2 winner branch to user-visible contested/classification behavior for search and heuristic (stop unresolved contested-cap when the tier has a D2 winner; keep loser as second opinion). Exact unchanged.

This F1c PR is **devtools / tests / docs only** — no production classification change.

## Public flags

Unchanged. `REVIEW_POSITIONAL_EXPLANATIONS_ENABLED` remains false. Fritz internals unchanged.
