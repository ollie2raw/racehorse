# Game Review: Engine-First Hero Feature Plan

Date: 2026-08-10
Status: proposal only; Part 3 is not implemented.
Dependency: review and approval of the evaluation-model verdict in `game-review-analyzer-audit.md`.

## Product contract

Game Review should make only claims its evidence supports:

- **Review Engine** means a versioned search result over a complete recorded public position.
- **Fritz recommendation** means the live opponent policy's preference; it is not presented as objective best play.
- **Exact** means all relevant continuations/hidden allocations in the declared scope were exhausted.
- **Search** means a bounded information-set search with recorded nodes, coverage, and confidence.
- **Heuristic** means the current strategic evaluator was used as fallback and the UI labels it accordingly.

The hero loop is: identify the moments that changed the game, show the played and recommended alternatives on the actual board, explain the measurable consequence, and let the player retry from that position.

## Dependency-ordered implementation batches

### Batch 0 — Lock the analysis contract and fixture corpus

Goal: define what a review result means before changing UI or percentage constants.

Work:

1. Add a versioned `ReviewPositionSnapshotV2` schema containing:
   - ruleset/config and engine versions;
   - game, hand, global action, actor, and turn sequence identifiers;
   - canonical pre-action board and actor hand;
   - opponent tile count, drawable/dead boneyard counts, scores, winning target, passes, and known-missing-pip evidence;
   - legal moves with exact tile + placement position;
   - actual action, immediate points, and authoritative state digest.
2. Specify `ReviewEvaluationV1`: source (`exact | search | heuristic`), best and played moves, expected value for each, loss, candidate ranking, principal continuations, search coverage, confidence, and diagnostics.
3. Build a checked-in corpus of real/anonymized and generated positions covering openings, scoring chains, forced moves, blocks, nested branches, near-win defense, hidden-information ambiguity, and exact endgames.
4. Add replay invariants: every V2 snapshot reproduces the logged action and the post-action board through game-core.

Acceptance gate:

- No synthetic placeholder state is needed by the analyzer.
- Replaying every fixture is deterministic and agrees with authoritative board/scoring outcomes.
- Legacy V1 logs are explicitly labeled `heuristic/low confidence`; missing data is never silently invented.

### Batch 1 — Capture and persist complete review positions

Depends on: Batch 0.

Work:

1. Capture V2 at the canonical action boundary in bot and multiplayer controllers, not separately in UI components.
2. Persist a compact game review record server-side for authenticated games; retain local-only fallback for guests.
3. Store schema, ruleset, and analyzer version with the game. Make review reopening load the same versioned result or intentionally request a named re-analysis.
4. Add privacy/size limits, migration behavior, and telemetry for rejected/incomplete snapshots.

Acceptance gate:

- Reopening the same game retrieves the same input snapshots.
- Actor hand remains private during live play and is exposed to review only under the correct post-game authorization.
- Game Review no longer depends on transient component state or a lossy move-log reconstruction.

### Batch 2 — Build the deterministic review oracle

Depends on: Batches 0–1.

Recommended architecture: a pure engine package shared by a Web Worker for immediate review and a server worker for deeper/cached review. The pure package owns state hashing, candidate enumeration, evaluation, and output types; transports only schedule work.

Work:

1. Add transposition-table state hashing and deterministic node-budget search.
2. Endgame solver:
   - exact perfect-information search when remaining ownership is known;
   - enumerate feasible hidden allocations when the public information set is small;
   - solve to terminal points/win probability with alpha-beta and memoization.
3. Midgame search:
   - determinization/expectimax or information-set MCTS over opponent-hand and boneyard distributions consistent with public evidence;
   - stratified deterministic samples and recorded coverage;
   - the current strategic evaluator only as leaf evaluation and fallback.
4. Opening/fallback evaluator:
   - return lower confidence and `heuristic` source when search coverage is insufficient;
   - never emit an “objective best” claim for a heuristic-only result.
5. Separate the Review Engine from Fritz tier selection. Optionally compute Fritz's tier move as a second comparison field.
6. Replace wall-clock cutoffs in reproducibility tests with deterministic node budgets; production may retain a hard safety timeout that marks an incomplete result rather than changing it silently.

Acceptance gate:

- Golden fixtures produce byte-stable candidate rankings for an engine version.
- Exact fixtures agree with exhaustive enumeration.
- Increasing search budget converges or reports uncertainty; it does not oscillate without diagnostics.
- Performance budgets are measured on representative desktop/mobile/server hardware.

### Batch 3 — Define and calibrate accuracy and classifications

Depends on: trustworthy Batch 2 evaluations. Do not start by tuning today's `99/92/80/...` constants.

Work:

1. Choose the evaluated quantity: expected final point differential and/or win probability from each decision point.
2. Define move loss as `value(best) - value(played)` on that common scale.
3. Convert aggregate loss to 0–100 with a monotonic calibrated mapping. Candidate starting model:
   - forced/no-choice actions are neutral or 100, never an 80-point penalty;
   - weight genuine decisions by leverage/choice significance, with a cap so one move cannot make the rest meaningless;
   - retain continuous loss before classification.
4. Derive labels from loss plus context, not loss alone:
   - Best: top evaluated move within search tolerance;
   - Excellent/Good: bounded small loss;
   - Inaccuracy/Mistake/Blunder: increasing expected-value or win-probability loss;
   - Great/Brilliant: separate positive tags requiring uniqueness, difficulty, sacrifice/tempo insight, or a game-changing line—not synonyms for exact match.
5. Calibrate against four datasets: oracle/self-play, strong human/bot play, representative ordinary play, and deliberately poor/random legal play.
6. Publish distribution, monotonicity, and edge-case tests. Verify optimal games can reach 99–100 and materially bad games span the lower range without artificial inflation.

Acceptance gate:

- Accuracy is monotonic with added move-value loss on the fixture corpus.
- Forced moves do not lower accuracy.
- Same engine result always maps to the same score/classification version.
- Product and data review approve the observed distribution before rollout.

### Batch 4 — Structured explanations and critical moments

Depends on: Batches 2–3.

Work:

1. Replace prose lookup tables with structured explanation facts from the evaluation:
   - played and recommended tile + position;
   - immediate point difference;
   - expected game/hand value difference;
   - open-end/control, mobility, pip burden, tempo, and reply threat deltas;
   - principal continuation and confidence/source.
2. Generate deterministic prose from only supported facts. Never state that Fritz or the engine saw a scoring line unless that exact line is present.
3. Rank critical moments using evaluated swing, outcome leverage, and uniqueness. Present a concise “where the game turned” sequence before the full move list.
4. Add explanation truth tests that replay every claimed score/continuation.

Acceptance gate:

- Every numerical/prose claim links to a structured field and a reproducible continuation.
- Generic bucket-only copy is removed.
- Low-confidence positions say what is uncertain.

### Batch 5 — Build the hero review experience

Depends on: stable result contracts from Batches 2–4. Use the locked Racehorse matte/neon visual system; do not copy Chess.com pixels.

Work:

1. Highlights landing state: accuracy with source/version, hand graph, three critical moments, and concise game story.
2. Move review state:
   - post-move board for the selected actual move;
   - toggle/compare the recommended alternative from the same pre-move position;
   - animate the principal continuation on-board;
   - show exact/search/heuristic badge and confidence unobtrusively.
3. Retry state: restore the pre-move position, let the player choose, evaluate the retry, then compare outcomes without mutating the historical game.
4. Preserve the now-fixed full-board containment, pan, zoom, reset, keyboard navigation, reduced motion, and mobile touch behavior.
5. Add loading/error states that retain the game result and degrade from deep analysis to an honestly labeled local heuristic review.

Acceptance gate:

- A player can answer “what should I have played, where, why, and what happens next?” without leaving the selected position.
- Large legal layouts stay legible at desktop and mobile review viewports.
- Accessibility and keyboard/touch journeys pass automated and manual checks.

### Batch 6 — Production hardening and rollout

Depends on: all prior batches.

Work:

1. Cache by game digest + engine version + analysis settings; make jobs idempotent and resumable.
2. Instrument queue/runtime, search coverage, fallback rate, confidence, reopen consistency, review completion, critical-moment engagement, retry use, and errors.
3. Shadow-run the new oracle against the old heuristic without exposing scores. Inspect disagreement fixtures.
4. Roll out behind a server-controlled cohort flag. Preserve old results with their original version rather than silently rewriting history.
5. Add abuse/cost controls and a bounded quick/deep analysis policy.

Acceptance gate:

- Operational SLOs and cost limits are met.
- No unresolved high-confidence oracle disagreements on the golden corpus.
- Rollback switches UI and scheduling without corrupting stored analysis.

## Scope and sequencing recommendation

This is a genuine new-engine/data-foundation project followed by a moderate product/UI project. Estimated implementation should be planned as two milestones:

1. **Trustworthy Review Foundation:** Batches 0–3, shipped internally with fixture dashboards and no marketing claim.
2. **Hero Game Review:** Batches 4–6, built on the approved versioned evaluation contract.

The next decision is not a visual mockup. It is approval of the audit verdict and the V2 snapshot/evaluation contracts in Batch 0.
