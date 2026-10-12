-- Production PREFLIGHT for the moderation migrations. READ-ONLY.
--
-- Run in the production SQL editor before applying anything; keep the output.
-- Every query only reads. P3 creates a function in pg_temp (session-local,
-- gone when the session ends) so existing usernames can be checked against
-- the new policy before it exists; nothing is written to any schema.

-- P0. Record the time you ran this. Paste it into verify.sql (V2).
select now() as preflight_at;

-- P1. Nothing from these migrations exists yet. Expect: all null / 0.
select to_regclass('public.user_reports')                         as user_reports,
       to_regclass('public.user_blocks')                          as user_blocks,
       to_regprocedure('public.username_policy_violation(text)')  as policy_fn,
       to_regprocedure('public.profiles_enforce_username_policy()') as profiles_trigger_fn,
       to_regprocedure('public.friends_refuse_blocked_pair()')    as friends_trigger_fn,
       (select count(*) from pg_trigger
         where not tgisinternal
           and tgname in ('profiles_username_policy', 'friends_refuse_blocked_pair')) as triggers;

-- P2. Targets the migrations depend on exist. Expect: one row, all true.
select to_regclass('public.profiles') is not null as profiles,
       to_regclass('public.friends') is not null as friends,
       to_regclass('auth.users') is not null as auth_users,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'friends'
                  and column_name in ('user_id', 'friend_user_id', 'status')
                group by table_name having count(*) = 3) as friends_columns,
       exists (select 1 from pg_trigger where tgname = 'on_auth_user_created' and not tgisinternal) as signup_trigger;

-- P3. Existing usernames the new policy WOULD reject. Informational only:
-- the migration never changes existing names (the trigger checks a username
-- only when it is set or changed). Review them with the owner afterwards.
create or replace function pg_temp.username_policy_violation(candidate text)
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

select pg_temp.username_policy_violation(username) as violation, count(*)
  from public.profiles
 where pg_temp.username_policy_violation(username) is not null
 group by 1 order by 1;

-- P4. Fingerprint of every existing username, to prove after the migration
-- that none changed. Keep both values.
select count(*) as profiles,
       count(*) filter (where username like 'user\_%') as placeholder_handles,
       md5(string_agg(id::text || ':' || username, ',' order by id)) as usernames_fingerprint
  from public.profiles;

-- P5. Current friend rows (unchanged by the migration; for comparison).
select status, count(*) from public.friends group by status order by status;
