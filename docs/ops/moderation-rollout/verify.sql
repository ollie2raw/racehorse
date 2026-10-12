-- Production VERIFY after applying the moderation migrations. READ-ONLY.
-- Run in the production SQL editor right after the apply step.

-- V1. Function and triggers exist. Expect: one row, all true.
select to_regprocedure('public.username_policy_violation(text)') is not null as policy_fn,
       exists (select 1 from pg_trigger where tgname = 'profiles_username_policy'
                 and tgrelid = 'public.profiles'::regclass and not tgisinternal) as profiles_trigger,
       exists (select 1 from pg_trigger where tgname = 'friends_refuse_blocked_pair'
                 and tgrelid = 'public.friends'::regclass and not tgisinternal) as friends_trigger,
       exists (select 1 from pg_trigger where tgname = 'on_auth_user_created' and not tgisinternal) as signup_trigger;

-- V2. Existing usernames unchanged. Replace the timestamp with preflight P0's
-- value; the fingerprint must equal preflight P4's (rows created since the
-- preflight are excluded, so new signups can't make this fail).
select count(*) as profiles_before_preflight,
       md5(string_agg(id::text || ':' || username, ',' order by id)) as usernames_fingerprint
  from public.profiles
 where created_at <= timestamptz '2026-01-01 00:00:00+00';  -- <- preflight_at

-- V3. Policy behaves. Expect: reserved | prohibited | null | syntax.
select public.username_policy_violation('admin')        as admin,
       public.username_policy_violation('fuckface')     as profanity,
       public.username_policy_violation('domino_king')  as ordinary,
       public.username_policy_violation('Bad Name')     as malformed;

-- V4. New tables exist with RLS on and no policies. Expect two rows:
-- rls = true, policies = 0.
select c.relname, c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('user_reports', 'user_blocks')
 order by c.relname;

-- V5. No client grants on the new tables. Expect: 0 rows.
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('user_reports', 'user_blocks')
   and grantee in ('anon', 'authenticated', 'public');

-- V6. Constraints and indexes. Expect 11 constraints (checks, unique,
-- primary keys, foreign keys) and 6 indexes, as listed in the rollout README.
select conrelid::regclass as table_name, conname, contype
  from pg_constraint
 where conrelid in ('public.user_reports'::regclass, 'public.user_blocks'::regclass)
 order by 1, 2;
select tablename, indexname from pg_indexes
 where schemaname = 'public' and tablename in ('user_reports', 'user_blocks')
 order by 1, 2;

-- V7. Every user FK cascades from auth.users (account deletion removes the
-- rows). Expect four rows, confdeltype = 'c'.
select conrelid::regclass as table_name, conname, confrelid::regclass as references_table, confdeltype
  from pg_constraint
 where contype = 'f'
   and conrelid in ('public.user_reports'::regclass, 'public.user_blocks'::regclass)
 order by 1, 2;

-- V8. Trigger functions are not client-callable. Expect: all false.
select has_function_privilege('anon', 'public.friends_refuse_blocked_pair()', 'execute') as anon_exec,
       has_function_privilege('authenticated', 'public.friends_refuse_blocked_pair()', 'execute') as auth_exec;

-- V9. Security posture: expect hard_fail_count = 0.
select public.assert_security_posture() -> 'hard_fail_count' as hard_fail_count;

-- V10. Friend rows unchanged (compare with preflight P5).
select status, count(*) from public.friends group by status order by status;
