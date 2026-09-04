-- RK-0 (HARDENING_PLAN.md §8.1.7 / decisions log): the INSERT policies on
-- ranked_games and rating_periods were named for service_role but never
-- actually scoped to it.
--
-- Root cause, traced to 2026-06-16_ranking_greenfield_baseline.sql:
--   create policy "Service role can insert ranked games"
--     on public.ranked_games for insert to public with check (true);
--   create policy "Service role can insert rating periods"
--     on public.rating_periods for insert to public with check (true);
-- `to public` was a typo for `to service_role` — the policy name asserted
-- service-role-only, the `to` clause said otherwise, so it silently applied
-- to every role, anon included. 2026-08-11_authoritative_ranking_and_bot_pending.sql
-- was written to close table-level access (its own drop/create pass touched
-- these same two policy names) but — per that migration's own history and
-- the 2026-09-01_commit_glicko_rpc_lockdown.sql comment naming the same
-- pattern — never actually reached prod. The result: any anon request with
-- the project's public anon key could POST an arbitrary row into
-- ranked_games (forge a win, inflate any player's rating) or rating_periods,
-- live, until found and fixed.
--
-- This was found live via `select policyname, roles, with_check from
-- pg_policies where tablename in ('ranked_games','rating_periods')` and
-- fixed directly in the Supabase SQL editor on 2026-09-04 (dropped and
-- recreated both policies scoped `to service_role`). This migration is a
-- no-op against current prod state — it exists so schema-as-code matches
-- what is actually live, closing the migration-drift risk RK-0 flagged
-- (a migrations-only project reset would otherwise silently resurrect the
-- wide-open policy).
--
-- Scoped to exactly the two INSERT policies RK-0 found broken. Does not
-- touch the "Users can read own ranked/rating games" SELECT policies or the
-- table-level GRANTs (both already tracked separately — §8.1.4 advisory).
--
-- Self-asserting: raises if either policy is not scoped to {service_role}
-- after this runs.

begin;

drop policy if exists "Service role can insert ranked games" on public.ranked_games;
create policy "Service role can insert ranked games"
  on public.ranked_games
  for insert
  to service_role
  with check (true);

drop policy if exists "Service role can insert rating periods" on public.rating_periods;
create policy "Service role can insert rating periods"
  on public.rating_periods
  for insert
  to service_role
  with check (true);

do $$
declare
  bad_scope int;
begin
  select count(*) into bad_scope
    from pg_policies
   where schemaname = 'public'
     and tablename in ('ranked_games', 'rating_periods')
     and policyname in ('Service role can insert ranked games', 'Service role can insert rating periods')
     and (roles <> array['service_role']::name[] or cmd <> 'INSERT');

  if bad_scope > 0 then
    raise exception 'lockdown failed: ranked_games/rating_periods insert policy still not scoped to service_role-only INSERT';
  end if;

  raise notice 'ranked_games/rating_periods: insert policies confirmed scoped to service_role';
end $$;

commit;
