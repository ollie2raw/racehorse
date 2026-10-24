> Historical first remediation, superseded by [the final parity and BRIDGE gate report](backend-runtime-final-gate.md). Its opponent-only context and parity certification do not describe the final design.

# Disconnect-forfeit rating recovery R1

Local continuation of `4488b5a9c009fc6821a16f4e0cd05b43515e73bf` on `audit/backend-runtime-reliability`. Production was not accessed or changed. Nothing was pushed or integrated.

## Root cause and lifecycle

`multiplayer/roomForfeit.ts` chose half-strength rating delta for `disconnect_timeout`, but supplied it only as an inline argument. Its durable `ranked_games` records could not distinguish disconnect from ordinary forfeit. Crash/failure after insertion left `rating_after IS NULL`; scheduled `ranking/periodService.ts` recovered these records at full strength. The former diagnostic reproduced twice the intended delta. A second parity problem was exposed by a partial two-seat commit: recovery read the already-updated opponent profile, changing the other seat's result even if the half-weight were preserved.

No existing field safely represented this treatment. `game_type=multiplayer`, source identity and scores do not distinguish completion causes; outcome means win/loss/draw and cannot also encode treatment.

| Path | Durable creation and rating interpretation |
|---|---|
| Normal human completion | `realtime/gameOverPersistence.ts` reads both profiles before either insertion; writes `standard`, score-derived outcome and each opponent's rating/RD snapshot. |
| Ordinary/manual forfeit | `multiplayer/roomForfeit.ts` writes `standard`, authoritative loss/win even when forfeiter led on points, and opponent snapshot. |
| Disconnect timeout | Same creation path writes `disconnect_forfeit`; its immutable context maps to weight 0.5. |
| Fritz completion/abandon recovery insertion | `ghost/service.ts` and `shared/fritzMatchLifecycle.ts` explicitly write `standard` and the configured Fritz rating/RD snapshot. Existing outcome behavior is preserved. |
| Inline processing | Consumes the actual returned durable records; no transient scale/outcome override remains. |
| Catch-up/restart | Reads the same context in its bounded pending projection and calls the same `commitProcessedGame`. No live opponent-profile query for new records. |
| Duplicate source insertion | Existing `(player_id,source_match_id)` uniqueness and ignore-duplicate insertion preserve the first context; duplicates never rewrite it. |

`rating_before`/`rd_before` remain insertion-time audit fields. Actual commit preconditions use the owner's current rating/RD/volatility/game count. The RPC locks the game, rejects an already-rated game, verifies the supplied context equals the locked durable context, then CAS-updates the owner profile, writes game results and inserts the unique `rating_periods.ranked_game_id` receipt in one transaction. Failure rolls back that seat's effects. Seats remain independent transactions: interruption after one seat is supported. A competing owner-profile change causes fresh-profile recomputation/CAS retry, as before; this change does not rewind unrelated intervening games or alter rating formulas.

## Durable model

One nullable JSONB column, `ranked_games.rating_context`:

```json
{"version":1,"treatment":"disconnect_forfeit","outcome":"loss","opponent":{"rating":1600,"rd":200}}
```

Versioned semantic treatment avoids storing an unchecked arbitrary multiplier. `standard` maps to 1; `disconnect_forfeit` maps to 0.5. Outcome and opponent snapshot travel together, so partial-seat recovery has the same inputs. RD/volatility treatment remains unchanged. Runtime validation requires exactly these fields, supported version/treatment/outcome, finite numeric rating and positive finite RD. New payload inputs require explicit treatment and snapshot; inserts verify their returned context and outcome. Malformed metadata throws; catch-up isolates/backoffs the row and never substitutes standard treatment.

## Migration and compatibility

`supabase/migrations/2026-10-15_ranked_rating_context.sql` is expand-first, transactional and independent of the pending cutover artifacts. It adds the nullable column with **no semantic default or backfill**, checks shape/values/outcome agreement, and makes context immutable by trigger (including NULL-to-context changes). Outcome is also immutable on context-bearing records. New writes always persist outcome; `RANKED_GAMES_OUTCOME_COLUMN_ENABLED` is retired in code/documentation, without changing any environment.

The existing 13-argument `commit_glicko_game_update` function is replaced atomically with the same arguments plus trailing `p_rating_context jsonb DEFAULT NULL`. Its row lock, profile CAS and unique receipt remain intact. Service-role-only execute privileges and pinned search path are retained. There is one signature, avoiding PostgREST overload ambiguity; schema reload is notified.

- **Old server + expanded schema:** old named/positional calls still process NULL-context records. Old callers cannot process new context records: the RPC rejects a missing/mismatched context before updating anything. Old writers continue to create legacy NULL records; they retain old semantics until upgraded.
- **New server + old schema:** process/liveness boots, but new inserts and pending scans fail closed on the absent column. Real boot check observed HTTP 200 and zero rating writes. This combination is safe from silent misrating but is not a functional rating deployment.
- **Required order:** apply migration, confirm PostgREST schema reload, then deploy the new server. A rollback to an old binary cannot drain new context rows; it fails closed. No live rollout was performed.
- **History:** NULL/absent context explicitly preserves the existing full-strength interpretation, stored outcome when available and otherwise score-derived outcome, with existing opponent lookup. Historical disconnects cannot be distinguished reliably; none were relabeled or recalculated. Previously applied outcomes remain unchanged.

The migration assumes the already-existing `outcome` column and claim/receipt RPC schema. It does not install, apply or alter rating-cutover migrations/gates in an application database. The fresh local fixture installs the prior claim migration only to reproduce that existing prerequisite.

## Crash matrix

| Interruption / concurrency case | Result |
|---|---|
| Normal completion, manual forfeit, disconnect forfeit | Inline and fresh recovery produce exactly equal persisted ratings/deltas/RD for both seats. Example loss: full delta −60.6808566684; disconnect inline and recovery −30.3404283342. |
| Both durable inserts, no rating effects | Catch-up reproduces inline results; disconnect delta is half the standard delta. |
| First seat committed, second interrupted | Restart/catch-up preserves the original opponent inputs; second delta equals uninterrupted inline result. |
| Receipt INSERT fails after profile/game UPDATE | Real transaction rolls both updates back; subsequent catch-up succeeds once. |
| Transaction committed, response lost | Recovery sees completed game; exactly one receipt and one owner game-count increment. |
| Duplicate catch-up | No second rating effect. |
| Foreground and catch-up overlap | Real PostgreSQL row-lock barrier queues both calls; one result per game, two receipts total for two seats. |
| Historical row inserted before migration | Remains NULL-context; full-strength backward-compatible result. |
| Invalid/unsupported context | DB CHECK rejects insertion; runtime malformed-row test makes no rating RPC and backs off without blocking valid rows. |
| Context/outcome update or retry with different treatment | Trigger rejects mutation; duplicate source insertion preserves first record. |
| Old RPC caller | Accepts legacy row; rejects new context row with zero effects. |

## Real local PostgreSQL/PostgREST validation

PostgreSQL **16.15**, PostgREST **16.4**, owned isolated cluster at loopback `55439`; expanded database `racehorse_forfeit_r1` served at `55440`, premigration database `racehorse_forfeit_r1_premigration` at `55441`. No production credentials or endpoints. Fixture: `server/test/fixtures/rankedRatingContextPostgres.sql`; actual existing claim migration and actual new migration were applied with `psql -X -v ON_ERROR_STOP=1`. A historical row was inserted before expansion. Tests use actual network requests, SQL constraints, RPC transactions, locks and receipts. Only the Supabase `/rest/v1` prefix is stripped for direct PostgREST; configuration uses a local-only JWT. Fault injection simulates interrupted/lost responses around real transactions.

Reproduce on a **fresh disposable** local database only:

1. Start PostgreSQL on `127.0.0.1:55439`, create the two database names above.
2. For each database, apply the fixture, then `supabase/migrations/2026-10-13_ranked_rating_claim.sql`. Apply `2026-10-15_ranked_rating_context.sql` only to `racehorse_forfeit_r1`.
3. Start direct PostgREST on loopback ports above with the corresponding DB URI using role `local_authenticator`, `db-schemas = "public"`, `db-anon-role = "anon"`, and `jwt-secret = "racehorse-forfeit-r1-local-validation-only-secret"`.
4. Run:

```sh
FORFEIT_R1_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/racehorse_forfeit_r1 \
SUPABASE_URL=http://127.0.0.1:55440 SUPABASE_SERVICE_KEY=local-only NODE_ENV=test \
npm run test:focused --prefix server -- src/ranking/ratingContextPostgres.integration.test.ts
npm run build --prefix server
NODE_ENV=test SUPABASE_URL=http://127.0.0.1:55441 SUPABASE_SERVICE_KEY=local-only \
node server/scripts/verifyForfeitPremigrationBoot.cjs
```

The integration test accepts only the exact disposable loopback database URL, reuses `assertNotProductionSupabase`, and cleans its synthetic cohorts. `PSQL_BIN` can override the local Homebrew binary path. The boot check runs the real compiled server through a local prefix gateway, waits for its 20-second startup catch-up, checks liveness/missing-column failure/zero writes, and shuts down its child. The fixture is intentionally a minimal claim-path schema, not a certification of every Supabase extension/RLS policy.

Results: real integration **11/11 passed**; migration committed; premigration boot **PASS**, HTTP 200, zero rating writes. All owned test services were stopped after validation.

## Prior reliability regression review and request budgets

The keyset cursor, failed-row backoff, ranking/decay single-flight implementations remain unchanged. Regression tests cover those paths, bounded room-log hydration, cleanup reconnect guard, match-start lost-response reconciliation, HTTP header/body timeout and Daily Fritz scan/no-refetch budgets. New context is added to the existing explicit bounded projection; no large JSON game state is selected. Normal completion still reads two profiles, now before either insertion. New context-bearing catch-up avoids the legacy live-opponent lookup: one human pending row with an ordinary owner requires scan + owner GET + atomic commit (3 requests rather than 4 for a distinct human opponent). Zero-work remains one scan. Profile normalization/CAS conflicts can add calls. No new scheduler or per-row success logs.

## Validation

- Final full server suite, exit 0: **2006 passed, 28 skipped, 1 existing todo**; four shards passed 486 / 588 / 492 / 440 tests. Test files: 295 passed, 5 opt-in/skipped. The 11 real database tests are deliberately opt-in and were executed separately with the exact local configuration above.
- Focused R1 + prior reliability regression selection: **120 passed**, 14 files, exit 0. Covers forfeit durability/parity/malformed metadata, catch-up keyset/backoff/single-flight, decay, room hydration/cleanup race, match-start retry, HTTP body timeout, ladder pagination and Daily Fritz request budgets.
- Real PostgreSQL/PostgREST matrix: **11 passed**, exit 0, including receipt-failure transaction rollback. New-server/premigration real boot: **PASS**, HTTP 200, zero writes.
- `npm run check:architecture --prefix client`: **22/22**, exit 0; responsive shell policy PASS.
- `npm run build --prefix server`: game-core, review-engine and server TypeScript build/typecheck **PASS**, exit 0.
- Changed production-file ESLint from `server/`: **0 errors, 3 existing warnings**, exit 0. Existing unused `averageMetric`/`variance` in Ghost and existing `any` in roomForfeit were verified against the starting commit. Tests are excluded by repository ESLint configuration. `node --check server/scripts/verifyForfeitPremigrationBoot.cjs`: PASS.
- `git diff --check`: PASS.

Validation logs are local review artifacts under `/private/tmp/forfeit-r1-*`, including `full-server-complete.log`, `regression-final.log`, `postgres-final.log`, `premigration-boot.log`, `architecture.log`, `build-final.log`, and `lint-final.log`. No unrelated cleanup, client changes, scoring changes, deployment, production migration, push or integration.

Changed files are the shared payload/context/commit interpretation, four ranked-game writer paths, the standalone migration, focused crash/fixture tests, local integration fixture/boot script and the linked documentation. The existing reliability implementation remains intact. Rollout still requires migration first; historical ambiguity is deliberately preserved rather than guessed. This report does not authorize a deployment.

**BACKEND RUNTIME RELIABILITY PASS READY FOR REVIEW**
