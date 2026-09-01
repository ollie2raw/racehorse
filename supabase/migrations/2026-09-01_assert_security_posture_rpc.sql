-- Weekly schema-posture check (see .github/workflows/security-posture.yml).
-- SECURITY DEFINER + service_role-only. Returns a jsonb report; the cron fails
-- the job iff hard_fail_count > 0.
--
-- Structural, no maintained server-only allowlist: a hardcoded list rots
-- silently (new table forgotten -> exposed -> "all clear"). These checks fail
-- loud instead. The one small list (intentional_client_rpcs) suppresses
-- ADVISORY noise only and can never hide a hard fail.
--
-- Context: 2026-09-01 incident — three reviewed lockdown migrations (T-1, the
-- ghost/bot RLS tables, the commit_glicko RPC) had sat unapplied in the repo
-- because there is no CI migration runner. This is the drift detector.

create or replace function public.assert_security_posture()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hard_fails jsonb := '[]'::jsonb;
  advisories jsonb := '[]'::jsonb;
  r record;
  -- SECURITY DEFINER functions confirmed intentionally client-callable.
  -- Empty for now (gauntlet_* / handle_new_user pending review). Suppresses
  -- ADVISORY 2 only — never a hard fail.
  intentional_client_rpcs text[] := array[]::text[];
begin
  -- HARD FAIL 1 — any public table with RLS disabled. Zero exceptions:
  -- public-read tables use `using (true)` policies, they still have RLS on.
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity is false
     order by c.relname
  loop
    hard_fails := hard_fails || jsonb_build_object(
      'check','rls_disabled','object','public.'||r.relname,
      'detail','row level security is not enabled');
  end loop;

  -- HARD FAIL 2 — SECURITY DEFINER function in public with a mutable search_path
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) cfg where cfg like 'search_path=%')
     order by p.proname
  loop
    hard_fails := hard_fails || jsonb_build_object(
      'check','securitydefiner_mutable_search_path',
      'object', format('public.%s(%s)', r.proname, r.args),
      'detail','SECURITY DEFINER function has no pinned search_path');
  end loop;

  -- HARD FAIL 3 — client write grant on a table where RLS is also off (the
  -- directly-exploitable combination; redundant with #1 but explicit).
  for r in
    select g.table_name, string_agg(distinct g.grantee||':'||g.privilege_type, ', ') as grants
      from information_schema.role_table_grants g
      join pg_class c on c.relname = g.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where g.table_schema='public' and g.grantee in ('anon','authenticated','public')
       and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
       and c.relrowsecurity is false
     group by g.table_name
  loop
    hard_fails := hard_fails || jsonb_build_object(
      'check','client_write_grant_rls_off','object','public.'||r.table_name,
      'detail','client roles hold write grants and RLS is off: '||r.grants);
  end loop;

  -- ADVISORY 1 — client write grants on RLS-enabled tables. Safe (RLS policies
  -- gate the writes) but not locked to intent per the 2026-08-11 revoke pattern.
  for r in
    select g.table_name, string_agg(distinct g.grantee||':'||g.privilege_type, ', ') as grants
      from information_schema.role_table_grants g
      join pg_class c on c.relname = g.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where g.table_schema='public' and g.grantee in ('anon','authenticated','public')
       and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
       and c.relrowsecurity is true
     group by g.table_name order by g.table_name
  loop
    advisories := advisories || jsonb_build_object(
      'check','client_write_grant_rls_on','object','public.'||r.table_name,
      'detail','write grants gated only by RLS policies — consider revoking per the 2026-08-11 pattern: '||r.grants);
  end loop;

  -- ADVISORY 2 — SECURITY DEFINER functions executable by a client role.
  -- proacl null => Postgres default EXECUTE-to-PUBLIC still applies.
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname <> all(intentional_client_rpcs)
       and (
         p.proacl is null
         or exists (
           select 1 from aclexplode(p.proacl) a join pg_roles ro on ro.oid = a.grantee
            where ro.rolname in ('anon','authenticated','public') and a.privilege_type='EXECUTE')
       )
     order by p.proname
  loop
    advisories := advisories || jsonb_build_object(
      'check','securitydefiner_client_executable',
      'object', format('public.%s(%s)', r.proname, r.args),
      'detail','client-executable SECURITY DEFINER function — confirm intentional or add to intentional_client_rpcs');
  end loop;

  return jsonb_build_object(
    'checked_at', now(),
    'hard_fail_count', jsonb_array_length(hard_fails),
    'advisory_count',  jsonb_array_length(advisories),
    'hard_fails', hard_fails,
    'advisories', advisories);
end $$;

revoke execute on function public.assert_security_posture() from public, anon, authenticated;
grant  execute on function public.assert_security_posture() to service_role;
