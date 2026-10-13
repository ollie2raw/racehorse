# Remediation PostgreSQL tests

These three Vitest files exercise the actual PostgreSQL functions and constraints:
`puzzleRushPostgres.integration.test.ts`, `rankingPostgres.integration.test.ts`,
and `ghostRatingPostgres.integration.test.ts`. They skip unless the database URL
matches the isolated local host, port, and database name below. Never point them
at Supabase or production.

Start a disposable PostgreSQL instance on `127.0.0.1:55432` with database
`racehorse_remediation` and a role that can create schemas and functions. On a
fresh database, apply these files in order with `psql -X -v ON_ERROR_STOP=1 -f`:

1. `server/test/fixtures/remediationPostgres.sql`
2. `supabase/migrations/2026-06-30_commit_glicko_game_update_rpc.sql`
3. `supabase/migrations/2026-10-13_puzzle_rush_assignment_and_atomic_completion.sql`
4. `supabase/migrations/2026-10-13_ranked_rating_claim.sql`
5. `supabase/migrations/2026-10-13_ghost_rating_idempotent_completion.sql`
6. `supabase/migrations/2026-10-13_ghost_user_match_uniqueness.sql`

Then run:

```sh
RACEHORSE_REMEDIATION_TEST_DATABASE_URL=postgresql://racehorse_test@127.0.0.1:55432/racehorse_remediation \
  npm run test:focused --prefix server -- \
  src/puzzleRush/puzzleRushPostgres.integration.test.ts \
  src/ranking/rankingPostgres.integration.test.ts \
  src/ghost/ghostRatingPostgres.integration.test.ts
```

The fixture is deliberately minimal. It verifies transaction behavior of the
new migrations; other server suites cover routing and gameplay contracts.

Production rollout is separate from this test fixture. Apply the Rush,
ranked, and first Ghost migration before the server code that calls their RPCs.
The ranked RPC keeps its old signature. The first Ghost migration keeps the
old global `match_id` constraint so a running older server can still use its
`on_conflict=match_id` path. Apply `ghost_user_match_uniqueness` only after
the replacement server is live. Once that last migration runs, rolling the
server back to the old Ghost writer requires restoring its global constraint;
that may require reconciling matches with two player rows first. A rollback of
the Rush schema cannot reconstruct assignments for runs opened by older code;
the migration closes those open runs without publishing a score.
