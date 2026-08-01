# Supabase Setup (Fast Path v1)

1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase/schema.sql`.
3. Run `supabase/daily_puzzle.sql` to add Daily Puzzle tables/policies.
4. Run `supabase/daily_fritz.sql` and then `supabase/migrations/2026-07-31_daily_fritz_events.sql` to add Daily Fritz attempts and durable operational events.
   The migration must be run after the Daily Fritz base schema because the event journal references `daily_fritz_attempts`.
5. Run `supabase/verified_matches.sql` to persist verified Fritz/Ghost match sessions.
6. Run `supabase/room_match_logs.sql` to persist archived multiplayer room event logs.
7. In `client/.env` (or `.env.local`) set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_ADMIN_EMAIL=you@example.com
```

8. Start the client normally (`npm run dev` in `client/`).
9. In `supabase/daily_puzzle.sql`, replace `admin@example.com` with the same email as `VITE_ADMIN_EMAIL` before running it.

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
