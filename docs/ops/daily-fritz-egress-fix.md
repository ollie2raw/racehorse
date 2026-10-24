# Daily Fritz recovery egress fix

> **Historical record.** The SHAs below are the states verified when this fix was written, not the current release artifacts. The
> current candidate and BRIDGE′ pins are in [backend-runtime-canonical-artifacts.md](backend-runtime-canonical-artifacts.md).

Source states verified after fetching origin:

- Candidate: `71eaf3d3920cce610e8e448fc59962b96cd82496` (`origin/feat/app-store-candidate`).
- Production main: `18bc747ac7156d0058c5acd9cddcc545660e6e28`.
- The affected recovery/store/lifecycle files are identical in those states.

## Cause and scope

Server startup schedules `recoverStrandedDailyFritzAttempts` at boot +20s and
every 15 minutes. Previously, each sweep selected the oldest 100 stale started
attempts with full `result` JSON, then refetched each one. Incomplete attempts
were skipped without leaving that query, indefinitely occupying the first page.

The fix changes only recovery selection/classification, associated tests, the
identified persistence QA safeguards, and a read-only reporting tool. There are
no schema changes, gameplay/rating changes, tournament changes, senior cutover
changes, deletions, or automatic abandonment.

## Recovery semantics and request budget

Each sweep makes one keyset-paged GET of at most 100 rows. Selected fields:
`id,user_id,run_date,started_at`, plus five projections out of `result`:
`version,format,games,setWinner,set_winner`. It does not transfer checkpoints,
authority ledgers, transcripts, or the rest of `result`.

Classification uses `normalizeDailyFritzSetResult`, the same normalizer used by
the finalizer. The projection includes all game validation inputs and both
winner aliases. Other result fields affect score publication/verification but
do not affect whether normalization yields a winner. Exhaustive best-of-three
win/loss combinations, alias precedence, one-game instant skunks, and malformed
games are tested against the full result's completion decision.

Incomplete and ambiguous rows cause no full-row lookup, mutation, or per-row
event. Complete candidates alone are refetched under the existing attempt lock
and passed to the unchanged finalizer/transactional command. Fresh status and
revision/idempotency checks remain in place. Failure remains retryable.

The cursor advances by ID through bounded pages, then wraps. A completion after
an old 100-row incomplete page is reached on the next sweep (15 minutes later),
rather than being starved forever. Previously incomplete rows are revisited
after wrap because legitimate gameplay can make them complete. The cursor is
in memory and resets on restart; traversal assumes the worker keeps running.
A guard prevents overlapping sweeps on one process. The existing per-attempt
lock remains process-local; this fix does not introduce distributed scheduling.

For 100 incomplete rows:

| Measure | Before | After |
|---|---:|---:|
| GETs per sweep | 101 | 1 |
| Full-row refetches per sweep | 100 | 0 |
| Scheduled GETs / 24h, continuously running one process | 9,696 | 96 |
| Boot sweep GETs, if included | +101 | +1 |

With exactly 100 rows, every other sweep observes the empty tail and wraps; it
still makes only one GET. No cleanup is needed to obtain the egress reduction.
One lightweight recurring scan remains necessary to discover newly completed
attempts; ordinary incomplete attempts are no longer recurring expensive work.

Previously, 100 rows × two copies × 96 sweeps/day × 30 days = 576,000 row
copies. At an illustrative 6 KB/row this is 3.46 GB of response payload before
compression. Removing the N+1 reads and large JSON should materially reduce
that trajectory, but the actual billed reduction must be observed after a
separately authorized deployment. Other traffic is outside this fix.

## Production-test safety

History shows CI previously used production Supabase plus the manual override;
commit `eb3d1768` moved those jobs and the Daily Fritz soak to dev. The earlier
ops inventory recorded 623 test-domain users and 46 test-owned Daily Fritz
attempts. Those figures are historical, not a new production inventory.

`assertAutomatedPersistenceTarget` calls the existing
`assertNotProductionSupabase` with production overrides disabled. The Daily
Fritz soak requires a local API origin and dev Supabase. The reachability seed
checks its effective credentials before any request. Daily Fritz browser QA
checks effective env and local app/API origins, blocks service workers, and
intercepts production Supabase requests, remote API requests, and remote
WebSockets. Tests exercise the actual seed entry point and browser interceptors.

No change is made to deliberate production operational tools or their existing
manual opt-in mechanism. Browser QA now requires a local frontend/server.

## Read-only production reconciliation

No production inventory or cleanup was executed. This isolated worktree has no
local Supabase credential files. The script can be run later by an operator.

Preferred: use an approved JSON export of stale attempts. Either full rows
(`result` included) or the projected scan rows are accepted. Optional ownership
evidence is a JSON object keyed by user ID with `{ "email": "..." }` or
`{ "missing": true }`; do not infer missing ownership from an absent map entry.

```sh
cd server
node --import tsx scripts/reportDailyFritzStaleAttempts.ts \
  --input /path/to/attempt-export.json \
  --owners /path/to/approved-owner-evidence.json > /path/to/report.json
```

Alternatively, the script supports explicit live **GET-only** inspection using
operator-supplied environment credentials. Production requires the existing
manual opt-in, and this command is intentionally not part of automated tests:

```sh
node --import tsx scripts/reportDailyFritzStaleAttempts.ts \
  --supabase-read-only --allow-production > /path/to/report.json
```

The report distinguishes:

1. Incomplete but potentially resumable: preserve state.
2. Complete and eligible for the existing recovery path: normal recovery.
3. QA/test/orphan candidates, only with supplied ownership evidence: review;
   ownership alone never authorizes abandonment.
4. Corrupt/ambiguous: operator review; no automated full-row fetch or closure.

Complete/corrupt classification takes precedence over ownership, which is also
reported separately. Every entry has `automaticClosureAllowed: false`.
The script has no write/apply mode and performs no auth-user enumeration.

Any later reconciliation that closes a confirmed abandoned row is a separate
approved operation: retain a reviewed manifest, preserve result/checkpoint
evidence, recheck status/revision/state, use the normal idempotent lifecycle
transition, and record an audit event. Never close solely because of age or a
test-domain email. The older `remediateDailyFritzStrandedAttempts.ts` script is
not used; its ID-only PATCH is insufficient for concurrent-state safety.

## Initial candidate validation

- Focused recovery/lifecycle/leaderboard/QA-safety suites: 42 tests passed.
- Full server suite, four shards: 1,940 tests passed; 17 skipped, 1 todo;
  291 test files passed, 4 skipped.
- Architecture: 22/22 invariants plus responsive policy passed.
- Server build (including game-core and review-engine): passed.
- Server script typecheck: passed.
- Local memory persistence test: passed with network persistence forbidden.
- Read-only report CLI against a local four-category fixture: passed.
- Browser script syntax checks and `git diff --check`: passed.
- Changed runtime modules lint clean, except the untouched pre-existing
  `console.warn` in `dailyFritzStore.ts` (baseline line 607).
  Whole-server lint reports 60 existing errors and 136 warnings in unrelated
  code; these are not part of this fix.

The initial sandboxed suite could not bind a local loopback test server, and
the tsx CLI could not create its local IPC pipe. Required commands passed when
rerun with local socket/IPC access. The isolated worktree has no Supabase env
files; no production traffic or writes were used for validation.

## Initial production hotfix preparation

`hotfix/daily-fritz-egress` is based directly on production main
`18bc747ac7156d0058c5acd9cddcc545660e6e28`, at commit
`8bee686abfbd4103bc5ab6e73f9bc9ee19a02c94`. Only the recovery fix and its
tests are included: 10 files, with no candidate merge, QA tooling, migrations,
senior cutover changes, or unrelated jobs. The 10 affected files exactly match
their final candidate versions.

Hotfix validation: 36 focused tests passed; full server suite passed all four
shards (1,873 tests passed, 1 todo; 281 test files passed); server build passed;
22/22 architecture invariants and responsive policy passed; branch-level
`git diff --check` passed. Both worktrees are clean. Nothing was pushed, merged,
migrated, deployed, or executed against production Supabase.

## Malformed-row blocker closure and final gate

The initial artifacts above were held at review: a JSON score object with
non-callable `toString`/`valueOf` could throw during normalization, before the
sweep's row error boundary, preventing cursor advancement. Those initial SHAs
and validation counts are historical; the corrected artifacts supersede them.

The shared correction is candidate commit
`6e1f39e475b684c30c255eb76d90b7ff67f532d0`, ported minimally to hotfix commit
`3a65ab1c37f098aa94c306c755eca8fbbc65aee2` on the same production-main base.

- The classifier accepts untrusted input and encloses property access and the
  existing normalizer in one exception boundary. Coercion/parsing errors return
  `ambiguous`; valid completion interpretation is unchanged.
- The sweep separately catches unforeseen eligibility errors, warns without
  unsafe error-object coercion or per-row persistence, skips that row, and
  continues the page/cursor. Ordinary malformed rows cause no full-row lookup.
- Scan failures are logged and rethrown to the existing scheduler handler;
  they do not become successful zero-work/ambiguous-row results. Retry retains
  the cursor and releases the overlap guard.
- Regression tests cover every numeric coercion site, malformed containers and
  property access, a malformed first row on a 100-row page, later completions,
  cursor advancement/wrap, repeated runs, unchanged malformed state, and scan
  failures. Existing completion parity, resume and amplification tests remain.
- The same classifier makes reconciliation robust. A CLI fixture containing a
  malformed row followed by a complete row reports both, with the malformed
  row marked `corrupt_ambiguous` and no automatic closure. The script remains
  GET/read-only, with no write/apply mode; no production report was executed.

Final gate results on corrected source:

| Check | Candidate | Minimal production hotfix |
|---|---|---|
| Focused tests | 59 passed | 51 passed |
| Full server suite (four shards) | 1,957 passed; 17 skipped; 1 todo | 1,888 passed; 1 todo |
| Architecture and responsive policy | 22/22 + policy passed | 22/22 + policy passed |
| Server build and script typecheck | Passed | Passed |
| Branch diff check | Passed | Passed |
| Changed runtime files lint | No findings | No findings |

The corrected local memory reproducer passes on both artifacts: first sweep
finalizes the valid later set and skips the malformed row; the second sweep
does no further finalization; the malformed row remains unchanged; network
calls are zero. Whole-server lint retains the same 60 existing errors and
136 warnings. No production data, migration, tournament, rating cutover, or
unrelated job is changed. The hotfix still contains only the original ten
recovery/helper/test files, excluding candidate-only QA/report tooling.
