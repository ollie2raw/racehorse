# Racehorse 9.5 Engineering Program — Evidence Ledger

This file is append-only. Status labels have strict meanings:

- `CODE-COMPLETE`: implementation exists but has not completed required automated verification.
- `LOCALLY-VERIFIED`: stated automated verification passed locally against the stated environment.
- `MIGRATION-APPLIED`: required schema was applied and confirmed by querying the named target database.
- `PRODUCTION-VERIFIED`: behavior was directly confirmed against production Render/Vercel/Supabase.

No entry may infer a stronger status from a weaker one.

## Current batch status matrix

- [x] **Batch 1 — Daily Puzzle five-slot constraint: local implementation and static/store verification.** `LOCALLY-VERIFIED`.
- [ ] **Batch 1 — apply and introspect the constraint in PostgreSQL/Supabase.** `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database target)`; production state `UNKNOWN`.
- [x] **Batch 5 — durable multiplayer invites: local implementation and mocked-store/socket verification.** `LOCALLY-VERIFIED` (completed in the 2026-08-06 session recorded below).
- [ ] **Batch 5 — apply the invite migration and enable the durable runtime path.** `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database target)`; `MULTIPLAYER_DURABLE_INVITES=false` remains the safe default and production state is `UNKNOWN`.

These paired checkboxes distinguish implementation completion from external schema activation. An unchecked database/production step does not make the corresponding local implementation batch incomplete.

## 2026-08-06 — Program baseline and Batch 0 safety audit

### Baseline repository evidence

- Active branch at start: `fix/fritz-score-toast-sticky`.
- HEAD at start: `888038e82409236e332206e482a5133af96a774d`.
- After `git fetch origin`, `origin/main`: `e93368e410b33aae38625c1e64a96f4eb738026f`.
- Fresh divergence: 15 commits unique to HEAD and 14 commits unique to `origin/main`.
- Dirty worktree at start: 98 modified, 41 untracked, 3 deleted (142 entries total).
- Existing stashes: five (`stash@{0}` through `stash@{4}`); none applied, modified, or dropped.
- No commit or push was performed.

### Human disposition blockers

The following P0-relevant untracked work remains preserved and requires explicit human disposition before branch reconciliation:

- `client/src/config/fritzChallengeFeature.ts`
- `client/src/fritzChallenge/`
- `server/src/fritzChallenge.ts`
- `server/src/fritzChallenge.test.ts`
- `supabase/migrations/2026-08-02_daily_fritz_finalize_instant_skunk.sql`
- `supabase/migrations/2026-08-02_multiplayer_live_room_authority.sql`
- `supabase/migrations/2026-08-03_fritz_challenge_recipient_invites.sql`
- `supabase/migrations/2026-08-06_fritz_challenge_lifecycle_telemetry.sql`

The five stashes were inspected read-only with `git stash show --stat`. No disposition was assumed.

### Remote divergence finding

`origin/main` contains equivalent five-puzzle and Daily Fritz fixes under different commit IDs. A blind merge/rebase risks duplicate patches and conflicts in the dirty worktree. Reconciliation is blocked pending a clean, human-approved disposition of untracked work and stashes.

### CI findings

- Latest inspected primary CI run `31121847790` failed before checkout because GitHub Actions returned `Service Unavailable` while resolving action downloads. This is an infrastructure failure, not evidence of an application test failure.
- Latest inspected puzzle-generation run `31133453652` completed most dates but exited with one failed date: `2026-08-13`.
- That puzzle run used Node `20.20.2` and emitted `EBADENGINE` warnings because Supabase packages require Node 22 or newer.
- That install also reported eight high-severity dependency vulnerabilities; remediation belongs to Batch 9.

### Node/toolchain change

Status: `CODE-COMPLETE`

Changed:

- `.nvmrc`: Node 20 → Node 24.
- `server/.nvmrc`: Node 20 → Node 24.
- `.github/workflows/gen-puzzles.yml`: Node 20 → Node 24; checkout v4 → v5; setup-node v4 → v6.
- Primary CI and Daily Fritz soak were already on Node 24.

Required verification still pending at this entry:

- Confirm local Node 24 install/runtime.
- Run dependency install/build without Supabase engine warnings.
- Run focused puzzle-generation logic without changing production data.
- Run repository validation required for Batch 0.

### Batch 0 status

- Repo disposition/reconciliation: `BLOCKED — HUMAN DECISION REQUIRED`.
- Node alignment: `CODE-COMPLETE`.
- CI root-cause catalog: `LOCALLY-VERIFIED` as read-only GitHub run inspection; no production behavior claim.
- Production state: `UNKNOWN`.

## 2026-08-06 — Batch 1 Daily Puzzle five-slot completion constraint

### Root cause

`supabase/migrations/2026-08-06_daily_puzzle_five_slot_ladder.sql` widened `daily_puzzles.slot_index`, `daily_puzzle_attempts.current_slot_index`, and `daily_puzzle_slot_results.slot_index` to five, but omitted `daily_puzzle_attempts_puzzles_completed_check`. The pre-existing constraint still rejected values above three.

### Changes

Status: `CODE-COMPLETE`

- Added `supabase/migrations/2026-08-06_daily_puzzle_five_slot_completion_constraint.sql` to widen `puzzles_completed` from 0–3 to 0–5.
- Included a guarded manual rollback that must not run while rows above three exist.
- Added `server/src/dailyPuzzleFiveSlotSchema.test.ts` for migration guardrails.
- Added `server/src/http/stores/dailyPuzzleStore.fiveSlot.test.ts` to prove the store serializes and reads back a five-completion attempt.

### Required external step

- Migration application and schema introspection against a disposable Supabase/Postgres target are `BLOCKED — NO DISPOSABLE DATABASE TARGET CONFIGURED`.
- Production migration application is `BLOCKED — HUMAN APPROVAL AND PRODUCTION SQL ACCESS REQUIRED`.
- Migration status: not applied by this program; production state `UNKNOWN`.

### Verification

Focused verification:

```text
npm run test:focused --prefix server -- \
  src/dailyPuzzleFiveSlotSchema.test.ts \
  src/http/stores/dailyPuzzleStore.fiveSlot.test.ts \
  src/dailyPuzzleLadderStabilization.test.ts \
  src/dailyPuzzleGeneration.test.ts

Test Files  4 passed (4)
Tests       26 passed (26)
```

Status after focused verification: `LOCALLY-VERIFIED` for static migration guardrails and store request/response behavior only.

Not yet verified:

- Real Postgres constraint application.
- Full submission-to-database persistence against a disposable Supabase/Postgres instance.
- Full repository validation.
- Production schema/application.

## 2026-08-06 — Batch 2 migration ledger and schema verification tooling

### Changes

Status: `CODE-COMPLETE`

- Added `supabase/migration-ledger.json` as the machine-readable base/migration order.
- Added `scripts/validate-migration-ledger.mjs` to reject missing files, duplicate entries, omitted migrations, and known dependency-order violations.
- Added `scripts/apply-migration-ledger.mjs` to apply the ledger with `psql` and `ON_ERROR_STOP=1` against an explicitly supplied database.
- Added `supabase/verify-application-schema.sql` to verify critical tables, constraints, and command RPCs after application.
- Added `supabase/MIGRATION_LEDGER.md` documenting base-vs-migration policy, destructive base SQL, same-day ordering, and rollback requirements.
- Added root npm scripts `check:migrations` and `db:apply-ledger`.

### Environment blocker

No local `supabase`, `docker`, or `psql` executable was available. A fresh disposable database apply and schema diff are therefore `BLOCKED — LOCAL POSTGRES TOOLING OR DISPOSABLE DATABASE REQUIRED`.

Production application remains `BLOCKED — HUMAN APPROVAL AND PRODUCTION SQL ACCESS REQUIRED`.

### Verification

Static ledger verification:

```text
npm run check:migrations
Migration ledger valid: 12 base files, 24 migrations.
```

`git diff --check` also passed.

Status after static verification: `LOCALLY-VERIFIED` for ledger completeness/order only. Fresh database application remains blocked and is not claimed.

## 2026-08-06 — Batch 3 multiplayer durable command authority

### Corrected authority design

The draft multiplayer authority migration exposed revision assertion and snapshot commit as separate RPCs. PostgreSQL row locks do not survive between RPC transactions, and the snapshot RPC did not write an idempotency receipt. Wiring those functions directly would have created a false atomicity claim.

Status: `CODE-COMPLETE`, feature gated off by default.

Changes:

- Extended `2026-08-02_multiplayer_live_room_authority.sql` with `commit_room_live_session_command(...)`, which locks the room row, verifies request identity and expected revision, updates the full private snapshot, increments `authority_revision`, and writes the replayable command receipt in one transaction.
- Added an idempotent request-ID constraint upgrade for databases that received an earlier migration draft.
- Added `Room.authorityRevision`, persisted/hydrated from `room_live_sessions.authority_revision`.
- Added `server/src/multiplayer/liveRoomCommandStore.ts` for durable preflight replay/conflict detection and atomic command commit.
- Wired `game:action` to the transactional store behind `MULTIPLAYER_TRANSACTIONAL_COMMANDS=true`.
- Preserved the existing in-memory receipt cache as the fast path; durable receipts are now the restart-safe source when the feature is enabled.
- A rejected/raced CAS commit is not broadcast. The room is marked degraded and further gameplay is blocked rather than publishing uncertain state.
- Added the feature flag to `server/.env.example`; default remains false until the migration is confirmed applied.
- Added the atomic RPC to `supabase/verify-application-schema.sql`.

### Verification

```text
npm run test:focused --prefix server -- \
  src/multiplayer/liveRoomCommandStore.test.ts \
  src/multiplayer/multiplayerAuthoritySchema.test.ts \
  src/multiplayer/roomLivePersistence.test.ts \
  src/multiplayer/roomLivePersistence.flush.test.ts \
  src/multiplayer/roomLiveHydration.test.ts \
  src/multiplayer/gameActionIdempotency.test.ts \
  src/multiplayer/registerGameplayActionHandlers.test.ts

Test Files  7 passed (7)
Tests       46 passed (46)
```

`npm run build --prefix server`, `npm run check:migrations`, and `git diff --check` passed.

The focused suite proves:

- durable receipt replay can bypass local mutation after an in-memory/process reset;
- the commit request binds room, actor, request ID, digest, expected authority revision, full snapshot, and response;
- stale CAS rejection degrades the room instead of broadcasting it;
- the SQL guard contains snapshot update and receipt insertion in the same database function.

### Status and blockers

- Code and mocked-RPC behavior: `LOCALLY-VERIFIED`.
- Real PostgreSQL transaction/CAS behavior: `BLOCKED — DISPOSABLE DATABASE REQUIRED`.
- Migration: not applied by this program; production state `UNKNOWN`.
- Runtime feature flag: must remain false until migration application is confirmed.
- Multi-instance Socket.IO, distributed room locking, and distributed matchmaking remain unsupported and are explicitly deferred to Batch 8. This batch establishes restart-safe single-instance command receipts, not horizontal scaling.

### Rollback

Set `MULTIPLAYER_TRANSACTIONAL_COMMANDS=false` to return gameplay commands to the pre-existing persistence path. This is an application rollback only; it does not remove `authority_revision`, receipts, or RPCs. Schema removal would require a separately reviewed down migration after confirming no operational dependency on stored receipts.

## 2026-08-06 — Batch 4 observable non-blocking failures

### Changes

Status: `LOCALLY-VERIFIED` for code/build and focused telemetry tests.

- Added `server/src/operationalTelemetry.ts`, which records warning-level structured diagnostics to both server logs and Sentry without changing the primary gameplay/API outcome.
- Replaced every bare/no-op catch found by the exhaustive `server/src` and `client/src` sweep. Instrumented areas include Daily Puzzle activity, Daily Fritz activity, Ghost activity, multiplayer activity/post-match stats, reconnect room lookup, presence, rival caching, matchmaking stats, tournament bracket refresh, auth fallback, bot/ghost profile refresh, debug ingest, audio resume, and cosmetic completion effects.
- The two test-only rejected-promise consumers now name their intentionally consumed error.
- Added runtime logger tests and a source guard covering the four originally audited gameplay sites.

### Verification

```text
Server focused:
Test Files  4 passed (4)
Tests       16 passed (16)

Client focused:
Test Files  2 passed (2)
Tests       3 passed (3)

npm run build --prefix server  # passed
npm run build --prefix client  # passed
git diff --check               # passed
```

The client build retained pre-existing warnings for a circular bot chunk, an invalid CSS `room` property, mixed tournament dynamic/static imports, and large chunks. No new build error was introduced.

The final no-op-catch sweep returned no matches. Production telemetry/dashboard delivery remains dependent on valid Sentry configuration and is not `PRODUCTION-VERIFIED`.

## 2026-08-06 — Batch 5 durable multiplayer invites

### Changes

Status: `LOCALLY-VERIFIED` for server/client code, static schema guards, and focused tests. The durable path is gated off by default.

- Added `supabase/migrations/2026-08-06_multiplayer_durable_invites.sql` with recipient-bound pending/accepted/declined/expired state, five-minute expiry, a partial uniqueness rule for pending room/recipient invites, idempotent creation, and recipient-authorized resolution RPCs.
- Added `server/src/social/multiplayerInviteStore.ts` for create/list/deliver/resolve persistence.
- Updated friend-invite socket handling to persist before emitting, retain pending invites for offline recipients, redeliver after authenticated presence identification, mark acceptance/decline durably, and report persistence failures without breaking the socket process.
- Added `MULTIPLAYER_DURABLE_INVITES=false`. The original online-only ephemeral path remains active until the migration is confirmed applied; the schema can therefore deploy before the code path and rollback is an application flag toggle.
- Updated the client challenge policy so offline friends are eligible when the durable path is enabled and local invite expiry matches the server's five-minute contract.
- Added the table and RPCs to the migration ledger/application-schema verifier.

### Verification

```text
Server focused:
Test Files  5 passed (5)
Tests       23 passed (23)

Client focused:
Test Files  1 passed (1)
Tests       2 passed (2)

npm run build --prefix server  # passed
npm run build --prefix client  # passed with previously recorded warnings
npm run check:migrations       # 12 base files, 25 migrations
git diff --check               # passed
```

The tests prove mocked-store behavior for offline persistence, reconnect delivery, duplicate RPC reuse, expiry resolution, the default-off legacy path, and non-throwing persistence failure handling. They do not prove the SQL functions against PostgreSQL.

### Status and blockers

- Code/store contracts: `LOCALLY-VERIFIED`.
- Migration application: `BLOCKED — DISPOSABLE DATABASE REQUIRED`.
- Production migration/flag enablement: `BLOCKED — HUMAN APPROVAL AND PRODUCTION ACCESS REQUIRED`; production state `UNKNOWN`.
- Offline delivery is not claimed in production while `MULTIPLAYER_DURABLE_INVITES=false`.

### Rollback

Set `MULTIPLAYER_DURABLE_INVITES=false` to restore online-only ephemeral invite delivery. This does not remove stored invite rows or schema. A schema down migration must only run after confirming no deployment still reads the durable invite table/RPCs.

## 2026-08-08 — Batch 1 and Batch 5 status reconciliation

### Batch 1: Daily Puzzle `puzzles_completed`

- The exact final repair is `supabase/migrations/2026-08-06_daily_puzzle_five_slot_completion_constraint.sql:7-12`; lines 10–12 add `daily_puzzle_attempts_puzzles_completed_check` with `check (puzzles_completed between 0 and 5)`.
- That migration already existed at the start of this session and was already listed in `supabase/migration-ledger.json`. It was added in the earlier 2026-08-06 Batch 1 session recorded above; it was not added or edited during this reconciliation.
- `server/src/dailyPuzzleFiveSlotSchema.test.ts` verifies that the migration text contains the final `0..5` definition.
- `scripts/verify-schema-contract-static.mjs` does not check ordering alone: it reads every ledger-ordered definition of `daily_puzzle_attempts_puzzles_completed_check` and verifies that the final definition is `puzzles_completed between 0 and 5`.
- Therefore the local fix is genuinely `LOCALLY-VERIFIED` for migration content, final ledger precedence, and mocked store serialization/readback. It remains `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database target)` for actual PostgreSQL application and constraint introspection.

### Batch 5: durable multiplayer invites

- Batch 5 was implemented and focused-tested in the prior 2026-08-06 session, as recorded in the existing Batch 5 entry above. The principal artifacts are `supabase/migrations/2026-08-06_multiplayer_durable_invites.sql`, `server/src/social/multiplayerInviteStore.ts`, the friend-invite/presence socket integrations, and their focused tests.
- The apparent unchecked state came from a transient work plan that treated Batch 5 as a remaining external activation step rather than distinguishing it from the completed local implementation. It was not evidence that the checklist entry was aspirational.
- Local implementation remains `LOCALLY-VERIFIED`. Actual SQL/RPC behavior and offline delivery through PostgreSQL remain `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database target)`. Production activation remains `UNKNOWN`, and the durable flag remains off by default.

## 2026-08-06 — Batch 6 full-lifecycle test coverage checkpoint

### Existing harness confirmed

- `client/e2e/auth.setup.ts` provisions two namespaced Supabase users and writes separate `host.json` / `guest.json` browser states.
- `client/e2e/helpers/multiplayerMatch.ts` already provides reusable two-context private-room and reconnect helpers.
- Daily Fritz currently proves start plus exact refresh/resume in `client/e2e/daily-fritz-v2.spec.ts`, but not a deterministic full best-of-three browser completion.
- Daily Puzzle remains explicitly skipped in `client/e2e/match.spec.ts`; Challenge Mode has no full two-browser lifecycle spec.

### Blocker

The required authenticated environment variables are all absent in this shell:

```text
SUPABASE_URL=unset
SUPABASE_SERVICE_KEY=unset
VITE_SUPABASE_ANON_KEY=unset
PLAYWRIGHT_BASE_URL=unset
```

Status: `BLOCKED — AUTHENTICATED SUPABASE E2E TARGET REQUIRED` for running or truthfully certifying the two-user/five-slot/best-of-three browser tests. No skipped test was relabeled as passing, and no production credential was simulated.

The gap list remains open. This checkpoint does not claim Batch 6 complete; work continues on unblocked batches as required by the program.

## 2026-08-08 — Batch 2 human-readable migration ledger completion

Status: `LOCALLY-VERIFIED` for documentation completeness, machine-readable/document ordering agreement, and static schema precedence only.

### Changes

- Expanded `supabase/MIGRATION_LEDGER.md` to enumerate all 12 base SQL files and all 27 timestamped migrations in exact application order with a one-line purpose for every entry.
- Documented overlapping definitions and final authority for ghost tables, Daily Puzzle, Daily Fritz, Fritz Challenge, multiplayer live rooms, and tournament replacement functions.
- Documented separate fresh-database and historically-migrated winners, including the destructive fresh-install-only status of `supabase/daily_puzzle.sql`.
- Extended `scripts/validate-migration-ledger.mjs` to parse the ordered Markdown tables and reject a missing, extra, or out-of-order human-readable SQL row.

### Verification

```text
npm run check:migrations
Migration ledger valid: 12 base files, 27 migrations.
Static schema contract verified: 22 relations, 3 views, 9 functions, 80 critical columns.
```

### Deferred proof

- Full ledger application and schema introspection remain `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database target)`.
- Production migration state remains `UNKNOWN`.

## 2026-08-07 — Batch 7 canonical analytics and alert contract

### Changes

Status: `LOCALLY-VERIFIED` for taxonomy/store code, static schema contracts, focused tests, and builds. Database-backed metrics remain unapplied.

- Added a canonical Daily Puzzle lifecycle/failure taxonomy and an idempotent durable event store.
- Added `daily_puzzle_events`, `daily_puzzle_event_funnel`, and `daily_puzzle_failure_metrics` in `2026-08-06_daily_puzzle_canonical_telemetry.sql`.
- Instrumented authoritative Daily Puzzle impression, attempt start/resume, slot submission, and completion. Added an authenticated client telemetry route restricted to client-owned event types; the client emits start-requested, first-move, and share events without blocking gameplay.
- Added `multiplayer_operational_events` and `multiplayer_operational_metrics` in `2026-08-07_multiplayer_operational_events.sql`, including hourly p50/p95/p99 latency aggregation.
- Instrumented multiplayer gameplay action outcomes and durable-room hydration outcomes. Room codes are SHA-256 hashed and truncated before event persistence.
- Added `docs/operations/mode-alerts-runbook.md` with ten concrete alert conditions, thresholds, response steps, privacy rules, and operator configuration requirements.
- Extended the migration ledger/application schema verifier to 27 migrations.

## 2026-08-08 — Batch 7 local-only canonical telemetry completion

Status: `LOCALLY-VERIFIED` for taxonomy/classification code, mocked durable emission, client/server builds, static migration contracts, alert runbook, and pure/query-backed multiplayer aggregation code.

### Daily Puzzle

- Bumped the canonical taxonomy to version 2 and added `verification_failed`, `command_conflict`, `retry_requested`, `review_opened`, and `leaderboard_opened`.
- Added the missing `challenge` and `command` failure phases and `client_update_required` recovery class.
- Added deterministic failure normalization and event-type selection for verification, stale/order conflicts, version incompatibility, and request failures.
- Instrumented authoritative submit rejection paths for completed attempts, slot-order conflicts, content-version mismatch, puzzle mismatch, and verifier rejection. These writes remain best-effort and cannot block gameplay.
- Instrumented scored-flow review/practice and leaderboard opening on the client.
- Added `supabase/migrations/2026-08-08_daily_puzzle_telemetry_taxonomy_v2.sql` as an additive migration rather than rewriting the prior telemetry migration. Ledger count is now 28.

### Multiplayer fleet metrics

- Added `server/src/multiplayer/multiplayerOperationalMetrics.ts` with executable definitions for reconnect success, stale-command rate, action-rejection rate, hydration/persistence failure rates, and continuous p50/p95/p99 persistence latency.
- Added a bounded PostgREST loader with a `truncated` signal so saturated samples cannot be mistaken for complete windows.
- Extended `docs/operations/mode-alerts-runbook.md` with exact destinations, setup steps, formulas, ownership/verification fields, and the rule that Sentry is not a substitute for database-rate denominators.

### Verification

```text
Server focused telemetry/metrics:
Test Files  6 passed (6)
Tests       16 passed (16)

npm run build --prefix server  # passed
npm run build --prefix client  # passed; pre-existing circular/dynamic-import/chunk warnings remain
npm run check:migrations
Migration ledger valid: 12 base files, 28 migrations.
Static schema contract verified: 22 relations, 3 views, 9 functions, 80 critical columns.

git diff --check  # passed
```

The event-store tests mock `supabaseFetch` and assert exact durable rows, idempotency identity, taxonomy version, failure phase, and recovery class. The multiplayer loader test mocks the durable event query and validates rate/percentile output.

### Deferred proof

- Applying migration 28 and querying real event rows is `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database target)`.
- Fleet-wide sample output, alert delivery, and production notification ownership are `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no production telemetry/alert target)`.
- No production observability claim is made.

## 2026-08-07 — Batch 7 original verification record (continued)

The following evidence and rollback record belong to the original 2026-08-07 Batch 7 entry above; the 2026-08-08 section supersedes its migration count but not its historical test evidence.

### Verification

```text
Daily Puzzle telemetry focused:
Server Test Files  4 passed (4), Tests 17 passed (17)
Client Test Files  2 passed (2), Tests 15 passed (15)

Combined telemetry + gameplay focused:
Server Test Files  6 passed (6), Tests 19 passed (19)

Hydration/metrics focused:
Server Test Files  4 passed (4), Tests 21 passed (21)

npm run build --prefix server  # passed
npm run build --prefix client  # passed with previously recorded warnings
npm run check:migrations       # 12 base files, 27 migrations
git diff --check               # passed
```

### Status and blockers

- Code/schema contracts: `LOCALLY-VERIFIED`.
- Event rows, queries, and percentile output against PostgreSQL: `BLOCKED — DISPOSABLE DATABASE REQUIRED`.
- Alert delivery: `BLOCKED — PRODUCTION METRICS/SENTRY ACCESS AND HUMAN ALERT OWNER REQUIRED`.
- Migration status: not applied by this program; production state `UNKNOWN`.

### Rollback

Telemetry call sites are non-blocking and can be reverted independently. Tables/views should be retained during application rollback for incident evidence. Schema removal requires a reviewed migration after all writers are disabled.

## 2026-08-07 — Batch 8 soak/chaos checkpoint

### Daily Fritz soak correction

Repository inspection showed `server/scripts/dailyFritzAuthoritySoak.ts` already drives games 1–3 until the best-of-three is decided, verifies duplicate start/hand/game/completion commands, simulates a lost response, checks refresh/resume, checks a cross-device transcript conflict, audits durable rows/outbox projection, and confirms leaderboard eligibility. The workflow/job label still incorrectly said “Game 1.”

Changes:

- Renamed the workflow job to full best-of-three authority/recovery soak.
- Raised manual defaults from 5 users / concurrency 2 to 20 users / concurrency 5.
- Added completed-user count, error rate, and p50/p95/p99 elapsed-time output.
- Added a source guard preventing regression back to Game-1-only or summary-free coverage.

Verification:

```text
npm run typecheck:scripts --prefix server  # passed
Daily Fritz soak guardrail: 1 file passed, 1 test passed
git diff --check                           # passed
```

Status: `LOCALLY-VERIFIED` for harness type safety and contract only.

### Remaining blockers

- Actual Daily Fritz measured throughput/latency: `BLOCKED — AUTHENTICATED SOAK TARGET AND SUPABASE CREDENTIALS REQUIRED`.
- Challenge Mode and Daily Puzzle soak harness execution/results: not complete.
- Actual server-kill/database-outage chaos execution: `BLOCKED — DISPOSABLE SERVER/DATABASE TARGET REQUIRED`.
- A concurrency ceiling cannot be stated without those runs. No numerical production-capacity claim is made.

Batch 8 remains incomplete; this checkpoint closes the stale Game-1-only characterization but not the required production-like evidence.

## 2026-08-07 — Batch 9 dependency and identity-boundary hardening

### Changes

Status: `LOCALLY-VERIFIED` for dependency resolution, guest-identity normalization, authorization guardrails, state masking, spectator projection, and the server build.

- Updated vulnerable transitive dependencies through the workspace lockfile using `npm audit fix --workspaces` without introducing major direct-dependency upgrades.
- Added `server/src/platform/auth/guestIdentity.ts`. Unauthenticated room and matchmaking identities must now match the bounded `guest_` namespace generated by current clients.
- Applied the same guest contract to socket room identity resolution and unranked matchmaking. UUID-shaped or arbitrary client claims no longer become a server seat identity without verified authentication.
- Added a source guard proving `getUserIdFromAuthHeaderSync` remains limited to REST rate-limit bucketing. Account authorization continues to use the asynchronous Supabase `/auth/v1/user` verification path.
- Documented the remaining non-cryptographic guest-continuity risk and blast radius in `docs/operations/guest-identity-trust-boundary.md`.

### Verification

```text
Security/masking focused server tests:
Test Files  6 passed (6)
Tests       18 passed (18)

Match protocol spectator tests:
Test Files  1 passed (1)
Tests       3 passed (3)

npm run build --prefix server  # passed
git diff --check               # passed

npm audit --workspaces --audit-level=high --json:
info 0, low 0, moderate 0, high 0, critical 0, total 0
```

### Trust decision and remaining risk

Guest identifiers provide unranked continuity only and do not authorize account-owned resources. They remain client-held, non-cryptographic values and may be claimed by anyone who learns them. This is accepted only for guest/unranked play; authenticated ranking, profile, friend, and tournament operations must continue to require Supabase-verified account identity.

Production dependency installation and deployed guest-boundary behavior are not checked here. Status is not `PRODUCTION-VERIFIED`.

### Rollback

Revert the guest normalization call sites and lockfile update independently. Reverting guest normalization restores legacy arbitrary non-UUID identity continuity and therefore reopens the documented spoofing surface; it requires explicit security review.

## 2026-08-07 — Batch 10 local certification checkpoint

### Full local validation evidence

Status: `LOCALLY-VERIFIED` for unit/integration/behavior tests, static architecture gates, builds, bundle budgets, migration-ledger consistency, and dependency audit.

```text
Shared game core:       11 files passed, 190 tests passed
Match protocol:          1 file passed,    3 tests passed
Server shard 1/4:       31 files passed, 174 tests passed
Server shard 2/4:       31 files passed, 178 tests passed
Server shard 3/4:       30 files passed, 143 tests passed
Server shard 4/4:       30 files passed, 135 tests passed
Server total:          122 files passed, 630 tests passed
Client Vitest:         151 files passed, 989 tests passed
Client behavior suite:  39 files passed

Client typecheck: passed
Client TypeScript lint: passed with 0 errors and 445 warnings
Client CSS lint: passed
Dependency boundaries: passed
Multiplayer architecture boundaries: passed, 0 violations
Multiplayer cycle gate: passed, 0 violations
Socket registry: passed, 0 grandfathered direct socket.on sites
Architecture invariants: 11/11 passed
Server build: passed
Server script typecheck: passed
Client production build: passed
Bundle size budgets: 4/4 passed
Bot-match lazy boundaries: passed
Migration ledger: valid, 12 base files and 27 migrations
Dependency audit: 0 vulnerabilities at every severity
git diff --check: passed
```

## 2026-08-08 — Final local-only validation after status, ledger, telemetry, and test completion

Status: `LOCALLY-VERIFIED` for all work executable without a database target, authenticated browser target, production telemetry target, or worktree reconciliation.

```text
Shared game core:       11 files passed, 190 tests passed
Match protocol:          1 file passed,    3 tests passed
Server shard 1/4:       32 files passed, 178 tests passed
Server shard 2/4:       32 files passed, 180 tests passed
Server shard 3/4:       32 files passed, 155 tests passed
Server shard 4/4:       31 files passed, 139 tests passed
Server total:          127 files passed, 652 tests passed
Client Vitest:         151 files passed, 993 tests passed
Client behavior suite:  39 files passed

Server build: passed
Server script typecheck: passed
Client production build: passed
Migration ledger: valid, 12 base files and 28 migrations
Static schema contract: 22 relations, 3 views, 9 functions, 80 critical columns
git diff --check: passed
```

The server count increased from the requested 644-test baseline to 652 and the client count from 989 to 993; no baseline test was removed or weakened during this continuation.

Client build warnings remain for the pre-existing bot chunk cycle, mixed tournament static/dynamic imports, and generic Vite large-chunk warnings. They are non-failing and outside this local reliability scope.

### Exhausted local boundary

The following are intentionally not marked locally or production verified:

- Batch 1 five-slot constraint application/introspection: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database target)`.
- Batch 2 fresh/historical ledger application and catalog diff: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database target)`.
- Batch 3 real PostgreSQL CAS/idempotency concurrency and restart behavior: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database/server target)`.
- Batch 5 durable-invite SQL/RPC behavior and flag activation: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database target)`.
- Batch 6 authenticated two-browser execution and click-by-click board certification: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no authenticated Playwright target/credentials)`.
- Batch 7 real event rows, fleet sample output, alert ownership, and notification delivery: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database/production telemetry target)`.
- Batch 8 process-kill, database-outage, soak execution, latency, and capacity measurements: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no disposable server/database target)`.
- Batch 0 worktree, stashes, and branch history remain untouched by explicit user direction.

No commit, push, reset, clean, stash operation, database mutation, Playwright execution, or production configuration change was performed.

The test counts exceed the recorded starting baseline (server 596 to 630; client 986 to 989) without replacing weaker tests for stronger ones.

### Build warning correction

Tailwind was interpreting structured diagnostic prefixes such as `[room:recovery]` as arbitrary-property utility classes and emitting invalid CSS (`room: recovery`). `client/tailwind.config.js` now blocklists all current structured diagnostic tokens. A fresh production build confirms the invalid-CSS warning is gone without changing logging or UI behavior.

Remaining non-failing build warnings are a circular manually assigned bot chunk, a tournament module imported both dynamically and statically, and chunks over Vite's generic 500 kB warning threshold. Repository-specific bundle budgets still pass. These warnings are not represented as resolved.

### Certification blockers

This is not final 9.5 certification and is not `PRODUCTION-VERIFIED`:

- No `docker`, `psql`, or `supabase` executable is available in this environment, and no disposable database URL was supplied. Fresh-database migration apply, real PostgreSQL CAS/idempotency concurrency, and migration schema introspection remain blocked.
- Authenticated Supabase Playwright credentials and a target URL remain absent. The full two-user Challenge lifecycle, five-slot Daily Puzzle browser lifecycle, and full Daily Fritz best-of-three browser lifecycle remain blocked.
- No disposable server/database target is available for process-kill, database-outage, or measured soak/load certification.
- Production Supabase, Render, Vercel, Sentry, and alerting access was not supplied. All production migration, feature-flag, dashboard, alert-delivery, and deployment-revision states remain `UNKNOWN`.
- Batch 0 still requires human disposition of the dirty/untracked worktree and five stashes. No file was discarded, no stash was changed, and no branch-history reconciliation was executed.

### Rollback

All work remains uncommitted and separable by file/diff. No production migration or feature flag was changed. Reverting local changes must be done selectively because the worktree contains substantial unrelated user work; broad reset/clean/stash operations are prohibited.

## 2026-08-08 — User-directed local-only continuation

The user explicitly deferred disposable-Supabase execution, authenticated Playwright execution, and Batch-0 worktree/stash reconciliation. The worktree and all stashes remain untouched: no reconciliation, move, discard, commit, push, reset, clean, or stash operation was performed.

### Batch 2 static schema simulation

Status: `LOCALLY-VERIFIED` for the static ordered-SQL contract. This is not a substitute for PostgreSQL execution.

Changes:

- Added `supabase/application-schema-contract.json`, declaring 22 required relations, three views, nine functions, and 80 application-critical columns.
- Added `scripts/verify-schema-contract-static.mjs`, which evaluates the ordered migration ledger as source, verifies required relation/function declarations, checks critical columns against the owning declarations, confirms the final five-slot constraint is `0..5`, and cross-checks `supabase/verify-application-schema.sql`.
- Extended `check:migrations` to run both the ledger validator and static schema contract.
- Added the three operational views to `supabase/verify-application-schema.sql`.

Evidence:

```text
Migration ledger valid: 12 base files, 27 migrations.
Static schema contract verified: 22 relations, 3 views, 9 functions, 80 critical columns.
```

Database execution status: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no DB/server target)` for fresh-database apply, catalog introspection, and historical-vs-fresh schema comparison. Production application remains `UNKNOWN`.

### Batch 3 CAS/idempotency adversarial guardrails

Status: `LOCALLY-VERIFIED` for mocked transport/store behavior and SQL-source guardrails.

Added coverage proving:

- a reused request ID with a different semantic digest is rejected as `request_id_conflict`;
- a durable receipt appearing between preflight and commit produces an uncertain `room_command_commit_raced` result and degrades room persistence rather than falsely acknowledging success;
- an RPC transport failure marks the room degraded while retaining its last authoritative revision;
- SQL binds receipts to semantic digests, contains the request-ID conflict branch, records stale-revision outcomes, and uses the composite receipt key.

Evidence:

```text
Test Files  2 passed (2)
Tests       9 passed (9)
npm run build --prefix server  # passed
git diff --check               # passed
```

Real PostgreSQL concurrency/process-restart status: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no DB/server target)`.

### Batch 6 reusable authority lifecycle drivers and browser contracts

Status: `LOCALLY-VERIFIED` for deterministic driver unit tests and Playwright discovery/compilation. Authenticated execution is intentionally deferred.

Changes:

- Added `server/src/testing/fritzChallengeLifecycleDriver.ts`. It drives the real Challenge command contract using `buildHonestDailyFritzHandTranscript`, advances verified hands, records games, verifies record-game replay idempotency, and resolves subsequent games through the canonical start/resume endpoint.
- Added `server/src/testing/dailyPuzzleLifecycleDriver.ts`. It derives submitted moves from shared game-core legal-move generation, submits all five ordered slots, verifies duplicate slot replay, and finalizes the attempt.
- Added focused tests for both drivers: four tests passed.
- Added `client/e2e/authority-lifecycle.spec.ts`, gated by `RUN_AUTHORITY_E2E=1`. It defines a two-authenticated-context Challenge invite/accept/both-complete/result-review contract and a five-slot Daily Puzzle persistence/result-render contract.
- Added `server/src/testing/dailyFritzLifecycleDriver.ts` and a third gated browser contract that drives the published Daily Fritz best-of-three through verified hand/game/completion commands, checks duplicate record/completion replay, reloads `/today`, and opens the authenticated completion surface.
- The browser specs deliberately use deterministic protocol drivers for gameplay. They are hybrid browser/API lifecycle tests, not click-by-click board-play certification; that distinction remains open in the final gap list.

Evidence:

```text
Driver Test Files  3 passed (3)
Driver Tests       5 passed (5)
npm run build --prefix server             # passed
npm run typecheck:scripts --prefix server # passed
Playwright --list discovered all three lifecycle cases plus setup/teardown
git diff --check                          # passed
```

Authenticated execution status: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no DB/server target and no authenticated Playwright credentials)`.

### Batch 8 Challenge and Daily Puzzle authority soak programs

Status: `LOCALLY-VERIFIED` for TypeScript compilation and shared lifecycle-driver behavior. No throughput result is claimed.

Changes:

- Added `server/scripts/authoritySoakSupport.ts` for bounded HTTP calls, ephemeral user lifecycle, authenticated API transport, environment loading, and percentile calculation.
- Added `server/scripts/fritzChallengeAuthoritySoak.ts`: creates an accepted friend pair, publishes/accepts a challenge, starts both attempts, drives both verified best-of-three sets, verifies duplicate game-record replay, reloads final challenge state, and emits p50/p95/p99 lifecycle latency.
- Added `server/scripts/dailyPuzzleAuthoritySoak.ts`: validates a published five-slot day, races duplicate starts, drives and replays all five slot submissions, verifies duplicate completion, and emits p50/p95/p99 lifecycle latency.
- Both new soak programs execute configurable concurrent waves (`FRITZ_CHALLENGE_SOAK_CONCURRENCY` / `DAILY_PUZZLE_SOAK_CONCURRENCY`) rather than reporting a workload that is actually sequential.
- Added `soak:fritz-challenge-authority` and `soak:daily-puzzle-authority` package scripts.
- Added `server/scripts/multiplayerProcessRestartChaos.ts` and `chaos:multiplayer-restart`. The harness launches the real built server, creates/starts a two-seat room, records its sequence, sends SIGTERM, restarts the process, and requires both seats plus the exact sequence to hydrate from durable storage.
- Added `server/src/authorityLifecycleHarnessGuardrails.test.ts` to prevent the Challenge, Daily Puzzle, and process-restart harnesses from silently regressing to shallow smoke tests.

Harness execution status: `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no DB/server target)`. Measured concurrency, error rate, and latency remain `UNKNOWN`; no capacity claim is made.

### 2026-08-08 Batch 6/8 local-only adversarial and fixture sweep

Status: `LOCALLY-VERIFIED` for the additional local invariants below.

- Added a Challenge route-lifecycle adversarial case that takes an otherwise honest shared-core transcript, substitutes the challenge identity, and proves the server returns `challenge_mismatch` without advancing the attempt revision or calling the transactional commit store.
- Hardened the reusable five-slot Daily Puzzle lifecycle driver so a five-element fixture cannot conceal a duplicate slot and omitted slot; it now requires the exact ordered identity set `1,2,3,4,5` before sending commands.
- Confirmed existing local adversarial coverage already rejects Daily Puzzle fake scores, foreign/duplicate tiles, and illegal placement; Daily Fritz forged ownership/draw/pass/Fritz-policy/deal/identity evidence; Challenge outdated protocol versions; and shared-core stale/post-terminal commands. No duplicate shallow test was added for those already-proven cases.
- Confirmed existing local determinism coverage already proves byte-stable three-game Daily Fritz publications, Challenge game/hand coordinate replay, and shared-core same-seed terminal replay.

Evidence:

```text
Test Files  6 passed (6)
Tests       42 passed (42)
```

The six focused files were `fritzChallenges.lifecycle.test.ts`, `dailyPuzzleLifecycleDriver.test.ts`, `dailyFritzVerifier.test.ts`, `dailyPuzzleSubmissionValidation.test.ts`, `fritzChallenge.test.ts`, and `dailyFritzPublishedChallenge.test.ts`.

No further truthful local-only closure was found for process-kill, database-outage, real concurrent PostgreSQL writers, authenticated two-browser execution, historical cross-build artifacts, or measured soak capacity. Those remain `CODE-COMPLETE, NOT LOCALLY-VERIFIED` with their previously recorded DB/server/credential blockers; placeholder tests were intentionally not added.

### Continuation validation snapshot

```text
Focused authority/CAS/harness suite: 5 files passed, 16 tests passed
Daily Fritz lifecycle driver:       1 file passed,   1 test passed
Full server shard 1/4:              32 files passed, 177 tests passed
Full server shard 2/4:              32 files passed, 179 tests passed
Full server shard 3/4:              31 files passed, 149 tests passed
Full server shard 4/4:              31 files passed, 139 tests passed
Full server total:                 126 files passed, 644 tests passed
Server build: passed
Server script typecheck: passed
Client typecheck: passed
Migration/static schema checks: passed
Playwright discovery: 3 authority lifecycle tests found (execution gated)
git diff --check: passed
```

The server suite increased from the previous 630-test checkpoint to 644 without removing prior tests.

### Rollback

All additions in this continuation are isolated new contract/test/script files plus narrow manifest/verifier edits. No database was changed. Roll back by selectively reverting these files; do not use broad git reset/clean/stash operations in this dirty worktree.

## 2026-08-08 — Authoritative final local-only validation record

This is the final chronological record for the current continuation and supersedes earlier test-count snapshots. It does not upgrade any database, browser, production, or worktree-reconciliation status.

```text
Shared game core:       11 files passed, 190 tests passed
Match protocol:          1 file passed,    3 tests passed
Server shard 1/4:       32 files passed, 178 tests passed
Server shard 2/4:       32 files passed, 180 tests passed
Server shard 3/4:       32 files passed, 155 tests passed
Server shard 4/4:       31 files passed, 139 tests passed
Server total:          127 files passed, 652 tests passed
Client Vitest:         151 files passed, 993 tests passed
Client behavior suite:  39 files passed
Server build: passed
Server script typecheck: passed
Client production build: passed
Migration ledger: valid, 12 base files and 28 migrations
Static schema contract: 22 relations, 3 views, 9 functions, 80 critical columns
git diff --check: passed
```

The final server count exceeds the requested 644-test baseline, and the final client count exceeds the prior 989-test snapshot. The remaining environment-bound items and exact blockers are listed in the earlier “Exhausted local boundary” section; they remain unchanged. No commit, push, migration application, Playwright execution, production configuration change, or destructive git operation occurred.
