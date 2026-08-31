-- Lock down client writes to scheduled_tournament_registrations.
--
-- Supersedes an earlier version of this file that did:
--
--   drop policy if exists "str_insert_self"  on ...;
--   drop policy if exists "str_update_self"  on ...;
--
-- Those are the names created by 2026-05-14_scheduled_tournaments.sql, but
-- production was built by hand and carries different names ("Users can insert
-- own registrations", etc). `drop policy if exists` matched nothing and
-- silently succeeded, so the migration reported success while changing
-- nothing. Never drop a policy by hardcoded name.
--
-- This version selects policies by what they DO (table + command + the roles
-- they apply to), so it is correct under any naming, on production and on a
-- greenfield database built from the checked-in migrations alike. It ends with
-- an assertion that raises if any client-writable policy survives, so a no-op
-- can never again read as a success.
--
-- Why writes must not be client-reachable: every column on this table is
-- server-authored. `seed` is assigned when the bracket is generated, `status`
-- tracks elimination, and `placement` is written only by
-- persistTournamentPlacements() when a tournament completes. The browser holds
-- an anon-key Supabase client with the user's own JWT, so any INSERT/UPDATE
-- policy scoped to `authenticated` is a path to self-assigned placements
-- (read back verbatim by /api/tournaments/history and
-- /api/tournaments/:id/result) or a self-assigned seed (which decides the
-- double-no-show tiebreak in selectHigherSeedWinner).
--
-- Registration and withdrawal run server-side via insertRegistration /
-- withdrawRegistration in server/src/scheduledTournament/persistence.ts using
-- SUPABASE_SERVICE_KEY. service_role holds BYPASSRLS, so it needs no policy of
-- its own and is unaffected by everything below. No client code references
-- this table directly.
--
-- SELECT is deliberately left alone. Narrowing reads is a separate decision
-- with its own blast radius; this migration closes the write vector only.

begin;

-- 1 ── Drop every policy on this table that can admit a client write.
--
-- Matches on cmd + roles rather than name. cmd 'ALL' is included on purpose: a
-- policy created without a `TO` clause defaults to `TO public`, which covers
-- anon and authenticated for INSERT/UPDATE/DELETE even when it is named as
-- though it were service-role only.

do $$
declare
  pol record;
  dropped integer := 0;
begin
  for pol in
    select policyname, cmd, roles
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'scheduled_tournament_registrations'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and roles && array['anon', 'authenticated', 'public']::name[]
  loop
    raise notice 'dropping client-writable policy % (cmd=%, roles=%)',
      pol.policyname, pol.cmd, pol.roles;
    execute format(
      'drop policy %I on public.scheduled_tournament_registrations',
      pol.policyname
    );
    dropped := dropped + 1;
  end loop;

  raise notice 'dropped % client-writable policy(ies)', dropped;
end $$;

-- 2 ── Remove the underlying table privileges as well.
--
-- RLS filters rows; it does not grant. A policy is only half the door — if
-- anon/authenticated hold an UPDATE grant, any future permissive policy
-- (including one added by a later hand-run migration) reopens the vector
-- immediately. Revoking the grant closes it at the privilege layer too.

revoke insert, update, delete
  on public.scheduled_tournament_registrations
  from anon, authenticated;

-- 3 ── RLS must actually be on, or policies are inert.

alter table public.scheduled_tournament_registrations enable row level security;

-- 4 ── Re-declare the service-role path explicitly.
--
-- Not required (service_role bypasses RLS) but it documents intent, and it
-- restores an equivalent of a "Service role can manage all" policy if step 1
-- dropped one that was mis-scoped to `public`.

drop policy if exists "str_service_role_manage" on public.scheduled_tournament_registrations;
create policy "str_service_role_manage"
  on public.scheduled_tournament_registrations
  for all
  to service_role
  using (true)
  with check (true);

-- 5 ── Assert the end state. Raises and rolls back the whole transaction if
-- anything client-writable survived, so this file cannot silently no-op.

do $$
declare
  leftover_policies integer;
  leftover_grants   integer;
  rls_on            boolean;
begin
  select count(*) into leftover_policies
    from pg_policies
   where schemaname = 'public'
     and tablename  = 'scheduled_tournament_registrations'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and roles && array['anon', 'authenticated', 'public']::name[];

  select count(*) into leftover_grants
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name   = 'scheduled_tournament_registrations'
     and grantee in ('anon', 'authenticated', 'public')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  select relrowsecurity into rls_on
    from pg_class
   where oid = 'public.scheduled_tournament_registrations'::regclass;

  if leftover_policies > 0 then
    raise exception
      'lockdown failed: % client-writable policy(ies) still present', leftover_policies;
  end if;

  if leftover_grants > 0 then
    raise exception
      'lockdown failed: % client write grant(s) still present', leftover_grants;
  end if;

  if not rls_on then
    raise exception 'lockdown failed: row level security is not enabled';
  end if;

  raise notice 'lockdown verified: no client-writable policies or grants remain';
end $$;

commit;
