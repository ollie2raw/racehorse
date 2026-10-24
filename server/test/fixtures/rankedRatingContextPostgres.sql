-- Isolated local schema for actual PostgREST write/recovery validation.
-- Never run on an existing application database.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
do $$ begin create role local_authenticator login; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to local_authenticator;
create schema auth;
create table auth.users (id uuid primary key);
create table public.profiles (
  id uuid primary key references auth.users(id), username text,
  glicko_rating double precision not null default 1500,
  glicko_rd double precision not null default 200,
  glicko_vol double precision not null default 0.06,
  glicko_last_period timestamptz, provisional boolean not null default false,
  peak_rating double precision not null default 1600,
  ranked_games_played integer not null default 30
);
create table public.ranked_games (
  id uuid primary key default gen_random_uuid(), player_id uuid not null references auth.users(id),
  opponent_id uuid not null, player_score integer not null, opponent_score integer not null,
  game_type text not null, source_type text, source_match_id text,
  played_at timestamptz not null default now(), rating_before double precision not null,
  rd_before double precision not null, rating_after double precision, rd_after double precision,
  delta double precision, outcome text check (outcome in ('win','loss','draw'))
);
create unique index ranked_games_player_source_match_uidx on public.ranked_games(player_id,source_match_id);
create table public.rating_periods (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  rating_before double precision, rating_after double precision, rd_before double precision,
  rd_after double precision, vol_before double precision, vol_after double precision,
  processed_at timestamptz
);
-- Only to install the prior, already-existing claim RPC in this fresh fixture.
create table public.rating_cutover_gate (id boolean primary key, quiesced boolean not null);
insert into public.rating_cutover_gate values (true,true);
grant usage on schema public to service_role, anon, authenticated;
grant select,insert,update on public.profiles,public.ranked_games,public.rating_periods to service_role;
-- A representative historical row is created before expansion, not backfilled.
insert into auth.users values ('11111111-1111-4111-8111-111111111111');
insert into profiles(id,username) values ('11111111-1111-4111-8111-111111111111','Historical');
insert into ranked_games(id,player_id,opponent_id,player_score,opponent_score,game_type,rating_before,rd_before)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
'00000000-0000-0000-0000-000000000001',60,20,'fritz',1500,200);
