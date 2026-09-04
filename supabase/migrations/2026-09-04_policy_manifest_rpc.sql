-- Guardrail #1 (ENGINEERING_GUARDRAILS.md) — RLS/policy assertions.
--
-- RK-0 (HARDENING_PLAN.md §8.1.7 / decisions log) was a policy named
-- "Service role can insert ranked games" that was actually scoped `to
-- public` — RLS enabled, a policy present, everything assert_security_posture()
-- checks for was green, and it was STILL a live, unauthenticated,
-- zero-skill exploit. That function deliberately treats "RLS enabled +
-- client write grant" as advisory-only, trusting the policy predicates to
-- be doing their job — it never actually inspects them. RK-0 was found only
-- because a human ran a manual `select * from pg_policies` in the SQL
-- editor. This RPC is what lets that same check run unattended in CI.
--
-- Read-only. Returns one row per RLS policy on a `public` schema table:
-- schema/table/policy name, the roles clause, cmd, and the qual/with_check
-- predicates as text (pg_policies already exposes these as human-readable
-- expression text, not raw internal representations).
--
-- SECURITY DEFINER + pinned search_path + service_role-only EXECUTE, same
-- posture as assert_security_posture().

create or replace function public.list_rls_policy_manifest()
returns table (
  schemaname text,
  tablename text,
  policyname text,
  roles text[],
  cmd text,
  qual text,
  with_check text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select p.schemaname, p.tablename, p.policyname, p.roles, p.cmd, p.qual, p.with_check
    from pg_policies p
   where p.schemaname = 'public'
   order by p.tablename, p.policyname;
$$;

revoke execute on function public.list_rls_policy_manifest() from public, anon, authenticated;
grant  execute on function public.list_rls_policy_manifest() to service_role;

do $$
declare
  bad_grant int;
begin
  select count(*) into bad_grant
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join lateral aclexplode(p.proacl) a on true
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public' and p.proname = 'list_rls_policy_manifest'
     and r.rolname in ('anon', 'authenticated', 'public')
     and a.privilege_type = 'EXECUTE';

  if bad_grant > 0 then
    raise exception 'lockdown failed: EXECUTE still granted to a client role on list_rls_policy_manifest';
  end if;

  raise notice 'list_rls_policy_manifest: created, EXECUTE restricted to service_role';
end $$;
