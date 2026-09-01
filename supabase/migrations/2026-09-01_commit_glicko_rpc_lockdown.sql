-- commit_glicko_game_update: pin the SECURITY DEFINER search_path and restrict
-- EXECUTE to service_role.
--
-- Two findings from the 2026-09-01 advisor sweep on this one function:
--   1. SECURITY DEFINER with a mutable search_path — a caller able to create
--      objects on the resolved search_path could shadow public.profiles /
--      ranked_games / rating_periods and have them execute as the definer.
--   2. EXECUTE granted to anon + authenticated. The function takes a target
--      profile id + arbitrary rating values as parameters and writes them
--      straight into profiles / ranked_games / rating_periods with no check
--      that the caller owns that profile — so any anonymous request could
--      rewrite any user's Glicko rating. The only caller is the app server
--      via the service-role key (server/src/ranking/periodService.ts:162);
--      no client code calls it.
--
-- 2026-08-11_authoritative_ranking_and_bot_pending.sql already specified the
-- revoke; it never reached prod (same migration-drift pattern as the RLS
-- tables). Scoped to this one function.
--
-- Tamper check before this ran (2026-09-01): 0 rating_periods with a real
-- rating change for a user with no ranked_games; 0 implausible profile rating
-- values. Theoretically exploitable for ~2 months (since 2026-06-30), no
-- evidence it was exploited.
--
-- Self-asserting: raises if search_path is still mutable or EXECUTE is still
-- held by a client role.

begin;

alter function public.commit_glicko_game_update(
  uuid, double precision, double precision, double precision,
  timestamp with time zone, boolean, double precision, integer,
  uuid, double precision, double precision, double precision, double precision
) set search_path = public, pg_temp;

revoke execute on function public.commit_glicko_game_update(
  uuid, double precision, double precision, double precision,
  timestamp with time zone, boolean, double precision, integer,
  uuid, double precision, double precision, double precision, double precision
) from public, anon, authenticated;

grant execute on function public.commit_glicko_game_update(
  uuid, double precision, double precision, double precision,
  timestamp with time zone, boolean, double precision, integer,
  uuid, double precision, double precision, double precision, double precision
) to service_role;

do $$
declare
  bad_path  int;
  bad_grant int;
begin
  select count(*) into bad_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commit_glicko_game_update'
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
     );

  select count(*) into bad_grant
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join lateral aclexplode(p.proacl) a on true
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public' and p.proname = 'commit_glicko_game_update'
     and r.rolname in ('anon', 'authenticated', 'public')
     and a.privilege_type = 'EXECUTE';

  if bad_path > 0 then
    raise exception 'lockdown failed: search_path still mutable on commit_glicko_game_update';
  end if;
  if bad_grant > 0 then
    raise exception 'lockdown failed: EXECUTE still granted to a client role on commit_glicko_game_update';
  end if;

  raise notice 'commit_glicko_game_update: search_path pinned + EXECUTE restricted to service_role';
end $$;

commit;
