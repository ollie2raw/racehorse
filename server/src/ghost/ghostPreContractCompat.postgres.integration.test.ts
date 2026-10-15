/**
 * Mixed-version Ghost completion against REAL PostgreSQL + PostgREST (owned loopback instance).
 *
 * Build the database in the PRE-CONTRACT schema first:
 *   PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres TERMINAL_TEST_SCHEMA=pre-contract \
 *     server/scripts/setupTerminalCompletionTestDb.sh racehorse_terminal_r1
 * The suite is ordered: it exercises the pre-contract schema, then APPLIES the Ghost contract
 * migration to the same database and proves the deferred seat drains exactly once. Rebuild the
 * database to run it again. Skipped unless both loopback URLs match exactly.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startLocalPostgrestGateway, type LocalPostgrestGateway } from '../../test/support/localPostgrestGateway';

const DB_URL = 'postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1';
const REST_URL = 'http://127.0.0.1:55440';
const enabled =
  process.env.TERMINAL_R1_TEST_DATABASE_URL === DB_URL && process.env.TERMINAL_R1_POSTGREST_URL === REST_URL;

const holder = vi.hoisted(() => ({ url: 'http://127.0.0.1:1' }));
vi.mock('../config', async () => {
  const { createHmac } = await import('node:crypto');
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 7200 })}`;
  const key = `${message}.${createHmac('sha256', 'racehorse-forfeit-r1-local-validation-only-secret').update(message).digest('base64url')}`;
  return {
    config: {
      isProd: false,
      nodeEnv: 'test',
      get supabaseUrl() { return holder.url; },
      supabaseServiceKey: key,
    },
  };
});

import { assertNotProductionSupabase } from '../platform/env/productionSupabaseGuard';
import { completeGhostGame } from './service';
import {
  drainDeferredGhostCompletions,
  GHOST_DEFERRED_MAX_ATTEMPTS,
  resetDeferredGhostDrainForTests,
} from './deferredGhostCompletion';
import { supabaseFetch } from '../supabaseUtils';

function sql(query: string): string {
  if (!enabled) throw new Error('Refusing nonlocal database');
  return execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', DB_URL, '-c', query], {
    encoding: 'utf8',
    timeout: 20_000,
  }).trim();
}
const sqlFile = (file: string) =>
  execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', DB_URL, '-f', file], { encoding: 'utf8', timeout: 30_000 });

function seedAccount(prefix: string): string {
  const id = randomUUID();
  const name = `${prefix}${id.replace(/-/g, '').slice(0, 8)}`;
  sql(`insert into auth.users(id,email,raw_user_meta_data) values ('${id}','${name}@racehorse-test.invalid','{"username":"${name}"}')`);
  return id;
}
const legacyConstraintPresent = () =>
  Number(sql(`select count(*) from pg_constraint where conname='ghost_games_match_id_unique' and conrelid='public.ghost_games'::regclass`)) === 1;
const ghostRows = (matchId: string) =>
  Number(sql(`select count(*) from public.ghost_games where match_id='${matchId}'`));
const receipts = (matchId: string) =>
  Number(sql(`select count(*) from public.ghost_games where match_id='${matchId}' and rating_applied_at is not null`));
const deferred = (matchId?: string) =>
  Number(sql(`select count(*) from public.ghost_deferred_completions${matchId ? ` where match_id='${matchId}'` : ''}`));
const profileGames = (userId: string) =>
  Number(sql(`select games_played from public.ghost_profiles where user_id='${userId}'`));

const move = { type: 'place' } as never;
const seatArgs = (userId: string, opponentUserId: string, matchId: string, mine: number, theirs: number) => ({
  userId,
  opponentUserId,
  finalScore: mine,
  opponentScore: theirs,
  moveLog: [move, move],
  matchId,
  applyGlicko: true,
});

const run = enabled ? describe : describe.skip;
let gateway: LocalPostgrestGateway;

run('Ghost pre-contract compatibility (real PostgreSQL + PostgREST)', () => {
  const a = { id: '' };
  const b = { id: '' };
  const matchId = randomUUID();

  beforeAll(async () => {
    assertNotProductionSupabase('ghost pre-contract compat local PostgreSQL');
    gateway = await startLocalPostgrestGateway({ upstream: REST_URL, port: 55443 });
    holder.url = gateway.url;
    expect(legacyConstraintPresent()).toBe(true); // this suite must start from the pre-contract schema
    a.id = seedAccount('gca');
    b.id = seedAccount('gcb');
  });
  afterAll(async () => {
    await gateway?.close();
    resetDeferredGhostDrainForTests();
  });

  describe('PRE-CONTRACT (ghost_games_match_id_unique still present)', () => {
    it('two authenticated human seats: seat A completes, seat B is durably deferred, nothing throws', async () => {
      const first = await completeGhostGame(seatArgs(a.id, b.id, matchId, 60, 42));
      expect(first.ghostDeferred).toBeUndefined();
      const second = await completeGhostGame(seatArgs(b.id, a.id, matchId, 42, 60));
      expect(second.ghostDeferred).toBe(true);

      expect(ghostRows(matchId)).toBe(1);
      expect(receipts(matchId)).toBe(1);
      expect(sql(`select user_id from public.ghost_games where match_id='${matchId}'`)).toBe(a.id);
      expect(deferred(matchId)).toBe(1);
      expect(sql(`select user_id||'|'||final_score||'|'||opponent_score||'|'||mode||'|'||reason from public.ghost_deferred_completions where match_id='${matchId}'`))
        .toBe(`${b.id}|42|60|ghost|legacy_match_uniqueness`);
      // NO SILENT LOSS: completed seats + durably deferred seats == expected authenticated Ghost seats
      expect(receipts(matchId) + deferred(matchId)).toBe(2);
      expect(profileGames(a.id)).toBe(1);
    });

    it('repeating seat B (foreground retry / replay) does not duplicate the deferral; repeating seat A does not rewrite', async () => {
      const gamesBefore = profileGames(a.id);
      for (let i = 0; i < 3; i += 1) {
        expect((await completeGhostGame(seatArgs(b.id, a.id, matchId, 42, 60))).ghostDeferred).toBe(true);
        expect((await completeGhostGame(seatArgs(a.id, b.id, matchId, 60, 42))).ghostDeferred).toBeUndefined();
      }
      expect(deferred(matchId)).toBe(1);
      expect(ghostRows(matchId)).toBe(1);
      expect(profileGames(a.id)).toBe(gamesBefore);
    });

    it('the deferral is narrow: invalid input and a same-user divergent retry still raise and defer nothing', async () => {
      const m = randomUUID();
      await completeGhostGame(seatArgs(a.id, b.id, m, 60, 42));
      await expect(completeGhostGame({ ...seatArgs(a.id, b.id, m, 61, 42) })).rejects.toThrow(/ghost_match_conflict/);
      await expect(supabaseFetch('/rest/v1/rpc/complete_ghost_rating_v2', {
        method: 'POST',
        body: JSON.stringify({ p_user_id: b.id, p_match_id: m, p_final_score: -1, p_opponent_score: 1, p_move_log: [], p_mode: 'ghost', p_opponent_rating: 800, p_apply_rating: false }),
      })).rejects.toThrow(/ghost_invalid_completion/);
      await expect(supabaseFetch('/rest/v1/rpc/complete_ghost_rating_v2', {
        method: 'POST',
        body: JSON.stringify({ p_user_id: b.id, p_match_id: m, p_final_score: 1, p_opponent_score: 1, p_move_log: {}, p_mode: 'ghost', p_opponent_rating: 800, p_apply_rating: false }),
      })).rejects.toThrow(/ghost_invalid_completion/);
      expect(deferred(m)).toBe(0);
    });

    it('single-account completions are unchanged (Fritz-mode RPC, solo Ghost match)', async () => {
      const m1 = randomUUID();
      const m2 = randomUUID();
      const fritz = await supabaseFetch<{ isNewGame: boolean; status?: string }>('/rest/v1/rpc/complete_ghost_rating_v2', {
        method: 'POST',
        body: JSON.stringify({ p_user_id: a.id, p_match_id: m1, p_final_score: 70, p_opponent_score: 30, p_move_log: [], p_mode: 'fritz', p_opponent_rating: 1000, p_apply_rating: true }),
      });
      expect(fritz.isNewGame).toBe(true);
      expect(fritz.status).toBeUndefined();
      const solo = await completeGhostGame({ userId: a.id, finalScore: 60, opponentScore: 30, moveLog: [move], matchId: m2, applyGlicko: true });
      expect(solo.ghostDeferred).toBeUndefined();
      expect(deferred(m1) + deferred(m2)).toBe(0);
    });

    it('drain while the constraint exists: 2 requests, row untouched, attempts not burned (no retry storm)', async () => {
      gateway.reset();
      const result = await drainDeferredGhostCompletions();
      expect(result).toMatchObject({ scanned: 1, completed: 0, waitingForContract: true, failed: 0, quarantined: 0 });
      expect(gateway.requests).toHaveLength(2); // one lightweight list + the first replay probe
      expect(gateway.requests.map((r) => r.method)).toEqual(['GET', 'POST']);
      expect(sql(`select attempts||'|'||coalesce(last_error,'-') from public.ghost_deferred_completions where match_id='${matchId}'`)).toBe('0|-');
      // a "restart" (fresh module state) sees exactly the same single pending seat
      resetDeferredGhostDrainForTests();
      expect(deferred(matchId)).toBe(1);
      expect(ghostRows(matchId)).toBe(1);
    });

    it('with nothing deferred the drain is one request', async () => {
      const m = randomUUID();
      // isolate: park the real row out of the scan by quarantining it, restore afterwards
      sql(`update public.ghost_deferred_completions set quarantined_at=now() where match_id='${matchId}'`);
      gateway.reset();
      const result = await drainDeferredGhostCompletions();
      expect(result.scanned).toBe(0);
      expect(gateway.requests).toHaveLength(1);
      sql(`update public.ghost_deferred_completions set quarantined_at=null where match_id='${matchId}'`);
      expect(m).toBeTruthy();
    });
  });

  describe('CONTRACT applied (2026-10-13_ghost_user_match_uniqueness.sql)', () => {
    it('applies the real contract migration to the same database', () => {
      sqlFile(path.resolve(__dirname, '../../../supabase/migrations/2026-10-13_ghost_user_match_uniqueness.sql'));
      expect(legacyConstraintPresent()).toBe(false);
      // The contract must not have lost the pending seat.
      expect(deferred(matchId)).toBe(1);
      expect(ghostRows(matchId)).toBe(1);
    });

    it('the drain completes the deferred seat exactly once: one Ghost result per account, row removed', async () => {
      const gamesA = profileGames(a.id);
      gateway.reset();
      const result = await drainDeferredGhostCompletions();
      expect(result).toMatchObject({ scanned: 1, completed: 1, waitingForContract: false, failed: 0, stoppedEarly: null });
      expect(ghostRows(matchId)).toBe(2);
      expect(receipts(matchId)).toBe(2);
      expect(Number(sql(`select count(distinct user_id) from public.ghost_games where match_id='${matchId}'`))).toBe(2);
      expect(deferred(matchId)).toBe(0);
      expect(profileGames(b.id)).toBe(1);
      expect(profileGames(a.id)).toBe(gamesA); // seat A was rated once pre-contract and never again
      expect(Number(sql(`select count(*) from public.ghost_games where match_id='${matchId}' and rating_applied_at is not null`))).toBe(2);
    });

    it('repeating recovery is a no-op: one request, no duplicates, no extra rating', async () => {
      const gamesA = profileGames(a.id);
      const gamesB = profileGames(b.id);
      gateway.reset();
      for (let i = 0; i < 3; i += 1) await drainDeferredGhostCompletions();
      expect(ghostRows(matchId)).toBe(2);
      expect(profileGames(a.id)).toBe(gamesA);
      expect(profileGames(b.id)).toBe(gamesB);
      expect(gateway.requests).toHaveLength(3); // one empty scan each
      // replaying either seat through the foreground path is also idempotent
      expect((await completeGhostGame(seatArgs(b.id, a.id, matchId, 42, 60))).ghostDeferred).toBeUndefined();
      expect(ghostRows(matchId)).toBe(2);
      expect(profileGames(b.id)).toBe(gamesB);
    });

    it('new two-account matches now complete both seats directly without the transitional path', async () => {
      const m = randomUUID();
      expect((await completeGhostGame(seatArgs(a.id, b.id, m, 60, 42))).ghostDeferred).toBeUndefined();
      expect((await completeGhostGame(seatArgs(b.id, a.id, m, 42, 60))).ghostDeferred).toBeUndefined();
      expect(ghostRows(m)).toBe(2);
      expect(deferred(m)).toBe(0);
    });

    it('a deferred seat whose foreground retry completed first is cleared by the RPC itself', async () => {
      // Simulate a seat parked while the legacy constraint existed, then completed by an ordinary retry.
      const m = randomUUID();
      sql(`insert into public.ghost_deferred_completions(user_id,match_id,final_score,opponent_score,move_log,mode,opponent_rating,apply_rating) values ('${b.id}','${m}',42,60,'[]','ghost',800,true)`);
      await completeGhostGame(seatArgs(b.id, a.id, m, 42, 60));
      expect(deferred(m)).toBe(0);
      expect(ghostRows(m)).toBe(1);
    });

    it('poison row: deterministic rejection is counted and quarantined; infrastructure failure never spends the budget', async () => {
      const m = randomUUID();
      sql(`begin; select set_config('racehorse.ghost_rating_v2','on',true); insert into public.ghost_games(user_id,match_id,final_score,opponent_score,move_log,rating_applied_at) values ('${a.id}','${m}',50,40,'[]',now()); commit`);
      // same account, different scores => ghost_match_conflict (deterministic)
      sql(`insert into public.ghost_deferred_completions(user_id,match_id,final_score,opponent_score,move_log,mode,opponent_rating,apply_rating) values ('${a.id}','${m}',51,40,'[]','ghost',800,true)`);
      for (let i = 1; i < GHOST_DEFERRED_MAX_ATTEMPTS; i += 1) {
        const r = await drainDeferredGhostCompletions();
        expect(r).toMatchObject({ failed: 1, quarantined: 0 });
        expect(Number(sql(`select attempts from public.ghost_deferred_completions where match_id='${m}'`))).toBe(i);
      }
      // transient infrastructure fault: stops the sweep, attempts unchanged
      gateway.faults.push({ name: 'infra', phase: 'before', match: (r) => r.path.includes('complete_ghost_rating_v2'), times: 1 });
      const infra = await drainDeferredGhostCompletions();
      gateway.faults.length = 0;
      expect(infra.stoppedEarly).toBe('infrastructure');
      expect(Number(sql(`select attempts from public.ghost_deferred_completions where match_id='${m}'`))).toBe(GHOST_DEFERRED_MAX_ATTEMPTS - 1);
      const last = await drainDeferredGhostCompletions();
      expect(last).toMatchObject({ failed: 1, quarantined: 1 });
      expect(sql(`select (quarantined_at is not null)||'|'||attempts from public.ghost_deferred_completions where match_id='${m}'`)).toBe(`true|${GHOST_DEFERRED_MAX_ATTEMPTS}`);
      // quarantined rows stay visible to operators and are never rescanned
      gateway.reset();
      const again = await drainDeferredGhostCompletions();
      expect(again.scanned).toBe(0);
      expect(gateway.requests).toHaveLength(1);
      expect(deferred(m)).toBe(1);
    });
  });
});
