-- Runbook artifact — paste into the Supabase SQL editor against production to
-- confirm the scheduled_tournament_registrations write lockdown (gap T-1,
-- migration 2026-08-30_tournament_registration_rls_lockdown.sql) is actually
-- applied. Each query must return ZERO rows / the expected value.
--
-- This is the manual counterpart to assert_security_posture() — kept because
-- the T-1 lockdown was reviewed and merged but sat unapplied for weeks, and
-- because there is no CI migration runner. Re-run after any migration that
-- touches this table.

-- 1. No client-writable policy survives (expect 0 rows).
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'scheduled_tournament_registrations'
   and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
   and roles && array['anon', 'authenticated', 'public']::name[];

-- 2. No client INSERT/UPDATE/DELETE grant survives (expect 0 rows).
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name   = 'scheduled_tournament_registrations'
   and grantee in ('anon', 'authenticated', 'public')
   and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

-- 3. Row level security is enabled (expect one row: relrowsecurity = true).
select relname, relrowsecurity
  from pg_class
 where oid = 'public.scheduled_tournament_registrations'::regclass;
