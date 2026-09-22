# Luck versus skill: Phase F design only

Date: 2026-09-20. No runtime, classification, accuracy, schema, or storage
change is proposed for automatic rollout by this document.

## Separate the questions

| Question | Information allowed | Output |
| --- | --- | --- |
| Was the decision good when it was made? | Actor's hand, public board/history, public draw/pass evidence, and legal hidden allocations at that instant | Existing information-set expected-value comparison; quality/confidence/classification follow the authoritative Phase F rules. |
| Was the subsequent result fortunate? | The realized continuation, compared with a declared counterfactual distribution | A separate descriptive outcome measure, never a replacement for the move-quality judgment. |

Realized opponent tiles must not leak backward into a decision's grading.
An unlucky strong move stays strong; a lucky weak move stays weak. Forced
moves are not evidence of decision skill merely because they score well.

## Candidate analysis contract

1. Freeze the pre-action information set and deterministic seed. Sample only
   allocations consistent with it, including public evidence and dead/drawable
   boneyard conventions used by the evaluator.
2. Evaluate the chosen move and alternatives on paired allocations and paired
   continuation randomness. Keep the move-quality estimate, uncertainty, and
   reference disagreement separate from the observed game outcome.
3. For a descriptive luck analysis, declare the horizon (for example, the end
   of the current hand), continuation policies, scoring unit, sample count,
   and excluded/incomplete samples before computing results.
4. Compare the realized result with that distribution. A percentile or
   realized-minus-expected score is a candidate descriptive statistic, not
   win probability, rating, causal attribution, or a second accuracy score.
5. Report sensitivity to continuation policy and uncertainty. If policies
   disagree or the sample is insufficient, say the evidence is inconclusive;
   do not label the player lucky or unlucky with false precision.

## Guardrails

- Actual outcomes include later decisions by both players. Any result-gap
  measure is conditional on the specified continuation model, not a clean
  causal decomposition into luck and skill.
- Correlated moves from the same game are not independent observations.
  Aggregate uncertainty must preserve game-level grouping.
- Keep evaluation version, sampling seed, information-set digest, horizon,
  continuation policies, and completion counts alongside experimental output.
  This is an experimental output contract, not authorization to change
  persisted production review records.
- Do not feed this measure into move labels, displayed accuracy, rankings,
  matchmaking, or rewards. No new UI, data collection, backfill, or stored
  field is authorized by this design.
- Product naming, presentation, and any future implementation/rollout remain
  human decisions. Existing visibility and cohort gates remain unchanged.

## Acceptance for a future separately approved experiment

| Check | Required property |
| --- | --- |
| Hidden-information counterfactual | Changing unrevealed actual tiles without changing the pre-action information set cannot change move-quality grading. |
| Seed replay | Identical inputs, seeds, budgets, and continuation policies reproduce experimental samples, except explicitly recorded timing-dependent policies. |
| Outcome separation | Replacing only the realized continuation changes the descriptive outcome statistic, not the frozen move-quality result. |
| Uncertainty | Incomplete samples are counted; game-cluster intervals and policy sensitivity are reported. |
| Storage and display | Existing accuracy values and saved evaluations remain byte-identical; no new production writes or visible labels. |
