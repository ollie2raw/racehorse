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

## 3. Does the deeper search pick better moves? (interim, not yet conclusive)

`reviewDepthMatch.ts`: two players choose every move with the review engine, identical but for depth (2 vs 3 plies, same 2,500 samples), complete games to 60 on identical deals with seats swapped. `reviewDepthMatchSummary.ts` aggregates.

**Interim, 44 games over 20 deals:** the 3-ply player won 25 (56.8%, 95% interval 42-70%, sign test p = 0.45); mean margin +2.1 points per game; of 20 deals, 3-ply swept 3, 2-ply swept 2, 15 split. **Not distinguishable from even yet.** A 55-60% edge needs several hundred games to show; the run (168 games planned) was still going when this was written, and its final numbers should replace this paragraph. Machine throughput was the limit (one game takes about 55 s alone and about 4 minutes with 7 running at once on this laptop).

## What this means for the goal ("one of the platform's most exceptional features")

1. **The September "36 of 65 analyzed" problem is not what players get today.** Every non-forced decision in a saved review ends on search or exact. That is real progress and should be said plainly, not hidden behind the old numbers.
2. **The review's "best move" is only as good as a 2-ply search.** If the match confirms depth helps, the lever is search quality (depth, or a better value estimate at the horizon), not more samples. If it does not, the next lever is the evaluation itself. Either way the question is now measurable.
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
