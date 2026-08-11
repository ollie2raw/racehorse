import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8');
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').toLowerCase();
}

describe('DB idempotency schema guardrails', () => {
  it('ships the formerly manual social tables in the greenfield ledger', () => {
    const sql = compactSql(readRepoFile(
      'supabase/migrations/2026-05-18_social_greenfield_baseline.sql',
    ));
    expect(sql).toContain('create table if not exists public.player_presence');
    expect(sql).toContain('create table if not exists public.activity_feed');
    expect(sql).toContain('create table if not exists public.rivals');
    expect(sql).toContain('references auth.users(id) on delete cascade');
    expect(sql).toContain('alter table public.activity_feed enable row level security');
    expect(sql).toContain('select 1 from public.friends');
  });

  it('ships the production-derived ranking baseline before ranking upgrades', () => {
    const baseline = compactSql(readRepoFile(
      'supabase/migrations/2026-06-16_ranking_greenfield_baseline.sql',
    ));
    const idempotency = compactSql(readRepoFile(
      'supabase/migrations/2026-06-17_ranked_games_source_idempotency.sql',
    ));
    const atomicUpdate = compactSql(readRepoFile(
      'supabase/migrations/2026-06-30_commit_glicko_game_update_rpc.sql',
    ));

    expect(baseline).toContain('add column if not exists glicko_rating double precision not null default 1500');
    expect(baseline).toContain('create table if not exists public.ranked_games');
    expect(baseline).toContain('constraint ranked_games_game_type_check');
    expect(baseline).toContain('create table if not exists public.rating_periods');
    expect(baseline).toContain('alter table public.ranked_games enable row level security');
    expect(baseline).toContain('alter table public.rating_periods enable row level security');
    expect(baseline).not.toContain('source_match_id');
    expect(baseline).not.toContain('create or replace function public.commit_glicko_game_update');
    expect(idempotency).toContain('add column if not exists source_match_id text null');
    expect(atomicUpdate).toContain('create or replace function public.commit_glicko_game_update');
  });

  it('keeps Daily Puzzle attempt and slot-result uniqueness in the ladder migration', () => {
    const sql = compactSql(readRepoFile('supabase/daily_puzzle_ladder_v1.sql'));

    expect(sql).toContain('constraint daily_puzzle_attempts_puzzle_date_user_id_key unique (puzzle_date, user_id)');
    expect(sql).toContain('constraint daily_puzzle_slot_results_attempt_slot_key unique (attempt_id, slot_index)');
    expect(sql).toContain("array_agg(kcu.column_name::text order by kcu.ordinal_position) = array['puzzle_date', 'puzzle_type']::text[]");
  });

  it('keeps Daily Fritz one-attempt-per-user-per-run uniqueness', () => {
    const sql = compactSql(readRepoFile('supabase/daily_fritz.sql'));

    expect(sql).toContain('create unique index if not exists idx_daily_fritz_attempts_run_user on public.daily_fritz_attempts (run_date, user_id)');
    expect(sql).toContain('create unique index if not exists idx_daily_fritz_events_idempotency on public.daily_fritz_events (idempotency_key)');
    expect(sql).toContain('create or replace view public.daily_fritz_event_metrics with (security_invoker = true) as');
    expect(sql).toContain('security_invoker = true');
    expect(sql).toContain('revoke all on public.daily_fritz_event_metrics from anon, authenticated');
  });

  it('ships the Daily Fritz operational event migration with append-only idempotency', () => {
    const sql = compactSql(readRepoFile('supabase/migrations/2026-07-31_daily_fritz_events.sql'));
    expect(sql).toContain('create table if not exists public.daily_fritz_events');
    expect(sql).toContain('event_type text not null');
    expect(sql).toContain('idempotency_key text not null');
    expect(sql).toContain('alter table public.daily_fritz_events enable row level security');
    expect(sql).toContain('create or replace view public.daily_fritz_event_metrics with (security_invoker = true) as');
    expect(sql).toContain('security_invoker = true');
  });

  it('keeps Ghost and verified single-player completion idempotency keys', () => {
    const ghostSql = compactSql(readRepoFile('supabase/ghost.sql'));
    const verifiedSql = compactSql(readRepoFile('supabase/verified_matches.sql'));

    expect(ghostSql).toContain('add constraint ghost_games_match_id_unique unique (match_id)');
    expect(verifiedSql).toContain('create table if not exists public.verified_single_player_matches ( match_id uuid primary key');
    expect(verifiedSql).toContain('create unique index if not exists idx_verified_single_player_matches_user_local on public.verified_single_player_matches (user_id, local_match_id)');
  });

  it('keeps Fritz Challenge participants, attempts, and hands idempotent', () => {
    const sql = compactSql(readRepoFile('supabase/fritz_challenges.sql'));

    expect(sql).toContain('share_code text not null unique');
    expect(sql).toContain('unique (challenge_id, user_id)');
    expect(sql).toContain('primary key (challenge_id, game_number, hand_index)');
    expect(sql).toContain('for update');
    expect(sql).toContain('and opponent_user_id is null and status = \'open\'');
    expect(sql).toContain('create or replace function public.start_fritz_challenge_attempt');
    expect(sql).toContain('on conflict do nothing');
    expect(sql).toContain('create or replace function public.get_or_create_fritz_challenge_hand');
    expect(sql).toContain('create or replace function public.advance_fritz_challenge_hand');
    expect(sql).toContain('create or replace function public.record_fritz_challenge_game');
    expect(sql.match(/on conflict do nothing/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps scheduled tournament bracket-slot uniqueness', () => {
    const sql = compactSql(readRepoFile('supabase/migrations/2026-05-14_scheduled_tournaments.sql'));

    expect(sql).toContain('unique (tournament_id, round, match_number)');
  });

  it('ships immutable, idempotent Daily Fritz challenge publication', () => {
    const sql = compactSql(readRepoFile(
      'supabase/migrations/2026-08-01_daily_fritz_published_challenges.sql',
    ));
    expect(sql).toContain('create table if not exists public.daily_fritz_published_challenges');
    expect(sql).toContain('unique (run_date, contract_version)');
    expect(sql).toContain('unique (content_digest)');
    expect(sql).toContain('create trigger protect_daily_fritz_published_challenge');
    expect(sql).toContain('daily_fritz_published_challenge_is_immutable');
    expect(sql).toContain('daily_fritz_invalidated_challenge_is_final');
    expect(sql).toContain('daily_fritz_published_challenge_delete_forbidden');
    expect(sql).toContain('create or replace function public.publish_daily_fritz_challenge');
    expect(sql).toContain('on conflict (challenge_id) do nothing');
    expect(sql).toContain('daily_fritz_challenge_identity_conflict');
    expect(sql).toContain('grant execute on function public.publish_daily_fritz_challenge');
    expect(sql).toContain('create or replace function public.invalidate_daily_fritz_challenge');
    expect(sql).toContain('v_invalidated_at timestamptz := now()');
    expect(sql).toContain('grant execute on function public.invalidate_daily_fritz_challenge');
  });

  it('ships Daily Fritz CAS, durable receipts, normalized authority, and outbox primitives', () => {
    const sql = compactSql(readRepoFile(
      'supabase/migrations/2026-08-01_daily_fritz_command_primitives.sql',
    ));
    expect(sql).toContain('add column if not exists revision bigint not null default 0');
    expect(sql).toContain('add column if not exists current_game_number int not null default 1');
    expect(sql).toContain('foreign key (challenge_id) references public.daily_fritz_published_challenges(challenge_id)');
    expect(sql).toContain('create table if not exists public.daily_fritz_attempt_operations');
    expect(sql).toContain('unique (attempt_id, operation_id)');
    expect(sql).toContain('unique (user_id, challenge_id, operation_id)');
    expect(sql).toContain('create table if not exists public.daily_fritz_verified_hands');
    expect(sql).toContain('primary key (attempt_id, game_number, hand_index)');
    expect(sql).toContain('create table if not exists public.daily_fritz_verified_games');
    expect(sql).toContain('primary key (attempt_id, game_number)');
    expect(sql).toContain('create table if not exists public.daily_fritz_outbox');
    expect(sql).toContain('unique (attempt_id, operation_id, event_type)');
    expect(sql).not.toContain('constraint daily_fritz_outbox_operation_event_key constraint');
    expect(sql).toContain('where delivered_at is null');
    expect(sql).toContain('daily_fritz_attempt_operations_no_client_access');
  });

  it('ships transactional Daily Fritz start and mutation commands', () => {
    const sql = compactSql(readRepoFile(
      'supabase/migrations/2026-08-01_daily_fritz_transactional_commands.sql',
    ));
    expect(sql).toContain('create or replace function public.start_daily_fritz_attempt_command');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('for update');
    expect(sql).toContain("'operation_id_reused'");
    expect(sql).toContain('create or replace function public.commit_daily_fritz_attempt_command');
    expect(sql).toContain("'stale_revision'");
    expect(sql).toContain("'command_slot_conflict'");
    expect(sql.indexOf('where id = p_attempt_id and user_id = p_user_id for update'))
      .toBeLessThan(sql.indexOf('where attempt_id = p_attempt_id and operation_id = p_operation_id'));
    expect(sql).toContain('revision = revision + 1');
    expect(sql).toContain('insert into public.daily_fritz_verified_hands');
    expect(sql).toContain('daily_fritz_terminal_hand_receipt_required');
    expect(sql).toContain('insert into public.daily_fritz_verified_games');
    expect(sql).toContain("jsonb_array_length(p_new_result->'games')");
    expect(sql).toContain('update public.verified_single_player_matches');
    expect(sql).toContain('insert into public.daily_fritz_attempt_operations');
    expect(sql).toContain('insert into public.daily_fritz_outbox');
    expect(sql).toContain('grant execute on function public.commit_daily_fritz_attempt_command');
    expect(sql.match(/on conflict \(attempt_id, operation_id, event_type\) do nothing/g)?.length)
      .toBeGreaterThanOrEqual(2);
  });

  it('repairs Daily Fritz outbox idempotency to be player-attempt scoped', () => {
    const sql = compactSql(readRepoFile(
      'supabase/migrations/2026-08-02_daily_fritz_outbox_attempt_scope.sql',
    ));
    expect(sql).toContain('unique (attempt_id, operation_id, event_type)');
    expect(sql).toContain("pg_get_functiondef(routine.oid)");
    expect(sql).toContain("'on conflict (attempt_id, operation_id, event_type) do nothing'");
    expect(sql).toContain("alter table public.daily_fritz_outbox drop constraint");
    expect(sql).toContain("'backfilled', true");
    expect(sql).toContain('on conflict (attempt_id, operation_id, event_type) do nothing');
  });

  it('ships canonical Daily Fritz funnel, failure taxonomy, and outbox projection', () => {
    const sql = compactSql(readRepoFile(
      'supabase/migrations/2026-08-01_daily_fritz_canonical_telemetry.sql',
    ));
    expect(sql).toContain("'mode_impression'");
    expect(sql).toContain("'first_move'");
    expect(sql).toContain("'recovery_succeeded'");
    expect(sql).toContain('create or replace function public.project_daily_fritz_outbox_event');
    expect(sql).toContain("'outbox:' || new.id::text");
    expect(sql).toContain('create or replace view public.daily_fritz_funnel_metrics');
    expect(sql).toContain('create or replace view public.daily_fritz_failure_metrics');
    expect(sql).toContain('create or replace view public.daily_fritz_retention_metrics');
    expect(sql).toContain('next_day_returned_users');
    expect(sql).toContain('seven_day_returned_users');
    expect(sql).toContain('analytics_projected_at');
    expect(sql).toContain('idx_daily_fritz_events_user_retention');
  });
});
