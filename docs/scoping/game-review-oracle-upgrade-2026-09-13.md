# Game Review Oracle Upgrade — Scoping Doc (Phases A–E)

**Status:** Phase A approved. Build A0–A6 as independently reviewable PRs. Hold Phase B until A is fully merged and captured snapshots are verified against a real played-out game.

**Date:** 2026-09-13

**Independence:** This workstream is independent of the paused Journey visual-identity work. Do not block on Journey PRs.

**Related prior art (do not re-litigate Batch 0):**
- `docs/game-review-analyzer-audit.md` — root-cause audit (2026-08-10)
- `docs/game-review-chess-parity-implementation-plan.md` — Batches 0–6 plan; **Batch 0 contracts are implemented**; Batches 1–6 are not
- `packages/game-core/src/reviewContracts.ts` + `reviewFixtureCorpus.ts` — V2 snapshot/eval schemas + fixture corpus

**Product contract (unchanged from audit):**
- **Review Engine** = versioned search over a complete recorded public position
- **Fritz’s read** = live opponent policy preference; never presented as objective best play
- **Exact / search / heuristic** evidence labels must match what the evaluator actually did
- Public `POST_GAME_REVIEW_VISIBLE` stays `false` until Phase E says otherwise

**Locked decisions (2026-09-13):**
1. **Oracle package home:** new `packages/review-engine` (not game-core). Skeleton lands in Phase B0 — not during capture.
2. **Headline accuracy:** heuristic / opening-only moves are **excluded entirely** from the % — not down-weighted.
3. **A4 actor coverage:** capture **both** actors (player and opponent) from day one.
4. **Server persist (E0):** starts **strictly after B5** — not in parallel with Phase A.

---

## Baseline: what Game Review actually is today

Verified against live code (not the canvas brief alone).

### Flags

| Flag | Value | File |
|---|---|---|
| `POST_GAME_REVIEW_VISIBLE` | `false` | `client/src/appRouteTypes.ts:25` |
| `PIVOTAL_REVIEW_WIZARD_ENABLED` | `false` | `client/src/modules/match/types/matchRuntimeTypes.ts:4` |
| Admin bypass | `isAdmin \|\| POST_GAME_REVIEW_VISIBLE` | `postGameReviewPolicy.ts` |

### Live pipeline

```text
Action boundary
  → collect*Snapshot / build*MoveLogEntry  (V1 MoveEntry)
  → ReplayRecorder.recordMove

Game over (admin only in practice)
  → analyzeMoveLogDeferred
  → buildEvalState (lossy reconstruct) + Fritz heuristic classifyMove
  → GameAnalysis + LEGACY_ANALYSIS_DISCLOSURE
  → PostGameReviewPrompt → GameReviewer
```

### What Batch 0 already shipped (reuse, do not rebuild)

| Asset | Location | Status |
|---|---|---|
| `ReviewPositionSnapshotV2` | `packages/game-core/src/reviewContracts.ts` | Done |
| `ReviewEvaluationV1` | same | Done |
| `createReviewPositionSnapshotV2` | same | Done — **zero production callers** |
| `replayReviewFixture` | same | Done |
| Fixture corpus (8 categories) | `packages/game-core/src/reviewFixtureCorpus.ts` | Done |
| Legacy disclosure | `LEGACY_REVIEW_EVALUATION_DISCLOSURE` | Wired into analyzer/UI |
| Package export | `@racehorse/game-core/review` | Done (not on root barrel) |

### Honest one-line gap

Everything needed to *define* a fair review input already exists in game-core. Everything needed to *produce* that input at decision time, *evaluate* it with a review oracle, and *teach* from the result does not.

---

## Phase A — Capture (`ReviewPositionSnapshotV2` at every decision)

### Question

Can we wire V2 snapshots from today’s action boundaries with real opponent-hand-count, boneyard counts, scores, missing-pip evidence, and version stamps — without inventing placeholders?

### Finding: yes, data is already on `BotMatchState` at the call site. It is discarded by the V1 log schema.

### What exists (reuse)

**Action-boundary hooks (do not invent new ones):**

| Role | File |
|---|---|
| Player snapshot | `client/src/modules/player-turn/playerMoveSnapshot.ts` |
| Player entry builders | `client/src/modules/player-turn/playerMoveLogEntries.ts` |
| Player place call site | `client/src/modules/player-turn/usePlayerPlacementHandler.ts` (~161–184) |
| Bot snapshot | `client/src/modules/bot-turn/botMoveSnapshot.ts` |
| Bot entry builders | `client/src/modules/bot-turn/botMoveLogEntries.ts` |
| Bot append | `client/src/modules/bot-turn/botActionCompletion.ts` |
| Timeline | `client/src/modules/replay/ReplayRecorder.ts` |
| Append bridge | `client/src/modules/match/match-turn-stack/useReplayMoveAppender.ts` |
| `BotMatchState` → `GameState` | `client/src/modules/match/runtime/gameCoreAdapter.ts` → `toCoreGameState` |
| V2 factory | `createReviewPositionSnapshotV2(authorityPreState, command, identifiers, knownMissingPipEvidence?)` |

**Available on `BotMatchState` at snapshot time but not written into `MoveEntry`:**

| Field | On state? | In V1 `MoveEntry`? |
|---|---|---|
| Opponent hand length | yes (`players.bot.hand.length` / symmetric) | **no** |
| `boneyard.length` / dead tiles | yes | **no** |
| Scores + `winningScore` | yes | **no** |
| `consecutivePasses` | yes | **no** |
| Missing-pip / pass-on-end live fields | yes (see below) | **no** |

**Live missing-pip accumulation already exists — but only for Fritz heuristics, not V2:**

| Mechanism | File | Shape |
|---|---|---|
| Draw-until-playable evidence when human draws | `botEngine.ts:619–641` | `opponentKnownMissing`, `opponentMissingEvidence: { pip, handNumber, turnIndex }[]` |
| Pass/draw open-end append | `applyPlayerActionResult.ts:26–32` | `opponentPassedOnEnds: number[]` |
| Fritz consumption | `botHeuristics.ts` `inferMissingPips` | heuristic weights only |

Fixture corpus already knows how to record V2 evidence (`reviewFixtureCorpus.ts` `recordMissingPipEvidence` with reasons `passed_on_open_end` | `drew_past_open_end`). That helper is **fixture-only** today.

### What must be replaced / built

1. **Stop treating V1 `MoveEntry` as the review-engine input.** Keep `MoveEntry` for timeline/replay UI if useful, but review evaluation must consume `ReviewPositionSnapshotV2[]` (or a thin wrapper that embeds them).
2. **Map live evidence → `ReviewKnownMissingPipEvidence`.** Current live fields are Fritz-oriented (`opponent*` naming, no `reason` / `openEnds` / `opponentId`). Need a small pure adapter + accumulation on **both** actors’ pass/draw events (today’s live path is incomplete for a fair public information set — bot passes/draws are under-logged for review).
3. **Call `createReviewPositionSnapshotV2` at the pre-action boundary** with `toCoreGameState(preState)` + the actual `GameCommand`. Do not hand-author snapshot fields; the factory already projects public facts and digests.
4. **Version stamps come free from the factory** (`snapshotVersion`, `rulesVersion`, `commandVersion`, `reviewEngineVersion`, `stateDigestVersion`). Identifiers (`sessionId`, `gameId`, `handId`, `decisionId`, mode, sequences) must be supplied by the match runtime — those IDs are the new plumbing work.

### Multiplayer note (Phase A scope boundary)

MP already has a thinner capture path (`buildGameplayMoveTelemetry` + `pickEngineBestMove` pip heuristic). **Phase A ships PVF/bot first.** MP parity is Phase E last, after PVF reviews are trustworthy. Do not expand A to MP “while we’re here.”

### Phase A — small independently reviewable steps

| Step | Size | Deliverable | Acceptance |
|---|---|---|---|
| **A0** | XS | Pure adapter: live `opponentMissingEvidence` / pass-on-end events → `ReviewKnownMissingPipEvidence[]` + unit tests | Round-trip fixtures; no production wiring yet |
| **A1** | S | Accumulate V2-shaped evidence for **both** actors on pass + draw-past-open-end in bot engine / player action path (extend, don’t invent a second system) | Evidence present on state after scripted pass/draw sequences |
| **A2** | S | `captureReviewSnapshotAtDecision(preState, command, ids, evidence)` thin wrapper around `toCoreGameState` + `createReviewPositionSnapshotV2` | Unit tests against game-core fixture categories |
| **A3** | S | Wire capture into **player place/draw/pass** PVF path only; append to an in-memory `reviewSnapshots: ReviewPositionSnapshotV2[]` on the match/review runtime (do not persist server-side yet) | Completing a short PVF hand yields one snapshot per player decision; digests match `toCoreGameState` |
| **A4** | S | Wire capture into **bot place/draw/pass** path (bot actor snapshots too — needed for fair midgame search later, even if UI only grades “you”) | Snapshot count = all actors’ decisions in hand |

**Accepted asymmetry:** bot-actor PVF snapshots retain the bot's true actor hand for the planned A4 analysis use; MP masks the opponent hand because it is not client-visible, and this difference is deliberate rather than missed.
| **A5** | S | Analyzer dual-read shim: if V2 snapshots present, refuse to invent placeholders in `buildEvalState`; if absent, keep legacy path + `LEGACY_ANALYSIS_DISCLOSURE` | No silent promotion of V1 → “exact” |
| **A6** | S | Session-local persistence of snapshot array (RAM + optional localStorage for admin reopen) — **not** server yet | Refresh within session can reopen; no schema migration of old histories |

**Out of A:** review search, accuracy formula changes, coaching rewrite, public flag, server tables, MP capture.

**Risks:**
- `createReviewPositionSnapshotV2` requires 1v1 `GameState` and matching `command.sequence` / `actorId` — capture must happen on the true pre-action state before any apply.
- Actor hand is private during live play; V2 includes `actorHand` for post-game review only. Do not ship snapshots to opponents mid-match.
- Daily Fritz / guided / journey paths share bot hooks — gate capture with the same eligibility policy as review (`isBotPostGameReviewEligible` or a narrower `isReviewCaptureEnabled`) so we don’t bloat DF verification payloads.

---

## Phase B — Oracle v1 (versioned Review Engine)

### Question

Is a layered exact / determinization / heuristic Review Engine buildable on game-core’s existing primitives, with fixed compute budgets for determinism?

### Finding: yes for primitives; no existing review engine to extend. Fritz search is a labeled fallback candidate only.

### What exists (reuse)

| Primitive | Location | Role |
|---|---|---|
| `getLegalMoves`, `canDraw`, `applyMove`, … | `packages/game-core` `./engine` | Candidate enumeration |
| `applyGameCommand` | `./commands` | Authoritative transition |
| `simulatePlacement`, `computePlayScore`, `getOpenEnds` | `./scoring` | Immediate points / geometry |
| `GameState` / `Config` | `./types` | Authority state |
| V2 eval contract | `ReviewEvaluationV1` | Output schema already designed |
| Fixture corpus | `reviewFixtureCorpus.ts` | Golden inputs for B |
| Fritz MC + `minimaxFull` | `client/src/modules/fritz/botHeuristics.ts` | **Heuristic leaf / “Fritz’s read” only** — inputs are `BotMatchState`, wall-clock 90ms Master endgame |

**Server today:** no analysis worker, no `/review` route, no GameAnalysis persistence API.

### What must be built (replace)

A new **pure review package** (recommended: `packages/game-core` sibling module or `packages/review-engine`) that:

1. Takes `ReviewPositionSnapshotV2` (+ optional authority only in fixtures).
2. Never fabricates opponent hands of length 0 or fake 14-tile boneyards.
3. Returns `ReviewEvaluationV1` with `evidence.source ∈ {exact, search, heuristic}`, confidence, loss, candidates, PV, search diagnostics.
4. Uses **fixed node/sample budgets** for determinism (not `performance.now()` cutoffs). Production may add a hard safety timeout that marks `search.complete: false` rather than silently changing rankings.

### Layering (product requirement → technical mapping)

| Phase of game | Method | Evidence | Confidence | In headline accuracy? |
|---|---|---|---|---|
| Endgame (small information set: few tiles total, locked/drawable yard small, evidence tight) | Exact or enumerate feasible hidden allocations + solve | `exact` or `search` with `complete: true` | high | **Yes** |
| Midgame | Determinization / expectimax (or IS-MCTS) over hands+boneyard consistent with public counts + missing-pip evidence | `search` | medium (or low if coverage thin) + **convergence/coverage signal** | **Yes if coverage ≥ threshold**; else exclude or down-weight |
| Opening / high uncertainty | Existing Fritz strategic evaluator, honestly labeled | `heuristic` | low · display **“Fritz’s read”** | **No** — excluded from headline accuracy aggregate |

**Confirm buildability:** every transition needed is already `getLegalMoves` + `applyGameCommand` / `simulatePlacement`. Hidden-state sampling is the new work; game-core deliberately omits opponent hand identities from V2 — the engine must sample consistent completions, not read secrets from the snapshot.

**Do not** call live Fritz `chooseBotMove` the Review Engine. Optionally compute Fritz’s tier move as a **second comparison field** (“Fritz would play”) after the oracle result exists.

### Phase B — small independently reviewable steps

| Step | Size | Deliverable | Acceptance |
|---|---|---|---|
| **B0** | S | Package skeleton: `evaluateReviewPosition(snapshot, budget) → ReviewEvaluationV1` stub that returns heuristic-only with correct low-confidence labeling | Typecheck + contract tests |
| **B1** | S | Deterministic hidden-allocation sampler from public counts + missing-pip evidence (pure, seeded) | Unit tests: sampled hands never violate evidence; seed-stable |
| **B2** | M | Exact/near-exact endgame solver on fixture category `exact_endgame` (+ locked yard) with node budget | Golden fixture byte-stable candidate ranking for `engineVersion` |
| **B3** | M | Midgame determinization/expectimax with recorded `nodes`, `hiddenStateSamples`, `coverage`, convergence diagnostic | Coverage increases monotonically with budget on ambiguous fixture; incomplete runs set `complete: false` |
| **B4** | S | Opening/insufficient-coverage path → heuristic “Fritz’s read” adapter (port leaf features, not tier noise / wall-clock) | Heuristic branch cannot emit `confidence: 'high'` (enforced by type + test) |
| **B5** | S | Client Web Worker host for B0–B4 (sync API + worker transport); stamp `reviewEngineVersion` + budget in every result | Same snapshot+budget → identical JSON on two runs |
| **B6** | S | Optional thin server route/worker that runs the **same pure package** (no second implementation) — cache key = digest+engineVersion+budget | Idempotent; not required to flip public flag yet |

**Out of B:** accuracy aggregation formula, coaching prose, public flag, MP.

**Risks:**
- Domino imperfect information is wide in opening — resist expanding “exact” claims.
- Porting Fritz leaf eval into the review package risks pulling `BotMatchState` — keep a narrow feature interface over public+actor-known facts.
- Godfile / architecture: do not dump oracle into `dailyFritz.ts` or `BotMatchScreen` blobs; new package + thin route registrar only.

---

## Phase C — Accuracy (continuous move-value-loss)

### Question

How do we replace fixed buckets / forced-move caps with calibrated accuracy?

### Finding: do not tune today’s `99/92/80/60/38/18` constants. They are structural, not a calibration knob.

### What exists (replace)

Still live in `client/src/analyzer/moveAnalyzer.ts` `classifyMove`:

| Condition | Score | Label |
|---|---:|---|
| Exact tier match | 99 | Brilliant |
| `normalizedDiff` thresholds | 92 / 80 / 60 / 38 / 18 | Great → Blunder |
| Forced draw/pass | 84 | Good |
| Only-legal tile | 80 | Good |
| Eval unavailable | 72 | Good |

Hand/game accuracy = arithmetic mean of those scores. Letter grades S/A/B/C/D from the same means.

### Proposed model (design; calibrate before shipping numbers)

1. **Quantity:** expected final point differential (primary) and optional win probability from the decision point (secondary when search provides it).
2. **Move loss:** `value(best) − value(played)` on that scale (from `ReviewEvaluationV1.loss`).
3. **Forced / no-choice:** neutral contribution to accuracy (**100** or excluded from denominator) — never an 80-cap penalty.
4. **Heuristic-only decisions:** excluded from headline accuracy (Phase B rule), shown separately as “Fritz’s read.”
5. **Aggregate:** monotonic mapping from mean (or sum) loss → 0–100, versioned (`accuracyModelVersion`).
6. **Labels** derived from loss + context:
   - Best = within search tolerance of top
   - Inaccuracy / Mistake / Blunder = increasing loss bands (calibrated)
   - Brilliant / Great = **positive tags** requiring uniqueness / sacrifice / swing — not synonyms for “exact match”

### Fixture-corpus calibration approach

Reuse and extend `reviewFixtureCorpus.ts` categories:

| Dataset | Purpose |
|---|---|
| Oracle self-play / exact endgames fixtures | Upper bound: near-100 when always playing `best` |
| Strong policy play (Master Fritz without tier noise, recorded) | High but not perfect distribution |
| Ordinary PVF tier play | Mid distribution |
| Deliberately poor / random legal | Low tail without floor inflation |
| Forced-move fixtures | Prove forced decisions do not drag accuracy |

**Process:** freeze `engineVersion` + `accuracyModelVersion` → compute loss histograms → fit monotonic map → publish acceptance tests (monotonicity, forced-move invariance, optimal-game ceiling, poor-play floor). Product/data review signs the observed distribution **before** UI claims “accuracy %.”

### Phase C — small independently reviewable steps

| Step | Size | Deliverable | Acceptance |
|---|---|---|---|
| **C0** | S | Spec doc in-repo: loss definition, exclusion rules, label bands (no UI yet) | Written + reviewed |
| **C1** | S | `accuracyFromEvaluations(evals[])` pure module + property tests (monotonicity, forced-neutral) | Unit only |
| **C2** | S | Calibration harness over fixture corpus + recorded self-play logs (script, not UI) | Checked-in report artifact |
| **C3** | S | Dual-run shadow: old bucket accuracy vs new (admin-only, no player-facing) | Disagreement fixtures logged |
| **C4** | S | Switch GameAnalysis accuracy/grade to new model **only when** all moves in aggregate have non-heuristic evidence (else show “partial / Fritz’s read”) | No silent mix |

**Out of C:** coaching copy rewrite (D), public flag (E).

---

## Phase D — Coaching (one structured compare path)

### Question

How do we kill the three competing copy paths and teach — including same-tile-wrong-end?

### Finding: three live paths still compete; structured eval facts do not yet drive UI.

| Path | File | Problem |
|---|---|---|
| `buildExplanation` | `moveAnalyzer.ts` | Position-ish but often unused by UI |
| `positiveNote` | `GameReviewer.tsx` | Hardcoded praise for Brilliant/Great/Good |
| `buildReviewSidebarCopy` | `reviewSidebarCopy.ts` | Gap cascade → vague “engine rated X stronger” / “Fritz didn’t score” |

GameReviewer already has board + best-move ghost skeleton — keep the shell, replace the facts.

### Same-tile-wrong-end (explicit category)

When `played.tile` equals `best.tile` but `played.position ≠ best.position` (including branch refs):

- **Do not** say “you should have played 2-2” as if the tile was wrong.
- Teach: **“Same tile, better end — play 2-2 at left, not right.”**
- Board UX: highlight both ends; ghost/alternate shows the correct placement from the **same pre-move** position.
- This is a first-class `missKind: 'same_tile_wrong_end'` in the structured explanation object (not a prose afterthought).

### Structured explanation object (replace all three paths)

```ts
// Design sketch — final types land with ReviewEvaluationV1 consumers
type ReviewCoachingFacts = {
  played: { action; immediatePoints };
  best: { action; immediatePoints };
  missKind: 'better_tile' | 'same_tile_wrong_end' | 'missed_score' | 'reply_risk' | 'forced' | 'pass_or_draw' | 'unknown';
  deltas: { immediatePoints; expectedPointDifferential; winProbability? };
  evidence: ReviewEvaluationEvidence;
  principalVariation: ReviewPrincipalVariationStep[]; // for board PV
  prose: { headline; detail; takeaway }; // generated ONLY from fields above
};
```

Prose generator: deterministic templates that **refuse** to emit a sentence unless supporting fields exist. No “clearly stronger” without a numeric Δ or PV.

### Phase D — small independently reviewable steps

| Step | Size | Deliverable | Acceptance |
|---|---|---|---|
| **D0** | S | `ReviewCoachingFacts` builder from `ReviewEvaluationV1` + played action; includes `same_tile_wrong_end` detection | Unit tests |
| **D1** | S | Deterministic prose from facts only; truth tests that every number appears in structured fields | No unsupported claims |
| **D2** | S | GameReviewer: remove `positiveNote` + `buildReviewSidebarCopy` usage; render structured compare panel | One coaching path |
| **D3** | S | PV-on-board: step principal variation from pre-move position (toggle played vs best) | Player can see continuation without leaving the move |
| **D4** | S | Delete or quarantine dead copy modules once call sites are gone | No third path left |
| **D5** | S | Wire calibrated per-move labels into GameReviewer for exact/search-evidence moves | Label bucket matches the game's own accuracyModel, not a separate scorer |

**D5, added 2026-09-17 (retrofit):** not in the original table above because
`LOSS_BAND_BOUNDARIES`/`lossBandLabelForEvaluation` did not exist when this
document was written (2026-09-13) — they shipped later, in Phase C0's
calibration work. `useMoveHeuristicClassification.ts`'s
`selectMoveHeuristicClassification` (D2/D3, PR #243/#244) already overrides
the per-move label when a decision's real evidence is heuristic-tier, but
explicitly falls through to the legacy `move.rating` (`classifyMove`) for
exact/search-evidence moves — real, calibrated per-decision data, computed
in `reviewWorkerBatch` for every move that has it, simply unused for this
purpose. D5 closes that gap: for exact/search evidence, classify with
`lossBandLabelForEvaluation` (`phase-c-accuracy-model-spec.md` §4a) instead
of falling back to the legacy rating. No new capture or calibration work —
this is a rendering swap of already-shipped, already-calibrated data.

**Out of D:** pivotal wizard product (E), public flag.

---

## Phase E — Product (persist, public gate, pivotal re-scope, MP last)

### Question

When is it safe to flip the public visibility flag and revive pivotal?

### Finding: only after A–D produce versioned, persisted, honest results for PVF.

### What exists

| Item | Status |
|---|---|
| `saveGameAnalysis` localStorage | MP open-review only; PVF is RAM-only |
| Server review store | **Absent** |
| Pivotal wizard | Flag off; miss-reason taxonomy (`pivotalReviewMissReasons.ts`) |
| `selectPivotalTurnsFromAnalysis` | Ranks on old heuristic ratings — must re-score on loss |

### Phase E order (strict)

| Step | Size | Deliverable | Acceptance |
|---|---|---|---|
| **E0** | M | Server: versioned review record (game digest, snapshot list or hash, evaluations, `engineVersion`, `accuracyModelVersion`) + idempotent write API | Reopen returns same result; auth-gated |
| **E1** | S | PVF post-game: persist + load path; guests keep local fallback | Admin + authenticated PVF |
| **E2** | S | Shadow cohort / internal dogfood with public flag still false | Ops + disagreement review |
| **E3** | S | Re-scope pivotal: top-N **highest expected-value-loss** moments; drop miss-reason taxonomy as primary UX (optional free-text note only) | Wizard uses oracle loss, not old ratings |
| **E4** | S | Flip `POST_GAME_REVIEW_VISIBLE` behind server cohort flag first, then client constant | Rollback without rewriting stored analyses |
| **E5** | M | Multiplayer parity last: V2 capture at MP action boundary, same oracle, no pip-heuristic `engineBestMove` as truth | MP reviews match PVF honesty bar |

**E0's storage-shape decision (E0b, settled 2026-09-17):** the "snapshot list **or**
hash" wording above was a deliberately open question, resolved before schema
work started. E0 persists **`ReviewEvaluationV1[]` + `getReviewAuthorityStateDigest`
output — not full `ReviewPositionSnapshotV2[]`.**

- **Measured sizes** (not estimated — `JSON.stringify` over the real fixture/recorded
  corpora): `ReviewPositionSnapshotV2` averages **4,154 bytes** (53 real fixtures,
  `packages/game-core`), `ReviewEvaluationV1` averages **1,592 bytes** (531 real
  recorded decisions, `packages/review-engine/fixtures/recorded-self-play`). A real
  game averages **~106 decisions**. Evaluations-only ≈ **170KB/game**; snapshots +
  evaluations ≈ **610KB/game** — **~3.6×** heavier for no redisplay benefit (below).
- **Reopen-dependency finding (traced, not assumed):** `GameReviewer.tsx` never
  reads `ReviewPositionSnapshotV2` anywhere in its render path — board/PV/ghost
  rendering and per-move labels come entirely from `ReviewEvaluationV1.played` /
  `.best` / `.candidates` / `.principalVariation` and the separately-built
  `AnalyzedMove`. The snapshot is consumed only as review-engine *input* and as
  an integrity digest; it has zero display role, so "reopen returns same result"
  is fully satisfiable from evaluations alone.
- **Why digest-only-recompute was rejected:** a scheme that persists only the
  digest and re-runs the review engine on reopen would need to reconstruct the
  original snapshot to recompute, and a recompute under a `reviewEngineVersion`/
  `accuracyModelVersion` that has since moved on would silently relabel a
  historical game under a newer model — exactly the silent-reinterpretation risk
  "versioned" exists in this design to prevent. Evaluations-only avoids this
  because each persisted `ReviewEvaluationV1` already carries its own version
  stamp and is never recomputed.
- **Trade-off, stated explicitly:** no raw position record survives this scheme.
  If a future audit, dispute, or debugging need ever requires re-deriving a
  review from scratch (e.g. to check the review engine's own correctness against
  the original position, not just re-display its stored conclusion), that
  capability does not exist under this design — only the evaluation's own
  conclusions persist, not the position they were computed from.

**E0's trust boundary, stated explicitly (added 2026-09-17, E0a/E0c):**
`game_reviews` rows are **client-asserted, not server-verified**. The write
route (`gameReviewsRoute.ts`) persists whatever `evaluations`/
`accuracyModelResult` the request body contains — there is no server-side
recomputation of the review to check it against, today or in this design as
scoped. This table must **never** be treated as authoritative for anything
competitive or comparative — leaderboards, rankings, achievements,
public-facing stats — without a server-side verification step added first.
It is a personal review record (the same trust level as any other
client-submitted jsonb blob), not a verified result like `ranked_games`,
which is idempotent but not the same thing as verified. Any future feature
that wants to compare or rank on this data needs its own verification design
before it can safely read from this table for that purpose.

**E1, shipped 2026-09-19 (PR #265, merged):** the real PVF post-game write
call site is live — `usePostGamePivotalReview.ts`'s existing accuracyModel
effect now POSTs to `/api/game-reviews` (E0c) once evaluations and the
computed `GameAccuracyModelResult` are both available, fire-and-forget
(mirrors `ingestDailyFritzNextHandDebug`'s isolation pattern — persistence
failure can never block or affect the post-game UI). `gameDigest` hashes
the full ordered array of per-decision `authorityPostStateDigest` values
(not just the final one, avoiding a real collision risk between two games
sharing a terminal state); `sourceMatchId` is a `crypto.randomUUID()`
generated once at match start.

This satisfied **only the admin+authenticated half** of E1's stated
acceptance bar ("Admin + authenticated PVF") at E1's merge point. The other
half — **"guests keep local fallback"** — was subsequently closed in PR #271
(merged): local review visibility is independent of cohort-gated persistence,
so non-cohort users retain the in-memory review experience without a server
write.

**E2, shipped 2026-09-19 (PR #267, merged):** accuracy-model reconciliation
is live as an observability-only shadow check. `accuracyFromEvaluations` and
`computeGameAccuracyModel` were relocated to the shared
`@racehorse/review-engine` package, and the E0c write route re-derives the
model server-side from the submitted evaluations after the write succeeds.
The route compares that result with the client assertion and emits structured
`childLogger` warnings for client/server mismatches; computation failures emit
a distinct reconciliation-failure warning with the game digest, user, and
error. Neither case blocks or changes the successful write response. The
existing admin-only review gate is the E2 shadow cohort; no new cohort,
allowlist, or feature-flag infrastructure was added.

**E3, shipped 2026-09-19 (PR #268, merged):** the pivotal-turn selector now
re-scores current completed-match moments from oracle evaluations using strict
top-N ordering by `loss.expectedPointDifferential` descending. It reuses the
shared `isScorable` filter, includes human decisions only, breaks equal-loss
ties by earlier move number, and returns the selected moments in chronological
display order. The miss-reason taxonomy (chips, cap, and reason-specific
coaching) was removed from the primary pivotal-review flow; the optional
free-text note remains available, and old stored reflections remain readable.
The pivotal card now sources its played move, best move, rating, expected loss,
and immediate-points difference from the oracle evaluation rather than legacy
`AnalyzedMove` fields, resolving the ranking/explanation mismatch. E3 covers
only the current live post-game session: `PIVOTAL_REVIEW_WIZARD_ENABLED`
remains `false`, and historical/reopened-game pivotal review is explicitly out
of scope. That reopen gap remains open for a future phase if needed.

**E4, server-cohort gate shipped and merged 2026-09-19 (PR #269, merge commit
`5c1089e295f1203ed2c71866846a8ab0f6856b8a`):** the
existing admin-email bypass is replaced by a server-owned
`POST_GAME_REVIEW_COHORT_USER_IDS` allowlist of exact Supabase user IDs. The
new authenticated `/api/game-reviews/access` endpoint reports cohort access,
and both existing review read/write routes enforce the same allowlist. The
client reads that response through a fail-closed hook and now requires
`server-cohort-response && POST_GAME_REVIEW_VISIBLE`; the client constant was
flipped in PR #270 (merged). The rollout population remains deliberately
limited to the existing admin's Supabase user ID, with no additional pilot
accounts yet: expansion was explicitly deferred while the guest-fallback and
reopen-history gaps were open, not forgotten. Stored analyses need no rewrite
to roll back. The remaining production verification is a deployment/config
check only — confirm the allowlist, access response, and admin review flow in
production; no new code change is required.

**E5, shipped 2026-09-19 (PR #273, merged, `e00355ba`):** multiplayer now
captures V2 review snapshots at the action boundary and evaluates them with
the same oracle/PVF honesty bar rather than the pip-heuristic
`engineBestMove`. The initial parity implementation left MP server
persistence as the remaining follow-up gap.

**E5 follow-up gap closure, shipped 2026-09-19 (PR #274, merged, merge commit
`3a3ddea1`):** MP reviews now persist for cohort members through the same
`/api/game-reviews` path as PVF, gated identically by the server cohort. Local
MP review visibility remains independent of cohort membership, preserving the
Step 2 guest-fallback pattern. The accepted PVF/MP hand-exposure asymmetry is
documented near the A4 entry above: PVF bot-actor snapshots retain the true
actor hand for planned A4 analysis, while MP masks the opponent hand because
it is not client-visible.

**Phase E final status:** E0a–E0d, E1, E2, E3, E4, E5, and the E5
MP-persistence follow-up are shipped and merged (including the guest-fallback
and review-E2E coverage closures in PRs #271 and #272). The single remaining
open item is manual production verification with a real admin login: complete
a match, confirm review appears, persists, and reopens. No further engineering
action is needed unless that manual check finds a real bug.

**Do not** enable public review on legacy V1 heuristic accuracy. If a game lacks V2 snapshots, show an honest “Review unavailable / upgrade client” or legacy-labeled fallback — never a fake precision %.

---

## Cross-phase REUSE vs REPLACE summary

| Phase | Reuse | Replace / build |
|---|---|---|
| **A Capture** | Action hooks, `toCoreGameState`, V2 factory, fixture evidence patterns, live missing-pip *signals* | V1 MoveEntry as oracle input; incomplete evidence; zero production V2 callers |
| **B Oracle** | game-core legal/apply/simulate/score; V2 eval schema; Fritz leaf as **heuristic only** | New node-budget review engine; no server worker today |
| **C Accuracy** | Fixture corpus + self-play harness idea | Fixed buckets + forced caps + mean-of-buckets |
| **D Coaching** | GameReviewer shell, board containment, ghost compare | Three copy paths; vague fallbacks |
| **E Product** | Policy gates, dossier UI, localStorage patterns as interim | Server persist; public flag; pivotal taxonomy; MP thin capture |

---

## Suggested milestone cut

1. **Trustworthy foundation (ship internal):** A0–A6 + B0–B5 + C0–C3  
2. **Teachable review (admin → cohort):** C4 + D0–D4 + E0–E2  
3. **Public PVF review:** E3–E4  
4. **MP parity:** E5  

Estimated shape: this is a **foundation + product** project, not a CSS pass. Prefer many S-sized PRs over a single “review engine” mega-PR. Same size discipline as Journey PR 1 — each step above should be independently reviewable.

---

## Hold point

**Phase A is approved.** Proceed A0–A6 only. Do not start Phase B until A is fully merged and captured snapshots look right against a real played-out game.

### Locked decisions (answered 2026-09-13)

1. **Package home for the oracle:** new `packages/review-engine` (not an extension of `packages/game-core`).
2. **Headline accuracy exclusions:** opening / heuristic-only moves are **excluded** from the % entirely — not merely down-weighted.
3. **Bot snapshots in A4:** capture both actors from day one.
4. **Server persist timing:** E0 starts **strictly after B5** — not in parallel with A.

---

## Key file index

| Area | Paths |
|---|---|
| Contracts | `packages/game-core/src/reviewContracts.ts`, `reviewFixtureCorpus.ts` |
| V1 log | `client/src/game/moveLogger.ts` |
| Capture hooks | `playerMoveSnapshot.ts`, `playerMoveLogEntries.ts`, `usePlayerPlacementHandler.ts`, `botMoveSnapshot.ts`, `botMoveLogEntries.ts`, `botActionCompletion.ts`, `ReplayRecorder.ts` |
| Core adapter | `client/src/modules/match/runtime/gameCoreAdapter.ts` |
| Live evidence | `botEngine.ts` (draw evidence), `applyPlayerActionResult.ts` |
| Analyzer | `client/src/analyzer/moveAnalyzer.ts`, `reviewSidebarCopy.ts`, `consequenceChain.ts` |
| UI | `GameReviewer.tsx`, `PostGameReviewPrompt.tsx`, `pivotalReview/*` |
| Flags | `appRouteTypes.ts`, `matchRuntimeTypes.ts`, `postGameReviewPolicy.ts` |
| Prior plans | `docs/game-review-analyzer-audit.md`, `docs/game-review-chess-parity-implementation-plan.md` |
