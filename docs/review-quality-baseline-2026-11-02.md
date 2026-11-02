# Review quality baseline, 2026-11-02

Why this exists: the question "is the post-game review at chess.com's standard?" was being answered from old documents. The September closeout said the human smoke test failed and rollout was held; the explanation study reported 38-44% of decisions on the heuristic fallback. This measures what the **current production path** does, with tools that stay in the repo (`packages/review-engine/src/devtools/`), so the answer can be re-measured after every change.

**What these corpora are:** the committed recorded games in `packages/review-engine/fixtures/recorded-self-play` (Fritz bot policy, `master` and `standard`, 10 games, 1,212 decisions, 840 non-forced). They are **bot play, not human play**. Nothing here says how the review reads on a real person's game; that still needs a human pass on a phone.

## 1. The production tier mix is much better than the old studies said

`reviewProductionTierMix.ts` replays each recorded position and runs it through `completeReviewEvaluations`, the same escalation the durable server job uses (100 / 2,500 / 12,000 / 50,000 sampled hidden states), starting from the recorded cheap result.

| non-forced decisions (840) | exact | search | heuristic |
| --- | ---: | ---: | ---: |
| as recorded (the retired single-budget dispatcher) | 2.1% | 59.5% | **38.3%** |
| after the production completion pass | 2.3% | 97.7% | **0.0%** |

The 38-44% heuristic figures in `review-convergence-gate-validation.md` and `review-explanation-coverage-study.md` describe the retired dispatcher, **not what a saved review gets today**. By game stage (tiles still held) the production heuristic share is 0% at every stage: endgame (1-2 tiles) 4.5% exact, 3-4 tiles 2.8%, 5-6 tiles 1.8%, openings 0%. Positions with the boneyard locked are solved exactly (19 of 19).

Cost, one thread: **mean 256 ms per decision** (median 0 ms because many are already resolved; 90th percentile 468 ms; the worst single decision 35 s). 840 decisions took 215 s, so a typical game's reviewed player's ~30 decisions is on the order of 10 s of compute. Not measured: Render's free instance under load.

## 2. The answer is stable against sampling, but not against search depth

`reviewSearchStability.ts`: 150 non-forced decisions with tiles still to draw, re-evaluated at 2,500 samples (production) with a different seed, at 12,000 samples, and at the same 2,500 samples searched 3 plies instead of 2. "Same grade" = the grade of the move the player actually played (best / inaccuracy / mistake / blunder, from the calibrated loss bands).

| comparison (148 decisions) | same top move | same grade of the played move |
| --- | ---: | ---: |
| different random seed (pure sampling noise) | 99.3% [96.3, 99.9] | 98.6% [95.2, 99.6] |
| 12,000 vs 2,500 samples | 99.3% [96.3, 99.9] | 99.3% [96.3, 99.9] |
| **3 plies deep vs 2** | **88.5%** [82.4, 92.7] | **92.6%** [87.2, 95.8] |

Sampling is not the weak point. But **one more ply changes the "best move" in about 1 decision in 9 and the grade a player would see in about 1 in 13**, so the production answer (2 plies: your move, the reply) is horizon-limited. That alone does not say 3 plies is *more right*, only that 2 plies is not a fixed point. Depth 3 costs about 3x (median 603 ms vs 203 ms per decision here).

Grades at the production budget in this corpus: 115 best, 15 inaccuracy, 18 mistake, 0 blunder (it is two bots).

## 3. Does the deeper search pick better moves? (no evidence that it does)

`reviewDepthMatch.ts`: two players choose every move with the review engine, identical but for depth (2 vs 3 plies, same 2,500 samples), complete games to 60 on identical deals with seats swapped. `reviewDepthMatchSummary.ts` aggregates.

**Result, 62 games over 29 deals:** the 3-ply player won **32 (51.6%, 95% interval 39-64%, sign test p = 0.90)**; mean margin **+0.7 points per game**; of 29 deals, 3-ply swept 4, 2-ply swept 2, 23 split one each. (An earlier interim read of 56.8% after 44 games did not hold up.) The run was planned for 168 games and was stopped at 62 because it saturated the machine (a game takes about 55 s alone and about 5 minutes with 7 running at once on a laptop), so the interval is wide: **an edge of up to roughly 13 points of win rate for the deeper search is not ruled out**, but a large one is, and the point estimate is zero.

What that means: one more ply changes the "best move" in about 1 decision in 9 (section 2), yet the player who follows those changed moves does not win more. The disagreements are mostly between near-equal moves (consistent with grade flips happening at band edges), so the extra ply is **not** the weak point, and tripling the compute for it is **not justified by this evidence**. If depth is ever revisited it should be with a longer, quieter run (about 200 or more games, run overnight, two shards at most).

Because the search is not the limiter, the question for strength moves to the **evaluation at the horizon** and to whether the grades *mean* something against real outcomes (a calibration study, below).

## 4. Consistency: no surface contradicts another (a permanent guard now)

September's production smoke failed on **contradictions**, not strength (a "Blunder" badge over text saying "Best move"). The existing checks (`assertPresentationConsistency`) were spot tests and a synthetic property test. `packages/review-engine/src/devtools/reviewCorpusConsistency.test.ts` now runs the whole real pipeline (evaluation, coaching facts, prose, presentation record) over **all 1,212 recorded decisions, every tier including the heuristic ones**, and requires, for each non-forced decision:

- the existing cross-surface assertions hold (played the reference move means no severity badge and no "miss" prose; "Best move" prose never sits on a Mistake or Blunder; true-equality prose never sits on a Mistake or Blunder);
- it has a label at all;
- a heuristic result never wears a calibrated severity badge;
- the board's best move is the evaluation's best move, and (exact and search) the coaching facts name the same one (the second-recommendation bug class);
- the facts describe the move that was actually played;
- for exact and search, the loss is best minus played and never negative;
- playing the reference move is never graded below Best.

**Result: 0 violations on the corpus.** To make sure the check can fail: making heuristic results wear a calibrated "Blunder" badge fails it (the report names the decision, tier, badge and headline), and so does pointing the board's reference at the played move. It runs in about a second and in CI on every PR (`review-engine tests`), so a new contradiction class fails with the exact decision. It checks the *presentation logic*; it does not say the prose is *true* about the position (that is the explanation truth tests), and it is bot play, not human play.

## 5. Do the grades mean something over the whole hand? (rollout calibration)

**What the search actually values.** At its horizon the review's search scores a position as the **current score difference** (`solveMidgameDeterminization`: `leafValue = actor score - opponent score`). So the review's "best move" is the move that scores the most over the next two plies; it assigns no value to hand quality, flexibility, or the points awarded at hand end for the opponent's leftover pips. Whether the grades mean anything depends on how often that agrees with the move that is best over the *whole hand*.

**The check** (`reviewRolloutCalibration.ts`, shared helper `rolloutValue.ts`): for 297 sampled decisions (search or exact, tiles still to draw), every legal move is played out to the end of the hand (including the end-of-hand award) against sampled opponent hands consistent with what the reviewed player could know, both sides then following the Fritz "standard" policy. The same sampled hands are used for every candidate (paired), and two independent sets of 60 hands are drawn so a result that is only sampling chance can be told from one that persists.

| grade the review gave the played move | decisions | review says it costs | rollouts say it costs | review's best really beats the played move | confirmed by > 2 standard errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| best (loss within tolerance, but not the top move) | 19 | 0.01 | 0.13 | 26% | 21% |
| inaccuracy | 31 | 0.44 | 0.19 | 68% | 26% |
| mistake | 48 | 1.86 | 1.38 | 73% | 48% |
| blunder | 1 | 11.23 | 7.43 | 1 of 1 | 1 of 1 |

- Correlation between the review's loss and the rollout loss (99 decisions where the played move was not the review's best): **0.53**.
- The review's top move is also the rollout's top move in **68%** of decisions; the move actually played is the rollout's top move in 56%.
- Of the 198 played moves the review calls **best**, the rollout prefers another by more than 1 point in 22 (half A) and 29 (half B), and in **both halves for 17 (8.6%)**. So roughly **1 in 11 "Best" grades would lose over the hand**, an upper-bound-ish figure since the continuation policy is itself imperfect.
- Of the 99 decisions where the review says the player erred, its best beats the played move in both halves for 51 (52%) and in half A for 61 (62%): about **40% of "you erred" calls cannot be confirmed** by the long view.
- Median standard error of one decision's rollout loss: 0.79 points, so single decisions are noisy; the table is about averages.

**Reading it.** The grades are **directionally right and the Mistake band is credible** (73% confirmed, magnitude about 75% of the claim, correlation 0.53). They are weaker where it matters for a premium feel: about 1 in 11 "Best" grades is wrong over the hand, and the **Inaccuracy band is barely real** (rollouts put its real cost at about 0.2 points). This is the first evidence that the review's blind spot (a points-only horizon) costs accuracy. Caveats: rollouts are a *different imperfect* evaluator (a fixed bot policy), not truth, and the corpus is bot play. The open question is whether choosing by the long view actually *plays* better than the review's choice; `reviewRolloutMatch.ts` plays exactly that match.

## What this means for the goal ("one of the platform's most exceptional features")

1. **The September "36 of 65 analyzed" problem is not what players get today.** Every non-forced decision in a saved review ends on search or exact. That is real progress and should be said plainly, not hidden behind the old numbers.
2. **Neither sampling nor depth is the limiter, and the horizon value is the likely weakness (section 5).** More samples change nothing (section 2) and one more ply changes the "best move" in about 1 decision in 9 but does not win more games (section 3). So the review's strength is bounded by the **evaluation at the search horizon**, and the right next question is whether the grades mean something against real outcomes (a calibration study), before any engine work.
3. **Still unmeasured, and what I would measure next:**
   - **Consistency**: the September smoke failure was a *contradiction* (a "Blunder" badge over text saying "Best move"). A corpus-wide check that badge, prose headline and board reference never disagree would guard that class permanently.
   - **Calibration against outcomes**: does a move the review calls a mistake actually cost points on average in real play? This tests that the grades mean something, not just that they are stable.
   - **Human games**: everything above is bot play. A human pass on a phone with real games is still the gate before anyone calls this validated.
4. **Not engine work, but part of "exceptional"**: Daily Fritz and tournaments have no review; the in-match multiplayer review still says "Fritz" about a person; the review's explanation covers about 73% of the decisions where the player's move differed from the reference.

## Re-running

```
cd packages/review-engine
npx tsx src/devtools/reviewProductionTierMix.ts fixtures/recorded-self-play 100000 out.md   # ~4 min
npx tsx src/devtools/reviewSearchStability.ts fixtures/recorded-self-play 150 out.md        # ~10 min
npx tsx src/devtools/reviewDepthMatch.ts <shard> <deals> out.jsonl                          # ~1 min per game, run shards in parallel
npx tsx src/devtools/reviewDepthMatchSummary.ts out.md shard1.jsonl shard2.jsonl ...
```
