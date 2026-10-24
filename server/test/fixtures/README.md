# Remediation PostgreSQL tests

`puzzleRushPostgres.integration.test.ts`, `rankingPostgres.integration.test.ts`,
and `ghostRatingPostgres.integration.test.ts` exercise the final RPCs and
constraints. `rolloutPostgres.integration.test.ts` creates and removes its own
disposable database to test the old → expand → new → contract sequence. Every
test refuses a database URL other than the isolated localhost test instance.

Create `racehorse_remediation` on `127.0.0.1:55432` with a role able to create
schemas/functions. On a fresh database apply, in order:

1. `server/test/fixtures/remediationPostgres.sql`
2. `supabase/migrations/2026-06-30_commit_glicko_game_update_rpc.sql`
3. `supabase/migrations/2026-10-13_rating_cutover_gate.sql` (pre-expand)
4. Close the gate, as the production runbook does before any expand:
   `update public.rating_cutover_gate set quiesced=true, quiesced_at=now() where id;`
   (the Ghost and ranked expand migrations refuse to run otherwise)
5. `supabase/migrations/2026-10-13_ghost_rating_idempotent_completion.sql` (expand)
6. `supabase/migrations/2026-10-13_ghost_cutover_reconciliation.sql`
7. `supabase/migrations/2026-10-13_puzzle_rush_assignment_and_atomic_completion.sql` (expand)
8. `supabase/migrations/2026-10-13_ranked_rating_claim.sql`
9. `supabase/migrations/2026-10-13_puzzle_rush_assignment_contract.sql` (contract)
10. `supabase/migrations/2026-10-13_ghost_user_match_uniqueness.sql` (contract; refuses while Ghost/Fritz handoff partials are unresolved)

Apply each with `psql -X -v ON_ERROR_STOP=1 -f`. Then run:

```sh
RACEHORSE_REMEDIATION_TEST_DATABASE_URL=postgresql://racehorse_test@127.0.0.1:55432/racehorse_remediation \
  npm run test:focused --prefix server -- \
  src/puzzleRush/puzzleRushPostgres.integration.test.ts \
  src/ranking/rankingPostgres.integration.test.ts \
  src/ghost/ghostRatingPostgres.integration.test.ts \
  src/rolloutPostgres.integration.test.ts
```

The fixture is intentionally minimal; it verifies real PostgreSQL locking,
transactions, and migration transitions. The server suite covers HTTP and
gameplay contracts. The production cutover is specified separately in
`docs/ops/senior-audit-rating-rush-cutover.md` and must never use this fixture.

## Terminal completion R1 (real PostgreSQL + PostgREST + hard process kill)

`terminalCompletionBase.sql` + `scripts/setupTerminalCompletionTestDb.sh` build a disposable database from
the repository's **real** migrations (ranking, rooms, matches, ghost, tournaments tables, rating-cutover gate,
ranked claim + rating-context, ghost expand **and contract**). No production credentials are involved; the
script refuses any non-loopback `PGHOST`.

```sh
# 1. owned PostgreSQL 16 on 127.0.0.1:55439 (any local cluster works), then:
PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres server/scripts/setupTerminalCompletionTestDb.sh racehorse_terminal_r1
# 2. PostgREST (v12.x) on 127.0.0.1:55440:  db-uri=postgres://local_authenticator@127.0.0.1:55439/racehorse_terminal_r1,
#    db-schemas=public, db-anon-role=anon, jwt-secret="racehorse-forfeit-r1-local-validation-only-secret"
# 3. real-database crash matrix / mode matrix / request budgets (28 tests):
TERMINAL_R1_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1 \
TERMINAL_R1_POSTGREST_URL=http://127.0.0.1:55440 \
  npm run test:focused --prefix server -- src/multiplayer/terminalCompletionRecovery.postgres.integration.test.ts
# 4. real server process, SIGKILL at the boundary, fresh process finishes the completion:
TERMINAL_R1_TEST_DATABASE_URL=... TERMINAL_R1_POSTGREST_URL=... \
  npx tsx server/scripts/terminalCompletionHardRestart.ts            # boundary-b + replay-crash
```

`test/support/localPostgrestGateway.ts` sits in front of PostgREST (strips `/rest/v1`, counts requests, injects
faults around real commits: lost-before-commit, committed-response-lost, hold-then-kill) and
`test/support/syntheticAuth.ts` stands in for the three Auth endpoints the server/chaos scripts use. The existing
`chaos:multiplayer-restart` and `chaos:ranked-restart` scripts run unmodified against
`scripts/localChaosGateway.ts` (set `SUPABASE_URL` to its printed URL and both keys to its printed JWT).

### Durable-state monotonicity (room fence + ranked applied state)
`src/multiplayer/durableStateMonotonicity.postgres.integration.test.ts` (same env as step 3) exercises
`2026-10-16_room_live_session_monotonic_fence.sql` and `2026-10-16_ranked_applied_state_monotonic.sql`
(both are applied by `setupTerminalCompletionTestDb.sh`) through the RPC, the PostgREST merge-duplicates upsert and raw SQL.
`server/scripts/roomStateMonotonicityRace.ts [iterations]` is the two-**process** race: an OLD instance, a NEW instance
and a restart sweep, each a separate OS process running the real persistence/recovery code, in four timing modes. It
asserts the stale writer is rejected, the terminal row is intact, and the sweep completes it exactly once.

### Pre-/post-contract schema (Ghost mixed-version gate)
`scripts/setupTerminalCompletionTestDb.sh` builds the database in the exact cutover order and takes
`TERMINAL_TEST_SCHEMA=pre-contract` (default: what is live when NEW deploys, legacy `ghost_games_match_id_unique` present,
Rush/Ghost contracts NOT applied) or `post-contract`. Run every real-DB suite against both.
`src/ghost/ghostPreContractCompat.postgres.integration.test.ts` and
`terminalCompletionHardRestart.ts precontract-ghost` START from a fresh pre-contract database and APPLY the real Ghost
contract migration themselves; rebuild the database before re-running them.
