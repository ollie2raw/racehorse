# Game Review — Phase F / A–F closeout

**Date:** 2026-09-22  
**Main HEAD at audit:** `df5f16cdba448a25de178690ce245515f5921368`  
**Scope:** documentation / audit only — no production behavior, budgets, gates, ceilings, or flags changed.

## Executive status

**PHASE F ENGINEERING: COMPLETE**

**ADMIN-COHORT LAUNCH READINESS: BLOCKED**

Engineering for the planned A–F Game Review overhaul is complete on `origin/main`. Admin-cohort launch remains blocked on **human voice sign-off**, **deployment of the historical `replay_artifact` migration**, **cohort configuration confirmation**, and a **real-admin production smoke test**. Broader public rollout is a separate product decision.

---

## Ancestry verification (required squash SHAs on `origin/main`)

| Squash | Topic | Contained |
| --- | --- | --- |
| `da17515ea6fa86aa6c55a523ddfc682d4767c91f` | F1c D2 apply (#291) | YES |
| `996e8f4c040153f289277b09761ad674fdea4198` | Historical replay F1e-5 (#292) | YES |
| `339a28369a5f334308a48d2b37e2b829bb9390bc` | F3a FAIL / retain coverage (#293) | YES |
| `625ec62b9aac001eb51c43aa32fb0537fc15297c` | F4a worker pool (#294) | YES |
| `bedf444b33019829dfa8ba8d74e660b795c9000e` | F4b wall-clock ceiling (#295) | YES |
| `df5f16cdba448a25de178690ce245515f5921368` | F4c latency report (#296) | YES |

Supporting F2 / F1e merges also on main include (non-exhaustive): `#288` F1e audit, `#289` facts consistency, `#290` F1c adjudication, `#281`–`#287` positional prose / coverage / equal-value follow-ups.

---

## Completed engineering (A–F summary)

### Phase E foundation (pre-F)

Server cohort gate, persistence, PVF/MP review paths, and admin visibility flip shipped earlier (`POST_GAME_REVIEW_VISIBLE = true`; persistence still cohort-gated via `POST_GAME_REVIEW_COHORT_USER_IDS`).

### F0

Accepted recovery / plan root (see `PROGRESS-F.md` / `F0-AUDIT.md`). No re-audit required.

### F1 — Oracle validation

| Item | Status | Evidence |
| --- | --- | --- |
| F1a | COMPLETE | Head-to-head / replayable oracle tooling merged |
| F1b | COMPLETE | D1: default oracle vs Fritz Master 299/600 (49.8%, CI 45.8–53.8), margin −1.2 (−3.2..+0.7) → indistinguishable → retain reference policy |
| F1c | COMPLETE | D2 report + production apply `#291` `da17515e` |
| F1d | COMPLETE (this closeout) | Owner-run SQL landed on main: `scripts/sql/fritz-master-vs-humans-winrate.sql` (not executed against production) |
| F1e | COMPLETE | Parity audit `#288`; F1e-5 historical replay `#292` |
| F1f | COMPLETE (this closeout) | Design note on main: `docs/scoping/game-review-luck-versus-skill-design.md` (no UI) |
| F1g | COMPLETE | 2200 vs 2400 conflict **flagged** in Phase F doc / code (`FRITZ_MASTER_RATING = 2200`); number not chosen |

### F2 — Explanations

| Item | Status | Evidence |
| --- | --- | --- |
| F2a–F2d | COMPLETE | Positional features, parity, reference resolver + D2 policy, coaching facts/prose + truth tests |
| F2e | ENGINEERING COMPLETE / HUMAN PENDING | `docs/review-explanation-samples.md` (30 samples) + sign-off packet below |

Product flag: `REVIEW_POSITIONAL_EXPLANATIONS_ENABLED = true` (ship gate); live enablement is `isPositionalCoachingProseEnabled(serverCohort)` only.

### F3 — Coverage gate

| Item | Status | Evidence |
| --- | --- | --- |
| F3a | COMPLETE | FAIL decision — retain existing coverage gate (`#293`) |
| F3b | CANCELLED | Newly admitted = 0 under AND gate |
| F3c | COMPLETE | Tier mix reported in F3a artifact |

### F4 — Latency

| Item | Status | Evidence |
| --- | --- | --- |
| F4a | COMPLETE | `#294` `625ec62b` — byte-identical 1/2/4 workers |
| F4b | COMPLETE | `#295` `bedf444b` — 2000 ms ceiling; `search.complete=false` |
| F4c | COMPLETE | `#296` `df5f16cd` — median −17.67% on fixed master game |

Canonical F4c numbers: `docs/review-latency-validation.md`.

---

## Decision-rule outcomes

### D1 (F1b)

Default oracle vs Fritz Master: indistinguishable → **retain existing reference policy**.

### D2 (F1c)

- **Search:** oracle wins disagreements (CI entirely positive) → Review Engine primary; Fritz second opinion; **no** automatic Inaccuracy cap.
- **Heuristic:** Fritz wins disagreements (CI entirely negative) → **Fritz's read** primary; contested retained.
- **Exact:** remains ground-truth authoritative.

### F3

`F3 DECISION: FAIL — retain existing coverage gate`. No convergence gate; no accuracy-model bump; no `MINIMUM_COVERAGE_FLOOR` recalibration from F3.

### F4

Worker pool deterministic; 2000 ms per-decision ceiling; measured −17.67% median wall-clock on fixed master game with **0** deadline incompletes.

---

## Phase F workstream matrix

| Workstream | Status | Evidence | Remaining action |
| --- | --- | --- | --- |
| F0 | COMPLETE | `PROGRESS-F.md` / `F0-AUDIT.md` | none |
| F1a | COMPLETE | merged tooling | none |
| F1b | COMPLETE | D1 numbers applied | none |
| F1c | COMPLETE | `#290` + `#291` | none |
| F1d | COMPLETE | `scripts/sql/fritz-master-vs-humans-winrate.sql` on main | optional owner run vs production |
| F1e | COMPLETE | `#288` + `#292` | deploy migration (ops) |
| F1f | COMPLETE | design note on main | UI deferred |
| F1g | COMPLETE | conflict flagged | owner chooses 2200 vs 2400 later |
| F2a–F2d | COMPLETE | merged F2 PRs + tests | none |
| F2e | ENGINEERING COMPLETE | sample docs exist | **HUMAN voice sign-off** |
| F3a | COMPLETE | `#293` | none |
| F3b | CANCELLED | F3 FAIL | none |
| F3c | COMPLETE | F3a report | none |
| F4a | COMPLETE | `#294` | none |
| F4b | COMPLETE | `#295` | none |
| F4c | COMPLETE | `#296` | none |

---

## Ship Gate

| # | Requirement | Status | Evidence | Owner | Next action |
| --- | --- | --- | --- | --- | --- |
| 1 | F1b/F1c reported and rules applied | **AUTOMATED GATE COMPLETE** | D1/D2 docs + `#291` production policy + tests (`reviewF1cD2SeverityPolicy.test.ts`) | — | none |
| 2 | F2e samples exist **and** product owner reviews ≥10 and approves voice | **COMPLETE / PRODUCT OWNER APPROVED** | Packet `docs/review-explanation-voice-signoff-packet.md`; coaching voice PR `#298` merged `1048df18018c800e26e1ab6333ff8328d89b1f41` | Product owner | none |
| 3 | Truth tests green; no Fritz numeric rating in user-facing review copy | **AUTOMATED GATE COMPLETE** | `reviewCoachingProse.test.ts` truth cases; `reviewF1cD2SeverityPolicy.test.ts` J; Fritz 2200 is PVF tier label / Glicko constant — not coaching prose | — | Keep Gate 3 green |
| 4 | Prose enabled for admin cohort only; `POST_GAME_REVIEW_VISIBLE` unchanged | **IMPLEMENTED (code) / OPS PENDING** | `isPositionalCoachingProseEnabled(serverCohort)` = ship constant ∧ cohort ∧ visible; GameReviewer + artifact fail closed without cohort; non-cohort local review unchanged | Deploy/ops | Apply migration → deploy → confirm cohort → A–R smoke |

---

## Current flag / cohort state

| Knob | Current value | Role |
| --- | --- | --- |
| `POST_GAME_REVIEW_VISIBLE` | `true` | Client release switch for review surfaces |
| `POST_GAME_REVIEW_COHORT_USER_IDS` | server env allowlist | Persistence + cohort access (server-owned) |
| `isPostGameReviewEnabled` | `serverCohort && POST_GAME_REVIEW_VISIBLE` | Persistence / gated APIs |
| `REVIEW_POSITIONAL_EXPLANATIONS_ENABLED` | **`true`** (product ship gate) | Approved positional prose may render **only** when combined with cohort via `isPositionalCoachingProseEnabled` |
| `isPositionalCoachingProseEnabled` | ship ∧ cohort ∧ visible | Live render + replay-artifact snapshot boundary |

Non-cohort users: local in-memory review may still appear where locally eligible; **positional coaching prose and server persistence fail closed** outside the allowlist.

**Production migration still NOT applied.** **Production smoke still PENDING.**

---

## Deployment requirements — historical `replay_artifact`

**Migration:** `supabase/migrations/2026-09-22_game_reviews_replay_artifact.sql`

- **Purpose:** additive nullable `game_reviews.replay_artifact jsonb` for F1e-5 frozen historical explanations.
- **Idempotent:** `add column if not exists`.
- **Backward compatible:** NULL = legacy row; app must not Fritz-recompute.
- **Backfill:** none required / none provided.
- **Production status (engineering knowledge):** **NOT applied** during engineering work.

**Classification:** `DEPLOYMENT BLOCKER — migration not yet applied` for historical reopen with frozen explanations **and** for production writes that include `replay_artifact`.

**Safe sequence:**

1. Apply migration to production (owner/ops; not an agent session).
2. Deploy current main (or ensure app that writes `replay_artifact` lands only after column exists).
3. Confirm cohort env allowlist.
4. Run real-admin smoke test (below).

App already treats missing/null artifact as legacy-honest on read.

---

## Manual production smoke test (HUMAN)

Do **not** mark this passed without a human run.

A. Admin/cohort user can access Game Review (`/api/game-reviews/access` true)  
B. Complete a Play vs Fritz match  
C. Post-game review appears  
D. Per-move classifications render  
E. Explanation text renders (after prose enablement — or confirm baseline coaching without positional flag if testing pre-enable)  
F. Evidence / source labels honest (Exact / Review Engine search / Heuristic; Fritz's read where heuristic primary)  
G. Hand-before context renders  
H. Played tile highlight correct  
I. Playable alternatives correct  
J. Pass/draw does **not** show a fake Played tile  
K. Contested / second opinion behaves when encountered  
L. Review persists  
M. History exposes **Review Game**  
N. Reopen loads the same frozen review  
O. Reopen shows no recomputation/drift (no Fritz/worker re-run)  
P. Legacy row (if available) shows honest unavailable notice  
Q. No Fritz numeric rating in review coaching copy  
R. Non-cohort user does **not** gain unintended persistence/access  

---

## Remaining human decisions

| Decision | Classification |
| --- | --- |
| Approve explanation voice (≥10 samples) | **Launch blocker** (Ship Gate 2) |
| Enable `REVIEW_POSITIONAL_EXPLANATIONS_ENABLED` for admin cohort after approval | **Launch blocker** for prose-on cohort launch (Gate 4) |
| Confirm/update `POST_GAME_REVIEW_COHORT_USER_IDS` | **Launch blocker** (ops/config) |
| Apply `2026-09-22_game_reviews_replay_artifact.sql` | **Deployment blocker** for historical replay + artifact writes |
| Real-admin production smoke test | **Production verification pending** |
| Run `fritz-master-vs-humans-winrate.sql` vs production | Optional / nonblocking |
| Resolve Fritz Master 2200 vs 2400 docs conflict | Optional / nonblocking for admin-cohort review launch |
| Broader public rollout | Separate product decision — deferred |

---

## Deferred / nonblocking roadmap

Do **not** treat as incomplete Phase F engineering:

- Advantage / win-probability graph (F1e-1)
- Reachable key-moment list in normal flow (F1e-2)
- Spatial reference-placement overlay (F1e-3)
- Retry-a-mistake sandbox (F1e-4)
- Luck-vs-skill UI (F1f note only)
- Hub/branch-geometry tactics depth
- Deeper multi-ply narrative
- Feature-logic consolidation into `botHeuristics.ts`
- Fritz wall-clock → node-budget conversion
- Broader MP-specific enhancements
- Broader public rollout beyond admin cohort

---

## Final ordered path to admin-cohort rollout

1. Product owner reviews `docs/review-explanation-voice-signoff-packet.md` (10 samples).  
2. Product owner approves or rejects the voice.  
3. Ops applies `2026-09-22_game_reviews_replay_artifact.sql` in production.  
4. Deploy current main (after schema).  
5. Confirm `POST_GAME_REVIEW_COHORT_USER_IDS` and `POST_GAME_REVIEW_VISIBLE`.  
6. After voice approval: enable `REVIEW_POSITIONAL_EXPLANATIONS_ENABLED` for the intended cohort path (product-controlled change — not done in this closeout).  
7. Execute real-admin production smoke test (A–R).  
8. Resolve only real defects found.  
9. Declare **admin-cohort Game Review validated**.  
10. Broader public rollout remains a **separate** product decision.

---

## Automated confidence gates (this closeout)

Run on closeout branch at `df5f16cd` + docs/SQL/design landings (no product behavior change):

| Gate | Result |
| --- | --- |
| `npm run lint --prefix client` | PASS (0 errors; pre-existing warnings only) |
| `npm run lint:hooks --prefix client` | PASS |
| `npm run typecheck --prefix client` | PASS |
| `npm run check:architecture --prefix client` | PASS (22/22) |
| `npm run build --prefix client` | PASS |
| `npm run build --prefix server` | PASS |
| Focused client review tests (prose/facts/D2/replay/zero-recompute/F4a pool) | PASS 93/93 |
| Focused review-engine (F4b deadline + capitalization) | PASS 9/9 |

Note: `npm run lint --prefix server` reports pre-existing `no-console` / warning debt on main; CI Server Validation uses tests + build, not that lint script. Not introduced by this closeout.

---

## Related artifacts

- `docs/review-latency-validation.md` — F4c  
- `docs/review-convergence-gate-validation.md` — F3a  
- `docs/oracle-strength-validation-runs/f1c-disagreement-adjudication-2026-09-21.md` — F1c  
- `docs/review-explanation-samples.md` — F2e full set  
- `docs/review-explanation-voice-signoff-packet.md` — Gate 2 packet  
- `scripts/sql/fritz-master-vs-humans-winrate.sql` — F1d  
- `docs/scoping/game-review-luck-versus-skill-design.md` — F1f  
