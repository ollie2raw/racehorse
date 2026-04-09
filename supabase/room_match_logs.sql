create table if not exists public.room_match_logs (
  match_id uuid primary key,
  room_code text not null,
  status text not null check (status in ('completed', 'abandoned')),
  event_log_version integer not null,
  last_event_sequence integer not null,
  event_count integer not null,
  started_at timestamptz null,
  archived_at timestamptz not null default timezone('utc', now()),
  participant_user_ids uuid[] not null default '{}',
  participants jsonb not null default '[]'::jsonb,
  summary jsonb null,
  state_snapshot jsonb null,
  events jsonb not null default '[]'::jsonb
);

create index if not exists idx_room_match_logs_room_code_archived
  on public.room_match_logs (room_code, archived_at desc);

create index if not exists idx_room_match_logs_participant_user_ids
  on public.room_match_logs using gin (participant_user_ids);

alter table public.room_match_logs enable row level security;

drop policy if exists "room_match_logs_select_own" on public.room_match_logs;
create policy "room_match_logs_select_own"
  on public.room_match_logs
  for select
  using (auth.uid() = any(participant_user_ids));

drop policy if exists "room_match_logs_no_client_write" on public.room_match_logs;
create policy "room_match_logs_no_client_write"
  on public.room_match_logs
  for all
  using (false)
  with check (false);
