-- Guardrail #6 (ENGINEERING_GUARDRAILS.md) — account-deletion cascade
-- completeness.
--
-- SA-6 (HARDENING_PLAN.md §11.1.5 / D-20) was `bot_match_pending`'s `user_id`
-- foreign key referencing `public.profiles(id)` with no `ON DELETE` action at
-- all (defaulting to `RESTRICT`), while every other player-owned table in the
-- schema correctly cascades from `auth.users`. `DELETE /api/account` 500'd
-- with a raw Postgres `23503` for any user with an unresolved
-- `bot_match_pending` row — found only because a human traced the account
-- deletion flow by hand. This RPC is what lets that same check (every
-- ownership-shaped FK to `profiles`/`auth.users` actually cascades) run
-- unattended in CI, the same way list_rls_policy_manifest() does for RLS.
--
-- Read-only. Returns one row per foreign-key constraint on a `public` schema
-- table whose referenced table is `public.profiles` or `auth.users`:
--   schemaname / tablename  — the owning (referencing) table
--   constraint_name         — pg_constraint.conname
--   column_names            — the constrained column(s), FK-definition order
--   referenced_table        — 'public.profiles' or 'auth.users'
--   referenced_columns      — the referenced column(s) (expected: {id})
--   confdeltype             — pg_constraint's raw delete-action code:
--                             'c' = CASCADE, 'r' = RESTRICT, 'n' = SET NULL,
--                             'd' = SET DEFAULT, 'a' = NO ACTION
-- `pg_constraint` is a system catalog PostgREST cannot reach directly — same
-- reason list_rls_policy_manifest() exists for pg_policies.
--
-- SECURITY DEFINER + pinned search_path + service_role-only EXECUTE, same
-- posture as list_rls_policy_manifest() and assert_security_posture().

create or replace function public.list_cascade_delete_manifest()
returns table (
  schemaname text,
  tablename text,
  constraint_name text,
  column_names text[],
  referenced_table text,
  referenced_columns text[],
  confdeltype text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    n.nspname as schemaname,
    c.relname as tablename,
    con.conname as constraint_name,
    (
      select array_agg(att.attname order by u.ord)
        from unnest(con.conkey) with ordinality as u(attnum, ord)
        join pg_attribute att
          on att.attrelid = con.conrelid and att.attnum = u.attnum
    ) as column_names,
    (rn.nspname || '.' || rc.relname) as referenced_table,
    (
      select array_agg(att.attname order by u.ord)
        from unnest(con.confkey) with ordinality as u(attnum, ord)
        join pg_attribute att
          on att.attrelid = con.confrelid and att.attnum = u.attnum
    ) as referenced_columns,
    con.confdeltype::text as confdeltype
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class rc on rc.oid = con.confrelid
    join pg_namespace rn on rn.oid = rc.relnamespace
   where con.contype = 'f'
     and n.nspname = 'public'
     and (
       (rn.nspname = 'public' and rc.relname = 'profiles')
       or (rn.nspname = 'auth' and rc.relname = 'users')
     )
   order by c.relname, con.conname;
$$;

revoke execute on function public.list_cascade_delete_manifest() from public, anon, authenticated;
grant  execute on function public.list_cascade_delete_manifest() to service_role;

do $$
declare
  bad_grant int;
begin
  select count(*) into bad_grant
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join lateral aclexplode(p.proacl) a on true
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public' and p.proname = 'list_cascade_delete_manifest'
     and r.rolname in ('anon', 'authenticated', 'public')
     and a.privilege_type = 'EXECUTE';

  if bad_grant > 0 then
    raise exception 'lockdown failed: EXECUTE still granted to a client role on list_cascade_delete_manifest';
  end if;

  raise notice 'list_cascade_delete_manifest: created, EXECUTE restricted to service_role';
end $$;
