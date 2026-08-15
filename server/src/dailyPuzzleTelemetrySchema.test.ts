import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sqlPath = path.resolve(process.cwd(), '../supabase/migrations/2026-08-06_daily_puzzle_canonical_telemetry.sql');
const taxonomyV2Path = path.resolve(process.cwd(), '../supabase/migrations/2026-08-08_daily_puzzle_telemetry_taxonomy_v2.sql');
const routePath = path.resolve(process.cwd(), 'src/http/routes/dailyPuzzle.ts');
const clientPath = path.resolve(process.cwd(), '../client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx');

describe('Daily Puzzle canonical telemetry guardrails', () => {
  it('defines durable idempotent events and fleet-wide query views', () => {
    const sql = fs.readFileSync(sqlPath, 'utf8').toLowerCase();
    expect(sql).toContain('create table if not exists public.daily_puzzle_events');
    expect(sql).toContain('idempotency_key text not null unique');
    expect(sql).toContain('create or replace view public.daily_puzzle_event_funnel');
    expect(sql).toContain('create or replace view public.daily_puzzle_failure_metrics');
    expect(sql).toContain('daily_puzzle_events_no_client_access');
  });

  it('extends failures and engagement without rewriting the original migration', () => {
    const sql = fs.readFileSync(taxonomyV2Path, 'utf8').toLowerCase();
    expect(sql).toContain("'verification_failed'");
    expect(sql).toContain("'command_conflict'");
    expect(sql).toContain("'retry_requested'");
    expect(sql).toContain("'review_opened'");
    expect(sql).toContain("'leaderboard_opened'");
    expect(sql).toContain('create or replace view public.daily_puzzle_failure_metrics');
  });

  it('instruments authoritative start, slot, completion, and client telemetry paths', () => {
    const source = fs.readFileSync(routePath, 'utf8');
    expect(source).toContain("eventType: replayed ? 'attempt_resumed' : 'attempt_started'");
    expect(source).toContain("eventType: 'slot_submitted'");
    expect(source).toContain("eventType: 'attempt_completed'");
    expect(source).toContain('recordDailyPuzzleFailureBestEffort');
    expect(source).toContain("app.post('/api/daily-puzzle/telemetry'");
  });

  it('emits first-move and share lifecycle events from the scored client flow', () => {
    const source = fs.readFileSync(clientPath, 'utf8');
    expect(source).toContain("eventType: 'first_move'");
    expect(source).toContain("eventType: 'share_requested'");
    expect(source).toContain("eventType: 'share_completed'");
    expect(source).toContain("eventType: 'review_opened'");
    expect(source).toContain("eventType: 'leaderboard_opened'");
  });
});
