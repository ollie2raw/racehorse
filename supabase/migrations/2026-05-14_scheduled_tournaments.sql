-- Scheduled tournaments: 8-player single-elimination bracket
-- Runs every 30 minutes on a fixed schedule (PST). See TOURNAMENT_README.md.

-- ── Core tables ──────────────────────────────────────────────────────────

create table if not exists public.scheduled_tournaments (
  id uuid primary key default gen_random_uuid(),
  scheduled_start timestamptz not null unique,
  registration_open_at timestamptz not null,
  registration_close_at timestamptz not null,
  status text not null default 'upcoming'
    check (status in ('upcoming','registration_open','in_progress','completed','cancelled')),
  format text not null default '7-tile',
  win_target integer not null default 30,
  max_players integer not null default 8,
  winner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.scheduled_tournament_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.scheduled_tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  registered_at timestamptz not null default now(),
  seed integer,
  status text not null default 'registered'
    check (status in ('registered','withdrawn','eliminated','active','winner')),
  unique (tournament_id, user_id)
);

create table if not exists public.scheduled_tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.scheduled_tournaments(id) on delete cascade,
  round integer not null check (round between 1 and 3),  -- 1=QF, 2=SF, 3=Final
  match_number integer not null,                          -- 1-4 for QF, 1-2 for SF, 1 for Final
  player1_id uuid references auth.users(id) on delete set null,
  player2_id uuid references auth.users(id) on delete set null,
  winner_id uuid references auth.users(id) on delete set null,
  room_code text,
  status text not null default 'waiting'
    check (status in ('waiting','ready','in_progress','completed','bye')),
  started_at timestamptz,
  completed_at timestamptz,
  player1_score integer,
  player2_score integer,
  unique (tournament_id, round, match_number)
);

-- ── Indexes ──────────────────────────────────────────────────────────────

create index if not exists idx_st_status_start on public.scheduled_tournaments(status, scheduled_start);
create index if not exists idx_st_start on public.scheduled_tournaments(scheduled_start);

create index if not exists idx_str_user on public.scheduled_tournament_registrations(user_id, registered_at desc);
create index if not exists idx_str_tournament on public.scheduled_tournament_registrations(tournament_id);

create index if not exists idx_stm_tournament_round on public.scheduled_tournament_matches(tournament_id, round, match_number);
create index if not exists idx_stm_players on public.scheduled_tournament_matches(player1_id, player2_id);
create index if not exists idx_stm_ready on public.scheduled_tournament_matches(tournament_id, status) where status in ('ready','in_progress');

-- ── RLS ──────────────────────────────────────────────────────────────────

alter table public.scheduled_tournaments enable row level security;
alter table public.scheduled_tournament_registrations enable row level security;
alter table public.scheduled_tournament_matches enable row level security;

drop policy if exists "st_select_all" on public.scheduled_tournaments;
create policy "st_select_all" on public.scheduled_tournaments
  for select using (true);

drop policy if exists "str_select_all" on public.scheduled_tournament_registrations;
create policy "str_select_all" on public.scheduled_tournament_registrations
  for select using (true);

drop policy if exists "str_insert_self" on public.scheduled_tournament_registrations;
create policy "str_insert_self" on public.scheduled_tournament_registrations
  for insert with check (auth.uid() = user_id);

drop policy if exists "str_update_self" on public.scheduled_tournament_registrations;
create policy "str_update_self" on public.scheduled_tournament_registrations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "stm_select_all" on public.scheduled_tournament_matches;
create policy "stm_select_all" on public.scheduled_tournament_matches
  for select using (true);

-- All inserts/updates to tournaments + matches happen via the service-role
-- backend; no client-side policy needed for those tables.

-- ── Seed 30 days of slots ────────────────────────────────────────────────
-- Half-hour slots all day in America/Los_Angeles.
-- Idempotent — uses ON CONFLICT DO NOTHING via the unique scheduled_start.

do $$
declare
  d date := (now() at time zone 'America/Los_Angeles')::date;
  end_d date := d + interval '30 days';
  hh integer;
  mm integer;
  slot timestamptz;
begin
  while d < end_d loop
    for hh in 0..23 loop
      foreach mm in array array[0, 30] loop
        slot := (
          d::text || ' ' ||
          lpad(hh::text, 2, '0') || ':' ||
          lpad(mm::text, 2, '0') || ':00'
        )::timestamp at time zone 'America/Los_Angeles';
        insert into public.scheduled_tournaments
          (scheduled_start, registration_open_at, registration_close_at, status)
        values
          (slot, slot - interval '30 minutes', slot - interval '5 minutes', 'upcoming')
        on conflict (scheduled_start) do nothing;
      end loop;
    end loop;
    d := d + 1;
  end loop;
end $$;
