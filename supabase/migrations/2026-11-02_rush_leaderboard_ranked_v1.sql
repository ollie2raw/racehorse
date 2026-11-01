-- Puzzle Rush all-time leaderboard, ranked in the database (roadmap 3.7).
--
-- The server used to read the top N completed runs and dedupe to one per player in memory, which cannot page and cannot
-- tell a player their own rank once they are past the first page. This does it where the data is: one best completed run
-- per player, ranked in the same total order the app uses (score desc, puzzles solved desc, earliest finish, run id), then
-- a page of it, the number of ranked players, and optionally one player's own row and rank.
--
-- Safe to run more than once. Nothing here changes data. The server falls back to its own in-memory ranking when this
-- function does not exist, so applying it is not a deploy dependency in either order.
--
-- Same lockdown as the other Rush functions: executable by service_role only (the table itself is deny-all for players).

create or replace function public.rush_leaderboard_ranked_v1(
  p_limit integer default 50,
  p_offset integer default 0,
  p_user_id uuid default null
) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with best as (
    select distinct on (user_id)
      id, user_id, username, total_score, puzzles_solved, ended_at
    from public.rush_runs
    where status = 'completed'
    order by user_id, total_score desc, puzzles_solved desc, ended_at asc nulls last, id asc
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

-- Rollback (only if needed):
-- drop function if exists public.rush_leaderboard_ranked_v1(integer, integer, uuid);
