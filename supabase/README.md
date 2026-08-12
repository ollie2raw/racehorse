# Supabase Setup (Fast Path v1)

1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase/schema.sql`.
3. Run `supabase/migrations/2026-05-12_bot_match_pending_greenfield_baseline.sql`,
   then `supabase/friends.sql`, then
   `supabase/migrations/2026-05-18_social_greenfield_baseline.sql` to install
   Fritz pending-match and social persistence.
4. Run `supabase/daily_puzzle.sql` to add Daily Puzzle tables/policies.
5. Run `supabase/daily_fritz.sql` and then `supabase/migrations/2026-07-31_daily_fritz_events.sql` to add Daily Fritz attempts and durable operational events.
   The migration must be run after the Daily Fritz base schema because the event journal references `daily_fritz_attempts`.
6. Run `supabase/verified_matches.sql` to persist verified Fritz/Ghost match sessions.
7. Run `supabase/room_match_logs.sql` to persist archived multiplayer room event logs.
8. In `client/.env` (or `.env.local`) set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_ADMIN_EMAIL=you@example.com
```

9. Start the client normally (`npm run dev` in `client/`).
10. In `supabase/daily_puzzle.sql`, replace `admin@example.com` with the same email as `VITE_ADMIN_EMAIL` before running it.

## Social greenfield baseline

`supabase/migrations/2026-05-18_social_greenfield_baseline.sql` installs the
existing `player_presence`, `activity_feed`, and `rivals` schemas that were
previously documented as manual SQL Editor steps under `server/sql/social`.
It must run after `supabase/friends.sql` because the feed and rival read
policies reference accepted friendships.

## Pending Fritz match greenfield baseline

`supabase/migrations/2026-05-12_bot_match_pending_greenfield_baseline.sql`
installs the production-derived `bot_match_pending` table that was previously
created out-of-band. It must run after `supabase/schema.sql`, because its
`user_id` foreign key references `public.profiles(id)`, and before application
traffic can start or resolve Play vs Fritz sessions.

## Ranking greenfield baseline

The Glicko tables were historically created out-of-band. New databases must run
the checked-in ranking files in this order:

1. `supabase/schema.sql`
2. `supabase/migrations/2026-06-16_ranking_greenfield_baseline.sql`
3. `supabase/migrations/2026-06-17_ranked_games_source_idempotency.sql`
4. `supabase/migrations/2026-06-18_ranked_games_source_conflict_target.sql`
5. `supabase/migrations/2026-06-30_commit_glicko_game_update_rpc.sql`

The baseline adds the production `profiles` ranking columns and creates the
production `ranked_games` / `rating_periods` tables, indexes, RLS policies, and
grants. The later files remain responsible for source idempotency, making its
unique index inferable by PostgREST's explicit conflict target, and the atomic
rating-update RPC respectively.

## Daily Fritz transactional-authority upgrade (2026-08-01)

Keep `DAILY_FRITZ_TRANSACTIONAL_COMMANDS=false` while applying these files in this exact order:

1. `supabase/migrations/2026-08-01_daily_fritz_published_challenges.sql`
2. `supabase/migrations/2026-08-01_daily_fritz_command_primitives.sql`
3. `supabase/migrations/2026-08-01_daily_fritz_transactional_commands.sql`
4. `supabase/migrations/2026-08-01_daily_fritz_canonical_telemetry.sql`
5. `supabase/migrations/2026-08-02_daily_fritz_outbox_attempt_scope.sql`

`supabase/verified_matches.sql` must already be installed because transactional
attempt creation links its verified match in the same transaction.

Verify the expansion before enabling writes:

```sql
select
  to_regclass('public.daily_fritz_published_challenges') as published_challenges,
  to_regclass('public.daily_fritz_attempt_operations') as operation_receipts,
  to_regclass('public.daily_fritz_verified_hands') as verified_hands,
  to_regclass('public.daily_fritz_verified_games') as verified_games,
  to_regclass('public.daily_fritz_outbox') as outbox,
  to_regclass('public.daily_fritz_funnel_metrics') as funnel_metrics,
  to_regclass('public.daily_fritz_failure_metrics') as failure_metrics,
  to_regclass('public.daily_fritz_retention_metrics') as retention_metrics;

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'daily_fritz_attempts'
  and column_name in ('revision', 'challenge_id', 'current_game_number')
order by column_name;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'publish_daily_fritz_challenge',
    'invalidate_daily_fritz_challenge',
    'start_daily_fritz_attempt_command',
    'commit_daily_fritz_attempt_command'
  )
order by routine_name;
```

All eight objects, all three columns, and all four routines must be present.
Then set `DAILY_FRITZ_TRANSACTIONAL_COMMANDS=true` on every server instance and
redeploy. `/ready` reports `checks.dailyFritzAuthority.enabled=true` and must
report `available=true` before traffic is considered ready.

Rollback is application-only: set the flag to `false` and redeploy. The schema
is additive and should remain in place; do not drop authority records during a
rollback. Legacy attempts remain available. Challenge-bound modern attempts
fail closed with `authority_temporarily_unavailable` until transactional
authority is re-enabled; they never fall back to legacy writes.

## Daily Fritz migration verification

Run this in the Supabase SQL Editor after the migration:

```sql
select to_regclass('public.daily_fritz_events') as event_table,
       to_regclass('public.daily_fritz_event_metrics') as metrics_view;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'daily_fritz_event_metrics';
```

The first query should return both object names. The metrics view should be
available to `service_role`; it should not be granted to `anon` or
`authenticated`. The server's `/ready` endpoint and the admin
`/api/daily-fritz/metrics` endpoint provide the runtime verification path.

## Notes
- If env vars are missing, the app stays in Guest mode and gameplay still works.
- Auth methods enabled in Supabase should include Email/Password.
- Stats writes are client-side and protected by RLS policies in `schema.sql`.
