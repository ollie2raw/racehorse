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
  it('keeps Daily Puzzle attempt and slot-result uniqueness in the ladder migration', () => {
    const sql = compactSql(readRepoFile('supabase/daily_puzzle_ladder_v1.sql'));

    expect(sql).toContain('constraint daily_puzzle_attempts_puzzle_date_user_id_key unique (puzzle_date, user_id)');
    expect(sql).toContain('constraint daily_puzzle_slot_results_attempt_slot_key unique (attempt_id, slot_index)');
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
});
