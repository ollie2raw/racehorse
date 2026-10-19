# Multiplayer `avgMoveQuality` — V2 migration audit

Branch `audit/multiplayer-move-quality-v2`, from candidate `42a9d30f`. Scope: the one persisted multiplayer statistic the
review-engine integration gate left on the legacy analyzer (its "R2"). The V2 review engine itself is not reopened.

## 1. The pipeline as it was

```
finished multiplayer game (guest vs registered only)
  -> MultiplayerGameShell: analyzeMoveLogDeferred(log, true, { oracleMode:'tier', tierPlayed:'standard' })   [browser, legacy]
  -> accuracy  (undefined when 0 moves or accuracy 0)
  -> recordMatchResult({ avgMoveQuality })  ->  POST /api/stats/record-match { avgMoveQuality }
  -> server recordUserMatch: accepted if finite and 0 < x <= 100, nothing else checked
  -> INSERT matches.avg_move_quality   (falls back to inserting without it when the column is missing)
  -> read: statsDerivations averages row.avg_move_quality over the user's online rows -> StatsSummary.avgMoveQuality
```

Aliases: `avgMoveQuality` (client/API body), `avg_move_quality` (column), `StatsSummary.avgMoveQuality`.

What is true, checked rather than assumed:

* **The column does not exist.** `supabase/schema.sql` defines `public.matches` without it and no migration adds it. The client
  read path says so (`statsApi.fetchUserStatsByUserId`: "Production `matches` does not expose `avg_move_quality` yet") and never selects
  it, so `StatsSummary.avgMoveQuality` is always `null`. The server insert has an explicit retry that drops the field when the
  column is missing. Net: the browser's number is computed (a Fritz-Master analysis per game) and then discarded. (No production
  access from here: "not in production" rests on the repo schema, the client comment and the insert fallback, not on a query.)
* **Nothing renders it.** No component displays move quality. `StatsSummary.avgMoveQuality` is read by `playerIdentityNormalization`
  as a pass-through. No social, leaderboard, ranking, achievement or feed code reads it (server `social/*`, `ranking.ts`
  select other columns).
* **Only guest-vs-registered games reach it.** `MultiplayerGameShell` returns before the analysis when both players have
  accounts; those rows are written by the server's own game-over event (`recordPublicOnlineMatch`) with no quality at all.
* **It was a client claim.** The value is the browser's; the server only range-checks it.

Classification: not cosmetic, not ranking, not achievement, not social: a profile statistic with no reader.

## 2. The legacy formula (`analyzeMoveLog`, `moveAnalyzer.ts`)

* Perspective: `entry.player === 'you'`, the reporting seat only.
* Every one of that seat's rows is averaged, including rows that are fixed constants rather than evaluations: only legal move
  **80**; forced draw/pass (no legal plays) **84**; "No legal plays recorded" / "No engine evaluation available" **72**; a
  non-play when plays existed **46**. Plays with a real choice are scored against Fritz Master's reply.
* Reference engine: `enrichMovesWithFritz` -> `chooseBotMove(..., 'master')`, a search with `performance.now()` deadlines
  (`MASTER_ENDGAME_BUDGET_MS` 90 ms, `EXACT_CHAIN_BUDGET_MS` 45 ms). Multiplayer passes no `reviewSnapshots`, so this path always runs.
* Rounded to one decimal; 0 moves gives 0 (the client turns that into `undefined`).
* Ties: whichever move the Master search returns first; no tie handling.
* Incomplete analysis: not represented; a position whose evaluation throws is silently scored 72.

On 48 game-seats (24 games, both seats) **1,362 of the 2,638 averaged legacy rows (51.6%) were fixed constants**
(1,055 x 80, 169 x 84, 138 x 72). (The Master search also logs "legal move projection failed ... not bot's turn" while analysing
these games; those errors are caught inside `enrichMovesWithFritz` and I did not trace which rows they correspond to.)

Wall-clock sensitivity. The dependence is real and reproduced deterministically (`multiplayerMoveQuality.differential.test.ts`):
with a frozen clock the search reads `performance.now` 884,400 times on `multiplayer-quality-v2:0`; with a slow clock (5 ms per
read) 3,206 times, about 276x less search. The headline number happened to agree on this game and on 10 games x 8 clock models
(frozen ... 5 ms/read, plus a 10 s/read clock), and repeat runs were identical, so the legacy value was **stable on this
corpus but not machine-independent by construction**; nothing in the stored value records that it was cut short.

## 3. The V2 contract

`authoritativeMoveQuality(job)` (`packages/review-engine/src/authoritativeMoveQuality.ts`) is the single definition.

| Question | Answer |
| --- | --- |
| Value | the V2 headline accuracy, `100 * exp(-k * mean expected-point loss)`, the same number the review shows (`computeGameAccuracyModel`) |
| Source | a review-completion job the **server evaluated**, only when `jobAuthoritativeComplete` (every decision FORCED or SCORED exact/search) |
| Whose decisions | the reviewed player's own (the job's snapshots) |
| Forced moves | excluded from numerator and denominator (not averaged as constants) |
| Draws / passes | a draw or pass with plays available is a real scored decision; a forced draw/pass is forced and excluded |
| Tied-optimal | zero loss, scored as optimal |
| Rounding | none (raw double; JSON round trip exact) |
| Version | `accuracyModelVersion` returned with the value |
| Incomplete / failed / pending / coverage gap | `status: 'unavailable', avgMoveQuality: null, reason: 'review-incomplete'` |
| No graded decision (all forced / none) | `unavailable`, `no-graded-decisions` |
| Any decision cut by the wall-clock ceiling | `unavailable`, `wall-clock-truncated` |
| Forfeit / disconnect | not an input. Review needs `gameOver` and captured snapshots; with no snapshots there is no job and no stat. A game that did produce a complete job is judged on the decisions actually played |
| Never | 0 or 100 because analysis is unavailable |

Exposed by `GET /api/review-completion-jobs/:jobId` and `GET /api/review-completion-jobs?gameDigest=` as `moveQuality`,
owner-only (the job must belong to the caller).

No new metric: it reuses `computeGameAccuracyModel`. It is recomputed from the job's evaluations, not read from the stored
`accuracyModelResult`, so a record that round-tripped through Postgres is judged by the same function.

## 4. Legacy vs V2 on a deterministic corpus

Namespace `multiplayer-quality-v2:<n>`, 24 games x both seats = 48 game-seats; policies random/score/doubles/branch, branch
placements, doubles, draw runs, blocked hands, multiple hands, terminal scoring. Replay any game with
`makeGame('multiplayer-quality-v2', n)`; rerun with
`MQ_DIFFERENTIAL=1 MQ_GAMES=24 MQ_OUT=out.jsonl npx vitest run src/analyzer/multiplayerMoveQuality.differential.test.ts` and
`node client/scripts/summarizeMoveQualityDifferential.mjs out.jsonl`.

* V2 - legacy: mean **+3.72**, median **+4.46**, mean |d| 6.72, median |d| 5.94, max |d| **17.65**; Pearson r 0.70.
  Legacy mean 74.3 (61.3-85.0); V2 mean 78.1 (56.6-98.3).
* Why: V2 excludes the 849 forced decisions and grades the 1,856 real choices exactly; legacy averages 1,362 constants
  (80/84/72) that pull strong play down and weak play up, so it **compresses**: mean by policy legacy/V2: score 80.2/89.0,
  doubles 68.8/72.4, branch 73.8/75.4, random 72.7/73.1. V2 separates the greedy-scoring seat from random play by 15.9 points,
  legacy by 7.5.
* Largest differences (all `score`/`doubles` seats with many forced rows): `:21 bot` 76.3 -> 94.0 (+17.7), `:13 you` 76.8 -> 92.9,
  `:22 you` 70.6 -> 84.3, `:9 you` 85.0 -> 98.3, `:1 you` 83.9 -> 96.7.
* Within a game, which seat played better changes in **8 of 24** games (`:2 :3 :4 :5 :12 :14 :19 :21`), e.g. `:19`
  legacy you 75.8 / bot 77.0 but V2 87.4 / 68.2 (branch vs random: V2 ranks them correctly).
* All 48 V2 jobs completed (none unavailable, none ceiling-truncated on an unloaded machine). V2 job time per game-seat: median
  27 s, max 235 s: it is on-demand work, which is why the stat is not computed for every game.

## 5. Determinism

* Repeat analysis, **two full independent runs of the 48 game-seats: all 48 V2 values (and the legacy values) bit-identical.**
* Separate processes: four game-seats from the first exploratory process equal the corpus values to the last digit.
* JSON round trip of the job: identical on all 48; permuted decision order (every rotation and the reverse): identical (unit test).
  `accuracyFromEvaluations` already sums a canonically sorted copy.
* **Machine speed: a real defect, found and handled.** Under a slow clock the job still completed, with 19 of 46 search-tier
  decisions cut by the wall-clock ceiling (`search.complete=false`, "wall-clock safety ceiling exceeded", e.g. 901 vs 2,500
  samples) yet accepted as SCORED, changing 6 losses and the stat (96.704 -> 96.637). Exact-tier decisions were identical.
  `authoritativeMoveQuality` now returns `unavailable / wall-clock-truncated` when any graded decision carries that diagnostic,
  so the stat is the identical number or explicitly absent, never a speed-dependent average. Node-budget exhaustion alone
  (seeded, machine-independent) does not suppress it.
  Not changed: the completion pass still accepts a ceiling-truncated search as SCORED for the **review display**
  (deferred, below).

## 6. Trust boundary

* The legacy write path is removed: `/api/stats/record-match` no longer reads `avgMoveQuality`, `recordUserMatch` neither
  validates nor inserts it (any client value, valid or not, is ignored; 11 claim shapes plus the inserted row's exact columns), and the client no longer sends it or runs the legacy analysis.
* V2 is derived server-side from the server's own evaluations. Real HTTP tests: a forged `avgMoveQuality`, `moveQuality`,
  `accuracyModelResult`, `evaluations`, scores or result in the job body, a tampered candidate set (omitted best move, added illegal
  move) and a replayed digest change nothing.
* **Limit (a tripwire test pins it): the server evaluates the positions and the PLAYED action the client submits.**
  `actualAction` is part of the claim and nothing binds a job to a game this server saw (the earlier gate noted the same: "the
  server never bound the snapshots to an authoritative game record"). Claiming the best move was played turned 7.3 into 100. This has
  no competitive impact today because `moveQuality` is returned only to the job's owner and is **persisted nowhere new**. It
  is the reason the V2 value is not written to `matches` or any shared surface: that needs server-issued snapshots first.

## 7. Historical data

Nothing to migrate. No schema or migration defines the column, so no historical value exists in the repo's schema; the legacy
values that were sent were dropped or never read. No version field is added: the V2 value carries `accuracyModelVersion` and lives
with the job, and no client reads a quality scale. If a production `matches.avg_move_quality` column does exist with legacy
rows, they are untouched and unread (the read path does not select it).

## 8. Retry / exactly once

No new write. `enqueueReviewCompletionJob` returns the existing job for a (gameDigest, user), so a retry, or a hostile replay of
the same digest with a different body, cannot create a second job or change the value (tested); the value is a pure function of the
persisted decisions, so reading it any number of times returns the same bits.

## 9. Client consumers

The only client reference that rendered anything is gone. `StatsSummary.avgMoveQuality` (still `null`) is untouched. No profile,
history, feed, achievement or result screen displays move quality, so no UI changes.

## 10. Findings

| ID | Finding | Status |
| --- | --- | --- |
| Q2 | The persisted stat was a client-asserted number from a wall-clock legacy analyzer averaging constants, and the DB column does not exist (value dropped) | **fixed**: legacy path removed, V2 single definition added |
| Q1 | V2 search-tier evaluations cut by the wall-clock ceiling were accepted as SCORED and changed the stat with machine speed | **fixed for the stat** (`wall-clock-truncated`) |
| Q2 | The review completion pass accepts a ceiling-truncated search as SCORED, so the review display (not the stat) can vary slightly with server speed | deferred (review-engine behaviour; out of scope) |
| Q2 | Job `actualAction` is client-claimed; the V2 value must not feed a shared/competitive surface until snapshots are server-issued | deferred, pinned by a tripwire test |
| Q3 | `StatsSummary.avgMoveQuality` and the `statsDerivations` averaging are dead code (the read path never selects the column) | deferred |
| Q3 | `packages/review-engine` `tsc --noEmit` pulls in client files (unrelated, pre-existing) | deferred |

No Q0: the stat had no reader and no competitive effect before or after.
