-- Minimal Supabase stand-in for a throwaway local pg16 database.
--
-- The tournament migration chain references auth.users, auth.uid(), and the
-- anon / authenticated / service_role roles. Supabase provisions these; a
-- vanilla pg16 cluster does not. This is the smallest shim that lets the
-- chain apply and exercises the RLS + FOR UPDATE behaviour we care about.
-- It is NOT a faithful Supabase reproduction.

create extension if not exists pgcrypto;

-- Roles (no login — they only exist so GRANT / policy TO clauses resolve).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;

-- auth schema + a stub users table (only `id` is referenced by FKs).
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
grant usage on schema auth to anon, authenticated, service_role;

-- auth.uid() — Supabase reads the JWT `sub` claim from a GUC. Here it reads a
-- plain session GUC so the FOR UPDATE test can impersonate a user with
--   set local request.jwt.claim.sub = '<uuid>';
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- auth.role() — Supabase reads the JWT `role` claim. Here it reads a plain
-- session GUC so a test can impersonate a role with
--   set local request.jwt.claim.role = 'anon';
create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;
