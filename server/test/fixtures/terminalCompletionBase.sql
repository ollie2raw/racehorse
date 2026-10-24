-- Isolated local schema stubs for terminal-completion recovery validation.
-- Never run on an existing application database. Applied once to a FRESH database, then the real
-- repository migrations listed in scripts/setupTerminalCompletionTestDb.sh are applied in order.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
do $$ begin create role local_authenticator login noinherit; exception when duplicate_object then null; end $$;
alter role service_role bypassrls;  -- as on Supabase: the service role is not subject to RLS
grant anon, authenticated, service_role to local_authenticator;
create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
-- Reads the verified subject exactly like Supabase's auth.uid(): PostgREST (and the identity RLS suite) set the
-- request.jwt.claims GUC; no claim -> NULL, so anon and service-role sessions have no uid.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
create schema if not exists extensions;
-- Supabase gives anon/authenticated/service_role ALL on every table/sequence/function created in public by default;
-- RLS and the migrations' explicit REVOKEs are then the only barrier. Mirror that so the suite tests the real posture.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
