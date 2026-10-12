-- Self-checking test for 2026-10-12_username_policy.sql and
-- 2026-10-12_user_reports_and_blocks.sql. Run against the DEV project only,
-- after applying both migrations:
--
--   psql "$DEV_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/moderation_and_username_policy.sql
--
-- Everything runs in one transaction that is rolled back at the end, so it
-- leaves no rows behind. Any failed expectation raises and aborts the run.

begin;

-- Throwaway accounts. The signup trigger creates their profiles.
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values
  ('a1a1a1a1-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'mt1@racehorse-test.invalid', '{"username":"mt_domino_one"}'),
  ('a2a2a2a2-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'mt2@racehorse-test.invalid', '{"username":"Racehorse_Support"}'),
  ('a3a3a3a3-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'mt3@racehorse-test.invalid', '{"username":"n_i_g_g_e_r"}'),
  ('a4a4a4a4-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'mt4@racehorse-test.invalid', '{"username":"mt_domino_four"}');

do $$
declare u text;
begin
  -- Signup: an allowed handle is kept.
  select username into u from public.profiles where id = 'a1a1a1a1-0000-4000-8000-000000000001';
  if u is distinct from 'mt_domino_one' then raise exception 'signup kept wrong handle: %', u; end if;

  -- Signup: reserved and prohibited handles fall back to the placeholder
  -- instead of aborting the auth.users insert.
  select username into u from public.profiles where id = 'a2a2a2a2-0000-4000-8000-000000000002';
  if u not like 'user\_%' then raise exception 'reserved signup handle not replaced: %', u; end if;
  select username into u from public.profiles where id = 'a3a3a3a3-0000-4000-8000-000000000003';
  if u not like 'user\_%' then raise exception 'prohibited signup handle not replaced: %', u; end if;
end $$;

-- Rename: reserved (case-insensitive), prohibited and malformed names are refused.
do $$
declare bad text;
begin
  foreach bad in array array['admin', 'ADMIN', 'fritz', 'racehorse_team', 'shit_player', 'Bad Name'] loop
    begin
      update public.profiles set username = bad where id = 'a1a1a1a1-0000-4000-8000-000000000001';
      raise exception 'rename to % was allowed', bad;
    exception when check_violation then
      if sqlerrm <> 'username_not_allowed' then raise; end if;
    end;
  end loop;
end $$;

-- Rename: an ordinary new handle is accepted.
update public.profiles set username = 'mt_renamed_ok' where id = 'a1a1a1a1-0000-4000-8000-000000000001';

-- The deployed (pre-5A) client renames by PATCHing its own profile under RLS
-- as the signed-in user. Allowed names still work; denied names are refused
-- by the trigger, not silently stored.
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"a4a4a4a4-0000-4000-8000-000000000004","role":"authenticated"}', true);
  set local role authenticated;
  update public.profiles set username = 'mt_client_rename' where id = 'a4a4a4a4-0000-4000-8000-000000000004';
  if not found then raise exception 'client rename under RLS updated no row'; end if;
  begin
    update public.profiles set username = 'racehorse_help' where id = 'a4a4a4a4-0000-4000-8000-000000000004';
    raise exception 'client rename to a reserved name was allowed';
  exception when check_violation then
    if sqlerrm <> 'username_not_allowed' then raise; end if;
  end;
end $$;
reset role;

-- Stats writes from the existing glicko RPC never touch the username trigger.
update public.profiles set glicko_rating = coalesce(glicko_rating, 1500)
 where id = 'a1a1a1a1-0000-4000-8000-000000000001';

-- Existing rows are unaffected: a legacy name the policy would reject can still
-- receive writes to other columns.
alter table public.profiles disable trigger profiles_username_policy;
update public.profiles set username = 'admin' where id = 'a4a4a4a4-0000-4000-8000-000000000004';
alter table public.profiles enable trigger profiles_username_policy;
update public.profiles set created_at = created_at where id = 'a4a4a4a4-0000-4000-8000-000000000004';
update public.profiles set username = username where id = 'a4a4a4a4-0000-4000-8000-000000000004';

-- Reports.
insert into public.user_reports (reporter_user_id, reported_user_id, category, source)
values ('a1a1a1a1-0000-4000-8000-000000000001', 'a2a2a2a2-0000-4000-8000-000000000002', 'harassment', 'live_match');

-- Same reporter, target and category: the server's ignore-duplicates upsert is a no-op.
insert into public.user_reports (reporter_user_id, reported_user_id, category, source)
values ('a1a1a1a1-0000-4000-8000-000000000001', 'a2a2a2a2-0000-4000-8000-000000000002', 'harassment', 'profile')
on conflict (reporter_user_id, reported_user_id, category) do nothing;

do $$
begin
  if (select count(*) from public.user_reports where reporter_user_id = 'a1a1a1a1-0000-4000-8000-000000000001') <> 1 then
    raise exception 'duplicate report was stored twice';
  end if;

  begin
    insert into public.user_reports (reporter_user_id, reported_user_id, category, source)
    values ('a1a1a1a1-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001', 'other', 'profile');
    raise exception 'self-report was allowed';
  exception when check_violation then null;
  end;

  begin
    insert into public.user_reports (reporter_user_id, reported_user_id, category, source)
    values ('a1a1a1a1-0000-4000-8000-000000000001', 'a2a2a2a2-0000-4000-8000-000000000002', 'free text here', 'profile');
    raise exception 'unknown category was allowed';
  exception when check_violation then null;
  end;
end $$;

-- Blocks.
insert into public.user_blocks (blocker_user_id, blocked_user_id)
values ('a1a1a1a1-0000-4000-8000-000000000001', 'a2a2a2a2-0000-4000-8000-000000000002');

do $$
begin
  begin
    insert into public.user_blocks (blocker_user_id, blocked_user_id)
    values ('a1a1a1a1-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001');
    raise exception 'self-block was allowed';
  exception when check_violation then null;
  end;

  begin
    insert into public.user_blocks (blocker_user_id, blocked_user_id)
    values ('a1a1a1a1-0000-4000-8000-000000000001', 'a2a2a2a2-0000-4000-8000-000000000002');
    raise exception 'duplicate block row was allowed';
  exception when unique_violation then null;
  end;
end $$;

-- Friend requests never cross a block, whichever path writes them: directly
-- as the signed-in client under RLS (how the app sends them), or as the
-- server's service role. An unrelated pair still works.
do $$
begin
  begin
    perform set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-4000-8000-000000000001","role":"authenticated"}', true);
    set local role authenticated;
    insert into public.friends (user_id, friend_user_id, status)
    values ('a1a1a1a1-0000-4000-8000-000000000001', 'a2a2a2a2-0000-4000-8000-000000000002', 'pending');
    raise exception 'client friend request across a block was allowed';
  exception when insufficient_privilege then
    if sqlerrm <> 'friend_request_unavailable' then raise; end if;
  end;
end $$;
reset role;

do $$
begin
  begin
    insert into public.friends (user_id, friend_user_id, status)
    values ('a2a2a2a2-0000-4000-8000-000000000002', 'a1a1a1a1-0000-4000-8000-000000000001', 'pending');
    raise exception 'reverse-direction friend request across a block was allowed';
  exception when insufficient_privilege then
    if sqlerrm <> 'friend_request_unavailable' then raise; end if;
  end;
end $$;

insert into public.friends (user_id, friend_user_id, status)
values ('a1a1a1a1-0000-4000-8000-000000000001', 'a4a4a4a4-0000-4000-8000-000000000004', 'pending');

-- Privacy: server-only tables. RLS on, no client privileges, no policies.
do $$
declare t text; r text; p text;
begin
  foreach t in array array['public.user_reports', 'public.user_blocks'] loop
    if not (select relrowsecurity from pg_class where oid = t::regclass) then
      raise exception '% has RLS disabled', t;
    end if;
    if exists (select 1 from pg_policies where schemaname || '.' || tablename = t) then
      raise exception '% has a policy', t;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(r, t, p) then
          raise exception '% has % on %', r, p, t;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- Account deletion cascades: reports and blocks on either side disappear.
delete from auth.users where id = 'a2a2a2a2-0000-4000-8000-000000000002';

do $$
begin
  if exists (select 1 from public.user_reports where reported_user_id = 'a2a2a2a2-0000-4000-8000-000000000002') then
    raise exception 'reports survived account deletion';
  end if;
  if exists (select 1 from public.user_blocks where blocked_user_id = 'a2a2a2a2-0000-4000-8000-000000000002') then
    raise exception 'blocks survived account deletion';
  end if;
end $$;

select 'moderation_and_username_policy: all checks passed' as result;

rollback;
