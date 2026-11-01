# Saved game records: owner steps

Phase 2 of `docs/review-game-record-architecture.md`. Every finished standard Play vs Fritz game from a signed-in
player is saved to `public.game_records` (the chess.com model: the game is stored first, review is derived from it
later). Owner-run, additive, reversible. Nothing here touches existing tables.

## Order matters

1. **Apply the migration first**: `supabase/migrations/2026-11-01_game_records.sql` (SQL editor, one paste).
2. Merge / deploy the PR (Render + Vercel deploy `main`).

If the code is deployed before the table exists, nothing breaks: the save answers 5xx, the app keeps each finished
game in its on-device outbox (newest 10, 14 days) and delivers it once the table exists, on the next load.

## 1. Before (read-only, one result): is the table already there?

```sql
select to_regclass('public.game_records') is not null as game_records_exists;
```

Expect `false` before step 1.

## 2. After applying the migration (read-only, one result)

```sql
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'game_records') as columns,
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'game_records') as indexes,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'game_records') as policies,
  (select relrowsecurity from pg_class where oid = 'public.game_records'::regclass) as rls_enabled;
```

Expect `columns` 17, `indexes` 3 (pkey, idempotency, user_created), `policies` 2, `rls_enabled` true.

## 3. Once games are being played (read-only, one result)

```sql
select
  count(*) as records,
  count(*) filter (where verification = 'replay_verified') as replay_verified,
  count(*) filter (where verification = 'replay_mismatch') as replay_mismatch,
  count(*) filter (where verification = 'unverified') as unverified,
  max(created_at) as latest
from public.game_records;
```

- `replay_mismatch` should stay at 0. A non-zero value means a ranked game's actions did not replay to its reported
  score; send me the server log line `game record does not replay to the submitted result` with the source match id.
- `unverified` is expected for unranked games (the server does not own their deal yet; Phase 3 fixes that).

## Rollback

Nothing reads `game_records` yet, so there is nothing to roll back in the app. To stop new saves, revert the PR. To
remove the table: `drop table public.game_records;` (it is empty of anything but copies of finished games).
