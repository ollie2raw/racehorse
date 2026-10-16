-- EXPAND (additive; metadata-only DDL; BRIDGE- and NEW-compatible). Ranked rating-processing state is monotonic.
--
-- State model of public.ranked_games (the only writer of the applied fields is
-- commit_glicko_game_update, one transaction, row locked FOR UPDATE):
--   pending : rating_after, rd_after, delta all NULL     (inserted by the app; swept by catch-up)
--   applied : rating_after, rd_after, delta all NOT NULL (set exactly once by the RPC, together
--             with the profile CAS and the single rating_periods receipt)
-- There is no persisted "claimed" state: a claim is the RPC's row lock, released at commit.
--
-- Defect (reproduced against real PostgreSQL): the table accepted
--   * half-set results (rating_after without delta, delta without rating_after), and
--   * `update ... set rating_after = null` on an applied game.
-- The profile CAS stopped a second rating, but the reverted row looked pending forever: the
-- catch-up sweep failed on it every cadence and admit_ranked_rating_context raised
-- ranked_predecessor_pending for every later game of that player (a poison predecessor).
--
-- Historical rows: the app reads `rd_after ?? 350`, so legacy rows may be half-set. The CHECK is
-- NOT VALID (enforced for every new or updated row, never scanned, never rewritten) and is
-- deliberately not validated here. NULL legacy rows (no rating_context) are untouched.
begin;
set local lock_timeout = '5s';

do $$
declare n bigint;
begin
  select count(*) into n from public.ranked_games
   where not ((rating_after is null and rd_after is null and delta is null)
           or (rating_after is not null and rd_after is not null and delta is not null));
  raise notice 'ranked_games rows with half-set applied fields (left as-is, not validated): %', n;
end $$;

alter table public.ranked_games drop constraint if exists ranked_games_applied_fields_coupled;
alter table public.ranked_games add constraint ranked_games_applied_fields_coupled check (
  (rating_after is null and rd_after is null and delta is null)
  or (rating_after is not null and rd_after is not null and delta is not null)
) not valid;

create or replace function public.keep_ranked_applied_state_monotonic()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (old.rating_after is not null and new.rating_after is null)
     or (old.rd_after is not null and new.rd_after is null)
     or (old.delta is not null and new.delta is null) then
    raise exception 'ranked_applied_state_monotonic: game % is applied and cannot return to pending', old.id
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.keep_ranked_applied_state_monotonic() from public, anon, authenticated;

drop trigger if exists ranked_applied_state_monotonic on public.ranked_games;
create trigger ranked_applied_state_monotonic before update on public.ranked_games
  for each row execute function public.keep_ranked_applied_state_monotonic();

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.ranked_games'::regclass
                   and tgname = 'ranked_applied_state_monotonic' and not tgisinternal) then
    raise exception 'ranked applied-state trigger not installed';
  end if;
end $$;
commit;
