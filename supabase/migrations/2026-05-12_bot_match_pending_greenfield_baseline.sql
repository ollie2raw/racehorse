-- Greenfield baseline for an out-of-band production object.
--
-- `bot_match_pending` was created manually in production and was therefore
-- absent from the checked-in ledger. This definition was captured from the
-- production PostgreSQL catalog in a read-only transaction on 2026-08-11.

create extension if not exists pgcrypto;

create table if not exists public.bot_match_pending (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  fritz_tier text not null,
  room_code text not null,
  started_at timestamptz not null default now(),
  resolved boolean not null default false,
  constraint bot_match_pending_pkey primary key (id),
  constraint bot_match_pending_user_id_fkey
    foreign key (user_id) references public.profiles(id)
);

create index if not exists bot_match_pending_room_code_resolved_idx
  on public.bot_match_pending using btree (room_code, resolved);

create index if not exists bot_match_pending_user_id_resolved_idx
  on public.bot_match_pending using btree (user_id, resolved);

-- Preserve the production privilege surface exactly. Production currently has
-- RLS disabled and no policies on this table; that exposure is tracked as a
-- separate security decision rather than changed during greenfield parity work.
grant all privileges on table public.bot_match_pending to anon, authenticated, service_role;
