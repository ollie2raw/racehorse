# Daily Fritz Acquisition-Grade Engineering Program

**Companion to:** `docs/daily-fritz-principal-architecture-audit.md`
**Program date:** 2026-07-31
**Program objective:** Convert Daily Fritz into an acquisition-grade, server-authoritative daily product through narrow, dependency-ordered, reversible implementation batches.

## 1. Program mandate

This program preserves the product and engineering assets that already carry real value:

- the shared `@racehorse/game-core` rules and command application;
- the server transcript verifier and deterministic Fritz policy checks;
- the Daily Fritz best-of-three identity, including early clinch and skunk rules;
- the verified-only leaderboard eligibility path;
- the one-attempt-per-user/day constraint;
- the versioned local recovery checkpoint and run-fingerprint protections;
- the current user-facing board and gameplay format.

This is not a product-format rewrite. It is a controlled authority, durability, reliability, test, analytics, and completion-quality program.

The desired end state is:

> Every published Daily Fritz challenge is immutable and reproducible; every new attempt uses the modern transcript protocol; every accepted mutation is transactional, revision-checked, idempotent, and recoverable across tabs, devices, server instances, and response loss; every verified completion is backed by durable server authority and a clear player-facing receipt; and the full daily funnel is measurable without contaminating game authority.

## 2. Acquisition-grade completion criteria

The program is complete only when all of the following are true:

1. A challenge ID resolves to one immutable package containing all three possible games, challenge/rules/seed/Fritz-policy/ranking versions, draw configuration, complete hand definitions or immutable content-addressed equivalents, and a stable content digest.
2. Historical challenge packages can be reconstructed byte-for-byte or fetched directly after application releases.
3. New attempts cannot enter the score-only legacy authority path.
4. The server derives hand, game, set, and final completion results from verified authority; client score and completion claims are never decisive.
5. Every attempt mutation uses a durable operation ID and expected revision.
6. One database transaction commits the attempt transition, authority records, operation receipt, and outbox event.
7. Repeating the same operation returns the original committed result; reusing the operation ID with a different payload is rejected.
8. Concurrent devices or server instances cannot overwrite accepted progress.
9. A stale client receives the current authoritative snapshot and a recoverable conflict classification.
10. Refresh, crash, response loss, server restart, Pacific midnight, and DST behavior are covered by automated lifecycle tests.
11. Only verified attempts qualify for competitive completion, streak, history, leaderboard, percentile, and share claims unless a surface explicitly labels an older result as unverified.
12. Canonical analytics can measure impression, start, first move, hand/game/set completion, continuation, abandonment, resume, verification failure, sharing, next-day return, and seven-day retention.
13. The final experience presents a premium verified completion receipt containing challenge identity, set narrative, game results, verification state, rank/percentile where available, share action, and next-day return cue.
14. Operational runbooks, schema documentation, release evidence, rollback instructions, and data lineage are understandable to an acquiring engineering team without oral history.

## 3. Non-negotiable invariants

These invariants apply to every batch:

### Product invariants

- Daily Fritz remains a best-of-three set.
- Existing set-clinch and skunk behavior remains unchanged unless a separately approved product rules change is proposed.
- Game three remains skipped when the set is already decided.
- The product continues to use the existing shared bot-match board and gameplay presentation.
- No broad UI redesign is part of this program.

### Authority invariants

- `@racehorse/game-core` remains the shared legality/scoring implementation.
- `server/src/dailyFritzVerifier.ts` remains the authority for modern transcript replay.
- The client remains provisional state and presentation, never final authority.
- The verified leaderboard never admits unverified attempts.
- Historical completed rows are never silently rewritten into “verified” status.

### Recovery invariants

- Existing valid schema-7 local recovery checkpoints remain readable until an explicit compatibility batch changes the schema.
- A client update may invalidate unsafe local state, but it must not destroy accepted server progress.
- The server always wins a local/server disagreement.
- A retry must never double-credit a hand, game, set, streak, leaderboard entry, social activity, or analytics event.

### Delivery invariants

- Every batch has one primary purpose.
- Schema changes use expand/contract migrations; destructive contraction is delayed until production evidence exists.
- New read/write paths are guarded independently, with safe defaults.
- Each batch can be reverted without reverting unrelated batches.
- No batch uses `git add .`, mass formatting, opportunistic refactoring, or broad file rewrites.
- No implementation batch includes unrelated visual, multiplayer, Circuit, Fritz Challenge, tournament, or navigation changes.

## 4. Safe execution around the current dirty worktree

The repository currently contains substantial unrelated uncommitted work. Before Batch 00 implementation begins, use this protocol:

1. Record the integration base commit with `git rev-parse HEAD` and save `git status --short` as review evidence.
2. Identify whether any uncommitted Daily Fritz files are intended prerequisites. Do not infer that all dirty Daily Fritz changes belong to this program.
3. Create a dedicated sibling Git worktree from the agreed integration base, or wait until intended prerequisite changes are committed. Never stash, reset, restore, or clean the user’s existing worktree for this program.
4. Give each implementation batch its own branch and commit range.
5. Stage only the explicit batch allowlist with `git add <file...>`.
6. Before every commit, inspect `git diff --cached --name-only` and `git diff --cached`.
7. At handoff, report all changed files, generated migrations, test commands/results, rollout flag state, and rollback command/procedure.
8. If an implementation batch must touch a file already modified in the user’s original worktree, stop before merging and resolve ownership intentionally.

The audit and this program document may remain untracked or be committed separately. They must not be mixed into an implementation commit unless the user explicitly requests it.

## 5. Delivery architecture

The work follows an expand/shadow/migrate/contract sequence:

```text
Characterize and freeze behavior
        |
        v
Publish immutable challenge contract
        |
        v
Require modern authority for new attempts
        |
        v
Add durable operation + revision schema
        |
        v
Shadow transactional commands against current behavior
        |
        v
Migrate start -> hand -> game -> completion/abandon
        |
        v
Add cross-device client reconciliation
        |
        v
Prove complete lifecycle through E2E/failure tests
        |
        v
Add canonical analytics/outbox consumers
        |
        v
Ship premium verified completion receipt
        |
        v
Load/operations/acquisition handoff
        |
        v
Contract legacy paths after evidence window
```

## 6. Batch dependency graph

| Batch | Name | Hard dependencies | May proceed in parallel with |
|---:|---|---|---|
| 00 | Program baseline and behavior freeze | None | None |
| 01 | Best-of-three and verifier characterization | 00 | None |
| 02 | Immutable challenge contract and schema | 01 | 03 design only |
| 03 | Immutable challenge publication and historical reads | 02 | 04 |
| 04 | Modern-protocol-only new attempts | 01 | 03 |
| 05 | Durable operation and revision schema | 02 | Analytics taxonomy design |
| 06 | Transactional start/resume command | 04, 05 | None |
| 07 | Transactional verified-hand command | 06 | None |
| 08 | Transactional game-record command | 07 | Completion UI design only |
| 09 | Transactional finalize/abandon and outbox | 08 | None |
| 10 | Cross-tab and cross-device reconciliation | 07, 09 | 11 fixture design |
| 11 | Full lifecycle E2E and failure-injection suite | 03, 04, 06-10 | 12 schema design |
| 12 | Canonical analytics pipeline | 09, 11 core fixtures | 13 UI implementation |
| 13 | Premium verified completion experience | 09, 10, analytics contract from 12 | 12 ingestion work |
| 14 | Capacity, observability, and operating evidence | 11, 12 | 13 |
| 15 | Legacy contraction and acquisition handoff | 03-14 | None |

No batch after 05 should be merged out of order. In particular, client cross-device behavior must not be built before server revision/CAS semantics are stable.

## 7. Standard batch contract

Every batch pull request must contain:

- **Intent:** one sentence describing the authority or product capability added.
- **Preserved invariants:** explicit statement that game core, verifier, best-of-three, leaderboard, and recovery contracts remain intact unless the batch specifically extends one.
- **File allowlist:** every expected file or directory.
- **Non-goals:** adjacent work intentionally excluded.
- **Data impact:** tables, columns, indexes, backfills, retention, and privacy implications.
- **Compatibility:** old client/new server and new client/old server behavior.
- **Feature flags:** default, enablement order, and owner.
- **Test evidence:** command, result, fixtures, and failure-injection evidence.
- **Observability:** logs, counters, event, and alert affected.
- **Rollout:** development, staging/shadow, percentage/eligibility gate, production.
- **Rollback:** application rollback and schema rollback/forward-fix strategy.
- **Acceptance:** objective pass/fail criteria.
- **Residual risk:** what the batch intentionally leaves for a later dependency.

## 8. Implementation batches

### Batch 00 — Program baseline and change isolation

**Intent:** Establish a reproducible integration baseline and protect unrelated work before authority changes begin.

**Scope**

- Record current commit, branch, dirty-file inventory, Node/npm versions, Supabase migration state, and current Daily Fritz feature/config flags.
- Create a dedicated program branch/worktree from the approved base.
- Define a batch-specific test manifest and evidence directory under `docs/evidence/daily-fritz/` or CI artifacts.
- Record current API response examples for `/today`, `/start`, `/next-hand`, `/record-game`, `/complete`, `/leaderboard/:date`, and `/history` using test fixtures—not production secrets.

**Expected files**

- Documentation and CI/test manifest only.
- No gameplay, server route, or schema changes.

**Non-goals**

- No bug fixes.
- No formatting changes.
- No migration.

**Tests**

- Existing client and server builds.
- Existing targeted Daily Fritz tests.
- Confirm no test fixture contains credentials or production user data.

**Rollout and rollback**

- Documentation-only; revert the batch commit if incorrect.

**Acceptance criteria**

- Integration base is explicit.
- Dirty-worktree ownership is documented.
- Existing test baseline and known failures are recorded.
- Subsequent PRs can prove they did not absorb unrelated files.

---

### Batch 01 — Best-of-three and verifier characterization lock

**Intent:** Freeze the existing product/rules behavior before changing persistence or commands.

**Scope**

- Add table-driven golden tests around `appendDailyFritzGameToSet()` for all legal set paths:
  - normal 2–0 player/Fritz;
  - normal 2–1 player/Fritz;
  - game-one player/Fritz skunk;
  - game-two skunk after both possible 1–1 splits;
  - game-three skunk metadata;
  - invalid fourth game;
  - duplicate/out-of-order game.
- Add challenge/verifier fixtures that replay known legal and illegal transcripts without altering verifier logic.
- Add a canonical vocabulary test or type-level fixture distinguishing challenge, attempt, set, game, hand, and action.
- Add leaderboard ordering fixtures for every skunk and tie-break class.

**Expected files**

- `server/src/dailyFritzSkunk.test.ts`
- `server/src/dailyFritzVerifier.test.ts`
- `server/src/http/routes/dailyFritzVerification.test.ts`
- `packages/game-core/src/__tests__/dailyFritzTranscript.test.ts`
- New fixture files in narrowly scoped test directories.

**Protected files**

- No behavior changes to `packages/game-core/src/engine.ts`, `dailyFritzVerifier.ts`, `dailyFritzSkunk.ts`, or leaderboard comparator.

**Tests**

- Server Daily Fritz suite.
- Game-core transcript and Fritz policy suite.
- Mutation testing or negative fixtures proving invalid paths actually fail.

**Rollback**

- Test-only revert.

**Acceptance criteria**

- Every current best-of-three terminal path has a named fixture.
- Golden verifier fixtures include all action kinds and multi-hand score accumulation.
- Future changes to set identity, skunk rules, verifier output, or leaderboard order fail loudly.

---

### Batch 02 — Immutable challenge contract and additive schema

**Intent:** Define and store the complete Daily Fritz challenge as an immutable versioned artifact without changing the active read path.

**Scope**

- Introduce a typed `DailyFritzPublishedChallenge` contract containing:
  - challenge ID and Pacific date;
  - generation, seed, rules, transcript, Fritz-policy, and ranking versions;
  - tier, deal size, winning score;
  - all three game seeds;
  - draw winner and draw tiles per game;
  - complete hand deals for every supported hand slot in every game;
  - per-game and whole-challenge SHA-256 content digests;
  - status, published timestamp, invalidation metadata.
- Add additive Supabase tables or additive columns for immutable challenge publication. Prefer normalized challenge/game/hand records or one rigorously validated content-addressed package; do not overwrite `daily_fritz_runs` yet.
- Add unique constraints on challenge ID/date/version and content digest.
- Add RLS: authenticated read only where needed; service-role write only.
- Add strict validators for deck conservation, tile uniqueness, deal size, all 28 tiles, hand count, draw consistency, and digest verification.

**Expected files**

- New server challenge contract/service modules.
- `supabase/migrations/<sequence>_daily_fritz_published_challenges.sql`
- `supabase/daily_fritz.sql` canonical schema update.
- Contract/schema tests.

**Non-goals**

- No route switches.
- No attempt migration.
- No client change.
- No change to generation algorithm.

**Compatibility**

- Existing `daily_fritz_runs` remains active.
- New schema is unused until Batch 03.

**Tests**

- Same date/version produces the same canonical serialized package and digest.
- Different dates produce different intended packages.
- All three games have valid complete deals.
- Corrupt tile/deal/digest packages are rejected.
- Migration/RLS contract tests.

**Rollback**

- Disable publication writer if introduced.
- Because schema is additive, leave unused tables in place during rollback; remove only in a later cleanup migration after evidence confirms no data use.

**Acceptance criteria**

- One typed package can independently describe every possible hand in all three games.
- Package digest is stable across repeated Node executions.
- No production request reads the new tables yet.

---

### Batch 03 — Challenge publication, shadow comparison, and historical reads

**Intent:** Publish immutable challenges ahead of play and prove parity with the current run generator before making them authoritative.

**Scope**

- Add idempotent `publishDailyFritzChallenge(date)` behavior.
- Publication must return the existing package for the same challenge identity; it must reject same identity/different digest.
- Extend scheduled warmup/admin generation to publish the immutable package.
- Add a shadow comparator on `/today`, `/start`, and hand resolution that compares legacy run-derived content with the published package without changing the response.
- Persist mismatch telemetry containing challenge ID, game/hand index, expected digest, actual digest, generation version, and release version—never raw private player data.
- Add an admin historical challenge diagnostic by challenge ID/digest.
- After a zero-mismatch staging window, switch challenge reads behind `DAILY_FRITZ_PUBLISHED_CHALLENGE_READS` while preserving a one-release fallback.

**Expected files**

- Challenge publication service and store.
- Scheduled warmup/admin route integration.
- Narrow changes to `server/src/http/routes/dailyFritz.ts` or extracted query service.
- Health/readiness checks for publication availability.

**Non-goals**

- Attempt mutation remains unchanged.
- No protocol gating yet.
- No UI changes.

**Tests**

- Publish twice: same identity/same digest returns one package.
- Same identity/different digest fails closed.
- Shadow comparator covers games 1–3 and all hand slots.
- Historical package remains unchanged after a fixture generation-version bump.
- Invalidated package cannot start a new attempt.

**Rollout**

1. Deploy schema and writer disabled.
2. Publish staging fixtures.
3. Enable writer in production with reads on legacy path.
4. Observe shadow parity for at least seven generated dates or a compressed preproduction fixture set plus several live dates.
5. Enable published reads for internal accounts, then all new attempts.

**Rollback**

- Turn off published reads and return to legacy run reads.
- Never mutate/delete already published challenge rows.

**Acceptance criteria**

- No unresolved shadow mismatch.
- Today’s package exists before the first eligible attempt.
- Historical challenge fetch by ID and digest works after deploy.
- Game two and three no longer depend on the currently deployed generator once published reads are authoritative.

---

### Batch 04 — Modern-protocol-only authority for new attempts

**Intent:** Ensure every newly created attempt is transcript-verifiable while preserving historical legacy records as read-only data.

**Scope**

- Require exact supported transcript protocol, rules version, challenge generation version, and Fritz policy version on `/start` for new attempts.
- If an existing legacy attempt is resumed, return an explicit `legacy_unverified` compatibility response without upgrading or relabeling it.
- Remove score-only fallback from new attempts in `/next-hand` and `/record-game`.
- Make verification status visible in `/today`, `/start`, `/history`, and completion response contracts.
- Define qualifying completion consistently: verified competitive surfaces use only verified status; older records are clearly labeled.
- Add an explicit update-required error code with minimum/current versions.

**Expected files**

- `server/src/http/routes/dailyFritz.ts`
- `server/src/http/routes/dailyFritzVerificationPolicy.ts`
- `client/src/dailyFritz/api.ts`
- `client/src/dailyFritz/useDailyFritzRunController.ts`
- API contract tests and minimal compatibility copy where required.

**Protected behavior**

- Do not alter transcript format, verifier logic, game core, best-of-three rules, or leaderboard filtering.

**Tests**

- Omitted, older, newer, and mismatched versions rejected for new attempts.
- Supported versions create modern attempt.
- Existing verified attempt resumes.
- Existing legacy attempt remains readable and cannot become verified through a modern final request.
- Score-only hand/game request rejected for modern attempt.

**Rollout**

- Deploy server support before the client requirement.
- Confirm current production client sends all required versions.
- Gate new-attempt enforcement by server release minimum and enable after client adoption evidence.

**Rollback**

- Temporarily reopen new attempts only through an explicit emergency flag that marks them `legacy_unverified` and excludes all competitive/verified surfaces.

**Acceptance criteria**

- No new attempt can be created without modern version pinning.
- No new attempt can advance through score-only evidence.
- Legacy history remains accessible but never silently trusted.

---

### Batch 05 — Durable operation IDs and attempt revision schema

**Intent:** Add the database primitives required for transactional commands and cross-device correctness without moving routes yet.

**Scope**

- Add `revision bigint not null default 0` and explicit challenge identity/version references to attempts.
- Add `daily_fritz_attempt_operations` with:
  - operation ID;
  - attempt/user/challenge identity;
  - command type;
  - canonical request digest;
  - expected and committed revision;
  - status/result/error JSON;
  - created/committed timestamps;
  - uniqueness on `(attempt_id, operation_id)`.
- Add normalized or append-only verified hand/game receipt tables if selected by the target design.
- Add transactional outbox table now, unused until command migration.
- Add indexes for attempt/current state, operation replay, leaderboard, history, and outbox delivery.
- Add RLS/service-role restrictions and retention policy documentation.

**Non-goals**

- Existing routes continue to use current store.
- No client sends revision yet.
- No backfill changes attempt authority.

**Tests**

- Migration applies to populated fixture database.
- Existing attempts receive revision 0 without result mutation.
- Same operation ID/request digest can be read idempotently.
- Same operation ID/different digest is constrained/rejected by service logic fixture.
- RLS prevents direct authenticated writes.

**Rollback**

- Additive schema remains dormant if app code is rolled back.
- No destructive down migration in production; forward-fix or remove after a quarantine period.

**Acceptance criteria**

- Current production behavior is unchanged.
- Schema supports atomic revision and operation receipts.
- Existing attempt rows retain byte-equivalent result JSON.

---

### Batch 06 — Transactional start/resume command

**Intent:** Make attempt creation and resume idempotent across simultaneous requests and server instances.

**Scope**

- Introduce a database transaction/RPC or equivalent application command transaction for `start_attempt`.
- Inputs: user ID from auth context, challenge ID, operation ID, pinned versions.
- Transaction behavior:
  - lock/select challenge;
  - reject unpublished/invalidated/incompatible challenge;
  - create or return one attempt for user/challenge;
  - create/link verified single-player match exactly once;
  - write operation receipt;
  - increment revision only for a new state transition;
  - enqueue outbox event.
- Keep current `/start` endpoint shape via an adapter; add revision and operation receipt to response.
- Shadow-compare transactional result with current store result before routing all starts through it.

**Tests**

- 20 concurrent starts for the same user/challenge return one attempt and one verified match.
- Retry after response loss returns identical attempt/revision.
- Same operation ID/different challenge or versions is rejected.
- Invalidated challenge fails without partial rows.
- Two users receive separate attempts for the same challenge.

**Rollout**

- Shadow create/read in staging fixture database.
- Enable for internal users, then a small percentage of new attempts, then all new attempts.
- Existing attempts continue through compatible resume adapter.

**Rollback**

- Route new starts back to existing start path while preserving new attempt rows, which must remain readable by the adapter.

**Acceptance criteria**

- Unique constraint errors are not exposed as ordinary double-start failures.
- One request or twenty concurrent requests produce one authoritative attempt.
- Start no longer depends on process-local locking for correctness.

---

### Batch 07 — Transactional verified-hand command

**Intent:** Atomically verify and commit each hand with revision/CAS and durable replay semantics.

**Scope**

- Add `accept_verified_hand` command around the existing verifier; do not change verifier rules.
- Inputs: operation ID, expected revision, attempt/challenge/game/hand identity, transcript.
- Transaction flow:
  1. authenticate and load attempt;
  2. compare expected revision;
  3. resolve immutable published hand;
  4. run existing verifier outside or inside a safe command orchestration boundary;
  5. lock/recheck revision before commit if verification occurs outside the transaction;
  6. insert hand receipt with transcript digest and derived scores;
  7. update attempt hand progress/revision;
  8. write operation receipt and outbox event atomically.
- Return current authoritative snapshot on stale revision.
- Keep current `/next-hand` route as a compatibility adapter.
- Retain the local in-process lock as a latency optimization only, clearly documented as non-authoritative.

**Tests**

- Legal transcript accepted once.
- Illegal/wrong-actor/wrong-hand/wrong-game transcript rejected without revision change.
- Same operation replay returns original response.
- Same operation ID/different transcript digest rejected.
- Two valid submissions at the same revision: one commits; one receives stale revision/current snapshot.
- Response loss then retry does not duplicate hand receipt/outbox event.
- Multi-instance test bypasses shared process memory and still passes.

**Rollback**

- Feature flag routes hand acceptance to the old path.
- New hand receipts remain read-compatible or are ignored by old path; no deletion.

**Acceptance criteria**

- Accepted progress, operation receipt, and outbox event commit together.
- Attempt revision increases exactly once per accepted hand.
- Process-local lock removal would not change correctness.

---

### Batch 08 — Transactional game-record command

**Intent:** Derive and commit game/set transitions solely from verified hand authority.

**Scope**

- Add `record_verified_game` command.
- Remove client score/move/hand count from the decision path for modern attempts; keep fields temporarily in request parsing only for telemetry/compatibility diagnostics.
- Derive terminal game score, move/action count, hand count, game winner, point differential, seed, and game digest from immutable challenge plus accepted hand receipts.
- Call the existing `appendDailyFritzGameToSet()` unchanged.
- Validate game order and set invariants.
- Commit verified game receipt, set projection, attempt revision, operation receipt, and outbox event atomically.
- Return next game number or set-clinched state.

**Tests**

- 2–0 and 2–1 normal paths.
- Game-one and game-two skunk clinch paths.
- Game-three decider/skunk metadata path.
- Client submits manipulated scores/counts: server result remains authority-derived or request is rejected.
- Duplicate game operation returns same transition.
- Competing device cannot record the next game from a stale revision.
- Game two cannot record before game one; fourth game cannot record.

**Rollback**

- Route record-game to prior implementation behind flag.
- Preserve new verified game receipts and make adapter able to project existing set result.

**Acceptance criteria**

- Modern game transition is independent of client score claims.
- Best-of-three/skunk golden tests remain unchanged.
- One terminal hand produces one game receipt and at most one set transition.

---

### Batch 09 — Transactional finalize, abandon, verified match, and outbox

**Intent:** Make terminal attempt transitions exactly-once and keep all official records consistent.

**Scope**

- Add `finalize_verified_attempt` and `abandon_attempt` commands using expected revision and operation ID.
- Finalize derives set score, point differential, won state, move/action count, hands played, verification state, and server receipt only from verified authority.
- Atomically update:
  - attempt terminal state;
  - verified single-player match terminal state;
  - operation receipt;
  - leaderboard-eligible projection/materialized row if introduced;
  - outbox events for completion, leaderboard, social activity, and analytics.
- Abandon uses the same concurrency/operation discipline and is forbidden after committed completion.
- Remove correctness dependence on client `completion_hash`, `final_score`, `opponent_score`, `won`, `moves_used`, `hands_played`, `move_log`, and `set_result` fields.
- Preserve response compatibility during one deprecation window.

**Tests**

- Finalize once, retry many times, exactly one completion and leaderboard credit.
- Response loss after commit returns original receipt.
- Finalize versus abandon race has one legal winner.
- Finalize with incomplete game authority fails without state change.
- Attempt and verified match cannot diverge under injected DB failure.
- Social/outbox event emits once.
- Legacy attempt cannot be finalized as verified.

**Rollout**

- Shadow derive server result and compare to current completion for fixture attempts.
- Enable finalization command before client removes deprecated fields.
- Monitor mismatch, stale revision, replay, and outbox rates.

**Rollback**

- Revert endpoint adapter while retaining committed terminal rows.
- Outbox consumers can be paused independently.

**Acceptance criteria**

- Final completion is one atomic state transition.
- Completion receipt is stable and server-generated.
- Verified leaderboard and social activity cannot double-credit.
- `/abandon` no longer races unprotected with completion.

---

### Batch 10 — Cross-tab and cross-device reconciliation

**Intent:** Make concurrent clients safe and understandable without weakening the existing local recovery system.

**Scope**

- Extend API responses with `revision`, authoritative state, and typed conflict codes.
- Add durable client operation IDs stored with pending checkpoint mutations.
- Preserve existing local snapshot identity/fingerprint validation.
- Add a `BroadcastChannel` coordinator for same-browser tabs:
  - announce active attempt/revision;
  - elect one writer or warn on takeover;
  - propagate committed revision/state;
  - invalidate stale pending UI safely.
- On server `stale_revision`, fetch/reconcile authoritative state:
  - if submitted operation already committed, consume receipt;
  - if another device advanced, discard only stale provisional state and resume official state;
  - never silently merge divergent action logs.
- Add explicit recovery UI states: reconnecting, another device advanced, update required, submission restored, unrecoverable evidence mismatch.

**Expected files**

- `client/src/dailyFritz/api.ts`
- `client/src/dailyFritz/useDailyFritzRunController.ts`
- `client/src/modules/daily/dailyFritzSessionStorage.ts`
- `client/src/modules/daily/useDailyFritzSessionPersistence.ts`
- New focused reconciliation/coordinator module and tests.

**Non-goals**

- No board redesign.
- No change to gameplay rules or animations.
- No speculative local-state merge.

**Tests**

- Two tabs start simultaneously.
- One tab advances while another is stale.
- Same operation retry in another tab.
- Two devices submit different operations at same revision.
- LocalStorage unavailable.
- Browser crash with pending operation before/after server commit.
- Client update invalidates snapshot but resumes server progress.

**Rollback**

- Disable BroadcastChannel writer coordination and fall back to server CAS conflict handling.
- Server correctness remains intact.

**Acceptance criteria**

- No stale client can overwrite accepted state.
- Same-browser tabs converge on one authoritative revision.
- A valid accepted move is never lost merely because its response was lost.
- Existing schema-7 checkpoints remain safe or have an explicit migration.

---

### Batch 11 — Full lifecycle E2E and failure-injection gate

**Intent:** Prove the complete product lifecycle against real client, server, database, and concurrency boundaries.

**Scope**

- Build deterministic test challenge fixtures that can force:
  - normal 2–0;
  - normal 2–1;
  - player/Fritz game-one skunk;
  - game-two special skunk clinch;
  - game-three decider.
- Add authenticated Playwright journeys using an isolated test project/database.
- Add fault controls for response loss, delayed request, server restart, second server instance, stale revision, network offline, and Pacific date override in non-production.
- Run the fifteen production-grade cases from the audit plus:
  - final receipt/leaderboard consistency;
  - old-client update-required path;
  - challenge invalidation;
  - outbox exactly-once delivery;
  - localStorage denial/corruption;
  - login/logout identity partitioning.

**Test tiers**

- PR: deterministic core and one complete happy-path set.
- Merge/main: all set outcome fixtures and refresh/retry cases.
- Nightly: multi-instance, restart, response-loss, DST/midnight, and load-smoke cases.
- Release gate: no quarantined authority/recovery failures.

**Non-goals**

- Visual redesign snapshots are separate from authority E2E.
- Do not use production accounts or mutate production challenge rows.

**Rollback**

- Test infrastructure can be reverted independently; authority releases must not bypass the resulting gate without written exception.

**Acceptance criteria**

- A complete best-of-three journey is exercised through real HTTP and database writes.
- All expected failure scenarios produce a defined recoverable outcome.
- Multi-instance tests demonstrate correctness without shared memory.
- CI artifacts include challenge ID, attempt ID, revision sequence, operation IDs, and final receipt for failed runs.

---

### Batch 12 — Canonical analytics and retention pipeline

**Intent:** Measure the Daily Fritz habit and reliability funnel without making analytics part of game authority.

**Scope**

- Define a versioned canonical event envelope with event ID/name/time, challenge/run/attempt/user identity, generation/rules/Fritz/ranking versions, game/hand, revision, operation ID, client release, platform, outcome, and privacy classification.
- Server authoritative/outbox events:
  - challenge published;
  - attempt started/resumed;
  - hand verified/rejected;
  - game completed;
  - set clinched/completed;
  - attempt abandoned;
  - operation replayed/conflicted;
  - completion verified;
  - leaderboard entry created.
- Client product events:
  - home/hub impression;
  - CTA click;
  - first meaningful move;
  - recovery UI shown/resolved;
  - between-game continue;
  - completion receipt viewed;
  - share requested/succeeded;
  - leaderboard/review opened.
- Add ingestion deduplication and event-source classification.
- Add SQL views or warehouse queries for:
  - impression-to-start;
  - start-to-first-move;
  - G1 completion, G1-to-G2, G2-to-G3;
  - set completion and abandonment point;
  - 2–0/2–1/skunk distributions;
  - resume and recovery success;
  - verification/submission failure;
  - share and review rate;
  - D1 and D7 return/cohort retention;
  - authenticated new versus returning users;
  - client release/device failure concentration.

**Data quality rules**

- Server terminal events are canonical for outcomes.
- Client events never assert verified completion.
- Event IDs are stable across retry.
- Test/admin accounts and generated fixture challenges are identifiable and excluded by default from product metrics.
- User IDs are access-controlled; reports use aggregated/de-identified dimensions where possible.

**Tests**

- Exactly-once server event after command retry.
- Duplicate client ingestion deduplicates.
- Complete fixture produces the expected event sequence.
- D1/D7 query fixtures across Pacific midnight and DST.
- Missing impression or offline client event does not alter authority metrics.

**Rollback**

- Pause analytics consumers; outbox retains deliverable events.
- Disable client product event emission independently.
- Never roll back official attempt state because analytics failed.

**Acceptance criteria**

- Every required funnel metric has a documented numerator, denominator, eligibility rule, and query.
- Operational and product events are distinguishable.
- Analytics failure cannot block or corrupt gameplay.

---

### Batch 13 — Premium verified completion experience

**Intent:** Turn the authoritative result into a high-trust, memorable daily completion moment without changing gameplay or the best-of-three format.

**Scope**

- Extend completion response/view model with a signed or opaque server receipt identifier, challenge date/ID, verification state, set score, ordered game summaries, skunk/clinching narrative, total point differential, rank, percentile when statistically valid, streak eligibility, and next challenge availability.
- Upgrade the existing final overlay rather than replacing the board or game flow.
- Clearly distinguish:
  - verified completion;
  - submission pending/recovering;
  - unverified historical result;
  - incompatible client;
  - challenge invalidated.
- Build a deterministic share payload from server-authoritative result fields.
- Add share success/failure analytics and privacy-safe challenge/result identifiers.
- Add one-click leaderboard navigation and optional authoritative review entry point only if replay data is ready.
- Preserve current premium matte/neon Daily Fritz visual identity and responsive shell constraints.

**Expected files**

- `client/src/dailyFritz/DailyFritzFinalResultOverlay.tsx`
- `client/src/dailyFritz/buildDailyFritzSetOverlayViewModel.ts`
- `client/src/dailyFritz/setOverlayViewModel.ts`
- `client/src/dailyFritz/shareCard.ts`
- Narrow API/view-model additions.
- Focused CSS only where required.

**Non-goals**

- No gameplay, scoring, bot, challenge, board, navigation, or format changes.
- No percentile until the eligible population is large enough and its calculation is defined.

**Tests**

- Every set terminal class renders the correct narrative.
- Verification state cannot be spoofed by client props.
- Share payload matches server result and contains no private identifiers.
- Retry/recovery transitions into one final receipt without duplicate celebration/share events.
- Mobile/desktop accessibility: focus, screen-reader status, reduced motion, contrast, viewport containment.

**Rollback**

- Feature flag returns to current final overlay while retaining new server fields.

**Acceptance criteria**

- A user can explain what happened across the set, why it ended, whether it is verified, and what to do next.
- Share and leaderboard claims exactly match server authority.
- Completion experience does not delay or participate in committing the result.

---

### Batch 14 — Capacity, observability, and operating evidence

**Intent:** Produce defensible reliability and capacity evidence for production operations and acquisition diligence.

**Scope**

- Load-test immutable challenge reads, start/resume, verifier CPU, verified-hand commands, game/finalization transactions, leaderboard query, and outbox delivery.
- Test realistic and burst profiles, including daily reset concentration.
- Publish measured p50/p95/p99 latency, throughput, error rate, verifier rejection rate, stale-revision rate, retry rate, DB lock/transaction time, outbox lag, and resource saturation.
- Add dashboards/alerts with explicit thresholds and owners for:
  - challenge publication missing/mismatch;
  - start/hand/game/finalize failures;
  - verification failure code spikes;
  - stale-revision/conflict spikes;
  - completion/verified-match divergence;
  - outbox backlog;
  - readiness failures;
  - leaderboard query degradation.
- Write runbooks for challenge republish prohibition, invalidation, stuck attempt diagnosis, operation replay inspection, outbox recovery, and rollback.
- Add backup/restore verification for Daily Fritz tables and historical challenge packages.

**Non-goals**

- Do not publish theoretical concurrency numbers.
- Do not tune before measuring.

**Tests/evidence**

- Reproducible load scripts and environment description.
- Restore drill into isolated environment.
- Alert test and runbook walkthrough.
- Multi-instance correctness maintained under load.

**Rollback**

- Dashboards/load scripts are non-authoritative.
- Performance changes must be separate, individually reversible PRs following this evidence batch.

**Acceptance criteria**

- Capacity claims are measured and reproducible.
- Operators can diagnose one failed attempt from request/operation/attempt/challenge IDs without reading raw production secrets.
- Backup restore reproduces immutable challenge and verified completion history.

---

### Batch 15 — Legacy contraction and acquisition handoff

**Intent:** Remove obsolete compatibility paths only after the new architecture has proven stable, and package the system for external diligence.

**Entry gate**

- At least one full release window on immutable challenge reads.
- All new attempts modern-protocol-only.
- Transactional commands handle all production mutations.
- No unresolved authority mismatch.
- Lifecycle E2E release gate is green.
- Analytics data quality checks pass.
- Rollback window and backup restore are verified.

**Scope**

- Remove score-only mutation branches for new/active modern attempts.
- Remove unused client completion claim fields and ceremonial completion hash.
- Remove legacy generation fallback only after every retained challenge date is published or explicitly outside retention scope.
- Downgrade process-local attempt lock to an optional optimization or remove it after distributed tests prove no dependence.
- Remove shadow-comparison code after archived evidence.
- Keep historical legacy records readable with explicit unverified classification.
- Produce acquisition packet:
  - architecture and trust-boundary diagram;
  - schema/data dictionary;
  - API/command contracts;
  - challenge/versioning policy;
  - verifier and best-of-three invariants;
  - E2E/failure matrix and latest results;
  - measured capacity report;
  - dashboards/alerts/runbooks;
  - migration and rollback history;
  - known limitations and risk register;
  - data retention/privacy notes;
  - ownership map and release checklist.

**Tests**

- Full client/server/game-core suite.
- Full Daily Fritz E2E release gate.
- Historical legacy read fixtures.
- Unsupported old-client behavior.
- Migration from pre-program fixture database.

**Rollback**

- Contract removals occur in separate commits after usage telemetry proves zero callers.
- Retain one release tag capable of reading both old and new records.
- Never delete historical challenge or authority data as part of application rollback.

**Acceptance criteria**

- No production caller uses removed fields/routes.
- External engineers can trace challenge publication through verified completion using documentation and tests alone.
- Remaining known risks are explicit, owned, and severity-ranked.

## 9. Release gates

### Gate A — Behavior frozen

Required after Batch 01:

- best-of-three/skunk golden matrix complete;
- verifier legal/illegal golden fixtures complete;
- leaderboard ordering fixtures complete;
- existing builds/tests green or baseline exceptions documented.

### Gate B — Challenge trustworthy

Required after Batch 03:

- immutable package exists for all three games;
- same identity cannot accept a different digest;
- historical read fixture survives release/version change;
- shadow mismatch rate is zero for the approved window;
- invalidation behavior tested.

### Gate C — Authority closed

Required after Batch 04:

- every new attempt pins supported versions;
- score-only evidence is rejected for modern attempts;
- legacy records cannot become verified;
- verified leaderboard path remains unchanged and green.

### Gate D — Commands transactional

Required after Batch 09:

- start, hand, game, finalize, and abandon use operation IDs/revisions;
- same operation replay returns original result;
- conflicting operation payload is rejected;
- state, receipts, verified match, and outbox commit atomically;
- multi-instance test passes without shared memory.

### Gate E — Recovery proven

Required after Batch 11:

- refresh/crash/response-loss/server-restart scenarios pass;
- two-tab/two-device conflicts converge safely;
- midnight/DST fixtures pass;
- full 2–0/2–1/skunk E2E matrix passes.

### Gate F — Product measurable and premium

Required after Batches 12–13:

- funnel event sequence and retention queries pass fixture validation;
- final receipt exactly reflects server authority;
- share event and payload are trustworthy;
- accessibility and viewport tests pass.

### Gate G — Acquisition-ready

Required after Batches 14–15:

- measured capacity report exists;
- alerts/runbooks/backup restore are tested;
- legacy callers are zero before contraction;
- diligence packet is complete;
- open risks have owners and dates.

## 10. Feature-flag strategy

Use independently controlled server flags, not one master switch:

- `DAILY_FRITZ_PUBLISH_IMMUTABLE_CHALLENGES`
- `DAILY_FRITZ_SHADOW_CHALLENGE_COMPARE`
- `DAILY_FRITZ_PUBLISHED_CHALLENGE_READS`
- `DAILY_FRITZ_REQUIRE_MODERN_PROTOCOL`
- `DAILY_FRITZ_TRANSACTIONAL_START`
- `DAILY_FRITZ_TRANSACTIONAL_HANDS`
- `DAILY_FRITZ_TRANSACTIONAL_GAMES`
- `DAILY_FRITZ_TRANSACTIONAL_FINALIZE`
- `DAILY_FRITZ_OUTBOX_DELIVERY`
- `VITE_DAILY_FRITZ_REVISION_RECONCILIATION`
- `VITE_DAILY_FRITZ_VERIFIED_RECEIPT`
- `VITE_DAILY_FRITZ_PRODUCT_ANALYTICS`

Rules:

- Defaults must preserve the last known-safe production path until the relevant gate passes.
- Server authority flags are enabled before dependent client flags.
- Flags are temporary migration controls, each with a removal batch/owner.
- A disabled analytics or completion-UI flag must never disable authority or corrupt progress.
- Emergency legacy mode, if retained temporarily, must create only `legacy_unverified` attempts and must never qualify for verified competition.

## 11. Migration discipline

- Use additive migrations first: tables, columns, indexes, constraints initially `not valid` if necessary, and service-role policies.
- Backfills operate in bounded batches and are restartable.
- Challenge publication is immutable; correction uses invalidation plus a new version, not in-place mutation.
- Attempt revision begins at zero and increments only on accepted state transitions.
- Operation receipts and authority records are append-only.
- Destructive column/table removal occurs only in Batch 15 after usage telemetry and restore evidence.
- Every migration includes a production verification query and a forward-fix plan.
- No migration assumes a pristine database or empty table.

## 12. Review sizing and commit discipline

An implementation batch may contain multiple commits but should remain one reviewable capability. Preferred commit sequence:

1. tests/fixtures that characterize old behavior;
2. additive schema/contract;
3. implementation behind disabled flag;
4. shadow/telemetry wiring;
5. documentation and rollout evidence.

If a review exceeds roughly 500 meaningful changed lines excluding generated SQL/fixtures, split it by contract, persistence, route adapter, and client consumer. Never split in a way that merges an untested intermediate authority path.

## 13. Required test commands per affected layer

At minimum, use the repository-standard commands relevant to the batch:

```bash
npm run build --prefix client
npm run build --prefix server
npm test --workspace=server
npm test --workspace=client
npm run e2e --prefix client
```

Targeted commands should run first for iteration, but merge evidence must include the appropriate broader suites. Database-command batches also require isolated migration/RPC integration tests; concurrency and failure batches require multi-process or multi-instance tests, not mocks of the process-local lock.

## 14. Program risk register

| Risk | Likelihood before mitigation | Impact | Primary batches | Exit evidence |
|---|---:|---:|---|---|
| Published challenge differs across releases | Medium | Critical | 02–03 | Stable content digest and historical replay fixture |
| Old/custom client creates unverified competitive claim | Medium | High | 04 | Modern protocol gate and legacy quarantine tests |
| Two instances overwrite attempt JSON | Medium | Critical | 05–09 | Revision/CAS multi-instance test |
| Response loss duplicates progress/credit | Medium | High | 05–09 | Durable operation replay tests |
| Attempt and verified match diverge | Medium | High | 09 | Injected transaction failure test |
| Cross-device user loses accepted progress | Medium | High | 10–11 | Two-device E2E convergence |
| Analytics misstates retention | High | Medium | 12 | Event contracts and cohort fixture queries |
| Completion UI claims unverified rank/result | Medium | High | 13 | Server-receipt view-model tests |
| Load claim is theoretical | High | Medium | 14 | Reproducible capacity report |
| Cleanup removes historical compatibility too early | Medium | High | 15 | Zero-caller telemetry and restore/tag evidence |

## 15. Program success narrative

When these batches are complete, Daily Fritz will still be recognizably the same product: a premium best-of-three daily set against Fritz, using the same shared game rules, verifier, set identity, leaderboard, and recovery foundation.

What changes is the strength of the promise:

- “Same challenge” becomes an immutable content-addressed fact.
- “Verified” becomes a modern-protocol-only server authority contract.
- “One attempt” becomes a transactional, revision-checked invariant across instances and devices.
- “Safe to retry” becomes durable idempotency, not a client-side in-flight ref.
- “Resume anywhere” becomes explicit reconciliation, not only localStorage recovery.
- “Daily habit” becomes measurable through canonical funnel and retention data.
- “Completed” becomes a premium server-backed receipt that a player, operator, interviewer, or acquiring engineer can trust.

That is the acquisition-grade version of the existing Daily Fritz architecture: not a replacement, but a disciplined conversion of strong foundations into durable product infrastructure.
