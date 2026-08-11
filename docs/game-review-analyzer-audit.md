# Game Review Analyzer Root-Cause Audit

Date: 2026-08-10
Scope: the existing post-game Game Review for Play vs Fritz and multiplayer. Daily Fritz is explicitly excluded from this UI by `postGameReviewPolicy.ts`.

## Executive finding

The two board defects are concrete implementation bugs and can be repaired without changing gameplay. The evaluation layer is a different matter: the current percentage and labels are not produced by a review-grade search over the recorded position. They are a small set of fixed grade values derived from Fritz's live-play heuristic, run against an incomplete reconstructed state. That foundation is useful as a fallback evaluator, but it is not defensible as an engine-strength accuracy system.

Recommendation: keep `@racehorse/game-core` legal-move and simulation primitives and reuse Fritz's heuristic as a bounded fallback, but build a separate, versioned review oracle. It should receive a complete public-state snapshot for each decision, use deterministic exact search in tractable endgames, use a stronger imperfect-information search with explicit confidence elsewhere, and calibrate accuracy from measured move-value loss. Do not recalibrate the current fixed buckets and present the result as a solved accuracy metric.

## 1. Current architecture

### 1.1 Data and component flow

```text
live action
  -> collectPlayerMoveSnapshot / collectBotMoveSnapshot
       captures boardRenderState BEFORE the action
  -> build*MoveLogEntry
  -> ReplayRecorder.recordMove
       assigns a global, 1-based moveNumber across both players and all actions
  -> game ends
       Play vs Fritz: usePostGamePivotalReview effect
       multiplayer: openMultiplayerAnalyzer callback
  -> dynamic import moveAnalyzer.ts
  -> analyzeMoveLogDeferred(...)
  -> analyzeMoveLog
       optional Master Fritz enrichment
       segmentMoveLogByHand
       filter each hand to player === "you"
       classifyMove for each retained player action
       arithmetic mean of fixed per-move scores
  -> in-memory GameAnalysis
       multiplayer also writes localStorage history
  -> GameReviewer
       selected hand + zero-based cursor into player-only analyzedMoves
       shared Board renders analyzedMove.boardRenderState
```

There is no server-side post-game analyzer. Searches under `server/src` and `packages/game-core` find persistence, daily-puzzle review flags, and bot policies, but no `analyzeMoveLog`/`GameAnalysis` service. Play vs Fritz computes the analysis in the browser after `match.gameOver` in `client/src/modules/review/usePostGamePivotalReview.ts`. Multiplayer computes it in the browser when the player opens review in `client/src/multiplayer/MultiplayerGameShell.tsx`; only that path calls `saveGameAnalysis`. Therefore review is neither computed authoritatively at game end nor stored as a server-versioned result.

### 1.2 Index and numbering contracts

- `ReplayRecorder.recordMove` assigns `moveNumber = 1, 2, 3...` globally. The number includes both players and includes place, draw, and pass entries.
- `analyzeHandMoves` filters a hand to `player === 'you'`. The review's `moves` array is therefore a player-only subsequence of the global log.
- `GameReviewer.cursor` is a zero-based index into that filtered array. The header renders `cursor + 1`; `initialMoveIndex` is documented and handled as one-based.
- Sidebar `#60`, `#61`, and similar values are the original global `MoveEntry.moveNumber`; they are not indexes into the sidebar array and need not be consecutive.

The cursor/index conversion itself is correct. The board lag comes from the time represented by the snapshot selected at that index.

### 1.3 Evaluation path and the actual “engine”

`moveAnalyzer.ts::classifyMove` calls `getMoveScores`, which builds a synthetic `BotMatchState` and invokes the same `chooseBotMove` / `evaluateMove` implementation used by the client Fritz opponent in `client/src/modules/fritz/botHeuristics.ts`.

Fritz is a substantial hand-authored bot, not a solved-game engine:

- `evaluateMove` combines a weighted strategic score with Monte Carlo opponent-hand sampling. Master uses 20 samples and a 0.45 blend; lower tiers use fewer samples and intentional tier-selection error.
- Master switches to sampled-hand minimax only when the two visible hand counts total at most 12 tiles. It samples at most 16 possible opponent hands, searches depth 6–12, and stops at a 90 ms wall-clock deadline.
- Outside that endgame branch, move value is a weighted heuristic over immediate score, mobility, denial, pip unload, reply risk, chain potential, and sampled opponent threats. This is capable game AI, but it is not an objective position-value oracle.
- Legal move generation and forward simulation ultimately use the shared game-core engine (`getLegalMoves`, `applyMove`, `simulatePlacement`) and are suitable building blocks for a stronger review search.

The review reconstruction further reduces evaluation quality. `moveAnalyzer.ts::buildEvalState` currently:

- requires the pre-move board and the player's hand, but has no recorded opponent tile count;
- supplies an empty opponent hand, so `toBotVisibleState` records `opponentTileCount = 0`;
- supplies 14 placeholder boneyard tiles rather than the real drawable count;
- resets both scores to zero and hardcodes a winning score of 60;
- loses pass/missing-pip evidence and the real turn history; and
- evaluates opening snapshots poorly because enrichment rejects a null pre-move board.

There is also an identity mismatch. Enrichment stores Master Fritz's recommendation for display, while `classifyMove` grades against `gradeTier` (normally the tier that was played). The visible “best move” can therefore differ from the move against which the percentage bucket was assigned.

### 1.4 Determinism

Most random choices are seeded from the reconstructed position, so the same complete input normally produces the same result. The result is not strictly reproducible, however:

- Master endgame search terminates against `performance.now() + 90ms`; different devices or loads can complete different samples/nodes.
- The reconstructed input omits material public state, so it is reproducible only for the lossy reconstruction, not necessarily for the position that was played.
- Analysis has no engine/schema version persisted with it. A code release can reclassify the same saved move log.
- `analyzedAt` and local-history IDs intentionally vary.

A review-grade result should be deterministic for a fixed engine version, position snapshot, search budget expressed in deterministic work units where possible, and configuration.

### 1.5 Labels, thresholds, and accuracy mathematics

All values live inline in `client/src/analyzer/moveAnalyzer.ts`; they are not calibrated configuration.

Per-action cases:

| Condition | Score | Label |
| --- | ---: | --- |
| pass while a play exists | 12 | Blunder |
| forced draw/pass | 84 | Good |
| non-play while a play exists | 46 | Inaccuracy |
| placement with no recorded legal moves | 72 | Good |
| exactly one legal tile | 80 | Good |
| evaluation unavailable/reconstruction fails | 72 | Good |
| exact match with the tier reference | 99 | Brilliant |

For other placements:

```text
normalizedDiff = (bestHeuristicScore - playedHeuristicScore)
                 / max(abs(bestHeuristicScore), 20)

<= 0.03 -> 92 Great
<= 0.12 -> 80 Good
<= 0.28 -> 60 Inaccuracy
<= 0.48 -> 38 Mistake
else     -> 18 Blunder
```

Hand accuracy is the arithmetic mean of those assigned scores. Game accuracy is the arithmetic mean of all player move scores. Letter grades are `S >= 92`, `A >= 82`, `B >= 72`, `C >= 60`, else `D`.

This is the direct cause of the reported compression. The score is not a continuous transformation of expected game-value loss. A perfectly played forced move is capped at 80; a forced draw/pass is capped at 84. For example, one exact-best move plus one only-legal move produces `(99 + 80) / 2 = 89.5`, even though neither decision was suboptimal. Many ordinary logs land on repeated 72/80/84 defaults, so averages naturally cluster in the 70s–low 90s. The existing test suite codifies this behavior (`single legal option` expects Good/80 and `forced draw/pass` expects Good/84), confirming it is structural rather than a formatting defect.

Chess.com's current public description says its accuracy compares moves with top engine recommendations, covers 0–100, and that deeper review can change quick classifications. Its guided review also exposes best continuations, critical moves, and retries. Those are useful product principles, not a formula to copy: <https://support.chess.com/en/articles/8584089-how-does-game-review-work> and <https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined>.

## 2. Root cause of each reported symptom

### 2.1 Board is one move behind

Specific mechanism:

1. `client/src/modules/player-turn/playerMoveSnapshot.ts::collectPlayerMoveSnapshot` clones `match.board` before the selected action is applied.
2. `client/src/modules/player-turn/playerMoveLogEntries.ts::buildPlacementMoveLogEntry` stores that snapshot as `MoveEntry.boardRenderState`.
3. Bot logging follows the same pre-action contract in `botMoveSnapshot.ts` / `botMoveLogEntries.ts`.
4. `client/src/analyzer/moveAnalyzer.ts::analyzeHandMoves` copies the pre-action field unchanged into `AnalyzedMove.boardRenderState`.
5. `client/src/analyzer/GameReviewer.tsx` renders `current.boardRenderState` as the visible state for “Move N.”

Minimal reproduction: for an opening 5-5, the move-1 log snapshot is `null`, so Move 1 renders an empty board. The move-2 snapshot was captured after move 1 but before move 2, so Move 2 renders only 5-5. The selected index maps to the correct entry; the entry represents the wrong side of the action boundary for review display.

Root fix: preserve the pre-action snapshot for evaluation, derive an explicit post-action review board by applying the logged placement through the shared placement primitive, and render that field. Do not shift to the next log entry: doing so fails on the final move of a hand and confuses opponent/draw/pass entries.

### 2.2 Board is not contained as it grows

Specific mechanisms:

- `GameReviewer` passes `staticView`, `staticFitMainline`, and `staticSpineAnchor`. Static mode disables wheel, drag, double-click reset, and the visible zoom tray.
- `Board.fitCameraToContainer` computes a raw fit, then multiplies it by two for static view. For sufficiently long layouts, the rendered extent is therefore larger than the measured viewport.
- `staticFitMainline` centers on `y = 0` and applies a fixed spine anchor rather than centering the complete `minY...maxY` extent.
- `GameReviewer.css` sets the frame, layer, board container, and canvas to `overflow: visible` (including `!important`) and disables layer pointer events. This explicitly defeats the shared board container's normal clipping and interaction contract.
- `Board.tsx::layoutBranches` computes nested `minX/maxX`, but its return type and return value omit them. `computeLayout` therefore cannot include horizontally growing nested branches in its fit bounds.
- The general fit floor is 0.22. At narrow viewports, an extreme legal layout can require a smaller scale; clamping upward violates containment.

Root fix: return complete recursive bounds, use a review containment fit that honors the full bounding box and permits the legal scale range, keep the frame/container clipped, and expose the shared board's pan/zoom/reset controls in review.

### 2.3 Accuracy rarely reaches 95+

Both suspected causes are true:

1. The evaluation is a live-bot heuristic/sampled search run on a lossy synthetic state, not a review-grade value search over the recorded position.
2. The formula deliberately quantizes moves into a handful of fixed values and penalizes forced/only-legal actions. Only exact reference matches receive 99. A single forced 80 can pull a short otherwise-perfect hand below 95.

This cannot be repaired honestly by increasing constants. The system needs complete snapshots, a consistent oracle, move-value loss, and calibration against distributions of optimal, strong, average, and deliberately poor play.

### 2.4 Explanations are generic

`moveAnalyzer.ts::buildExplanation` does create some position-dependent text from the played/best breakdown. The visible UI does not consistently use it. `GameReviewer.tsx::positiveNote` replaces all Brilliant, Great, and Good explanations with one of three hardcoded bucket strings. Coaching ratings call `buildReviewSidebarCopy`, which is somewhat more concrete but remains based on heuristic breakdown fields and does not render the alternative continuation on the board.

Therefore the reported examples are exactly template lookup behavior. Part 3 should remove this parallel copy path and render a structured comparison: played move, oracle move, immediate score delta, evaluated position/game-value delta, confidence/source, and a board-playable continuation.

## 3. Honest model assessment

### Verdict

The current evaluator is structurally too weak and too lossy to support a trustworthy “accuracy” claim. It is more than decorative in the sense that it uses legal simulation and meaningful strategy heuristics, but its percentage is decorative precision: the exact number cannot be defended as closeness to optimal play.

It should be upgraded by replacing the review-evaluation foundation, not by discarding every existing part:

- Reuse: canonical rules, `getLegalMoves`, `applyMove`/placement simulation, open-end geometry, deterministic state hashing, heuristic features, and sampled-hand generation.
- Replace for review: move-log snapshot schema, synthetic state reconstruction, tier-vs-Master identity mismatch, wall-clock-only result reproducibility, fixed score buckets, and generic explanation selection.
- Separate product claims: “Review Engine” only for search-backed output with a recorded engine version/depth/confidence; “Fritz recommendation” for the live bot policy or heuristic fallback.

### Search feasibility

- Endgame: fully or near-fully tractable once hands and public uncertainty are small. The existing depth-6–12 sampled minimax proves the primitives are fast enough; a review worker/server can use larger deterministic budgets, transposition tables, and exact enumeration where hidden allocations are enumerable.
- Midgame: not a single perfect-information minimax because opponent hand and boneyard are hidden. Use determinization/expectimax or information-set MCTS across distributions consistent with public evidence. Return confidence and search coverage rather than pretending the estimate is exact.
- Opening: widest uncertainty. A versioned strategic evaluator or shallow information-set search is acceptable if visibly labeled lower confidence and excluded/down-weighted from claims that require an exact oracle.

The live Fritz policy and an objective review policy should be distinct. “What Fritz would play” currently means the tier bot for grading in one branch and Master Fritz for display in another. The redesigned product should compare against one versioned Review Engine; it may separately offer “Fritz's move” as a stylistic opponent comparison.

## 4. Part 2 repair contract

The concrete board repair is complete only when these invariants are tested:

1. At every player review cursor in a multi-hand log, the board contains exactly the placements through that selected action, including the current action.
2. Hand transitions reset the derived review board; no state leaks from the previous hand.
3. Draw and pass preserve the pre-action board.
4. A large nested-branch layout reports all recursive extents.
5. The auto-fit projection of those extents stays inside the review viewport with padding.
6. Review retains pan, wheel/button zoom, and reset without allowing content to bleed outside the frame.

## 5. Baseline evidence before fixes

- `npm test --prefix client -- --run src/analyzer/moveAnalyzer.test.ts src/modules/replay/ReplayRecorder.test.ts`
- Result on 2026-08-10: 2 files passed, 21 tests passed.

## 6. Part 2 implementation evidence

Implemented after this audit was written:

- `reviewBoardState.ts` derives an explicit post-action review board while preserving each move log's pre-action board for evaluation.
- `reviewBoardState.test.ts` walks the player-review cursor through a multi-hand sequence containing opponent interleaving, a crossed hub, both branch arms, and a hand reset. Every selected player move is compared with the canonical accumulated board after that exact action.
- `Board.tsx` now returns complete `minX/maxX/minY/maxY` bounds through nested branch recursion and exposes a containment fit mode with a legal narrow-viewport scale floor.
- `GameReviewer` uses the interactive contained mode; its frame/layers no longer override clipping or disable pointer interaction. Pan, wheel zoom, zoom buttons, and double-click reset come from the shared Board.
- `Board.reviewContainment.test.tsx` renders a 17-tile nested multi-branch board, asserts every tile participates in the returned bounds, proves the scaled bounds fit a 640 × 360 review viewport, and confirms interactive zoom controls are present.

Verification on 2026-08-10:

- Focused Vitest: 4 files passed, 23 tests passed.
- Full client Vitest baseline: 155 files passed, 1,021 tests passed.
- Analyzer behavior suite: passed.
- Client TypeScript typecheck: passed.
- Client production build: passed. Existing Vite warnings remain for the bot-guided/hand-lifecycle circular chunk, a tournament mixed static/dynamic import, and large chunks; none was introduced by this repair.
