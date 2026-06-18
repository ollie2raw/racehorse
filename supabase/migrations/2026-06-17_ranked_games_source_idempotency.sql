-- Ranked games idempotency: one row per (player, source match).
-- Requires RANKED_GAMES_SOURCE_COLUMNS_ENABLED=true on the server.

alter table public.ranked_games
  add column if not exists source_type text null,
  add column if not exists source_match_id text null;

comment on column public.ranked_games.source_type is
  'live_room | verified_single_player | local_fritz_abandon | scheduled_tournament';
comment on column public.ranked_games.source_match_id is
  'Stable idempotency key: room.matchId, verified match id, etc.';

create unique index if not exists ranked_games_player_source_match_uidx
  on public.ranked_games (player_id, source_match_id)
  where source_match_id is not null;
