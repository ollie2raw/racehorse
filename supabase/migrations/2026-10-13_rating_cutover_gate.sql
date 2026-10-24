-- PRE-EXPAND (step 0). Additive and safe for the old server: it creates the one
-- durable row that the bridge server's quiescence gate reads. The gate is a
-- single deployment-wide intent flag, so a process restart cannot reopen
-- legacy rating writers while a cutover is in progress. Apply this and deploy
-- the bridge build BEFORE any expand migration. Nothing here is a rating write.
begin;

create table if not exists public.rating_cutover_gate (
  id boolean primary key default true check (id),
  quiesced boolean not null default false,
  quiesced_at timestamptz null,
  enabled_boot_id text null,
  -- First time the gate was ever closed; never moves afterwards. It anchors
  -- the reconciliation window for in-flight legacy completions.
  first_quiesced_at timestamptz null,
  reason text null,
  -- Stamped by 2026-10-13_ghost_rating_idempotent_completion.sql the first
  -- time it runs. The reconciliation check uses it as the exact cutover boundary.
  ghost_expand_applied_at timestamptz null,
  updated_at timestamptz not null default now()
);

insert into public.rating_cutover_gate (id) values (true) on conflict (id) do nothing;

create or replace function public.touch_rating_cutover_gate()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.quiesced and new.first_quiesced_at is null then
    new.first_quiesced_at := coalesce(new.quiesced_at, now());
  end if;
  return new;
end $$;
drop trigger if exists rating_cutover_gate_touch on public.rating_cutover_gate;
create trigger rating_cutover_gate_touch before update on public.rating_cutover_gate
  for each row execute function public.touch_rating_cutover_gate();

-- Service role only. No policy is created, so anon/authenticated see nothing.
alter table public.rating_cutover_gate enable row level security;
revoke all on public.rating_cutover_gate from public, anon, authenticated;
grant select, update on public.rating_cutover_gate to service_role;

commit;
