-- NOTE (2026-09-01): this file was NEVER applied to prod (confirmed absent —
-- HARDENING_PLAN MP-G6). Superseded by
-- 2026-09-01_apply_room_command_receipts_and_mp_authority_events.sql, which
-- adds the explicit grants and a self-assert. Kept as the historical record.
--
-- Dedicated game:action idempotency receipts for private/live multiplayer.
-- Complements room_shell.actionReceipts (embedded snapshot) with a queryable
-- table so receipts survive even if shell size is trimmed, and support
-- multi-writer diagnostics. Authoritative server-only writes (service role).

create table if not exists public.room_command_receipts (
  room_code text not null,
  player_seat_id text not null,
  request_id text not null,
  match_id uuid null,
  ack jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (room_code, player_seat_id, request_id)
);

create index if not exists idx_room_command_receipts_expires
  on public.room_command_receipts (expires_at);

create index if not exists idx_room_command_receipts_room_code
  on public.room_command_receipts (room_code);

alter table public.room_command_receipts enable row level security;

drop policy if exists "room_command_receipts_no_client_write" on public.room_command_receipts;
create policy "room_command_receipts_no_client_write"
  on public.room_command_receipts
  for all
  to authenticated
  using (false)
  with check (false);
