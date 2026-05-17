alter table public.scheduled_tournament_matches
  add column if not exists ready_at timestamptz,
  add column if not exists ready_deadline_at timestamptz,
  add column if not exists player1_joined_at timestamptz,
  add column if not exists player2_joined_at timestamptz,
  add column if not exists winner_source text
    check (winner_source in ('game_over', 'no_show', 'forfeit')),
  add column if not exists status_reason text,
  add column if not exists forfeit_user_id uuid references auth.users(id) on delete set null,
  add column if not exists no_show_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_stm_ready_deadline
  on public.scheduled_tournament_matches(status, ready_deadline_at)
  where status = 'ready';
