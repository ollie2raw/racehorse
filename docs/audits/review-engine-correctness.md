# Review engine correctness pass (post-game analyzer)

Branch `audit/review-engine-correctness`, from candidate `7c4cf1e9`. Scope: game history → analyzer input → candidate evaluation →
best move → grade → review output. The authoritative engine, Daily Fritz verifier, ratings, realtime, persistence, auth, iOS and
board routing are out of scope and were not changed.

## 1. The pipeline as it is today

```text
live Play-vs-Fritz / multiplayer action (both seats)
  → ReviewSnapshotRecorder.recordActorDecision        at the TRUE pre-action boundary, one snapshot per command
      → captureReviewSnapshotAtDecision → createReviewPositionSnapshotV2 (game-core)
        board, actor hand, opponent COUNT, boneyard counts, scores, ruleset, legalActions, actualAction, outcome, digests, positionHash
  → move-log rows (collectPlayerMoveSnapshot / build*MoveLogEntry)          one row per play, pass, and per DRAW RUN
  → correlateSnapshotsToMoveLog                     hand + seat + action (tile AND position) + pre-action board; unique match only
  → analyzeMoveLog                                  segmentMoveLogByHand; human rows = analyzedMoves
  → adaptiveEvaluateReviewPosition                  tiered budgets, forced fast path; local worker or server completion
      → evaluateReviewPosition                      exact (locked yard) | search (midgame expectimax) | heuristic fallback
  → computeGameAccuracyModel / lossBandLabel / buildReviewPresentationRecord / buildPlayerDecisionLedger
  → GameReviewer                                    row ↔ decisionIdByMoveNumber ↔ resultsByDecisionId; "Best move" = that evaluation's best
```

Where each situation is represented:

| Situation | Representation |
| --- | --- |
| Draw | its own decision (`legalActions = [draw]`, so FORCED); every forced draw of a run records its own snapshot with the hand and boneyard as the player saw them at that draw. The log folds a run into ONE row backed by the first draw. |
| Pass | a decision (`legalActions = [pass]`, FORCED), captured after the draws that preceded it |
| Double / hub / branch | the logical `BoardState` in the snapshot; legal placements come from the engine, never from layout. Same tile on several ends = several distinct legal actions (NOT forced). |
| Hand boundary | `identifiers.handNumber` / `handId`; the first decision of a hand sees an empty board and `consecutivePasses = 0` |
| Scoring transition | `outcome.immediatePoints`, `outcome.postActionActorScore`; evaluation values are the net swing to the end of the hand |
| Blocked hand | a hand ending in passes; `blockedHandRule` / `endHandBonus` come from the stored `rulesetConfig` |
| Terminal | review stops at the last captured command of the last hand |

## 2. What was proved (independently of the code under test)

All suites are deterministic (`<namespace>:<n>`); a failure prints the game and action index.

* **Decision accounting** (`reviewDecisionCoverage.property.test.ts`): 13,403 commands over 120 games / 759 hands (CI size) and
  43,896 commands over 400 games / 2,481 hands (second namespace) are exactly 1:1 with snapshots: none dropped, none duplicated,
  ordered, attributed to the right seat and hand, never leaking across a hand boundary.
* **Candidate generation** against the independent rules oracle (`OBoard` replays the hand and exposes its ports): the snapshot's
  plays equal every (tile in hand × port it matches) on every position (18,970 with branch placements, 36,945 with hubs, 18,112
  with one tile on several ends); draw and pass appear exactly when the rules say; the opening obeys "double or scoring play".
  Independent scoring reproduces every `immediatePoints`.
* **Multi-draw**: each draw is its own decision seeing exactly the tiles drawn so far (hand +1, boneyard −1 per draw); the next
  play/pass sees all of them; no legal tile is ever outside the hand. 1,516 draw-then-play, 772 many-draws-then-play, 13
  draws-then-pass, longest run 12.
* **Best move / value / loss** (`reviewOracle.property.test.ts`): an independent minimax over the authoritative engine, averaged
  over every opponent hand the public information allows, agrees with the production exact path on every candidate value, the
  recommended move, the played value and the loss: 59 positions at CI size, 293 on a 300-game second namespace (124 with a tied
  best set), both seats.
* **Ties / equivalence**: every member of the best set has loss 0 and is labelled Best; a player who chose an equally optimal move
  is never told they missed (33 such rows checked against the real coaching prose and the presentation consistency asserts).
* **Client mapping** (`reviewDecisionMapping.property.test.ts`): 6,729 human decisions become 6,489 rows (the 240 difference is
  the later draws of collapsed draw runs, by design); correlation is one-to-one; the ledger identity holds; each row's evaluation
  is the evaluation of its own decision; the label is the independent loss band; the recommendation is that row's best.
* **Thresholds**: loss bands, grade letters and the 22/47 coverage floor are probed at the previous double, the boundary and the
  next double against independent literals (`reviewLossBands.test.ts`, `reviewGradeContract.test.ts`).
* **Board routing has no effect on review semantics**: no runtime import path from any review logic entry point reaches board
  layout, routing or camera code (`reviewBoardRoutingIndependence.test.ts`).

## 3. Defects found and fixed

**R1 — heuristic evaluations depended on object identity.** `solveHeuristicOpening` computed `handAfter` with
`actorHand.filter((t) => t !== action.tile)`. A live snapshot shares the `Tile` object between `legalActions` and `actorHand`, so
it worked; after any serialization (server completion, persistence, reload) nothing matched, the played tile stayed in the hand,
and every hand-dependent feature changed: the same position scored 23.7 live and 46.3 reloaded. Fixed with tile identity.

**R1 — solvers ignored the stored ruleset.** Exact, search, heuristic and positional solvers rebuilt their config from
`DEFAULT_CONFIG`, dropping the stored scoring multiple, blocked-hand rule and end-hand bonus. Under `blockedHandRule: noScore`
the oracle's −1.33 was reported as −2.33; with no end bonus +1.33 was reported as −2.33. Latent today (Journey trials, the only
non-default rulesets, are excluded from review), but the snapshot stores and hashes the ruleset and the audit lists it as
consumed. `resolveReviewConfig` now builds the engine config from the snapshot (defaults unchanged for default games).

**R1 — legacy analyzer graded the wrong placement.** `getMoveScores` looked the played move up by tile only and graded
`exactMatch` by tile only. 539 of 548 generated cases where the player used a different end than the reference were graded
Brilliant. The logged `MoveEntry.position` now decides both the played score and the exact match.

**R2 fixed.** (a) The heuristic path returned the BEST candidate as `played` when the actual action was not a legal action, and
returned an evaluation with no `best` when there were no legal actions; it now fails closed like the exact and search paths.
(b) The headline accuracy summed losses in arrival order, so the same decisions gave 4 distinct values to the last bit across
300 orders; the sum is now over a sorted copy. (c) The legacy tie-break used `String#localeCompare`; it is code-unit order now.

## 4. Deferred (not fixed here)

* **R2** The evaluator trusts `snapshot.legalActions`: an omitted legal action is not detected (an added or substituted illegal
  one is). Fresh captures derive the list from the authority state (proved above), so this needs a corrupt or hand-built snapshot,
  e.g. one posted to the completion endpoint. Documented by a test; the fix is a legal-set recomputation guard returning
  FAILED_FATAL `corrupt-snapshot`, which needs validation against the recorded corpora first.
* **R2** The legacy Master heuristic ends its endgame search at a `performance.now()` deadline, so legacy grades are load-dependent
  (already documented in `game-review-analyzer-audit.md` §1.4). Legacy path only (games with no V2 snapshots).
* **R2** The V2 per-decision wall-clock safety ceiling (2 s) marks a result incomplete instead of wrong; identical on any machine
  that does not hit it.
* **R2** There is no snapshot-count ↔ row-count reconciliation: a corrupt log missing a row would show one row fewer while the
  accuracy counts every evaluated decision.
* **R2** Legacy `validMoves` is tile-only, so on the legacy path one tile playable on two ends is shown as "Only legal move".
* Midgame/search values are sampled, so only structural invariants (candidate set, best dominates, loss = best − played ≥ 0,
  determinism, serialization invariance) are proved for them, not exact values.
