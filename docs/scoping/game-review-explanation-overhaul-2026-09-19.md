# Game Review Overhaul — Explanation, Coverage & Oracle Validation (Phase F)

**Status:** Approved for execution. Build as independently reviewable PRs. Follow the hold points; do not skip them.

**Date:** 2026-09-19

**Predecessor:** `docs/scoping/game-review-oracle-upgrade-2026-09-13.md` (Phases A–E, shipped/merged). Do not re-litigate anything decided there.

**Authority:** This document is the plan. The product owner and project lead made the decisions below. An executing agent implements them, verifies them, and reports. An agent does **not** re-decide locked decisions, re-scope tracks, or resolve items in "Human-owned decisions" on its own. If the code contradicts an assumption here, stop that step, report the contradiction with evidence, and continue with unaffected steps.

---

## Why this phase exists

Phases A–E built an honest number pipeline: capture, a versioned oracle, calibrated accuracy, persistence, and access gating. The result still does not feel like a chess.com-quality review. Two root causes, both verified:

1. **Explanations are structurally shallow.** Phase D specified prose "generated ONLY from" `ReviewEvaluationV1` fields (win probability, point differential). Those fields say *how much* a move lost, never *why*. Meanwhile `botHeuristics.ts` and `solveHeuristicOpening.ts` already compute named positional concepts (end control, denial/opponent threat, hand mobility, trap/orphan risk, missing-pip pressure) and collapse them into a single scalar before anything reaches the review. The explanation layer never sees them.
2. **Real analysis covers only about half the non-forced moves.** On the 100-game recorded corpus: 12,973 decisions, 6,182 forced (47.7%, excluded), 6,791 non-forced, of which 2,993 resolved at heuristic tier. Per-game real-tier coverage: min 36.5%, median 56.1%, mean 55.9%, max 69.7%.

A third issue surfaced in the Fritz audit and is now in scope: **nothing has verified that the oracle's "best move" is actually strong**, and when the oracle and Fritz Master disagree, nobody knows who is right.

## Product contract for this phase

- The review must say **why**, not only **how much**. Every non-forced human decision gets either a feature-backed explanation or an explicit "no meaningful positional difference" statement. Never a shrug, never a template that ignores the position.
- **Truth rule (inherited from D1, unchanged):** no sentence is emitted unless every claim in it is backed by a computed value in structured facts. Every number in prose appears in a structured field.
- **Honest labeling:** exact / search / heuristic evidence labels, "Fritz's read" vs "Review Engine," and the new "contested" state must match what the system actually did.
- **No Fritz rating appears anywhere in UI or copy.** Fritz Master's "2200" is a hardcoded constant (`glicko2.ts`), not a measured rating, and repo docs conflict (2200 in code, 2400 in several docs).
- `POST_GAME_REVIEW_VISIBLE`, the server cohort gate, and every public flag are **not touched** in this phase.

## Verified baseline (real numbers; do not re-derive)

| Fact | Value | Source |
|---|---|---|
| Solver budget | `maxNodes` 200,000; `maxHiddenStateSamples` 100; `maxPlyDepth` 2 | `client/src/modules/review/reviewEngineConfig.ts` |
| Coverage threshold | 0.02 (issue #226, open) | same |
| Batch execution | single Web Worker, strictly sequential decisions | `runReviewBatch.ts` |
| Latency (Node harness) | standard/hard ~12–17 ms/decision; master ~59–74 ms/decision | recorded manifests |
| Why more budget won't fix coverage | wide-hand positions need ~2,300 samples to reach 2% coverage (23× the budget); the metric measures sample count vs. combinatorial population, not estimate reliability | issue #226, agent arithmetic |
| Fritz Master vs oracle top move | 42–38 over 80 games (52.5%/47.5%); mean margin +2.7, 95% CI ≈ [−2.2, +7.5]. **Indistinguishable; underpowered.** | Fritz audit |
| Oracle/Fritz agreement | heuristic 64.6% (n=1552); search 77.9% (n=3372); exact 74.5% (n=157) | Fritz audit |
| Fritz per-move breakdown | `{ immediate, doubleBias, mobility, denial, unload, replyRisk }` already exported; `doubleBias` is a 0/1 flag | Fritz audit |
| Oracle latency tail | mean 22.2 ms, p95 93 ms, max 473 ms; no wall-clock ceiling | Fritz audit |
| Fritz information fairness | never reads the opponent hand or boneyard identities (`toBotVisibleState`); determinism source: two wall-clock deadlines (90 ms endgame, 45 ms chain) | Fritz audit |

## Locked decisions (2026-09-19)

1. **Reference move by evidence tier.**
   - `exact`: the oracle's best move is authoritative.
   - `search`: the oracle's best move is primary; "Fritz Master would play X" is **always** computed and shown as a second opinion.
   - `heuristic`: Fritz Master's move is the reference, labeled "Fritz's read," never "best."
2. **Agreement field.** Every decision records: oracle-vs-Fritz agree/disagree, and whether the played move matched the oracle's move, Fritz's move, both, or neither.
3. **"Contested" state.** In `search` and `heuristic` tiers, when the two engines disagree, the decision is `contested` and its severity is capped below Mistake/Blunder, **unless** the exact solver resolves it. The cap value is set from D2 results (see decision rules below), not by intuition.
4. **Explanations come from feature deltas.** For any move pair (played vs reference), compute named positional features for both, take the delta, rank by supported magnitude, and generate prose from the top deltas. This works at every tier.
5. **Do not modify** `botHeuristics.ts` (1,931 lines of production bot logic) or `solveHeuristicOpening.ts`. Port logic into a new module with parity tests. Consolidation is deferred to a later phase, after parity is proven.
6. **Fritz's `breakdown` is a cross-check, not the sole source.** Fritz's endgame uses sampled-hand minimax, so his breakdown may not reflect the actual decision.
7. **Coverage gate:** the convergence diagnostic replaces or augments coverage-fraction as the reliability gate, only after ground-truth validation (below). Adopting it requires an `accuracyModelVersion` bump and recalibration of `MINIMUM_COVERAGE_FLOOR`. Stored analyses are never silently reinterpreted.
8. **Latency:** parallelize the batch across a worker pool, deterministic regardless of worker count. Do **not** raise the search budget in this phase. Add a per-decision wall-clock safety ceiling that sets `search.complete = false` rather than silently altering rankings.
9. **Luck vs. skill** is **design only** in this phase (a written note). Implementation is deferred.
10. **Prose stays behind a default-off flag** until the Ship gate (below) is met and the product owner signs off on the sample doc.
11. **Merge policy.** Devtools, docs, and pure-additive modules (no user-visible change) may be merged once CI is green, including **Server Validation confirmed by name**. Anything that changes user-visible behavior, classification, accuracy numbers, or stored data stops for product-owner review before merge.
12. **Never** run queries against the production database; never use service-role keys.

## Pre-committed decision rules (so results can't be tuned to a preferred conclusion)

These are fixed **before** the data exists. Agents apply them mechanically and report which branch fired.

**D1 (head-to-head, 600+ games per variant):**
- If the 95% CI on the win-rate difference includes 0 → "oracle and Fritz Master are indistinguishable"; locked decisions 1–3 stand as written.
- If Fritz Master beats the oracle with the CI excluding 0 → the oracle has a strength problem. Root-cause it (likely heuristic-tier fallback share or the 2-ply depth) and report. Track F2 prose does not ship until resolved. Do not change the search budget to "fix" it inside this phase without a written proposal.
- If the oracle beats Fritz with the CI excluding 0 → oracle authoritative at search tier; Fritz second opinion remains but as lower-weight commentary.
- Also report the variant "oracle uses Fritz Master as its heuristic-tier fallback." If it beats the default oracle with the CI excluding 0, that becomes a proposed change (proposal only; product owner approves).

**D2 (disagreement adjudication, per tier):**
- Ground truth: exact solver where it applies; elsewhere paired rollouts with identical seeded continuations under **at least two** continuation policies (one must not be Fritz-derived, one must not be oracle-derived), sized for a CI.
- If, in a tier, one engine wins disagreements with the CI excluding 0 → that engine is the reference for that tier for contested moves, and the loser's move is shown as the second opinion.
- If the difference is indistinguishable → those decisions stay `contested`, with severity capped at **Inaccuracy** (never Mistake/Blunder).
- Report, per tier: disagreement count, winner, mean value gap, CI, and share of disagreements that are statistically indistinguishable.

**Coverage gate (Track F3):**
- Adopt the convergence-based gate only if, on positions where both the search tier and the exact solver apply, the **error rate against exact of newly admitted positions is no worse than the error rate of the existing search tier** against exact. Report flip rate and error rate with corpus numbers. If it fails, keep the existing gate and record the finding; do not weaken the standard.
- Report tier mix before and after. Do not claim a coverage number that wasn't measured.

## Workstreams and steps

Every step is an independently reviewable PR unless noted. Sizes: XS/S/M.

### F0 — Reconcile interrupted work (must complete first)

A prior agent run was interrupted by a rate limit while four tracks were in flight. Their state was reported in a garbled log and is **unverified**.

| Step | Size | Deliverable | Acceptance |
|---|---|---|---|
| **F0a** | S | Audit every worktree/branch (`git worktree list`, `.claude/worktrees/*`): commits ahead of main, uncommitted files, typecheck, tests, PR existence. Commit uncommitted work to its own branch as a WIP recovery commit; delete nothing. | Table per track: done / partial / not started, with evidence |
| **F0b** | XS | Map each recovered artifact to a step below (e.g. `computePositionalFeatures.ts` → F2a; `oracleVsFritzHeadToHead.ts` → F1a) and mark which are reusable as-is vs. need rework | No step is rebuilt from scratch if a valid recovered artifact exists |

Known claims to verify (not to trust): Track A has `computePositionalFeatures.ts`, a parity test, and `client/src/analyzer/reviewFritzSecondOpinion.ts`; Track D has `client/src/devtools/oracleVsFritzHeadToHead.ts` (+16 passing tests), `scripts/sql/fritz-master-vs-humans-winrate.sql`, and the D6 conflict note in `docs/fritz-difficulty-tiers-source-of-truth-audit.md`; Tracks B and C are believed unstarted. The 600-game runs were probably killed; `docs/oracle-strength-validation-runs/` was empty at last check.

### F1 — Oracle validation (blocks shipping F2 prose)

| Step | Size | Deliverable | Acceptance |
|---|---|---|---|
| **F1a** | S | Committed head-to-head devtool: Fritz Master vs oracle top move; identical seeded deals; seat rotation; fixed seeds; parallelized across cores; results written to files | Reruns produce identical results; unit tests pass |
| **F1b** | M | 600+ game runs for (i) default oracle, (ii) oracle with Fritz Master as heuristic-tier fallback. Win rate, CI, mean margin, split by phase | Numbers reported; D1 decision rule applied and stated |
| **F1c** | M | Disagreement adjudication (D2 rules above) on the recorded-corpus decisions where the engines disagree | **REPORTED 2026-09-21** — see `docs/oracle-strength-validation-runs/f1c-disagreement-adjudication-2026-09-21.md`; per-tier table below |
| **F1d** | XS | `scripts/sql/fritz-master-vs-humans-winrate.sql` review-ready. **Not run against production.** Handed to the product owner | SQL is read-only, aggregate-only, no PII |
| **F1e** | S | Chess.com-parity audit: win-probability graph, per-move classification, key-moment list, best-move on board, retry-a-mistake: present / partial / missing. Missing items added to a roadmap section of this doc | Table with file evidence per row |
| **F1f** | S | Design note: luck-vs-skill separation (judge decision quality on information available to the player; show outcome and hidden-hand reveal separately). Where it plugs into classification | Written note; no code |
| **F1g** | XS | Flag the 2200 vs 2400 conflict in docs (code says 2200 in `glicko2.ts`, `fritzConfig.ts`, `PlayVsFritz.tsx`; docs say 2400) | Conflict recorded; no number chosen by the agent |

### F2 — Positional feature layer and feature-delta explanations

| Step | Size | Deliverable | Acceptance |
|---|---|---|---|
| **F2a** | M | `computePositionalFeatures(snapshot, candidateAction)` in `packages/review-engine`, tier-agnostic, from public state + actor hand + `knownMissingPipEvidence` only. v1 features: pip denial / opponent outs left; end/number control; hand-shape bottleneck (orphans, playableNext, mobility); known-missing-pip exploitation; score-margin urgency; tile-count/boneyard pressure; double/hub-opening risk | Typechecks; no import of `BotMatchState`; deterministic |
| **F2b** | M | Parity tests against `botHeuristics.ts` / `solveHeuristicOpening.ts` over the recorded corpus that compare **feature values** (tolerance stated), not just which move ranks best | Documented per-feature parity; any deviations listed with reason |
| **F2c** | S | Reference-move resolver implementing Locked decisions 1–3, including the agreement field and contested metadata. F1c/D2 applied: search/heuristic engine-wins → no automatic Inaccuracy severity cap; contested remains factual; exact stays ground-truth authoritative | Unit tests for each tier and agreement case |
| **F2d** | M | Extend `ReviewCoachingFacts` with per-feature played-vs-reference values; generate prose from ranked feature deltas. Truth tests: every number in prose appears in structured facts; no sentence without support | Truth tests pass; "no meaningful difference" path covered |
| **F2e** | S | `docs/review-explanation-samples.md`: 30 real moves from the recorded corpus (mixed tiers, mixed classifications), old prose vs new prose, with the feature values behind each sentence | Product owner reviews (see Ship gate) |

### F3 — Coverage gate (#226)

| Step | Size | Deliverable | Acceptance |
|---|---|---|---|
| **F3a** | M | Validation study: for positions where both search tier and exact solver apply, how well does the convergence diagnostic (vs. coverage fraction) predict agreement with exact? Report flip rate and error rate | **COMPLETE** — see below; numbers only; no production gate change |
| **F3b** | M | If the coverage-gate rule above is met: implement the new gate, bump `accuracyModelVersion`, recalibrate `MINIMUM_COVERAGE_FLOOR` and the accuracy model on the recorded corpus | **CANCELLED** — F3a FAIL; retain existing coverage gate |
| **F3c** | XS | Report tier mix before/after on the 100-game corpus | **COMPLETE** (measured in F3a report) |

#### F3a result (2026-09-22)

Canonical report: `docs/review-convergence-gate-validation.md` (devtools port of `ce2a658c`).

Precommitted proposed gate (from hold/f3b `90c0d914`, not tuned on this run): `coverage >= 0.02 AND sameTopAction AND valueDelta <= 0.26`.

| metric | value |
| --- | ---: |
| Exact-complete validation denominator (locked-yard self-play replay) | 16 |
| Existing-gate admitted / errors / error rate | 16 / 3 / **18.75%** (95% CI [6.59%, 43.01%]) |
| Convergence admitted (total) | 16 |
| Newly admitted / errors / error rate | **0** / 0 / n/a |
| Newly rejected (exact-overlap) | 0 |
| Exact-overlap flip rate | 0% |
| Corpus non-forced flip rate (projected) | 337 / 6791 = **4.96%** (all newly rejected; newly admitted 0) |
| Tier mix before (non-forced) | exact 109 / search 3689 / heuristic 2993 |
| Tier mix after (projected) | exact 109 / search 3352 / heuristic 3330 |

**F3 DECISION: FAIL — retain existing coverage gate**

Internal: `INSUFFICIENT_EVIDENCE` (newly admitted = 0 under the AND gate with the same coverage floor; inconclusive samples are not PASS). F3b is **not** allowed to proceed.

Note: recorded-client-policy snapshot replay remains skipped (known cursor mismatch); exact-overlap used replayable recorded-self-play locked-yard positions only. Corpus tier-mix used all 12,973 stored evaluations.

### F4 — Review latency

| Step | Size | Deliverable | Acceptance |
|---|---|---|---|
| **F4a** | M | Worker-pool parallelization of `runReviewBatch`; output byte-identical regardless of worker count | Same snapshot + budget → identical JSON on 1 and N workers |
| **F4b** | S | Per-decision wall-clock ceiling on the oracle; overrun sets `search.complete = false`, never reorders candidates silently | Test with a forced-slow position |
| **F4c** | XS | Before/after wall-clock for a master-tier corpus game | Measured numbers only |

## Sequencing

1. **F0** first, alone.
2. **F1a → F1b/F1c** start immediately after F0. They are long-running: launch them early, in the background, and build other things while they run.
3. **F2a–F2e** and **F3a**, **F4** run in parallel with F1 (independent files). F2c uses provisional cap constants until F1c reports.
4. **F3b** waits for F3a's result and the coverage-gate rule.
5. **Ship gate** (below) before any prose reaches users.

Dependencies to respect: F2c ← F1c (final cap values); F2e ← F2d; F3b ← F3a; F4 is independent.

## Ship gate for user-visible prose

All of the following, in order:

1. F1b and F1c have reported and their decision rules have been applied.
2. F2e sample doc exists, and the product owner has read at least 10 samples and said which read like a strong player wrote them. **This is a creative call and cannot be inferred by an agent.**
3. Truth tests green; no Fritz rating anywhere in touched copy.
4. Prose is enabled behind the flag for the admin cohort only first. `POST_GAME_REVIEW_VISIBLE` is unchanged.

## Human-owned decisions (agents must not resolve these)

| Decision | Owner | Status |
|---|---|---|
| Is the review voice right? (sample doc sign-off) | Product owner | Pending F2e |
| Run `fritz-master-vs-humans-winrate.sql` against production (or approve an agent run) | Product owner | Pending F1d |
| Which Fritz Master number is intended, 2200 or 2400 | Product owner | Open; agents must not pick one |
| Approve any proposal to change the oracle's heuristic-tier fallback or search budget | Product owner | Only if F1b triggers it |
| Enable prose for the admin cohort | Product owner | After Ship gate |
| Manual production verification of Phase E with a real admin login (complete match → review appears → persists → reopens) | Product owner | Still open from Phase E |

## Explicitly deferred

- Hub/branch-geometry tactics and multi-ply tactical narrative (requires new geometry analysis and populated principal variations; `principalVariation` is currently always empty).
- Consolidating the ported feature logic back into `botHeuristics.ts` (production regression risk).
- Raising the search budget (blocked by latency and by the fact that the 2% coverage problem is a metric problem, not a compute problem).
- Implementing luck-vs-skill separation and any hidden-hand reveal UI.
- Converting Fritz Master's wall-clock deadlines to node budgets for cross-machine reproducibility (small and localized; do it if F1 reproducibility issues appear).
- MP-specific adjustments beyond what already shipped in E5.

## Chess.com-parity roadmap (F1e audit)

**Audit context (2026-09-21).** Phases A–E engineering is shipped. F2 prose
engineering is shipped behind its default-off flag: PR #285's historical study
is 189/280 (67.5%); PR #286 corrected displayed-reference semantics; and PR
#287's one shared facts pass is 201/280 (71.8%), with 12 rendered true-equality
cases and 79 remaining unsupported (70 displayed-reference values unavailable,
9 below the materiality floor, 0 other). Heuristic Fritz expected value is
unavailable by design. Contested Fritz jitter remains an activation blocker;
F1c is unrun; and prose voice is not human-approved for public activation. The
71.8% is a pass-specific rendered-coverage measurement, not an accuracy score.

| Capability | Status | Current evidence | Exact gap | Roadmap action |
|---|---|---|---|---|
| Win-probability / advantage graph | missing | `ReviewEvaluationV1` carries candidate `value.winProbability` (`packages/review-engine/src/reviewCaptureSchema.ts`); `GameReviewer` renders move navigation, ratings, coaching, and PV only (`client/src/analyzer/GameReviewer.tsx`). No review chart/graph component or rendering path exists (repository search of analyzer, pivotal-review, and bot review surfaces). | No user-facing over-game probability/advantage timeline, including no linked move cursor. | **F1e-1 advantage timeline** — show a review-wide, cursor-linked advantage series; primary systems: `GameReviewer.tsx`, `GameReviewer.css`, persisted `game_reviews` evaluations; dependency: stable per-review facts/persistence; can follow public prose activation because the current per-move review remains understandable without a graph. |
| Per-move classification | present | `GameReviewer` navigates every analyzed move with `cursor` and `selectedHandNumber`, reads each resolved evaluation via `decisionIdByMoveNumber`, and renders `selectMoveHeuristicClassification` / `heuristicClassificationToDisplay` plus rating state (`client/src/analyzer/GameReviewer.tsx`). Coverage includes `GameReviewer.heuristicRender.test.tsx`, `GameReviewer.searchBadge.test.tsx`, and `GameReviewer.coachingPanel.test.tsx`; post-game entry is `PostGameReviewPrompt` → `openReviewGameFromPrompt` in `client/src/modules/review/usePostGamePivotalReview.ts`. | None for the normal in-memory post-game flow; historical reopen remains separately missing below. | none |
| Key-moment / mistake list | partial | `selectPivotalTurns` ranks up to three scorable player decisions by expected loss (`client/src/training/pivotalReview/pivotalTurnSelector.ts`); `PivotalTurnReviewCard` and `PivotalReviewSummary` render the selected turns and lessons, with tests. `BotPivotalReviewPortal` wires it, but `PIVOTAL_REVIEW_WIZARD_ENABLED` is false and `usePostGamePivotalReview.ts` documents the path as inert on main. | The selector/list is not reachable in the normal current post-game flow and is not reconstructed for history. | **F1e-2 reachable key moments** — expose a deterministic, linked key-moment list from the regular Game Review; primary systems: pivotal selector/cards and `GameReviewer`; dependency: F1c/determinism for trustworthy contested ranking, then historical review loading for reuse; required before public prose activation only if the launch promise includes a curated mistake list, otherwise can follow the core review launch. |
| Best/reference move shown on board | partial | `GameReviewer` renders the review board and a `gr-ghost-tile` when an oracle best tile differs (`client/src/analyzer/GameReviewer.tsx`); it labels the tile “Best move.” It also has a synthetic PV board stepper (`GameReviewer.pvBoard.test.tsx`), while that test records production's current state as “No continuation recorded for this move.” `PivotalTurnReviewCard` shows best action text, not a placement overlay. | The ghost tile does not show the exact reference placement/end/branch spatially; production PVs are empty, so the stepper cannot provide that visualization. | **F1e-3 reference-placement overlay** — show the exact displayed reference action on the pre-move board, including end/branch; primary systems: `GameReviewer.tsx`, Board overlay API, `ReviewAction`; dependency: no new evaluation semantics, but must honor F2 displayed-reference source labels; can follow activation because text/reference facts remain available. |
| Retry-a-mistake / try-again | missing | `PivotalTurnReviewCard` only steps through reflection cards and completes notes; `PivotalReviewSummary` only selects a hand. The match `rematch` routes are whole-game multiplayer flow (`server/src/multiplayer/registerRematchPregameHandlers.ts`), and the history scrubber is disabled after game over (`client/src/bot/view-model/resolveHistoryScrubberView.ts`). No reviewed-state replay/alternative-comparison action exists. | A reviewed decision cannot launch a playable reconstruction of that position or compare a retry against its reference. | **F1e-4 decision retry sandbox** — start a non-persistent practice state from a selected reviewed snapshot and compare the retry to the stored reference; primary systems: review snapshots, Board/match runtime, GameReviewer; dependency: retained review snapshots plus explicit practice-state ownership; can follow public prose activation because it is instructional depth, not required to understand a review. |
| Reopen historical completed game with same review/explanations | present | Server persists versioned `replay_artifact` (artifactVersion 1: analysis navigation/boards + canonical coaching facts + rendered prose) alongside evaluations (`supabase/migrations/2026-09-22_game_reviews_replay_artifact.sql`, write via `postGameReviewWrite` / PR #289 store). Exact read: `GET /api/game-reviews/by-id/:reviewId`. History entry: Play vs Fritz “Recent reviews” → Review Game (`HistoricalGameReviewPortal`). GameReviewer historical mode hydrates stored facts/prose with zero Fritz/worker recomputation. Legacy rows without artifact show an explicit notice and do not recompute. Actor pre-move hand is carried in `analysis.analyzedMoves[].handBefore` (+ `validMoves`); live and historical share `buildReviewDecisionHandContext`. | None for new artifact rows; legacy rows intentionally lack replayable explanations. | none — F1e-5 complete for replayable artifact rows |
| Decision hand context (pre-move “Your hand”) | present | `GameReviewer` renders `Your hand` from `buildReviewDecisionHandContext` (`client/src/analyzer/reviewDecisionHandContext.ts`) for the selected decision: full actor `handBefore`, Played highlight on place, tile-level Playable from `validMoves`, held tiles remain visible (quieter). Pass/draw show hand with no Played badge. Live post-game and historical reopen use the same analysis fields; artifact v1 already persisted them inside `analysis` (no schema bump). Tests: `GameReviewer.handContext.test.tsx`, `reviewDecisionHandContext.test.ts`, extended identity in `gameReviewReplayArtifact.test.ts`. | None for actor-visible hand. Opponent private hand is not persisted/rendered for this UI. | none — required for V1 closeout; completed in #292 |

### F1e parity conclusion

**Present: 3. Partial: 2. Missing: 2.** Per-move classification, historical
reopen (F1e-5), and decision hand context (“Your hand”) are complete locked
surfaces for rows that include the versioned replay artifact. Key moments and
reference-on-board remain presentation/UX gaps. The advantage graph and retry
sandbox remain post-launch enhancements.

Historical reopen loads the persisted Path A artifact (canonical
`ReviewCoachingFacts` + rendered prose + analysis navigation, including actor
pre-move `handBefore` / `validMoves`) by exact review id. It does not recompute
Fritz. Legacy rows without `replay_artifact` show an honest unavailable notice.
Public prose / positional flags remain default-off.

### Review facts consistency contract

Within **one review instance**, each decision has at most one canonical
`ReviewCoachingFacts` result (keyed by stable decision ID). Production
consumers (`GameReviewer` coaching, contested metadata, displayed Fritz
reference / prose derived from those facts) must reuse that published result
rather than independently re-running Fritz-derived fact construction.

This is **intra-review consistency**, not cross-review determinism: Fritz
Master remains wall-clock bounded (`botHeuristics.ts` unchanged), so two
independently created reviews of the same game may still differ. Historical
replay (F1e-5) **persists/loads** the canonical review artifact (including
rendered prose) instead of recomputing it.

Owner: review-runtime `ReviewCoachingFactsStore` (fresh per match digest) +
lazy `createReviewCoachingFactsResolver` inside the reviewer; persistence
builds the artifact through that same store before POST.

### F1c disagreement adjudication (D2) — reported

Corpus: 100 recorded games (self-play + client-policy), 12,973 decisions,
3,447 oracle/Fritz disagreements. Sign: `oracle − Fritz` (positive favors
oracle). Actions frozen once per decision (Fritz resolved once; reused across
128 paired rollouts × 2 non-Fritz/non-oracle continuation policies). Exact
uses complete exact solve where available (39 exact / 3,401 rollout
adjudications).

| tier | disagreements | oracle wins | Fritz wins | ties/indistinguishable | mean oracle−Fritz gap | 95% CI | D2 result |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| exact | 60 | 16 | 6 | 38 | +0.907 | [−0.816, +2.817] | indistinguishable (exact remains per-decision ground truth; no contested cap vs exact) |
| search | 1,902 | 302 | 35 | 1,565 | +0.553 | [+0.390, +0.772] | **oracle wins** |
| heuristic | 1,485 | 47 | 185 | 1,246 | −0.590 | [−0.859, −0.355] | **Fritz wins** |

D2 branches: search → oracle-wins; heuristic → Fritz-wins; exact aggregate →
indistinguishable. Locked decision 1’s reference sources already match the
winners.

**F1c production application (D2 behavior):** search D2 winner = oracle, CI
`[+0.390, +0.772]`; heuristic D2 winner = Fritz, CI `[−0.859, −0.355]`.
Existing reference policy already matched both winners, so **no
reference-policy reversal** was required. Disagreement remains reportable as
`agreement.contested`. The provisional automatic Inaccuracy severity cap is
**retired** for search/heuristic under the engine-wins branch — validated
reference classifications can again surface Mistake/Blunder. Exact remains
exact-ground-truth authoritative (no disagreement-based cap). The F1c Ship
Gate requirement is **COMPLETE** (PR #291 squash `da17515e`).

Canonical write-up:
`docs/oracle-strength-validation-runs/f1c-disagreement-adjudication-2026-09-21.md`.

## Risks

- **Oracle may not be stronger than Fritz.** The 80-game result is underpowered. F1 is designed to find out honestly; the decision rules above fix the response in advance.
- **Convergence diagnostic ≠ correctness.** It measures sampling stability, not determinization bias. Hence the exact-solver validation requirement.
- **Porting drift.** Ported features can diverge from the originals. F2b exists to catch it; deviations must be listed, not hidden.
- **Silent accuracy shifts.** Changing the coverage gate changes which moves count toward accuracy. F3b's version bump and recalibration are mandatory.
- **False confidence from summaries.** Server Validation has previously passed on stale local `dist/`. Confirm it by name in CI output; rebuild `dist/` clean before trusting local results.

## Key file index

| Area | Paths |
|---|---|
| Oracle and dispatch | `packages/review-engine/src/evaluateReviewPosition.ts`, `solveExactEndgame.ts`, `solveMidgameDeterminization.ts`, `solveHeuristicOpening.ts`, `searchGameTree.ts` |
| Budget/config | `client/src/modules/review/reviewEngineConfig.ts`, `runReviewBatch.ts`, `reviewWorker.ts` |
| Fritz Master | `client/src/modules/fritz/botHeuristics.ts` (do not modify), `client/src/modules/fritz/fritzConfig.ts` |
| Ratings (constants, not measurements) | `server/src/ranking/glicko2.ts`, `client/src/ranking/glicko2.ts` |
| Accuracy model | `packages/review-engine/src/accuracyModelCalibration.ts`, `MINIMUM_COVERAGE_FLOOR` |
| Coaching | `reviewCoachingProse.ts`, `buildReviewCoachingFacts`, `reviewCoachingFactsResolver.ts`, `reviewCoachingFactsStore.ts` |
| Corpora | `packages/review-engine/fixtures/recorded-self-play`, `recorded-client-policy` |
| Prior plans | `docs/scoping/game-review-oracle-upgrade-2026-09-13.md`, `docs/game-review-analyzer-audit.md` |

---

## Amendments 2026-09-19

These product-owner amendments supersede conflicting acceptance criteria and sequencing above. Locked decisions, human-owned decisions, protected files, production restrictions, and merge policy otherwise remain binding.

### Recovery and documentation

F0 is accepted. Recovery commits: Track A `fc02985e`, Track B `90c0d914`, Track C `ed553d25`, root audit `ef0f6990`. Publish this plan at `docs/scoping/game-review-explanation-overhaul-2026-09-19.md` in a docs-only PR off main containing only the plan and these amendments. Do not include `F0-AUDIT.md` or `PROGRESS-F.md`. It may merge only after the full `gh pr checks` output is shown, CI is green, and **Server Validation** is confirmed passed by name.

### F1a reproducibility

Master's wall-clock cutoffs are in protected `botHeuristics.ts`; byte-identical Master reruns are not achievable. Everything except those cutoffs must be seed-deterministic. Log each Master decision as state digest → move so any game can be replayed exactly. Report Master's move-level rerun divergence rate on 50 seeds run twice. Do not modify `botHeuristics.ts` or `solveHeuristicOpening.ts`.

### CPU-load and laptop guards

- This is an 8-core, fanless MacBook Air. F1 runs use at most 4 worker processes; concurrently running variants must share that total limit.
- Launch **every F1 job** under `caffeinate -i`. Before launching, tell the product owner to keep the Mac plugged in, lid open, and other heavy apps closed, and wait for their explicit **ready** reply.
- Record `os.loadavg()` at start, end, and every 5 minutes in the results file. Flag any run whose sampled 1-minute load exceeds 6.
- Before F1b, run a 40-seed Master-vs-oracle check at 1 worker and at 4 workers. If Master's mean score differs by more than its seed-to-seed standard error, lower the worker count until it does not.
- Run the same 40-seed batch at the **start and end** of F1b, at the selected worker count. If Master's mean score differs by more than its seed-to-seed standard error, report thermal compromise and rerun at fewer workers or in shorter batches with cool-down gaps. **Do not report D1 numbers as valid without this thermal-drift check.**
- Interleave variants in chunks (for example 100 default games, then 100 Fritz-fallback games, repeating), so thermal drift affects both variants. Do not execute all of one variant before the other.
- While F1b runs, do **edits only**: no typechecks, vitest runs, builds, full suites, F3a, or other heavy jobs. This supersedes the earlier allowance for typechecks and single-file tests.
- Launch simulations detached with fixed seeds and results written to files. Check only results files, at most once every **20+ minutes**; do not poll jobs.

### Track B split

F3a is a validation study only. Preserve F3b gate changes in `evaluateReviewPosition.ts`, floor changes in `gameAccuracyModel.ts`, recalibration harness, and associated changes on held branch `hold/f3b-convergence-gate`. The F3a PR must not change the gate, floor, or any displayed number. Fix `validateMidgameConvergenceGate` to exclude positions with `exact.complete === false` and report the excluded count. Adoption still requires the pre-committed coverage decision rule and product-owner review.

**F3a outcome (2026-09-22):** FAIL — retain existing coverage gate. F3b cancelled / not adopted. See `docs/review-convergence-gate-validation.md`.

### F2b parity

Use `packages/review-engine/fixtures/recorded-self-play` for per-feature numeric parity against the originals. For each of the seven feature groups in F2a, name the original function being ported and the tolerance. For features without an original, test stated invariants. Composite-best ranking agreement does **not** count as parity.

### F4 acceptance

Replace mock-only pool evidence with a real-worker byte-identical test at 1 versus N workers. Fix the three recovered client TypeScript errors. Apply the wall-clock ceiling to the **whole** `evaluateReviewPosition` path, with a forced-slow test; an exact-solver-only ceiling is insufficient. Preserve incomplete-result labeling and the prohibition on silently changing candidate rankings.

### Amended execution order and reporting

1. Verify the latest commits on the four recovery branches and root branch; report in five lines.
2. Open and land the docs-only plan PR under the merge policy.
3. Fix F1a, then time a 2-game run and report the projected wall-clock for 2 variants × 600 games. If the projection exceeds 8 hours, use 400 games per variant and report the resulting CI. The readiness guard applies before any F1 execution.
4. Run the 50-seed repeatability study and CPU-load calibration; launch F1b as interleaved detached chunks under the laptop guards. Report paths, PIDs, and ETA, then stop polling.
5. While F1b runs, make only code edits for Tracks A, B (F3a), and C. Do not build Track A prose UI wiring beyond the default-off flag before product-owner approval.
6. After F1b and the thermal check finish, report valid D1 numbers and the decision-rule branch, or report thermal compromise. Then run F3a, F1c (D2), and F4c before/after timing; do not run these concurrently when they use Master.
7. Open each track as its own PR off main. No user-visible, classification, accuracy-number, or stored-data changes may merge without product-owner review. Devtools/docs/pure-additive PRs require full `gh pr checks` output and Server Validation passed by name before merge. Rebuild `dist/` clean before trusting local results.

One agent, one session, no subagents. Report after verification + docs PR, F1b launch, F1b results, and each PR opened, using plain tables. Checkpoint after each step: commit to its branch and update untracked `PROGRESS-F.md` (step, status, branch, next step, blockers; at most 10 lines). Preserve the earlier two-failed-fix-attempt stop rule, package-scoped development tests, once-per-PR full validation, and all hard constraints. If sandboxing blocks an action, report the exact command for the product owner to run; do not work around it.
