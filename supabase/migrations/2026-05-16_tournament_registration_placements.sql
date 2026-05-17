alter table public.scheduled_tournament_registrations
  add column if not exists placement integer;

create index if not exists idx_str_user_completed
  on public.scheduled_tournament_registrations(user_id, placement)
  where placement is not null;
