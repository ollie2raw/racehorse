# Review reference-relative delta audit

## Finding

`ReviewEvaluationV1.loss.expectedPointDifferential` is an oracle-best-versus-played loss. It is not necessarily the difference between the played action and the action shown as the coaching reference.

## Current semantic path

- Exact and search evaluation build `loss.expectedPointDifferential` as `evaluation.best.value.expectedPointDifferential - evaluation.played.value.expectedPointDifferential` in `packages/review-engine/src/evaluateReviewPosition.ts`. Their displayed reference is that oracle `best`, so the values coincide.
- Exact candidate values are net swings from the decision point in `packages/review-engine/src/solveExactEndgame.ts`; search values use the same net decision-point scale in `packages/review-engine/src/solveMidgameDeterminization.ts`. Both include immediate scoring.
- Heuristic evaluation also creates a candidate for every legal action, but `packages/review-engine/src/solveHeuristicOpening.ts` deliberately assigns every candidate `expectedPointDifferential: 0`; its raw strategic score is only a ranking diagnostic. Its loss is consequently always zero and is not a calibrated expected-value claim.
- With positional coaching enabled, `client/src/analyzer/reviewCoachingFacts.ts` changes the displayed `best` and `referenceSource` to Fritz's real `chooseBotMove('master')` action at heuristic tier, while leaving `deltas.expectedPointDifferential` populated from `evaluation.loss.expectedPointDifferential`.

## Mismatch and affected consumers

At heuristic tier the visible reference is Fritz, but the existing expected-point field is the evaluation/oracle-loss field. It cannot establish a Fritz-versus-played expected-value gap or tie. The affected consumers are:

- `client/src/analyzer/reviewCoachingProse.ts`: feature-delta value-gap and immediate-score sign guard; same-tile, reply-risk, better-tile, and pass/draw gap clauses.
- `packages/review-engine/src/devtools/reviewExplanationCoverageStudy.ts`: no-difference sub-split and unresolved-gap measurement.
- `packages/review-engine/src/devtools/reviewValueGapFallbackSamples.ts`: value-gap sample eligibility and displayed value number.
- Tests that construct `ReviewCoachingFacts` deltas, including `reviewCoachingFacts.test.ts`, `reviewPositionalExplanation.test.ts`, and prose truth tests.

`client/src/analyzer/GameReviewer.tsx`, `client/src/analyzer/gameAccuracyModel.ts`, and `packages/review-engine/src/reviewAccuracy.ts` also consume evaluation loss, but for review accuracy/severity rather than displayed-reference coaching prose; that oracle-loss semantics remains valid there.

## Current rendered-prose impact

There are **0** current heuristic rendered expected-value claims attributed to Fritz: heuristic `loss.expectedPointDifferential` is always zero, so the material expected-value fallback cannot fire. The immediate-score fallback can still render a directly board-derived score difference and does not state an expected-value claim. The defect affects the historical interpretation of the 70 heuristic cases among the prior 82 zero-loss bucket and would make a future equality/value sentence false or misattributed if reused unchanged.

## Available data and correction path

**Path B — unavailable.** The evaluation candidate list can match Fritz's action exactly (tile plus placement/end), but heuristic candidate expected values are all intentional zero placeholders. Candidate ranking or `rawScore` cannot be converted into a comparable point differential. No new Fritz valuation/search will be added here.

The correction must expose a separate displayed-reference expected delta only when the evaluation supplies a calibrated candidate value for that displayed action (exact/search oracle reference). It must be unavailable for heuristic Fritz references. Oracle loss remains separate for accuracy/classification. Any reference-relative expected-value prose must read only the new field.
