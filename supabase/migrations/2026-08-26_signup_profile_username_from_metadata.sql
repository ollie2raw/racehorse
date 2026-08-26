-- Persist the username submitted at signup.
--
-- Regression: the signup form sends the chosen handle to Supabase as
-- auth.users.raw_user_meta_data, but public.handle_new_user() -- the only writer
-- of the profile row the UI reads back -- always inserted the
-- 'user_<id-prefix>' bootstrap placeholder. The submitted handle was therefore
-- discarded, and the client's isTemporaryUsername() check prompted the player to
-- choose a username they had just chosen.
--
-- The trigger runs inside the auth.users insert, so it must never raise: an
-- invalid, reserved, or already-taken handle falls back to the placeholder
-- rather than aborting signup.

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
  -- namespace, which the app treats as "no handle chosen yet".
  if desired_username !~ '^[a-z0-9_]{3,}$'
    or desired_username like 'user\_%'
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
