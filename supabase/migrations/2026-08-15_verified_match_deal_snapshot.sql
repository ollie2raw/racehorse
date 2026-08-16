-- Server-owned deal/seed for ranked Play vs Fritz (and ranked Ghost).
-- Ranked complete must replay from this snapshot; it must not trust a client-invented hand.

alter table public.verified_single_player_matches
  add column if not exists deal_snapshot jsonb;

comment on column public.verified_single_player_matches.deal_snapshot is
  'Server-owned ranked deal/seed. Glicko writes are forbidden unless this snapshot is present and the submitted move sequence replays to an exact engine result.';
