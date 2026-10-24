-- Signup fallback username derived from the FULL auth user id. Idempotent (create or replace).
--
-- handle_new_user() used 'user_' || left(<uuid hex>, 8) as the placeholder handle for a signup with no usable
-- username (OAuth/Apple, invalid or reserved metadata, lost uniqueness race). Two auth users sharing the first 8
-- hex characters of their ids made the second fallback insert hit profiles_username_key INSIDE the
-- on-unique_violation handler, which aborted the auth.users insert: that signup failed outright. The id is a
-- UUID, so the full 32 hex characters are unique per user: the fallback can no longer collide with another
-- fallback, needs no probing or retry, and never trusts client input. Existing profiles are not modified. Human
-- username rules are unchanged (the 'user_' namespace stays reserved for placeholders).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback_username text := 'user_' || replace(new.id::text, '-', '');
  desired_username text;
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
