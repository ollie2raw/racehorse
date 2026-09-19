-- MP review persistence uses the explicit public mode name requested by the
-- client contract. Preserve existing 'mp' rows while allowing new writes to
-- identify multiplayer reviews unambiguously.
alter table public.game_reviews
  drop constraint if exists game_reviews_mode_check;

alter table public.game_reviews
  add constraint game_reviews_mode_check
  check (mode in ('pvf', 'mp', 'multiplayer'));
