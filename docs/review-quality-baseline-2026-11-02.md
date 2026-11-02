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

## 6. Does choosing by the whole hand play better? (no)

`reviewRolloutMatch.ts`: two players on identical deals with seats swapped, games to 60. "review" picks the review's own top move (2 plies, 2,500 sampled hands, horizon value = score gap). "rollout" plays every legal move out to the end of the hand against 40 sampled opponent hands (both sides continuing with the Fritz standard policy) and picks the best average.

**Result, 100 games over 50 deals: rollout won 49 (49.0%, 95% interval 39-59%, sign test p = 0.92); mean margin -0.5 points per game; deals swept 9 by rollout, 10 by review, 31 split.**

So the whole-hand chooser plays **no better** than the review's score-gap chooser, even though section 5 found the review's grade disagrees with the whole-hand view for about 1 move in 11. Together with section 3 this is a consistent pattern: three quite different move-choosers (2 plies, 3 plies, whole-hand rollouts) are **indistinguishable in actual play** at this sample size (about plus or minus 10 points of win rate). Reading it honestly:

- The disagreements are mostly **between near-equal moves**, which is why following either does not win more games. A per-decision cost of about 1.4 points is real in expectation but small against the variance of a game to 60.
- It is also consistent with an earlier finding in the review work (the oracle against Fritz Master was 49.8%, indistinguishable): these evaluators sit on the **same plateau**, and a stronger one is not available by searching deeper or by this style of rollout.
- Rollouts here are only as good as the fixed policy they continue with, and 40 samples is noisy. A better continuation policy could change this; it is untested.

**What it means for the product.** Making the review's "best move" *stronger* by these routes is not supported by evidence. What the evidence does support is making its **claims more honest**: section 5 shows about 1 in 11 "Best" grades and most "Inaccuracy" grades are not backed by the whole-hand view. The better investment is to use the second opinion to **suppress low-confidence verdicts** (call a move a Mistake only when the search and the whole-hand view agree; otherwise say it is a close call), which fixes false accusations without needing a stronger engine.

## 7. Would a second opinion make the verdicts more trustworthy? (yes, measured; not shipped)

Sections 3 and 6 say a stronger engine is not the lever; section 5 says the verdicts are the weak spot (about 1 in 11 "Best" grades and most "Inaccuracy" grades are not backed by the whole-hand view). The obvious fix that needs no stronger engine is a **second opinion**: ask the whole-hand view too, and state a severity only when it agrees. `reviewRolloutCalibration.ts` now measures that, **cross-validated** so the rule never grades itself: one independent set of 60 sampled hands decides, the other judges, and then the reverse (pooled). 595 decisions, 316 error verdicts and 796 "Best" verdicts judged.

An error verdict is **kept** only if the deciding half also finds the review's best better than the played move; it **holds up** if the judging half finds it better by more than 0.25 points. "Best" is **kept** unless the deciding half finds another move better than the played one by more than 1 point.

| error verdicts | holds up as the review stands | kept by the rule | holds up among the kept | dropped | holds up among the dropped |
| --- | ---: | ---: | ---: | ---: | ---: |
| inaccuracy (118) | 54% | 62% | **64%** | 38% of them | 38% |
| mistake or blunder (198) | 72% | 75% | **85%** | 25% of them | 33% |
| all error verdicts (316) | 66% | 70% | **78%** | 30% of them | 35% |

"Best" verdicts: as the review stands the judging half finds a better move (by more than 1 point) in **12%**; the rule marks 12% of them as a close call (the judging half agrees with that call in 61%), and among the 88% still called Best the judging half finds a better move in **6%**, **half as often**.

**Reading it.** A second opinion would raise the share of error verdicts that hold up from 66% to 78% (Mistake/Blunder from 72% to 85%) and halve the false "Best" rate, at the price of calling about 30% of error verdicts and 12% of Best verdicts a "close call" instead. What it drops is mostly what was not confirmed (35% hold up among the dropped). The absolute levels are **lower bounds**: the judging half is itself noisy (one decision's rollout loss has a standard error of about 0.8 points), so even a perfect verdict would not validate 100% of the time. The relative gain is the signal.

**Shipped (2026-11-02, owner delegated the call: "think like chess.com").** There is no "close call" label: chess.com gives the milder grade when its engine is unsure instead of an accusation (or a "Best") it cannot back. So an unconfirmed verdict is shown **one grade softer** (Inaccuracy becomes Good; Mistake and Blunder become Inaccuracy; an unconfirmed Best becomes Good) with copy that says the two views disagree and quotes no point gap. The loss, the bands and the accuracy number are unchanged. The result rides on the evaluation as an additive optional field, `secondOpinion` (absent on live results, exact endgames, forced decisions and every review saved before this). **Cost: mean 8 ms, p90 18 ms, max 51 ms per decision** (`secondOpinionCost.ts`, 60 corpus decisions); an earlier estimate of 0.2 to 0.5 s here was wrong, the calibration run's time was almost all the search itself. Caveats: bot play, not human play; rollouts continue with a fixed Fritz policy; one corpus.

## What this means for the goal ("one of the platform's most exceptional features")

1. **The September "36 of 65 analyzed" problem is not what players get today.** Every non-forced decision in a saved review ends on search or exact (section 1). That is real progress and should be said plainly, not hidden behind the old numbers.
2. **A stronger engine is not the lever.** More samples change nothing (section 2). A deeper search and a whole-hand rollout chooser both play the same as the review's own choice (sections 3 and 6: 51.6% and 49.0%), even though they disagree with it on 1 decision in 9 or so. These evaluators sit on the same plateau, so **spending effort on engine strength has no evidence behind it.**
3. **The lever is how honest the verdicts are.** Section 5: the Mistake band is credible (73% confirmed), but about 1 in 11 "Best" grades and most "Inaccuracy" grades are not backed by the whole-hand view. A review that wrongly says "you erred" or "best" erodes trust faster than a weaker engine would. The measured plan (section 7): use the whole-hand view as a **second opinion** and only state a severity when both the search and the long view agree; otherwise call it a close call. Cross-validated, that raises the share of error verdicts that hold up from 66% to 78% and halves the false "Best" rate (12% to 6%). The corpus consistency audit (section 4) is the guard that the surfaces then stay coherent.
4. **Done so far:** tier mix measured (1), stability (2), depth (3), consistency guard in CI (4), calibration (5), strength match (6). All on **bot play**.
5. **Still open, and not engine work:**
   - **Human games.** Everything here is bot self-play. A human pass on a phone with real games is still the gate before anyone calls this validated, and I cannot do it.
   - Daily Fritz and tournaments have no review at all; the in-match multiplayer review still says "Fritz" about a person; the explanation covers about 73% of the decisions where the player's move differed from the reference.

## Re-running

```
cd packages/review-engine
npx tsx src/devtools/reviewProductionTierMix.ts fixtures/recorded-self-play 100000 out.md          # ~4 min
npx tsx src/devtools/reviewSearchStability.ts fixtures/recorded-self-play 150 out.md               # ~10 min
npx tsx src/devtools/reviewRolloutCalibration.ts fixtures/recorded-self-play 300 60 out.md         # ~2 min
npx vitest run src/devtools/reviewCorpusConsistency.test.ts                                        # ~1 s, also runs in CI
# engine-vs-engine matches: ~25-60 s per game. Run AT MOST 2 shards, niced (7 in parallel drove a laptop to load 120).
nice -n 15 npx tsx src/devtools/reviewDepthMatch.ts <shard> <deals> out.jsonl
nice -n 15 npx tsx src/devtools/reviewRolloutMatch.ts <shard> <deals> out.jsonl
npx tsx src/devtools/reviewDepthMatchSummary.ts out.md shard1.jsonl shard2.jsonl ...
```
