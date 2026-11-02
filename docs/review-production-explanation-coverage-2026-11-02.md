# Production explanation coverage

**Headline: 95.3% of the decisions where a player's move differed from the review's get an explanation, not the 73% (67.5% earlier) that has been quoted.** The older figure (`review-explanation-coverage-study.md`) is measured on the recorded corpus as it was written, by the older single-budget dispatcher, whose evaluations are 30 to 40% heuristic. A heuristic evaluation has no point values, so no value sentence is possible (68 of that study's 77 unexplained decisions were "value unavailable"). Production never ends on a heuristic for a decision with a choice (`review-quality-baseline-2026-11-02.md` section 1: 0%), so the old number understated what players get. This replays every decision through the production completion path instead (`reviewProductionExplanationCoverage.ts`, including the whole-hand second opinion).

How to read the rows below:
- **positional, value-gap, equal-value** are real reasons ("X leaves you with fewer ways to play", "the review prefers X by about N points overall", "these two moves are even").
- **unconfirmed** (18%) is the softened wording from the second opinion, "the review leans toward X, but it is not clear-cut". It is honest and deliberate, but it is a hedge, not a reason. Counting only real reasons, coverage is 212 of 275 (77.1%); the rest is hedged.
- **no-difference** (4.7%, 13 decisions) is every one a gap below the 0.25-point floor, where "this one is genuinely close" is the right thing to say. There are no exact ties left, no "real gap with no feature", and no "value unavailable".

Caveats: bot self-play, not human play; "explained" means a sentence is rendered, not that a human finds it convincing (that needs a human pass); one corpus, one run (Fritz's time-bounded search is not seeded, so single-record differences between runs are noise).

Re-run: `cd packages/review-engine && npx tsx src/devtools/reviewProductionExplanationCoverage.ts fixtures/recorded-self-play 100000 out.md` (about 5 minutes; run it niced).

1212 recorded decisions replayed through the production completion path (840 with a choice). Bot self-play, not human play.

## Where the player's move differed from the review's

| rendered headline | count | share |
| --- | ---: | ---: |
| positional | 128 | 46.5% |
| value-gap | 57 | 20.7% |
| equal-value | 27 | 9.8% |
| unconfirmed | 50 | 18.2% |
| no-difference | 13 | 4.7% |
| **explained (everything but no-difference)** | 262 | **95.3%** |
| decisions where the move differed | 275 | |

"unconfirmed" is the softened wording from the second opinion ("the review leans toward X, but it is not clear-cut"): honest, but not a positional reason.

## The unexplained ones (no-difference), by why

| why | count |
| --- | ---: |
| exactly equal value (a true tie) | 0 |
| positive gap below the 0.25 floor | 13 |
| real gap, no positional feature favors the reference | 0 |
| value unavailable | 0 |

## Evidence tier of the decisions that differed

- exact: 5
- search: 270
- heuristic: 0

## Samples of the "real gap, no positional feature" cases (the ones worth a better sentence)

