# BRIDGE build for the senior-audit rating cutover

`rating-cutover-gate-bridge.patch` is `OLD + the rating cutover quiescence gate`,
with `LEGACY_RATING_WRITERS_ENFORCED = true`. It is the only server build that
can stop the OLD Ghost/Fritz completion and weekly decay writers and prove they
are idle (see `../senior-audit-rating-rush-cutover.md`).

Generated against OLD = `18bc747a` (`main` at the time of the remediation).
Verified on that commit:

* `git apply --check` is clean on a fresh checkout of `18bc747a`;
* the full server suite passes with the patch applied (four shards), including
  the gate, straddle, decay-overlap, route, and game-over tests, which here run
  the OLD Fritz path and the OLD unconditional decay PATCH, with "control" tests
  proving the same sequences lose the Ghost write / overwrite RD without the gate.

If production is not at `18bc747a`, check out the exact production SHA and run
`git apply --check`. On a conflict, re-apply the same hooks by hand (they are
small: the gate module, a registrar line in `index.ts`, one wrapper at the
room-persistence boundary, one wrapper around the locked `/api/ghost/complete`
body, `trackDeferredRatingWork` around the deferred Fritz Ghost write, and the
decay guards in `cron.ts`/`periodService.ts`) and re-run the gate tests.

```sh
git checkout <OLD production SHA>
git apply docs/ops/senior-audit-bridge/rating-cutover-gate-bridge.patch   # from the NEW branch checkout
npm ci && npm test --prefix server
```

Apply `supabase/migrations/2026-10-13_rating_cutover_gate.sql` (from the NEW
branch) before deploying the bridge; the bridge fails closed without that row.
Never deploy the bridge after the Ghost expand migration: use it only before
Step 3 of the runbook, and as the rollback target before the Ghost contract.
