-- Guest play, database half (docs/guest-play-design.md, roadmap 3.12 / G2b).
--
-- A guest is a Supabase anonymous session: a real auth.users row with is_anonymous = true. Guests are recorded like anyone (their games attach to their user
-- id and become the account's when it is upgraded) but are NOT ranked, so the leaderboards must be able to tell them apart. This adds:
--
--   1. profiles.is_guest, backfilled from auth.users.is_anonymous
--   2. handle_new_user() sets it at signup (the same function body as 2026-10-16, plus the one column)
--   3. a trigger on auth.users that flips it when a guest becomes a permanent account (Supabase sets is_anonymous = false once the email is confirmed)
--   4. delete_inactive_guests(): removes guests with no auth activity for N days. It is a DRY RUN unless told otherwise.
--   5. rush_leaderboard_ranked_v1() now leaves guests out (and gives a guest no rank of their own)
--
-- Safe to run more than once. Nothing here deletes anything by itself: step 4 is a function you call. The server works with or without this applied (it
-- falls back to not filtering when the column is missing), so applying it is not a deploy dependency in either order. Do not turn the guest flag on
-- (VITE_ENABLE_GUEST_PLAY) before this is applied.

-- 1. the column ------------------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists is_guest boolean not null default false;

update public.profiles p
   set is_guest = true
  from auth.users u
 where u.id = p.id and u.is_anonymous is true and p.is_guest = false;

create index if not exists profiles_is_guest_idx on public.profiles (is_guest) where is_guest;

-- 2. signup sets it -----------------------------------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback_username text := 'user_' || replace(new.id::text, '-', '');
  desired_username text;
  guest boolean := coalesce(new.is_anonymous, false);
begin
  desired_username := lower(trim(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
    ''
  )));

  if desired_username !~ '^[a-z0-9_]{3,}$'
    or desired_username like 'user\_%'
    or public.username_policy_violation(desired_username) is not null
    or exists (select 1 from public.profiles p where p.username = desired_username)
  then
    desired_username := fallback_username;
  end if;

  begin
    insert into public.profiles (id, username, is_guest)
    values (new.id, desired_username, guest)
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- The handle was claimed between the check and the insert.
      insert into public.profiles (id, username, is_guest)
      values (new.id, fallback_username, guest)
      on conflict (id) do nothing;
  end;

  return new;
end;
$$;

-- 3. upgrade flips it ---------------------------------------------------------------------------------------------------
create or replace function public.sync_profile_is_guest()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_anonymous is distinct from old.is_anonymous then
    update public.profiles set is_guest = coalesce(new.is_anonymous, false) where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_guest_sync on auth.users;
create trigger on_auth_user_guest_sync
  after update of is_anonymous on auth.users
  for each row execute function public.sync_profile_is_guest();

revoke execute on function public.sync_profile_is_guest() from public, anon, authenticated;

-- 4. cleanup of inactive guests -----------------------------------------------------------------------------------------
-- A guest counts as inactive when NOTHING on their auth record is newer than the cutoff: not the account itself, not a sign-in, and not a session refresh
-- (an app that is open refreshes its session at least hourly, so anyone using it shows up there). Only rows where is_anonymous is true AND the profile says
-- is_guest are ever considered, so a permanent account can never be a candidate. Deleting the auth user cascades to every row that references it.
--
--   select public.delete_inactive_guests();                -- how many WOULD be deleted (30 days), changes nothing
--   select public.delete_inactive_guests(30, 500, false);  -- delete up to 500 of them
create or replace function public.delete_inactive_guests(
  p_inactive_days integer default 30,
  p_limit integer default 500,
  p_dry_run boolean default true
) returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_inactive_days, 30), 7));
  v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids
  from (
    select u.id
      from auth.users u
      join public.profiles p on p.id = u.id and p.is_guest
     where u.is_anonymous is true
       and greatest(
             u.created_at,
             coalesce(u.updated_at, u.created_at),
             coalesce(u.last_sign_in_at, u.created_at),
             coalesce((select max(greatest(s.created_at, coalesce(s.refreshed_at, s.created_at), coalesce(s.updated_at, s.created_at)))
                         from auth.sessions s where s.user_id = u.id), u.created_at)
           ) < v_cutoff
     order by u.created_at
     limit greatest(coalesce(p_limit, 500), 1)
  ) candidates;

  if not coalesce(p_dry_run, true) and cardinality(v_ids) > 0 then
    delete from auth.users where id = any (v_ids) and is_anonymous is true;
  end if;
  return cardinality(v_ids);
end;
$$;

revoke execute on function public.delete_inactive_guests(integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.delete_inactive_guests(integer, integer, boolean) to service_role;

-- 5. the Puzzle Rush board leaves guests out ---------------------------------------------------------------------------
-- Same function as 2026-11-02_rush_leaderboard_ranked_v1.sql with one more condition: a run by a guest is not ranked, and a guest asking for their own
-- rank gets none. A run whose user has no profile row is kept (it is not known to be a guest).
create or replace function public.rush_leaderboard_ranked_v1(
  p_limit integer default 50,
  p_offset integer default 0,
  p_user_id uuid default null
) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with best as (
    select distinct on (r.user_id)
      r.id, r.user_id, r.username, r.total_score, r.puzzles_solved, r.ended_at
    from public.rush_runs r
    left join public.profiles p on p.id = r.user_id
    where r.status = 'completed' and coalesce(p.is_guest, false) = false
    order by r.user_id, r.total_score desc, r.puzzles_solved desc, r.ended_at asc nulls last, r.id asc
  ),
  ranked as (
    select
      row_number() over (order by total_score desc, puzzles_solved desc, ended_at asc nulls last, id asc) as rank,
      id, user_id, username, total_score, puzzles_solved, ended_at
    from best
  ),
  page as (
    select * from ranked
    order by rank
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'rank', rank,
        'userId', user_id,
        'username', username,
        'totalScore', total_score,
        'puzzlesSolved', puzzles_solved,
        'runId', id,
        'achievedAt', ended_at
      ) order by rank) from page),
      '[]'::jsonb
    ),
    'totalPlayers', (select count(*) from ranked),
    'self', (
      select jsonb_build_object(
        'rank', rank,
        'userId', user_id,
        'username', username,
        'totalScore', total_score,
        'puzzlesSolved', puzzles_solved,
        'runId', id,
        'achievedAt', ended_at
      )
      from ranked
      where p_user_id is not null and user_id = p_user_id
    )
  );
$$;

revoke execute on function public.rush_leaderboard_ranked_v1(integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.rush_leaderboard_ranked_v1(integer, integer, uuid) to service_role;

-- Rollback (only if needed; the column and the data stay):
-- drop trigger if exists on_auth_user_guest_sync on auth.users;
-- drop function if exists public.sync_profile_is_guest();
-- drop function if exists public.delete_inactive_guests(integer, integer, boolean);
-- (re-apply 2026-10-16_signup_fallback_username_full_uuid.sql to restore handle_new_user, and 2026-11-02_rush_leaderboard_ranked_v1.sql for the Rush function)
