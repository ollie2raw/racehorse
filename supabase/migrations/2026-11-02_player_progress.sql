-- Player progress that follows the account (docs/progress-sync.md; roadmap: Journey progress sync).
--
-- Journey progress lived only in the browser's localStorage, so a second device, a cleared cache or a new phone started the trail from nothing. This table keeps a
-- signed-in player's progress on the server so it can follow them. One row per player per scope ("journey" today); `data` is the scope's own shape.
--
-- Progress only ever grows, so two devices merge without loss: the server unions the completed stages of what it already has with what a device sends (it never
-- subtracts), and applies the same rule to its own copy. The merge happens in the server (service role), under optimistic concurrency on `revision`.
--
-- Written and read only by the server: RLS is on and every client operation is denied. Rows go when the account goes (cascade). The server routes answer
-- "not enabled" when PROGRESS_SYNC_ENABLED is not "true", and also when this table does not exist yet, so applying this is safe at any time and the flag
-- should be set only after it is applied. Additive and idempotent; no backfill (nothing was ever stored on the server).

create table if not exists public.player_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope ~ '^[a-z][a-z0-9_]{0,39}$'),

  data jsonb not null check (octet_length(data::text) <= 20000),
  revision integer not null default 1 check (revision >= 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, scope)
);

alter table public.player_progress enable row level security;

drop policy if exists "player_progress_no_client_access" on public.player_progress;
create policy "player_progress_no_client_access"
  on public.player_progress
  for all
  to authenticated
  using (false)
  with check (false);

-- Rollback (nothing else depends on it):
-- drop table if exists public.player_progress;
