# Which analysis stack owns what

Roadmap item 4.7. Written 2026-11-01. A player sees "how good was that move" in three places in the product, produced by
three different pieces of code. This page says which is which, what each is allowed to claim, and where they are pinned
against each other. Read it before touching move grading, coaching text or review accuracy.

## The three stacks

| | **In-game coach** | **Post-game review** | **Legacy / heuristic analyzer** |
|---|---|---|---|
| Where | `client/src/learning/` | `packages/review-engine/` (+ `server/src/reviewCompletion/`, `reviewPersistence/`) | `client/src/analyzer/` (`moveAnalyzer.ts`, `classifyHeuristicResult.ts`) |
| When it runs | live, during a Play vs Fritz or guided match, before and as the move is made | after a game, on the server (search/exact solver), results fetched by the client | after a game, in the browser, when no server review exists (history, offline, older games) |
| What it measures | **Fritz heuristic score delta** against the best move: `immediateScore x 34` plus strategic terms of about +-5 to +-40. Not points | **Expected-point loss** from a search or exact endgame solve, evaluated per candidate (`ReviewEvaluationV1.loss.expectedPointDifferential`) | the Fritz heuristic over the recorded move log; produces a heuristic classification, not a calibrated loss |
| Labels | `best / excellent / good / dubious / blunder` (`MoveCategory`) | `Best / Inaccuracy / Mistake / Blunder` (`LossBandLabel`) and a game grade `S / A / B / C / D` | displayed through `heuristicClassificationToDisplay`, and **labelled as heuristic** (`LegacyReviewEvaluationDisclosure`) |
| Thresholds | `DEFAULT_THRESHOLD_CONFIG` in `learning/types.ts` (6 / 18 / 34 / 42 score units; "all values need live playtesting tuning") | `LOSS_BAND_BOUNDARIES` (0.13 / 0.79 / 5.98 points) and `CALIBRATED_K` in `accuracyModelCalibration.ts`, fitted against a recorded corpus; grade cutoffs in `accuracyGrade.ts` (92 / 82 / 72 / 60) | none of its own for labels: it delegates to the review bands once an evaluation exists |
| Authority | **advisory**. Tone and hints only. Never persisted as a result, never ranked | the number a player is told about their game. **Owner-only until the played action is server-authoritative** (`reviewedMoveQuality.ts`, enforced by `reviewedMoveQualityGuard.test.ts`) | **not authoritative**; shown with a disclosure whenever a calibrated evaluation is missing |
| Consumers | `useLearningCoach` -> `BotMatchBoardStage`, `BotMatchCoachBoardOverlays`, guided placement; learning profile and `coachMessaging` | `usePostGamePivotalReview`, `modules/review/*`, `PostGameReviewPrompt`, `pivotalTurnSelector` | `GameReviewer` |

## The rules

1. **One word, one meaning.** "Blunder" the coach says in the middle of a game is a heuristic judgement; "Blunder" in the
   review is a calibrated expected-point loss over 5.98. Copy that quotes one must not borrow the other's authority. The
   coach says what it would play and why; only the review says how many points a move cost.
2. **Calibrated numbers come from the review engine only.** Accuracy, grade, loss, Inaccuracy/Mistake/Blunder. The client
   re-exports `LOSS_BAND_BOUNDARIES` and `gradeFromAccuracy` from the package; it must not keep a copy that can drift
   (`analyzer/gameAccuracyModel.ts` and `analyzer/accuracyGrade.ts` are the existing single-source hand-offs).
3. **The coach never feeds a stored or ranked value.** Nothing in `learning/` may write a game result, a rating input or a
   leaderboard row. Its `learningStore` is a private, per-device progress record.
4. **A heuristic result is always disclosed as one.** Where a calibrated evaluation is missing, the UI shows the legacy
   result with its disclosure, and decisions with `evidence.source === 'heuristic'` get no loss-band label
   (`lossBandLabelForEvaluation` returns `null` for them, and for forced decisions).
5. **A bot that grades a game and a bot that plays it are different jobs.** Fritz's playing search (client `botHeuristics`,
   the server's own copy) is not the reviewer; the reviewer uses the engine's solver tiers. Roadmap 4.1 and 4.2 are about
   the Fritz engine and are separate from this page.

## How the stacks are pinned against each other

- `client/src/learning/thresholdAgreement.test.ts` converts the coach's score units to points (1 scoring unit = 5 points =
  34 units, the only conversion the coach documents), sweeps 0 to 80 units, and asserts:
  - the two scales never contradict each other badly (a coach "blunder" is at least a review Mistake; a review Blunder is at
    least a coach "dubious"; a coach "best"/"excellent" is never a review Blunder);
  - both are monotonic;
  - the exact boundaries in points (coach 0.88 / 2.65 / 5.0; review 0.13 / 0.79 / 5.98);
  - an inline snapshot of every place the labels differ. **Changing either threshold set fails this test on purpose**: update
    the snapshot in the same PR and say why the two should now differ.
- `packages/review-engine/src/__tests__/phaseCCalibrationProvenance.test.ts` and `accuracyModelCalibration.test.ts` pin the
  calibration itself.
- `reviewedMoveQualityGuard.test.ts` pins who may read the owner-only quality value.

## Where they disagree today (and why that is acceptable)

| Loss in points | Coach says | Review says |
|---|---|---|
| 0.01 to 0.13 | excellent | Best |
| 0.13 to 0.79 | excellent | Inaccuracy |
| 0.79 to 0.88 | excellent | Mistake |
| 0.9 to 5.0 | good, then dubious | Mistake |
| 5.01 to 5.98 | blunder | Mistake |
| above 5.98 | blunder | Blunder |

The coach is slightly **stricter** at the top (it calls a 5 to 6 point miss a blunder where the review calls it a Mistake)
and slightly **more generous** in a 0.09-point sliver near 0.8 (excellent where the review says Mistake). Neither is a
contradiction a player would notice, and the coach's strategic terms mean its delta was never meant to equal points. If the
playtest tuning the coach file asks for ever happens, the target is to move the coach's `dubiousDelta` toward 40 (5.98
points) so the two blunder lines meet; do that in the same PR as a snapshot update.

## Known gaps

- The coach's `recurringMistakeTags` never fills (found while testing `learningStore`, held as an `it.fails` test).
- Journey and Learn lesson graders (`client/src/learn`, `journey`) are a fourth, separate notion of "correct" for fixed
  lesson positions; they are not move-quality grading and are out of scope here, but they should not reuse these labels.
