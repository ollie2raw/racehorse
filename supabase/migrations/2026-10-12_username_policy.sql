-- Public username policy (App Store Guideline 1.2: filter objectionable
-- content where users create public identity).
--
-- One authoritative check, enforced where usernames are committed:
--   * public.username_policy_violation(text) -> null when allowed, otherwise
--     'reserved' | 'prohibited' | 'syntax'.
--   * BEFORE INSERT / UPDATE OF username trigger on public.profiles. It only
--     looks at a username that is being set or changed, so existing rows (and
--     every other profile write: ratings, peaks, counters) are untouched.
--   * handle_new_user() falls back to the 'user_<id>' placeholder for a denied
--     handle instead of raising, because that trigger runs inside the
--     auth.users insert and must never abort signup (same rule as for a taken
--     handle).
--
-- The client mirrors these lists for immediate feedback
-- (client/src/auth/usernamePolicy.ts); a client test diffs the two so they
-- cannot drift. The client is UX only — this migration is the enforcement.
--
-- Matching is deliberately simple to keep false positives low: exact reserved
-- names, a few reserved prefixes, and substring matches for a short list of
-- unambiguous slurs/profanity. Slurs are also matched with underscores removed
-- (n_a_m_e). No leetspeak or fuzzy matching.
--
-- NOT YET APPLIED TO PRODUCTION. Apply to dev first; production is an owner
-- step after review.

create or replace function public.username_policy_violation(candidate text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  name text := lower(coalesce(candidate, ''));
  squashed text := replace(lower(coalesce(candidate, '')), '_', '');
  term text;
begin
  if name = any (array[
    'admin', 'administrator', 'admins', 'mod', 'mods', 'moderator', 'moderators',
    'support', 'help', 'helpdesk', 'staff', 'team', 'official', 'system', 'sysadmin',
    'root', 'owner', 'developer', 'dev', 'security', 'abuse', 'postmaster', 'webmaster',
    'noreply', 'no_reply', 'racehorse', 'racehorse_support', 'racehorse_team',
    'racehorse_official', 'racehorse_admin', 'playracehorse', 'fritz', 'fritz_bot',
    'fritzbot', 'fritz_ai', 'fritzai', 'fritz_official', 'player', 'guest', 'anonymous',
    'unknown', 'null', 'undefined', 'deleted', 'deleted_user'
  ]) then
    return 'reserved';
  end if;

  foreach term in array array['racehorse', 'admin', 'moderator', 'official'] loop
    if left(name, length(term)) = term then
      return 'reserved';
    end if;
  end loop;

  foreach term in array array[
    'nigger', 'nigga', 'faggot', 'fagot', 'kike', 'tranny', 'retard', 'wetback', 'chink',
    'gook', 'beaner', 'raghead', 'towelhead', 'hitler', 'rapist', 'pedophile', 'paedophile',
    'molester'
  ] loop
    if strpos(squashed, term) > 0 then
      return 'prohibited';
    end if;
  end loop;

  foreach term in array array[
    'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'porn', 'penis', 'vagina', 'pussy',
    'asshole', 'jizz', 'dildo', 'blowjob'
  ] loop
    if strpos(name, term) > 0 then
      return 'prohibited';
    end if;
  end loop;

  -- Existing syntax rule (signup form, rename form, signup trigger).
  if coalesce(candidate, '') !~ '^[a-z0-9_]{3,}$' then
    return 'syntax';
  end if;

  return null;
end;
$$;

comment on function public.username_policy_violation(text) is
  'Null when a public username is allowed; otherwise reserved | prohibited | syntax. Mirrored in client/src/auth/usernamePolicy.ts.';

create or replace function public.profiles_enforce_username_policy()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  violation text;
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;
  violation := public.username_policy_violation(new.username);
  if violation is not null then
    raise exception 'username_not_allowed'
      using errcode = '23514', detail = violation;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_username_policy on public.profiles;
create trigger profiles_username_policy
  before insert or update of username on public.profiles
  for each row execute procedure public.profiles_enforce_username_policy();

-- Same body as 2026-08-26_signup_profile_username_from_metadata.sql, plus the
-- policy check in the fallback condition.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback_username text := 'user_' || left(replace(new.id::text, '-', ''), 8);
  desired_username text;
begin
  desired_username := lower(trim(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
    ''
  )));

  -- Same rules the signup form enforces, plus the reserved placeholder
  -- namespace, which the app treats as "no handle chosen yet", plus the
  -- public username policy.
  if desired_username !~ '^[a-z0-9_]{3,}$'
    or desired_username like 'user\_%'
    or public.username_policy_violation(desired_username) is not null
    or exists (select 1 from public.profiles p where p.username = desired_username)
  then
    desired_username := fallback_username;
  end if;

  begin
    insert into public.profiles (id, username)
    values (new.id, desired_username)
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- The handle was claimed between the check and the insert.
      insert into public.profiles (id, username)
      values (new.id, fallback_username)
      on conflict (id) do nothing;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
