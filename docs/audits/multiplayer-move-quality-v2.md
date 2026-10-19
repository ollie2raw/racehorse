# Multiplayer move quality — V2 migration audit and integration decision

Audit branch `audit/multiplayer-move-quality-v2` (`d2af3ce4`), reviewed and corrected on `integrate/multiplayer-move-quality-v2`, both
from candidate `42a9d30f`. Scope: the one persisted multiplayer statistic the review-engine integration gate left on the legacy
analyzer (its "R2"). The V2 review engine itself is not reopened.

**Bottom line.** The branch removes a client-trusted, wall-clock-dependent, never-read statistic and leaves one owner-only,
truthfully named V2 value behind a hard guard. It does **not** deliver a trustworthy persisted stat, and it says so in the type, the
payload, a runtime gate, a test that fails on misuse, and here: the value is `reviewedMoveQuality`, not "authoritative".

```
PLAYED ACTION IS SERVER-AUTHORITATIVE: NO
```

## 1. The pipeline as it was (candidate `42a9d30f`)

```
finished multiplayer game (guest vs registered only)
  -> MultiplayerGameShell: analyzeMoveLogDeferred(log, true, { oracleMode:'tier', tierPlayed:'standard' })   [browser, legacy]
  -> accuracy  (undefined when 0 moves or accuracy 0)
  -> recordMatchResult({ avgMoveQuality })  ->  POST /api/stats/record-match { avgMoveQuality }
  -> server recordUserMatch: accepted if finite and 0 < x <= 100, nothing else checked
  -> INSERT matches.avg_move_quality   (retries without it when the first insert's error mentions the column)
  -> read: statsDerivations averages row.avg_move_quality over the user's online rows -> StatsSummary.avgMoveQuality
```

Aliases: `avgMoveQuality` (client/API body), `avg_move_quality` (column), `StatsSummary.avgMoveQuality`.

## 2. Schema and production uncertainty

Searched every file type in the repo (migrations, `supabase/*.sql`, `schema.sql`, policy manifest, RLS tests, generated types, docs,
client and server code), excluding only `node_modules`/`dist`.

* `avg_move_quality` is in **no** schema file and **none of the 91 migrations**; there are no generated DB types. No migration
  adds any column to `public.matches` (its only `ALTER`s are RLS enablement and an FK change). On the candidate it appears only in:
  the server write path and its fallback (`recordUserMatch.ts`), the client read type and averaging (`statsDerivations.ts`), one
  client comment (`statsApi.ts`), and two documentation bundles.
* **What the repo cannot prove:** whether production has an old, manually created `avg_move_quality` column. The client comment
  ("Production `matches` does not expose `avg_move_quality` yet") is a claim in code, not evidence, and there is no production
  access from here. **The integration therefore does not depend on the column being absent**; it is safe either way
  (section 7): it never writes the column, never reads it, and leaves any existing values untouched.
* Likewise unknowable from the repo: any production-only view/function that references the column. Removing the writes cannot break
  such a reader (it would see `NULL` for new rows; old rows are unchanged).

## 3. The legacy client-trust path, reproduced on the candidate's own code

Extracted `recordUserMatch.ts` from `42a9d30f` verbatim and ran it (throwaway probe, not committed):

* The route passes the browser's number straight in (`stats.ts:127`: `avgMoveQuality: req.body?.avgMoveQuality ?? null`).
* Validation is range-only: `99.9`, `100`, `0.0001` **accepted**; `0`, `-1`, `101`, `'abc'`, `NaN` rejected with **400** (the whole
  request, so an old client with a bad value could not record its match at all).
* **The forged value reaches the INSERT body**: `...,"avg_move_quality":99.9}`. If the database has the column, the old path
  persists a client-chosen number, for guest-vs-registered games.
* The fallback does **not** always fire. It retries without the field only when the first insert's error text contains
  `avg_move_quality`, `column` or `42703`. A column error (`column "avg_move_quality" ... does not exist`, or a PostgREST
  "Could not find the avg_move_quality column") retries and records the match without it. A connection error
  (`fetch failed`) or `permission denied` returns **500** with the value still in the (failed) insert; nothing drops it.

So: if production has no such column, the field was computed and discarded; if it does, the old path persisted attacker-controlled
data. The change removes both possibilities.

## 4. The legacy formula (`analyzeMoveLog`)

* Perspective: `entry.player === 'you'`, the reporting seat only. Every one of that seat's rows is averaged, including fixed
  constants: only legal move **80**; forced draw/pass **84**; "No legal plays recorded" / "No engine evaluation available" **72**;
  a non-play when plays existed **46**. Real choices are scored against Fritz Master's reply.
* Reference engine: `enrichMovesWithFritz` -> `chooseBotMove(..., 'master')`, a search with `performance.now()` deadlines (90 ms
  endgame, 45 ms exact chain). Multiplayer passes no `reviewSnapshots`, so this path always runs. Rounded to one decimal; 0 moves
  gives 0.
* On 48 game-seats (24 games, both seats) **1,362 of the 2,638 averaged legacy rows (51.6%) were fixed constants**
  (1,055 x 80, 169 x 84, 138 x 72).
* Wall-clock dependence is real and reproduced (`reviewedMoveQuality.differential.test.ts`): a frozen clock reads
  `performance.now` 884,400 times on `multiplayer-quality-v2:0`, a slow clock (5 ms/read) 3,206, about 276x less search. The number
  agreed on that game and on 10 games x 8 clock models, and repeat runs matched, so legacy was **stable on this corpus but not
  machine-independent by construction**.

## 5. The V2 value: what it is and what it is not

`deriveReviewedMoveQuality(job)` (`packages/review-engine/src/reviewedMoveQuality.ts`).

| Input to the number | Origin |
| --- | --- |
| candidate set | **server-derived** (the client's `legalActions` is replaced from the recorded position) |
| evaluation of every candidate | **server-evaluated** (client evaluations are ignored) |
| **the played action** | **client-asserted**: part of the snapshot the client submits; nothing binds a job to a game this server saw |

Reproduced on the final code: the same legitimate position with a different legal action claimed turns 7.3 into 100 (the server
derives and evaluates both candidates correctly; which one was *played* is the client's say). The earlier gate recorded the same
limit ("the server never bound the snapshots to an authoritative game record"). So the value is **reviewed**, not authoritative. The
original name `authoritativeMoveQuality` overstated this and was renamed.

| Question | Answer |
| --- | --- |
| Value | the V2 headline accuracy, `100 * exp(-k * mean expected-point loss)`, the same number the review computes (`computeGameAccuracyModel`) |
| Whose decisions | the reviewed player's own (the job's snapshots) |
| Forced moves | excluded (the legacy analyzer averaged constants for them) |
| Draws / passes | a draw or pass with plays available is a real scored decision; a forced draw/pass is excluded |
| Tied-optimal | zero loss, optimal |
| Rounding | none (raw double; JSON round trip exact) |
| Version | `accuracyModelVersion` returned with the value |
| Incomplete / failed / pending | `unavailable`, `review-incomplete` |
| No graded decision | `unavailable`, `no-graded-decisions` |
| Any decision cut by the wall-clock ceiling | `unavailable`, `wall-clock-truncated` |
| Forfeit / disconnect | not an input; with no captured snapshots there is no job and no value |
| Never | 0 or 100 because analysis is unavailable |

Every result carries `provenance { candidateSet:'server-derived', evaluation:'server-evaluated', playedAction:'client-asserted' }`
and `ownerOnly: true`, on the wire as `reviewedMoveQuality` on `GET /api/review-completion-jobs/:jobId` and
`?gameDigest=` (owner-only: the job must belong to the caller).

## 6. The persistence gate (the rule, enforced)

> Move quality must not be persisted, published, ranked, rewarded, or exposed to another user until the played action is
> server-authoritative.

* **Type/contract:** `ReviewedMoveQuality` (owner-only) is a different type from `ShareableMoveQuality`; the only way across is
  `assertMoveQualityShareable`, which **throws for every value the module produces** (played action client-asserted) and for any
  unavailable value. It opens only for a value whose provenance says `server-authoritative`, which nothing can currently produce.
  Tested both ways (refuses everything; opens for an attested value).
* **Wire:** the field is named `reviewedMoveQuality` and states its own provenance.
* **Static guard** (`server/src/reviewCompletion/reviewedMoveQualityGuard.test.ts`): scans the production sources of server,
  client, review-engine and game-core and fails if any file outside a short allowlist uses the reviewed value, the shareability
  gate, or `avg_move_quality`. Verified to bite: a file that references the column and the function fails it with the rule in the
  message. Adding a consumer is a deliberate, reviewed edit to that allowlist.
* **Tripwire** (`reviewCompletionReviewedMoveQuality.test.ts`): pins that a claimed best move moves the value (and that the value
  that moved is labelled client-asserted and owner-only). It goes red the day the played action is bound, which is the cue to update
  the provenance.
* The server worker never touches the database for this value (asserted).

## 7. Legacy removal and mixed-version safety

Removed: the client's legacy analysis and send; `/api/stats/record-match` no longer reads `avgMoveQuality`; `recordUserMatch` no longer
validates or inserts it or carries the missing-column fallback; `RecordMatchInput.avgMoveQuality`. Kept (untouched, dead but
harmless): `StatsSummary.avgMoveQuality`, `statsDerivations` averaging, `avg_move_quality?` in the read type.

* **Old client, new server** (route-level test, real route + real `recordUserMatch`, mocked DB): an old client that sends
  `avgMoveQuality` (valid, `1000`, `-3`, `'abc'`, `100`) is recorded normally, response `{ ok:true, replayed:false }` unchanged,
  and the row never carries the field. The three that the old server answered 400 are now recorded instead of failing.
* **New client, old server:** the new client simply omits the field, which the old server already treated as optional.
* **Replay de-duplication** is unchanged with or without the field. The recorded row is byte-identical either way.
* **If production has the column:** it is never written again, never read, existing values untouched.
* **Historical API/stats serialization:** `StatsSummary.avgMoveQuality` is unchanged (still `null`, never selected).

## 8. Legacy vs V2 on a deterministic corpus

Namespace `multiplayer-quality-v2:<n>`, 24 games x both seats = 48 game-seats; policies random/score/doubles/branch, branches,
doubles, draw runs, blocked hands, multiple hands, terminal scoring. Replay with `makeGame('multiplayer-quality-v2', n)`; rerun with
`MQ_DIFFERENTIAL=1 MQ_GAMES=24 MQ_OUT=out.jsonl npx vitest run src/analyzer/reviewedMoveQuality.differential.test.ts` and
`node client/scripts/summarizeReviewedMoveQualityDifferential.mjs out.jsonl`.

* reviewed - legacy: mean **+3.72**, median **+4.46**, mean |d| 6.72, max **17.65**; Pearson r 0.70 (legacy mean 74.3, V2 78.1).
* Legacy compresses: mean by policy legacy/V2 score 80.2/89.0, doubles 68.8/72.4, branch 73.8/75.4, random 72.7/73.1.
* Which seat played better changes in **8 of 24** games (e.g. `:19` legacy 75.8/77.0, V2 87.4/68.2).
* All 48 jobs completed; median job time 27 s, max 235 s (on-demand work, hence not computed per game).
* These are comparisons of two *estimates of a claimed game*; the corpus games are honest, so the played action is not in question.

## 9. Determinism

* Two full independent runs of the 48 game-seats: all 48 reviewed values (and the legacy values) bit-identical; four more match a
  separate earlier process to the last digit; identical after a JSON round trip and under permuted decision order.
* **Wall-clock truncation (reproduced three times, last on the final code).** Under a slow clock, 19 of 46 search-tier decisions
  were cut by the ceiling (`search.complete=false`, "wall-clock safety ceiling exceeded", e.g. 901 vs 2,500 samples; 6 of them with a
  different loss) yet accepted as SCORED, moving the stat 96.704 -> 96.637. Candidate sets were identical. Exact-tier decisions
  were identical. The baseline reproduces 96.70361036695363 every time. **Fix:** any ceiling-truncated decision makes the aggregate
  `unavailable / wall-clock-truncated`; node-budget exhaustion alone (seeded, machine-independent) does not. No partial set is
  averaged.
* **Can SCORED-but-unavailable mislead a current UI?** No. The review UI shows the job's `accuracyModelResult` headline and
  per-decision labels; nothing reads `reviewedMoveQuality`, and the ceiling diagnostic is only used in dev logging. So the only
  place speed can still leak is the existing review display (a slightly speed-dependent headline), which this change does not touch.
  If a screen ever shows both numbers they would disagree exactly in the truncated case. Q2, deferred.

## 10. Findings and decision

| ID | Finding | Status |
| --- | --- | --- |
| Q2 | Persisted stat was a client-asserted number from a wall-clock legacy analyzer averaging constants; if the column exists it was persisted | **fixed**: legacy path removed |
| Q1 | V2 search-tier evaluations cut by the wall-clock ceiling were accepted as SCORED and changed the aggregate with machine speed | **fixed for the aggregate** |
| Q2 | Name overstated trust ("authoritative") while the played action is client-asserted | **fixed**: renamed `reviewedMoveQuality`, provenance, gate, guard |
| Q2 | The played action is client-asserted; the value cannot be a shared/competitive stat | **bounded, not fixed**: owner-only, persisted nowhere, gated |
| Q2 | Review completion accepts ceiling-truncated searches as SCORED for the review display | deferred (review-engine behaviour) |
| Q3 | Dead `StatsSummary.avgMoveQuality` / `statsDerivations` averaging; `packages/review-engine` `tsc --noEmit` noise | deferred |

No Q0: nothing reads the value and there is no competitive effect before or after.

**Decision: integrate (A).** The cleanup removes a client-trusted, wasteful (a Fritz-Master analysis per guest game) and, if the
column exists, data-persisting path with no reader; the retained surface is small, owner-only, labelled for what it is, cannot be
written to a shared surface without editing a guarded allowlist and passing a gate that currently refuses, and is exercised by real
HTTP tests rather than dead code. If a reviewer prefers zero unused API surface, the one removable piece is the
`reviewedMoveQuality` field on the job read (the guard test's allowlist and the module would then be the only remainder).
