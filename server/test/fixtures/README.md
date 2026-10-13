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
3. `supabase/migrations/2026-10-13_puzzle_rush_assignment_and_atomic_completion.sql` (expand)
4. `supabase/migrations/2026-10-13_ranked_rating_claim.sql`
5. `supabase/migrations/2026-10-13_ghost_rating_idempotent_completion.sql` (expand)
6. `supabase/migrations/2026-10-13_puzzle_rush_assignment_contract.sql` (contract)
7. `supabase/migrations/2026-10-13_ghost_user_match_uniqueness.sql` (contract)

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
