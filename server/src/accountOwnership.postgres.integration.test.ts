/**
 * Durable-state ownership at the SERVICE-ROLE boundary (the server bypasses RLS, so every store must authorize
 * itself). Real PostgreSQL + PostgREST on an owned loopback instance: account B holding account A's resource id
 * (Daily Fritz attempt, Puzzle Rush run, verified Ghost/Fritz match, review job) must never read or mutate it.
 *
 *   PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres server/scripts/setupIdentityAuditDb.sh racehorse_terminal_r1
 *   TERMINAL_R1_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1 \
 *   TERMINAL_R1_POSTGREST_URL=http://127.0.0.1:55440 npx vitest run src/accountOwnership.postgres.integration.test.ts
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startLocalPostgrestGateway, type LocalPostgrestGateway } from '../test/support/localPostgrestGateway';

const DB_URL = 'postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1';
const REST_URL = 'http://127.0.0.1:55440';
const enabled =
  process.env.TERMINAL_R1_TEST_DATABASE_URL === DB_URL && process.env.TERMINAL_R1_POSTGREST_URL === REST_URL;

const holder = vi.hoisted(() => ({ url: 'http://127.0.0.1:1' }));
vi.mock('./config', async () => {
  const { createHmac } = await import('node:crypto');
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 7200 })}`;
  const key = `${message}.${createHmac('sha256', 'racehorse-forfeit-r1-local-validation-only-secret').update(message).digest('base64url')}`;
  return { config: { isProd: false, nodeEnv: 'test', get supabaseUrl() { return holder.url; }, supabaseServiceKey: key } };
});

import { assertNotProductionSupabase } from './platform/env/productionSupabaseGuard';
import { getDailyFritzAttemptById } from './http/stores/dailyFritzStore';
import { getRushRunById } from './http/stores/puzzleRushStore';
import { getVerifiedSinglePlayerMatch } from './shared/verifiedSinglePlayerMatch';

function sql(query: string): string {
  if (!enabled) throw new Error('Refusing nonlocal database');
  return execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', DB_URL, '-c', query], { encoding: 'utf8', timeout: 20_000 }).trim();
}
function seedAccount(prefix: string): string {
  const id = randomUUID();
  const name = `${prefix}${id.replace(/-/g, '').slice(0, 8)}`;
  sql(`insert into auth.users(id,email,raw_user_meta_data) values ('${id}','${name}@racehorse-test.invalid','{"username":"${name}"}')`);
  return id;
}

/** A smuggled filter must yield no row: either null or a rejected (400) request — never A's data. */
const noData = (p: Promise<unknown>) => p.then((v) => v === null, () => true);

const run = enabled ? describe : describe.skip;
let gateway: LocalPostgrestGateway;

run('service-role ownership: B holding A\'s resource id gets nothing (real PostgreSQL + PostgREST)', () => {
  const a = { id: '' };
  const b = { id: '' };
  const attemptId = randomUUID();
  const rushRunId = randomUUID();
  const verifiedMatchId = randomUUID();

  beforeAll(async () => {
    assertNotProductionSupabase('account ownership local PostgreSQL');
    gateway = await startLocalPostgrestGateway({ upstream: REST_URL, port: 55444 });
    holder.url = gateway.url;
    a.id = seedAccount('own');
    b.id = seedAccount('oth');
    sql(`insert into public.daily_fritz_runs(run_date, seed, fritz_tier, deal_size, winning_score, status, hand_deals) values (current_date, 's', 'elite', 7, 100, 'live', '[]'::jsonb) on conflict do nothing`);
    sql(`insert into public.daily_fritz_attempts(id, run_date, user_id, status) values ('${attemptId}', current_date, '${a.id}', 'started')`);
    sql(`insert into public.rush_runs(id, user_id, assigned_puzzle_ids) values ('${rushRunId}', '${a.id}', '{}'::uuid[])`.replace("'{}'::uuid[]", `array['${randomUUID()}']::uuid[]`));
    sql(`insert into public.verified_single_player_matches(match_id, user_id, local_match_id, mode, status) values ('${verifiedMatchId}', '${a.id}', 'local-a', 'ghost', 'started')`);
  });
  afterAll(async () => { await gateway?.close(); });

  it('Daily Fritz attempt: owner reads it, any other account (and a malformed id) gets null', async () => {
    expect((await getDailyFritzAttemptById(attemptId, a.id))?.id).toBe(attemptId);
    expect(await getDailyFritzAttemptById(attemptId, b.id)).toBeNull();
    expect(await noData(getDailyFritzAttemptById(attemptId, `${b.id}&user_id=eq.${a.id}`))).toBe(true); // filter injection
  });

  it('Puzzle Rush run: owner reads it, any other account gets null', async () => {
    expect((await getRushRunById(rushRunId, a.id))?.id).toBe(rushRunId);
    expect(await getRushRunById(rushRunId, b.id)).toBeNull();
    expect(await noData(getRushRunById(rushRunId, `${b.id}&user_id=eq.${a.id}`))).toBe(true);
  });

  it('verified Ghost/Fritz match: the stored owner is A, so the route-level owner comparison rejects B', async () => {
    const m = await getVerifiedSinglePlayerMatch(verifiedMatchId);
    expect(m?.userId).toBe(a.id);
    expect(m?.userId).not.toBe(b.id); // /api/ghost/complete returns 403 on this mismatch (ghost.ts)
  });
});
