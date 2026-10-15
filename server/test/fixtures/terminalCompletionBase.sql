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
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
create schema if not exists extensions;
