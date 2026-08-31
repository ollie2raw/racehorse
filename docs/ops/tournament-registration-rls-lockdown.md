# Tournament registration RLS lockdown — run book

Migration: `supabase/migrations/2026-08-30_tournament_registration_rls_lockdown.sql`

Applied by hand in the Supabase SQL editor. There is no CLI, no `supabase db
push`, and no CI step that applies migrations in this repo — a file existing
here means nothing about production state.

## Why the first attempt failed

The original file dropped policies by hardcoded name (`str_insert_self`,
`str_update_self`) — the names in
`2026-05-14_scheduled_tournaments.sql`. Production was built by hand with
different names, so `drop policy if exists` matched nothing, returned success,
and changed nothing.

**Rule: never drop a policy by name.** Select by table + command + roles.

## Step 1 — diagnose (run first, keep the output)

```sql
-- 1a. Exact policy definitions, including roles and both predicates.
--     `roles` = {public} means the policy has no TO clause and therefore
--     applies to anon and authenticated, whatever the policy is named.
select policyname, cmd, permissive, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'scheduled_tournament_registrations'
 order by cmd, policyname;

-- 1b. Is RLS actually on? Policies are inert when it is not.
select relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
  from pg_class
 where oid = 'public.scheduled_tournament_registrations'::regclass;

-- 1c. Table privileges. RLS filters rows; it does not grant.
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name   = 'scheduled_tournament_registrations'
   and grantee in ('anon', 'authenticated', 'public')
 order by grantee, privilege_type;

-- 1d. Column-level grants, which do not show up in 1c.
select grantee, column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name   = 'scheduled_tournament_registrations'
   and grantee in ('anon', 'authenticated', 'public')
   and privilege_type in ('INSERT', 'UPDATE')
 order by grantee, column_name;
```

## Step 2 — apply

Paste the whole migration file. It runs in a transaction and raises on any
surviving client-writable policy or grant, so a silent no-op is impossible.

## Step 3 — verify

Re-run **1a, 1b and 1c**. Expected end state:

- 1a: no row with `cmd` in (`INSERT`, `UPDATE`, `DELETE`, `ALL`) whose `roles`
  contains `anon`, `authenticated`, or `public`. The only write policy is
  `str_service_role_manage`, `roles = {service_role}`. Any SELECT policy is
  untouched.
- 1b: `rls_enabled = true`.
- 1c: no `INSERT` / `UPDATE` / `DELETE` row for `anon` or `authenticated`.

## Why "no UPDATE policy in the list" is not proof the update vector is closed

Three ways a client can still update with no row whose `cmd` is `UPDATE`:

1. **A `cmd = ALL` policy.** `ALL` covers UPDATE. A policy created without a
   `TO` clause defaults to `TO public` — so one named "Service role can manage
   all registrations" can in fact be granting every authenticated user full
   write access. Read the `roles` column, not the name.
2. **RLS disabled.** With `relrowsecurity = false` no policy is enforced and
   table grants alone decide. An empty policy list plus RLS off is the most
   permissive state there is, not the most locked down.
3. **Grants without policies.** Policies filter; grants permit. A leftover
   `GRANT UPDATE` means the next permissive policy anyone adds reopens the
   vector with no further change.

Check all three before calling it closed.
