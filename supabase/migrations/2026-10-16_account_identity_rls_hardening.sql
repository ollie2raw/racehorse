-- Account-identity RLS hardening (audit/account-identity-integrity). Idempotent.
--
-- 1. public.friends — recipient could re-point a request at an arbitrary account.
--    friends_update_recipient pins only `friend_user_id = auth.uid()` and `status` in WITH CHECK, and
--    the table-level UPDATE grant let the recipient set ANY column. A recipient M2 holding a pending
--    request from M1 could run `update friends set user_id = <victim>, status = 'accepted'`, which
--    manufactures an accepted friendship victim<->M2 that the victim never agreed to. The
--    activity_feed / rivals "accepted friend" read policies then disclose the victim's rows to M2
--    (cross-account durable read) and the victim's friend list gains an account they did not accept.
--    Fix: the only column the client ever updates is `status`; grant exactly that, and nothing to anon.
revoke all privileges on table public.friends from anon;
revoke update on table public.friends from authenticated;
grant update (status) on table public.friends to authenticated;

-- 2. public.daily_puzzles — admin write policies keyed on the *email claim* of the caller's JWT
--    (`admin@example.com`, a documented stale placeholder). Authority granted by an email string is
--    only as strong as email verification; nothing in the app writes this table as a user (publishing
--    is server-side with the service role, which bypasses RLS). Remove the dormant authority entirely.
do $$ begin
  if to_regclass('public.daily_puzzles') is not null then
    drop policy if exists "daily_puzzles_insert_admin" on public.daily_puzzles;
    drop policy if exists "daily_puzzles_update_admin" on public.daily_puzzles;
    drop policy if exists "daily_puzzles_delete_admin" on public.daily_puzzles;
    revoke insert, update, delete, truncate on table public.daily_puzzles from anon, authenticated;
  end if;
end $$;
