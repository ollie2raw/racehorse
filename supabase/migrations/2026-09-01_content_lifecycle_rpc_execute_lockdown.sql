-- Restrict EXECUTE on the four admin-only content-lifecycle RPCs to
-- service_role. These publish/close/invalidate Daily Fritz challenges and
-- Gauntlet days; none is called by client code (only the app server via the
-- service-role key, or scheduled jobs running as the table owner).
--
--   publish_daily_fritz_challenge(...)   -- publishes a Daily Fritz challenge
--   invalidate_daily_fritz_challenge(...)-- invalidates a published day
--   gauntlet_publish_day(...)            -- publishes a Gauntlet day
--   gauntlet_close_day(...)              -- closes a Gauntlet day
--
-- Findings (2026-09-01 RPC EXECUTE-grant sweep, see HARDENING_PLAN.md):
--
--   * publish_daily_fritz_challenge / invalidate_daily_fritz_challenge:
--     CONFIRMED anon-executable in prod. 2026-08-01_daily_fritz_published_challenges.sql
--     revoked EXECUTE from `public` and `authenticated` only — it omitted
--     `anon`, and Supabase grants EXECUTE on new public functions to `anon`
--     explicitly, so `revoke ... from public` did not remove it. A live,
--     real gap in a shipped feature: an anonymous request could publish or
--     invalidate a Daily Fritz day out of schedule. Neither function has any
--     body-internal auth check — protection is grant-only.
--
--   * gauntlet_publish_day / gauntlet_close_day: SECURITY DEFINER, client
--     -executable, no lockdown migration ever written. Gauntlet mode is
--     scrapped / in-progress — not shipped, no multiplayer connection — so
--     this fix is preventive, not a live exposure.
--
-- This migration SUPERSEDES / CORRECTS the anon-inclusion gap in
-- 2026-08-01_daily_fritz_published_challenges.sql (its revoke/grant lines for
-- these two functions are now redundant with, and corrected by, this file).
--
-- Both fixes are ALREADY LIVE IN PROD — applied by hand in the SQL editor on
-- 2026-09-01 and verified (has_function_privilege: anon=false,
-- authenticated=false, service_role=true for all four). This migration brings
-- the repo in sync with prod; it does not need to be applied again (and is
-- idempotent if it is).
--
-- Self-asserting: raises if any of the four still grants EXECUTE to a client
-- role after the revoke/grant.

begin;

revoke all on function public.publish_daily_fritz_challenge(
  text, date, integer, integer, integer, integer, integer, integer,
  integer, integer, text, integer, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.publish_daily_fritz_challenge(
  text, date, integer, integer, integer, integer, integer, integer,
  integer, integer, text, integer, text, text, jsonb, timestamptz
) to service_role;

revoke all on function public.invalidate_daily_fritz_challenge(date, text)
  from public, anon, authenticated;
grant execute on function public.invalidate_daily_fritz_challenge(date, text)
  to service_role;

revoke all on function public.gauntlet_publish_day(date, text, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.gauntlet_publish_day(date, text, jsonb, jsonb, timestamptz)
  to service_role;

revoke all on function public.gauntlet_close_day(date)
  from public, anon, authenticated;
grant execute on function public.gauntlet_close_day(date)
  to service_role;

do $$
declare
  fn      regprocedure;
  targets regprocedure[] := array[
    'public.publish_daily_fritz_challenge(text, date, integer, integer, integer, integer, integer, integer, integer, integer, text, integer, text, text, jsonb, timestamptz)',
    'public.invalidate_daily_fritz_challenge(date, text)',
    'public.gauntlet_publish_day(date, text, jsonb, jsonb, timestamptz)',
    'public.gauntlet_close_day(date)'
  ]::regprocedure[];
begin
  foreach fn in array targets
  loop
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'lockdown failed: % still EXECUTE-able by a client role', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'lockdown failed: service_role lost EXECUTE on %', fn;
    end if;
  end loop;

  raise notice 'content-lifecycle RPC EXECUTE restricted to service_role on all 4 functions';
end $$;

commit;
