-- Support the public Social feed's newest-first query across all players.
create index if not exists idx_activity_feed_created_at
  on public.activity_feed (created_at desc);
