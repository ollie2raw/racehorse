import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('multiplayer fleet telemetry schema', () => {
  it('provides durable idempotent events and latency percentiles', () => {
    const sql = fs.readFileSync(
      path.resolve(process.cwd(), '../supabase/migrations/2026-08-07_multiplayer_operational_events.sql'),
      'utf8',
    ).toLowerCase();
    expect(sql).toContain('create table if not exists public.multiplayer_operational_events');
    expect(sql).toContain('idempotency_key text not null unique');
    expect(sql).toContain('percentile_cont(0.95)');
    expect(sql).toContain('create or replace view public.multiplayer_operational_metrics');
  });
});
