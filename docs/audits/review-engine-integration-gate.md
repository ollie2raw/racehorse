# Review engine — independent integration gate

Branch `review/review-engine-integration` = candidate `7c4cf1e9` + the audited fixes (`audit/review-engine-correctness` @ `c1c1729f`)
+ the gate's own fixes below. The audit's "deferred R2: the evaluator trusts `snapshot.legalActions`" was re-investigated here as a
trust-boundary question and **promoted to R1**; a second R1 (hand verdict) was found while checking terminal scoring.

## 1. The three original R1 defects, reproduced on pre-fix code

`reviewGate.r1Reproductions.test.ts` (A, B) and `moveAnalyzer.positionAware.test.ts` (C) were run against the pre-fix sources
restored from `7c4cf1e9`, then against the branch.

| Defect | Pre-fix (`7c4cf1e9` sources) | Branch |
| --- | --- | --- |
| A. heuristic result depended on object identity | production-live snapshot (played Tile shared between `legalActions` and `actorHand`) vs its JSON copy: different `rawScore`/diagnostics/recommended order at `gate-r1a-5d2:0@1`; fails | live, structuredClone, JSON and key-reordered persistence-shaped copies give identical candidate values, raw scores, best, best set, played value, loss and whole-game grade; passes |
| B. stored ruleset ignored | `blockedHandRule: noScore`: candidate value 8.8 vs independent oracle 6 (`gate-r1b-9c1:8@86`); `endHandBonus: none`: 3.6 vs 0; fails | exact values, best and loss equal the oracle that plays by the stored rules; passes |
| B′. default games unchanged | digest of 3,006 default-ruleset evaluations `ad196ffa…` (SHA-256 form) | identical digest — default games are numerically unchanged |
| C. legacy path graded the tile, not the placement | "same tile, other end graded Brilliant" and "played breakdown from the best placement of that tile" fail | both pass |

(The digest in the committed test is a Node-free FNV-1a so the file stays INV-20-clean; the SHA-256 value above was produced by the
earlier revision of the same test on both sides of the swap.)

## 2. `snapshot.legalActions` trust boundary — CLIENT COULD ALTER THE REVIEW CANDIDATE SET (R1, fixed)

Trace: the client builds `ReviewPositionSnapshotV2` rows (`ReviewSnapshotRecorder`) and POSTs them to
`POST /api/review-completion-jobs` (authenticated, but the body is client-controlled). The server never bound the snapshots to an
authoritative game record, used `snapshot.legalActions` as the candidate set, and stored any client-supplied exact/search/forced
`evaluations` row as SCORED/FORCED without re-evaluating.

Hand-crafted requests (`server/src/reviewCompletion/reviewCompletionTrustBoundary.test.ts`, real express route, real evaluator),
run before the fix:

* omit the stronger legal move → a 13.00-point blunder was returned with **1 candidate and loss 0** (a forced decision);
* post an honest snapshot plus a forged exact `loss 0` evaluation → **stored verbatim** (loss 0);
* add an illegal action → the job failed (fail-closed, but still a client-chosen outcome).

Fix (at the boundary, not shape-validation): `deriveLegalActionsFromSnapshot` recomputes the legal set from the recorded state
(board, actor hand, opponent and boneyard counts, passes, hand-open, stored ruleset) with the engine's own `getLegalMoves` /
`canDraw`; `sanitizeSnapshotForReview` replaces the caller's list, and rejects snapshots that cannot be real decisions
(malformed/negative counts, `drawable ≠ physical − dead`, actual action not legal in the recorded position, played tile not in
hand) into explicit `captureFailures` (`corrupt-snapshot:*`). `enqueueReviewCompletionJob` no longer accepts client results: the
server evaluates every decision itself. After the fix all five crafted requests produce the honest result.

Validation before adoption: the derivation equals the engine-captured `legalActions` on every position of 4 rulesets × 60 games
(≈4,500 positions, live and JSON round-tripped, both seats, draws, passes, one-tile-several-ends) and on the whole fixture corpus.

Residual (inherent, not fixable server-side without a server-authoritative game record): a client can still fabricate or omit whole
*positions/decisions* of a game it played itself. The effect is confined to that user's own review artifact (owner-only reads, RLS
`select-own`, persisted rows are stamped `client-asserted`, no cross-user or ranking consumer of review accuracy exists). R2.

## 3. Hand verdict / end-of-hand scoring (R1, fixed)

`buildHandVerdict` summed the move log's per-play `pointsScored`. The engine also awards the end-of-hand bonus (sum of opponent
penalties) and the blocked-hand result, neither of which is in any log row. On 807 generated hands 453 differed from the engine
scoreboard and 98 had the **wrong winner**.

Fix: hand scores now come from the engine scoreboard — the first captured snapshot of hand N+1 carries both players' scores as the
engine had them when hand N ended; the last hand ends at the final match score (`finalScores`). Per-move scoring is untouched.
Wired for Play-vs-Fritz (`usePostGamePivotalReview`) and multiplayer (`scoreboardSnapshots` + `youActorId`, which does not switch
the analyzer's grading mode, so persisted stats are unaffected). Without a scoreboard the log-derived verdict remains and is not
marked `engine-scoreboard`. `reviewGate.handVerdict.test.ts`: every hand's winner, margin and both totals equal the engine's, for
default, `noScore` blocked, and `endHandBonus: none`, with go-out and blocked hands exercised.

## 4. Legacy / current path reachability

| Path | Reaches a newly completed game? |
| --- | --- |
| V2 evaluations (exact / search / heuristic) | Yes — Play-vs-Fritz and multiplayer, both seats |
| Legacy Master wall-clock grading (`enrichMovesWithFritz`) | PvF: no when snapshots exist (`buildEvalState` returns null). Multiplayer: the analyzer is called without `reviewSnapshots`, so it still runs, but the Game Review UI renders V2 labels/best move/prose whenever an evaluation is wired; legacy text is only a fallback when no evaluation path exists. Its one persisted output is the online-match `avgMoveQuality` stat. **R2** (stats only; persistence is out of scope) |
| V2 2 s safety ceiling | Yes, marks the result incomplete rather than wrong; machine-independent unless hit. R3 |
| Tile-only `validMoves` / "Only legal move" | Legacy row text only; not rendered by `GameReviewer` when a V2 evaluation exists. R3 |
| Imported/historical records | Legacy path by construction; not fixed (historical). Daily Fritz, ghost, guided, authoring, Journey trials are excluded from review by `postGameReviewPolicy` |

## 5–8. Ties, multi-draw, presentation, fresh-namespace differential

Namespace `gate-diff-ns-q91` (never used by the audit), seeds replayable as `<namespace>:<n>`:

* decision accounting: 22,714 commands = 22,714 snapshots over 200 games / 1,269 hands; legal sets verified on all 22,714 (9,881 with
  branch placements, 19,254 with hubs, 9,404 with one tile on several ends); 786 draw-then-play, 397 many-draws-then-play, 5
  draws-then-pass, longest run 9, hand and boneyard counts exact at every draw;
* oracle: 74 locked-yard positions (29 with tied best sets) at 80 games, 37 (14 tied) at 50 games — values, best, played value and
  loss identical to the independent minimax; both non-default rulesets compared on 237/327 and 143/186 positions;
* tied best moves: all equally optimal actions have loss 0 and the top label; 13 played-optimal-but-not-the-shown-best rows are
  never described as missed;
* robustness: 84 positions across exact/search/heuristic;
* client mapping (60 games): 3,521 human decisions → 3,419 rows (102 later draws folded by design), one-to-one correlation, ledger
  identity, labels equal the independent band, 8 tied-optimal rows checked against the real prose.

Two oracle tests exceeded the suite's 900 s per-test cap on this machine at 80 games (the `no end-of-hand bonus` ruleset enumeration
is slow); every comparison made before the cap matched, no mismatch was observed.
