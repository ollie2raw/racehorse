# Backend runtime reliability final gate

This closes the two R1s discovered after `82c35d09abbfdafab879feab2b306d656222b48e`.
Production was not accessed or changed. The validated runtime code commit is
`cba5667564c956c1f269a492e06ad107ce3af2f3`; subsequent report changes do not alter
runtime behavior. The canonical candidate is the updated `feat/app-store-candidate`
remote HEAD recorded in the final handoff, **not** `74ad0fec46dc6b79c7c1689f95b16ce93b7e4a67`.

## R1: owner interpretation and ordering

Inline human processing used raw profiles while recovery normalized zero-game
legacy profiles (1500 → 800). Saving only an opponent snapshot could not make
these calculations equal. Saving both sides without serialization would also
be wrong: game B could snapshot a player before pending game A was applied.

The intended new-player policy is established by `ranking/glicko2.ts`
(`DEFAULT_RATING=800`, `DEFAULT_RD=200`, `DEFAULT_VOL=0.06`) and existing
`needsLegacyRatingNormalization`/tests. The June greenfield baseline recorded
older production defaults of 1500/RD350/peak1500. A zero-game 1500 profile with
legacy peak NULL/0/1500 is normalized to the current defaults **before** the
new context is created. Other stored profiles keep their existing interpretation.

All insert paths use `insertRankedGameIdempotent`: drain earlier pending work,
read the normalized owner, capture authoritative opponent input, then insert.
The database locks the owner profile, rejects a pending predecessor and rejects
a snapshot that differs from that profile. A concurrent loser retries admission
at most five times; it drains the winning predecessor before retrying. There is
no rebasing of a stored new-context calculation. An unresolved invalid historical
predecessor blocks new rating admission for that owner visibly rather than
inventing a history; unrelated owners continue to recover.

The other seat of the *same match* uses that seat's immutable pre-game owner
state, even if its effect already committed. A repeated lookup closes the race
between the initial lookup and opponent preparation. This prevents a crash
between participant inserts from sampling the first participant's post-game
rating. Decay locks the same owner and refuses to alter a pending snapshot.

## Durable inputs and trust boundary

The unshipped migration was corrected in place; intermediate opponent-only v1
records have no compatibility promise. Final v1 context:

```json
{"version":1,"treatment":"disconnect_forfeit","cause":"disconnect_timeout","outcome":"loss","player":{"rating":800,"rd":200,"vol":0.06,"gamesPlayed":0,"peakRating":800},"opponent":{"rating":800,"rd":200}}
```

| Input | Classification / authority |
|---|---|
| Owner rating, RD, volatility | Durable normalized pre-game snapshot; mutable profile is subsequently used only for application validation. |
| Owner game count and peak | Durable snapshot for game-count/provisional/peak side effects. |
| Opponent rating and RD | Durable snapshot from authoritative profile/config, or same-match owner context. Opponent volatility/count do not enter the formula. |
| Outcome, scores | Immutable game facts from server-owned completion/verifier or authenticated room forfeit. Explicit outcome determines the Glicko result; score differential is not used. |
| Completion cause | Server-owned completed/manual-forfeit/disconnect-timeout classification, stored immutably. |
| Treatment / multiplier | Stored semantic treatment; v1 derives weight 1 or 0.5. Disconnect treatment requires disconnect-timeout cause; forfeits cannot be draws. |
| New-player normalization | Deterministic existing sentinel rule, applied before snapshot; not reinterpreted during replay. |
| Algorithm | Context version 1 selects this artifact's fixed Glicko2 equations/constants. No request/config-selected algorithm, placement multiplier or random input. Future algorithm changes require deliberate version handling. |
| Provisional and peak after result | Derived from snapshotted count + 1 (threshold20) and snapshotted peak/result. |
| Eligibility | Server verification/account-mode decision made before insertion; an inserted record is already eligible. |
| Processing timestamp / last-period timestamp | Receipt/application metadata, not a rating-calculation input. Decay is separately serialized. |

The helper obtains owner/opponent inputs itself; callers cannot supply the owner
snapshot. Existing caller audit/opponent arguments are superseded by these
authoritative reads. Clients cannot insert ranked games or write profile rating
columns: existing service-role grants/RLS lockdown remain intact. Context,
outcome, owner/opponent identities, scores, source and played-at facts cannot be
changed after creation. Inline and recovery call the same calculation, using
saved owner inputs for new records. Current-profile CAS conflicts fail closed;
only historical NULL contexts retain the prior recomputation behavior.

Strict runtime and SQL validation reject unknown versions, absent members,
contradictory treatment/cause, nonnumeric/nonfinite data, nonpositive RD/vol,
out-of-domain values and fractional/negative game counts. Rating domain is
±10000, RD (0,1000], volatility (0,1], and game count [0,2147483646]. New context
rows must enter pending, not pre-rated. Nonfinite calculation output is rejected.
Malformed recovery rows are isolated/backed off; there is no standard-treatment
fallback for a malformed new context.

## Migration and compatibility

`2026-10-15_ranked_rating_context.sql` explicitly follows
`2026-10-13_ranked_rating_claim.sql`: it depends on that migration's receipt key,
unique receipt index, profile CAS and RPC shape. The single RPC has a trailing
NULL-default context parameter, preserving old calls for NULL records while
rejecting old callers for new context records. No ambiguous overload is left.

The nullable column has no semantic default/backfill and requires no historical
row rewrite. Short expansion DDL and trigger/function installation commit before
CHECK validation takes its weaker validation lock. Reapplication was tested.
Historical NULL records retain full-weight, stored-outcome-or-score behavior;
no historical disconnects were guessed or re-rated. SQL constraints, immutable
triggers, pending admission, row locks, CAS, atomic receipts and decay fence were
exercised on PostgreSQL 16.15/PostgREST 16.4.

NEW/pre-context: actual compiled server booted with HTTP200; boot catch-up and a
disconnect insertion failed on the absent column with **zero Glicko writes**.
The preparation query fails before legacy normalization or insert. General
liveness/readiness alone is not certification of the rating schema.

The earlier September permissions migration had an independent fresh-install
gap: it named retired Gauntlet RPCs whose creation SQL is absent. It now revokes,
grants and self-checks those optional functions when installed; mandatory Daily
Fritz checks remain strict. No retired RPC was fabricated and no enabled product
behavior changed. All original historical migrations then applied successfully.

## R1: corrected BRIDGE admission

Historical `e3517fb0da9644ccede64697309d7af8d9ffb8ee` is superseded and must not be
deployed. Isolated `fix/rating-cutover-bridge-quiescence` is based exactly on it,
with corrected artifact **`3ccd6ff8c73c5cfd0efb24dde83d62cca82f7353`**. No candidate
features or full reliability implementation were merged into BRIDGE.

Catch-up now uses the same `withRatingCompletion` protocol as foreground rated
completion and H2H forfeits. Admin rating processing is also admitted/countable.
Authenticated Fritz disconnect work acquires its unit before touching the
pending match. Existing deferred Ghost and weekly decay accounting remains.
These are all enabled production runtime rating producers; tournaments remain OFF.

The count is incremented synchronously before reading the fence. A callback that
observed open remains counted through its awaited work; one observing closed
never enters the writer. Closing admission therefore cannot hide an admitted
callback. A failed row/run releases its unit in finally. Deferred Ghost work is
registered before the owning foreground unit ends. Decay counts its entire run.
Status is ready only when the closed fence was enabled by this process and all
three measures are zero. Restart preserves closure but requires re-enabling and
fresh drain evidence; it does not substitute killed work for observed drain.

### Exact-artifact live replay

Owned loopback PostgreSQL/PostgREST and a local auth fixture were used. Auth
fixtures issue synthetic identities; all persistence, constraints, RPCs and
transactions are real. No production credentials/network were used. Gateway
barriers pause actual requests; a loopback-only inspector invoked the actual
weekly callback without changing its code. The BRIDGE was also rebuilt/tested
against its own workspace packages, not candidate packages.

- Boot, `/api/health` and `/ready`: HTTP200, exact corrected release SHA.
- Open authenticated H2H: two ranked rows. Guest completion while closed: zero
  ranked rows; durable room completed.
- Closed H2H completion: zero ranked rows. Closed rated forfeit rejected; explicit
  resume/retry produced two ranked rows.
- Authenticated Fritz: held completion count1/readyfalse; after foreground return,
  held deferred Ghost count1/readyfalse; after release, readytrue and one training
  row. Closed retry503; resumed retry200, no duplicate rating.
- Actual boot catch-up held on its RPC: quiesce reported count1/readyfalse.
  After release, one receipt; closed admin attempt503. Two reads 30 seconds apart
  had the same bootId, readytrue and unchanged receipts.
- Actual weekly callback held on its profile write: decaytrue/readyfalse. After
  release it drained; another closed callback wrote no receipt.
- Restart while closed: boot callback skipped, no receipt; readyfalse until
  re-enabled. Closed admin503, explicit resume/admin200 produced exactly one
  receipt. Reclosed drain stayed ready over another 30-second pair.
- Expanded-schema BRIDGE boot/health/readiness passed while closed; pending NULL
  row remained unchanged. The exact old insert helper accepted the nullable
  expansion. Old RPC/NULL compatibility and new-context fencing passed real SQL.

The corresponding admission tests use controlled promises/fake timers for both
sides of the quiesce race, blocked DB work, row failure, closed boot callback,
resume and prohibition of receipts after positive drain while closed.

## Full-diff review and deferred R2s

Reviewed the full `74ad0fec..` reliability change and this continuation: body
consumption remains inside deadlines; bounded chronological catch-up retains
cursor/backoff/single-flight; decay remains single-flight/CAS; stream-filtered
room hydration retains ordering and completeness; reconnect guards retain rooms;
match-start retry keeps its PK/ignore-duplicate contract. The new context adds
only a bounded small JSON projection. No client/scoring/tournament changes.

During porting, profile-route tests caught that copying the old registrar would
remove candidate UUID validation. That was corrected by retaining the candidate
file and applying only the admission hunk. Final profile-route tests pass.

The three deferred items remain R2:

- Retention: two daily age-filtered idempotent DELETEs, no payload blobs; affected
  row count is uncapped. Live-room exclusion is retained. Volume/index/DB work
  caps remain an operational follow-up, not a current repeat-work/rating defect.
- Reservation terminal write: detached failure may leave stale historical
  `in_progress` metadata after an empty room is removed. It does not apply ratings;
  retry/expiration ownership remains deferred.
- Shutdown: live persistence has a bounded drain; detached workers/timers are not
  comprehensively cancelled/drained. Atomic receipts and deterministic pending
  snapshots survive interruption; derived Ghost style can rebuild from durable
  source rows. Broader lifecycle ownership remains deferred.

## Request budgets

| Scenario | Verified operations |
|---|---:|
| 100 stale incomplete Daily Fritz attempts | 1 recovery scan, 0 individual recovery GETs |
| Empty ranked catch-up | 1 GET |
| One recoverable game | 3 requests; repeated empty run1 |
| 100 distinct Fritz players | 201: scan1 + owner100 + commit100 |
| 100 new-context human players | 201; zero mutable opponent-profile reads |
| 100 same-owner poison rows | First page3 reads; valid next page3; backed-off repeat1 scan |
| Overlapping callback | No second active scan/application |
| 2400 room-log entries | 5 ordered pages, each ≤500, complete history |
| Lost match-start response | 2 attempts, one stored PK, successful reconciliation |

Foreground creation deliberately adds bounded preparation reads and may drain an
owner/opponent's predecessor. This pays correctness cost once when recording a
new game; recovery does not rediscover historical inputs by N+1 refetching.

## Validation and artifact handoff

Final command results and canonical Git SHAs are recorded in the final handoff.
Reproducible full migration runner: `server/scripts/verifyRuntimeMigrationChain.py`;
full crash matrix: `ratingContextPostgres.integration.test.ts`; reverse boundary:
`server/scripts/verifyForfeitPremigrationBoot.cjs`. These accept only owned local
database/REST endpoints. Fresh replay uses platform auth shims, 12 checked-in base
schemas, 77 historical migrations and all 8 pending migrations in dependency order.
Production-like upgrade replays actual historical DDL, with synthetic historical
rows and the exact staged BRIDGE/drain/expand/NEW/contract order.

Local evidence logs are `/private/tmp/runtime-r1-*`. No deployment, production
migration, production reconciliation or production data access is part of this gate.

Final validation (2026-10-15 UTC):

- NEW full server: **2012 passed, 40 opt-in skipped, 1 existing todo**, four
  shards 486/594/490/442; 297 passed files, 5 opt-in/skipped files.
- Corrected BRIDGE full server: **1903 passed, 1 existing todo**, four shards
  470/562/449/422. Admission/foreground/forfeit/Ghost/decay selection: **71 passed**.
- Focused reliability/request-budget selection: **126 passed**, 16 files.
- Full-schema real Postgres/PostgREST crash matrix: **23 passed**. Existing real
  Ghost/Rush/claim/rollout suite: **17 passed**; total **40 real database tests**.
- Fresh replay: **77 historical + 8 pending migrations**, plus the 12 base
  schemas and platform auth shim, all succeeded in explicit dependency order.
  Production-like replay passed gate, exact BRIDGE, drain, all expansions,
  NEW/pre-context fail-closed boundary, NEW smoke, resume, reconciliation **0**,
  contracts last, and post-contract completion/retry smoke with one receipt.
- Both artifacts: build/typecheck **PASS**, architecture **22/22**, responsive
  shell policy PASS, `git diff --check` PASS.
- Changed production-file lint: no new diagnostics. Six existing index.ts
  console-rule errors were verified identical against the pre-remediation
  source; passing run excludes only that baseline rule. NEW reported 0 errors,
  123 existing warnings under that configuration. No unrelated lint cleanup.
- Validation script syntax checks passed. Context migration reapplication
  passed. Optional retired-RPC permissions passed both absent and installed
  probe cases; no probe functions remain in the fresh schema.
- Owned loopback app, gateway, PostgREST and PostgreSQL services stopped.
  Generated match-log additions were restored to the original tracked content.

## Final production sequence (documentation only; not executed in production)

1. Apply `2026-10-13_rating_cutover_gate.sql`.
2. Deploy corrected BRIDGE `3ccd6ff8c73c5cfd0efb24dde83d62cca82f7353`.
3. Verify admin authentication, health/readiness and exact release.
4. Quiesce admission.
5. Prove all rating producers drained: two ready reads ≥30s apart, same bootId.
6. Apply `2026-10-13_ghost_rating_idempotent_completion.sql`.
7. Apply `2026-10-13_ghost_cutover_reconciliation.sql`.
8. Apply `2026-10-13_puzzle_rush_assignment_and_atomic_completion.sql`.
9. Apply `2026-10-13_ranked_rating_claim.sql`.
10. Apply corrected `2026-10-15_ranked_rating_context.sql`.
11. Deploy the current canonical NEW candidate SHA recorded in preflight.
12. Run completion/retry, H2H/Fritz, ranking and Rush smoke checks.
13. Confirm the BRIDGE instance has stopped.
14. Explicitly resume.
15. Observe using the existing production stability gate.
16. Require reconciliation zero / deliberate resolutions before contract.
17. Apply `2026-10-13_puzzle_rush_assignment_contract.sql`.
18. Apply `2026-10-13_ghost_user_match_uniqueness.sql`; repeat smoke.

**BACKEND RUNTIME RELIABILITY GATE PASSED**
