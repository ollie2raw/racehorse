-- Records how a rated match actually ended, for matches the scoreboard does
-- not decide. A forfeit is a loss for the player who quit even when they were
-- ahead on points; without this column the deferred rating-period path
-- recomputes the Glicko win/loss term from player_score vs opponent_score and
-- credits the quitter with a win.
--
-- Requires RANKED_GAMES_OUTCOME_COLUMN_ENABLED=true on the server.
-- Null means "decide from the scores", which is correct for every match played
-- to its natural conclusion and for all rows written before this shipped.

alter table public.ranked_games
  add column if not exists outcome text null;

alter table public.ranked_games
  drop constraint if exists ranked_games_outcome_check;

alter table public.ranked_games
  add constraint ranked_games_outcome_check
  check (outcome is null or outcome in ('win', 'loss', 'draw'));

comment on column public.ranked_games.outcome is
  'win | loss | draw from player_id''s point of view. Authoritative when set; overrides the score comparison. Null = derive from scores.';
