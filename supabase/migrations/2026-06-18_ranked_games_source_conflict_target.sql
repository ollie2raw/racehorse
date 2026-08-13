-- PostgREST emits ON CONFLICT (player_id, source_match_id) without an index
-- predicate. PostgreSQL cannot infer the earlier partial unique index for that
-- conflict target, so replace it with an equivalent full unique index. NULL
-- source ids remain non-conflicting under PostgreSQL's default NULL semantics.

drop index if exists public.ranked_games_player_source_match_uidx;

create unique index ranked_games_player_source_match_uidx
  on public.ranked_games (player_id, source_match_id);
