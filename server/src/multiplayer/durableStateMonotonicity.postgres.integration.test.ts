/**
 * Durable-state monotonicity against REAL PostgreSQL + PostgREST (owned loopback instance).
 * Opt-in exactly like terminalCompletionRecovery.postgres.integration.test.ts (see
 * server/test/fixtures/README.md, "Terminal completion R1"). Skipped unless both loopback URLs match.
 *
 * Covers supabase/migrations/2026-10-16_room_live_session_monotonic_fence.sql and
 * 2026-10-16_ranked_applied_state_monotonic.sql. Every assertion is made by the database itself.
 */
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startLocalPostgrestGateway, type LocalPostgrestGateway } from '../../test/support/localPostgrestGateway';
import { localSql, terminalDbEnabled, TERMINAL_DB_URL, TERMINAL_POSTGREST_URL } from './terminalCompletionTestKit';

const holder = vi.hoisted(() => ({ url: 'http://127.0.0.1:1' }));
vi.mock('../config', async () => {
  const { createHmac } = await import('node:crypto');
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 7200 })}`;
  const key = `${message}.${createHmac('sha256', 'racehorse-forfeit-r1-local-validation-only-secret').update(message).digest('base64url')}`;
  return { config: { isProd: false, nodeEnv: 'test', get supabaseUrl() { return holder.url; }, supabaseServiceKey: key } };
});
import { supabaseFetch } from '../supabaseUtils';

const run = terminalDbEnabled() ? describe : describe.skip;

const MATCH_A = () => randomUUID();
type Put = { code: string; match: string; status?: string; seq?: number; ev?: number; shell?: Record<string, unknown>; state?: boolean };

/** One snapshot through the production RPC (the writer every NEW server uses). */
function persistSql(p: Put): string {
  const session = {
    room_code: p.code,
    match_id: p.match,
    status: p.status ?? 'playing',
    source_type: 'private',
    game_state: p.state === false ? null : { sequence: p.seq ?? 0 },
    game_state_sequence: p.seq ?? 0,
    last_event_sequence: p.ev ?? 0,
    room_shell: p.shell ?? {},
  };
  return `select public.persist_room_live_session('${JSON.stringify(session).replace(/'/g, "''")}'::jsonb, '[]'::jsonb)`;
}
const put = (p: Put) => localSql(persistSql(p));
const putFails = (p: Put, needle: string) => expect(() => put(p)).toThrow(needle);
const row = (code: string) => localSql(`select row_to_json(r)::text from (select room_code,match_id,status,game_state_sequence,last_event_sequence,game_state,room_shell from public.room_live_sessions where room_code='${code}') r`);
const shell = (code: string) => JSON.parse(localSql(`select room_shell from public.room_live_sessions where room_code='${code}'`)) as Record<string, unknown>;
const status = (code: string) => localSql(`select status from public.room_live_sessions where room_code='${code}'`);
const newCode = () => `MN${randomUUID().slice(0, 6).toUpperCase()}`;

const OWING = { completionPending: true, matchLogged: false, config: { winningScore: 60 } };

run('room_live_sessions monotonic fence (real PostgreSQL)', () => {
  let gateway: LocalPostgrestGateway;
  beforeAll(async () => { gateway = await startLocalPostgrestGateway({ upstream: TERMINAL_POSTGREST_URL }); holder.url = gateway.url; });
  afterAll(async () => { await gateway.close(); });

  it('rejects a lower-sequence snapshot and leaves the newer row byte-identical', () => {
    const code = newCode(); const m = MATCH_A();
    put({ code, match: m, seq: 10, ev: 12, shell: { v: 'new' } });
    const before = row(code);
    putFails({ code, match: m, seq: 7, ev: 9, shell: { v: 'old' } }, 'room_live_session_stale_write');
    putFails({ code, match: m, seq: 9, ev: 99, shell: { v: 'old' } }, 'room_live_session_stale_write');
    expect(row(code)).toBe(before);
  });

  it('orders by (game_state_sequence, last_event_sequence), not by wall clock', () => {
    const code = newCode(); const m = MATCH_A();
    put({ code, match: m, seq: 5, ev: 5 });
    // A later wall-clock write with an older event sequence is stale; an earlier-clock one with a newer sequence is not.
    localSql(`update public.room_live_sessions set updated_at = now() + interval '1 day' where room_code='${code}'`);
    putFails({ code, match: m, seq: 5, ev: 4 }, 'room_live_session_stale_write');
    put({ code, match: m, seq: 6, ev: 6 });
    expect(localSql(`select game_state_sequence from public.room_live_sessions where room_code='${code}'`)).toBe('6');
  });

  it('refuses terminal -> playing for lower, equal and higher sequence; terminal shell metadata survives', () => {
    const code = newCode(); const m = MATCH_A();
    const recovery = { attempts: 3, lastError: 'boom', quarantinedAt: '2026-10-16T00:00:00.000Z' };
    put({ code, match: m, status: 'game_over', seq: 21, ev: 30, shell: { ...OWING, completionRecovery: recovery } });
    const before = row(code);
    for (const seq of [7, 21, 22]) {
      putFails({ code, match: m, status: 'playing', seq, ev: 30 + (seq === 22 ? 1 : 0), shell: {} }, seq < 21 ? 'room_live_session_stale_write' : 'room_live_session_terminal_regression');
    }
    putFails({ code, match: m, status: 'lobby', seq: 21, ev: 30, state: false }, 'room_live_session_terminal_regression');
    expect(row(code)).toBe(before);
    expect(shell(code)).toMatchObject({ completionPending: true, matchLogged: false, completionRecovery: recovery });
    expect(status(code)).toBe('game_over');
  });

  it('same sequence + identical payload is an accepted idempotent replay', () => {
    const code = newCode(); const m = MATCH_A();
    put({ code, match: m, status: 'game_over', seq: 4, ev: 4, shell: OWING });
    const before = row(code);
    put({ code, match: m, status: 'game_over', seq: 4, ev: 4, shell: OWING });
    expect(row(code)).toBe(before);
  });

  it('same sequence + different payload is accepted (response-loss retry / terminal bookkeeping)', () => {
    const code = newCode(); const m = MATCH_A();
    put({ code, match: m, seq: 8, ev: 8, shell: { a: 1 } });
    put({ code, match: m, seq: 8, ev: 8, shell: { a: 2 } });
    expect(shell(code)).toEqual({ a: 2 });
    put({ code, match: m, seq: 9, ev: 9, shell: { a: 3 } });
    expect(shell(code)).toEqual({ a: 3 });
  });

  it('terminal -> terminal at the same sequence is allowed (game_over then abandoned archive)', () => {
    const code = newCode(); const m = MATCH_A();
    put({ code, match: m, status: 'game_over', seq: 12, ev: 12, shell: OWING });
    put({ code, match: m, status: 'abandoned', seq: 12, ev: 13, shell: OWING });
    expect(status(code)).toBe('abandoned');
  });

  it('a live writer can never clear completionPending, regress matchLogged, or erase recovery state', () => {
    const code = newCode(); const m = MATCH_A();
    const recovery = { attempts: 2, lastError: 'x' };
    put({ code, match: m, status: 'game_over', seq: 21, ev: 30, shell: { ...OWING, completionRecovery: recovery } });
    // M3: an equal-sequence live snapshot that omits completionRecovery keeps it.
    put({ code, match: m, status: 'game_over', seq: 21, ev: 30, shell: { ...OWING } });
    expect(shell(code).completionRecovery).toEqual(recovery);
    // M2: pending cannot be cleared without matchLogged.
    put({ code, match: m, status: 'game_over', seq: 21, ev: 31, shell: { completionPending: false, matchLogged: false } });
    expect(shell(code).completionPending).toBe(true);
    // Legitimate recovery bookkeeping (CAS PATCH of the shell only) succeeds with no sequence advance.
    localSql(`update public.room_live_sessions set room_shell = room_shell || '{"completionRecovery":{"attempts":5}}' where room_code='${code}'`);
    expect(shell(code).completionRecovery).toEqual({ attempts: 5 });
    // Completion logged (exactly what markTerminalCompletionLogged writes).
    localSql(`update public.room_live_sessions set room_shell = (room_shell - 'completionRecovery') || '{"matchLogged":true,"completionPending":false}' where room_code='${code}'`);
    // M1: a stale live writer that still believes the completion is owed cannot resurrect it.
    put({ code, match: m, status: 'game_over', seq: 21, ev: 31, shell: { ...OWING, completionRecovery: recovery } });
    expect(shell(code)).toMatchObject({ matchLogged: true, completionPending: false });
    expect(shell(code).completionRecovery).toBeUndefined();
  });

  it('a different match cannot replace a terminal row that still owes completion; a logged one can be rematched', () => {
    const code = newCode(); const m1 = MATCH_A(); const m2 = MATCH_A();
    put({ code, match: m1, status: 'game_over', seq: 30, ev: 40, shell: OWING });
    putFails({ code, match: m2, status: 'lobby', seq: 0, ev: 0, state: false }, 'room_live_session_owes_completion');
    expect(localSql(`select match_id from public.room_live_sessions where room_code='${code}'`)).toBe(m1);
    localSql(`update public.room_live_sessions set room_shell = room_shell || '{"matchLogged":true,"completionPending":false}' where room_code='${code}'`);
    put({ code, match: m2, status: 'lobby', seq: 0, ev: 0, state: false, shell: {} }); // rematch: sequence restarts at 0 for a NEW match
    expect(localSql(`select match_id from public.room_live_sessions where room_code='${code}'`)).toBe(m2);
    const code2 = newCode(); // a playing row is replaceable by a new match exactly as before
    put({ code: code2, match: MATCH_A(), seq: 9, ev: 9 });
    put({ code: code2, match: MATCH_A(), seq: 0, ev: 0 });
  });

  it('the same fence holds on the PostgREST merge-duplicates upsert path (the BRIDGE writer)', async () => {
    const code = newCode(); const m = MATCH_A();
    const body = (over: Record<string, unknown>) => JSON.stringify([{ room_code: code, match_id: m, status: 'game_over', source_type: 'private',
      game_state: { sequence: 21 }, game_state_sequence: 21, last_event_sequence: 30, room_shell: OWING, engine_seat_ids: [], roster: [], events: [], participant_user_ids: [], ...over }]);
    const upsert = (b: string) => supabaseFetch(`/rest/v1/room_live_sessions?on_conflict=room_code`, { method: 'POST', headers: { Prefer: 'return=minimal,resolution=merge-duplicates' }, body: b });
    await upsert(body({}));
    const before = row(code);
    await expect(upsert(body({ status: 'playing', game_state_sequence: 7, last_event_sequence: 9, room_shell: {} }))).rejects.toThrow(/room_live_session_stale_write/);
    await expect(upsert(body({ status: 'playing', room_shell: {} }))).rejects.toThrow(/room_live_session_terminal_regression/);
    expect(row(code)).toBe(before);
    // and the RPC the NEW server uses, through PostgREST
    await expect(supabaseFetch('/rest/v1/rpc/persist_room_live_session', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ p_session: { room_code: code, match_id: m, status: 'playing', source_type: 'private', game_state_sequence: 3, last_event_sequence: 3 }, p_entries: [] }) }))
      .rejects.toThrow(/room_live_session_stale_write/);
    expect(row(code)).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------

const NORMAL = (rating: number) => ({ version: 1, treatment: 'standard', cause: 'completed', outcome: 'win',
  player: { rating, rd: 350, vol: 0.06, gamesPlayed: 0, peakRating: rating }, opponent: { rating: 800, rd: 350 } });

function seedPlayer(): string {
  const id = randomUUID();
  localSql(`insert into auth.users(id,email,raw_user_meta_data) values ('${id}','${id}@racehorse-test.invalid','{"username":"mn${id.replace(/-/g, '').slice(0, 10)}"}')`);
  localSql(`update public.profiles set glicko_rating=800, glicko_rd=350, glicko_vol=0.06, peak_rating=800, ranked_games_played=0, provisional=true where id='${id}'`);
  return id;
}
function pendingGame(player: string, opp: string, context: object | null = NORMAL(800)): string {
  const id = randomUUID();
  localSql(`insert into public.ranked_games(id,player_id,opponent_id,player_score,opponent_score,game_type,rating_before,rd_before,outcome,source_type,source_match_id,rating_context)
    values ('${id}','${player}','${opp}',60,40,'multiplayer',800,350,'win','live_room','${randomUUID()}',${context ? `'${JSON.stringify(context)}'::jsonb` : 'null'})`);
  return id;
}
const commit = (player: string, game: string, ctx = true) =>
  `select public.commit_glicko_game_update('${player}',830,300,0.06,now(),true,830,1,'${game}',30,800,350,0.06${ctx ? `,(select rating_context from public.ranked_games where id='${game}')` : ''})`;
const game = (id: string) => localSql(`select rating_after||'|'||coalesce(rd_after::text,'NULL')||'|'||coalesce(delta::text,'NULL') from public.ranked_games where id='${id}'`);

run('ranked_games applied-state monotonicity (real PostgreSQL)', () => {
  it('pending -> applied through the RPC still works, once, with exactly one receipt', () => {
    const p = seedPlayer(); const o = seedPlayer(); const g = pendingGame(p, o);
    localSql(commit(p, g));
    expect(game(g)).toBe('830|300|30');
    expect(() => localSql(commit(p, g))).toThrow('ranked_already_processed');
    expect(localSql(`select count(*) from public.rating_periods where ranked_game_id='${g}'`)).toBe('1');
  });

  it('refuses applied -> pending for every applied field, and leaves the row untouched', () => {
    const p = seedPlayer(); const o = seedPlayer(); const g = pendingGame(p, o);
    localSql(commit(p, g));
    for (const set of ['rating_after=null', 'rd_after=null', 'delta=null', 'rating_after=null, rd_after=null, delta=null']) {
      expect(() => localSql(`update public.ranked_games set ${set} where id='${g}'`)).toThrow(/ranked_applied_state_monotonic|ranked_games_applied_fields_coupled/);
    }
    expect(game(g)).toBe('830|300|30');
    // the poison-predecessor consequence is gone: the owner can still be admitted
    expect(() => pendingGame(p, o, { ...NORMAL(830), player: { rating: 830, rd: 300, vol: 0.06, gamesPlayed: 1, peakRating: 830 } })).not.toThrow();
  });

  it('refuses half-set applied fields on insert and on update of a pending row', () => {
    const p = seedPlayer(); const o = seedPlayer();
    const ins = (cols: string) => `insert into public.ranked_games(player_id,opponent_id,player_score,opponent_score,game_type,rating_before,rd_before,source_match_id,${cols.split('=')[0]}) values ('${p}','${o}',1,2,'multiplayer',800,350,'${randomUUID()}',${cols.split('=')[1]})`;
    expect(() => localSql(ins('rating_after=810'))).toThrow('ranked_games_applied_fields_coupled');
    expect(() => localSql(ins('delta=5'))).toThrow('ranked_games_applied_fields_coupled');
    expect(() => localSql(ins('rd_after=300'))).toThrow('ranked_games_applied_fields_coupled');
    const g = pendingGame(p, o);
    expect(() => localSql(`update public.ranked_games set rating_after=1 where id='${g}'`)).toThrow('ranked_games_applied_fields_coupled');
    expect(() => localSql(`update public.ranked_games set rating_after=1, rd_after=2 where id='${g}'`)).toThrow('ranked_games_applied_fields_coupled');
    expect(localSql(`select rating_after is null and rd_after is null and delta is null from public.ranked_games where id='${g}'`)).toBe('t');
  });

  it('keeps rating-context immutability and the single-pending-predecessor claim semantics', () => {
    const p = seedPlayer(); const o = seedPlayer(); const g = pendingGame(p, o);
    expect(() => localSql(`update public.ranked_games set rating_context = jsonb_set(rating_context,'{player,rating}','999') where id='${g}'`)).toThrow('ranked_rating_context_immutable');
    expect(() => pendingGame(p, o)).toThrow('ranked_predecessor_pending');
  });

  it('historical NULL-context rows and legacy half-set rows are preserved and still processable', () => {
    const p = seedPlayer(); const o = seedPlayer();
    const legacyPending = pendingGame(p, o, null);
    localSql(commit(p, legacyPending, false));
    expect(game(legacyPending)).toBe('830|300|30');
    // A historical half-set row (written before the CHECK existed) is not rewritten and not rejected at rest.
    const q = seedPlayer(); const legacy = randomUUID();
    localSql(`begin; alter table public.ranked_games drop constraint ranked_games_applied_fields_coupled;
      insert into public.ranked_games(id,player_id,opponent_id,player_score,opponent_score,game_type,rating_before,rd_before,rating_after,source_match_id)
        values ('${legacy}','${q}','${o}',1,2,'multiplayer',1500,350,1480,'${randomUUID()}');
      alter table public.ranked_games add constraint ranked_games_applied_fields_coupled check (
        (rating_after is null and rd_after is null and delta is null) or (rating_after is not null and rd_after is not null and delta is not null)) not valid; commit`);
    try {
      expect(localSql(`select rating_after from public.ranked_games where id='${legacy}'`)).toBe('1480');
      expect(localSql(`select convalidated from pg_constraint where conname='ranked_games_applied_fields_coupled'`)).toBe('f');
      expect(() => localSql(`update public.ranked_games set rating_after = null where id='${legacy}'`)).toThrow(/ranked_applied_state_monotonic/);
    } finally {
      // never leave a half-set row behind: the migration refuses to run while one exists
      localSql(`delete from public.ranked_games where id='${legacy}'`);
    }
  });

  it('two concurrent sessions committing the same pending game: exactly one applies', async () => {
    const p = seedPlayer(); const o = seedPlayer(); const g = pendingGame(p, o);
    const psql = (sql: string) => new Promise<{ code: number | null; err: string }>((resolve) => {
      const c = spawn(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', TERMINAL_DB_URL, '-c', sql]);
      let err = ''; c.stderr.on('data', (d) => { err += String(d); }); c.on('close', (code) => resolve({ code, err }));
    });
    const [a, b] = await Promise.all([psql(`begin; ${commit(p, g)}; select pg_sleep(1); commit`), (async () => { await new Promise((r) => setTimeout(r, 300)); return psql(commit(p, g)); })()]);
    expect([a.code, b.code].sort()).toEqual([0, 1]);
    expect(a.err + b.err).toContain('ranked_already_processed');
    expect(localSql(`select count(*) from public.rating_periods where ranked_game_id='${g}'`)).toBe('1');
    expect(localSql(`select ranked_games_played from public.profiles where id='${p}'`)).toBe('1');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Adversarial ranked state model + rollout gate (2026-10-16_ranked_applied_state_monotonic.sql)
// ---------------------------------------------------------------------------------------------------------------
const REPO = join(__dirname, '..', '..', '..');
const MIGRATION = join(REPO, 'supabase', 'migrations', '2026-10-16_ranked_applied_state_monotonic.sql');
const PREFLIGHT = join(REPO, 'scripts', 'sql', 'ranked-applied-state-preflight.sql');
function psqlFile(file: string, env: Record<string, string> = {}): { ok: boolean; out: string } {
  try {
    const out = execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', TERMINAL_DB_URL, '-f', file], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env },
    });
    return { ok: true, out };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}
const insertHalfSet = (player: string, opp: string, cols: { rating_after?: number; rd_after?: number; delta?: number }): string => {
  const id = randomUUID();
  const names = Object.keys(cols); const vals = Object.values(cols);
  localSql(`begin; alter table public.ranked_games drop constraint ranked_games_applied_fields_coupled;
    insert into public.ranked_games(id,player_id,opponent_id,player_score,opponent_score,game_type,rating_before,rd_before,source_type,source_match_id${names.map((n) => `,${n}`).join('')})
      values ('${id}','${player}','${opp}',1,2,'multiplayer',800,350,'live_room','legacy-${id}'${vals.map((v) => `,${v}`).join('')});
    alter table public.ranked_games add constraint ranked_games_applied_fields_coupled check (
      (rating_after is null and rd_after is null and delta is null) or (rating_after is not null and rd_after is not null and delta is not null)) not valid; commit`);
  return id;
};

run('ranked applied-state model, adversarial (real PostgreSQL)', () => {
  const insertWith = (p: string, o: string, cols: string) => {
    const names = cols ? cols.split(',').map((c) => c.split('=')[0]) : []; const vals = cols ? cols.split(',').map((c) => c.split('=')[1]) : [];
    return `insert into public.ranked_games(player_id,opponent_id,player_score,opponent_score,game_type,rating_before,rd_before,source_match_id${names.map((n) => `,${n}`).join('')})
      values ('${p}','${o}',1,2,'multiplayer',800,350,'${randomUUID()}'${vals.map((v) => `,${v}`).join('')})`;
  };
  it('exactly two of the eight applied-field combinations can be written: all NULL (pending) and all set (applied)', () => {
    const p = seedPlayer(); const o = seedPlayer();
    const combos: Array<[string, boolean]> = [
      ['', true], ['rating_after=810,rd_after=300,delta=10', true],
      ['rating_after=810', false], ['rd_after=300', false], ['delta=10', false],
      ['rating_after=810,rd_after=300', false], ['rating_after=810,delta=10', false], ['rd_after=300,delta=10', false],
    ];
    for (const [cols, ok] of combos) {
      const sql = insertWith(p, o, cols);
      // all-set insert is legal data-wise; keep the owner unblocked by using a fresh owner per attempt
      if (ok) expect(() => localSql(sql.replace(`'${p}'`, `'${seedPlayer()}'`))).not.toThrow();
      else expect(() => localSql(sql)).toThrow('ranked_games_applied_fields_coupled');
    }
  });

  it('applied results are immutable: cleared, changed, partially changed, multi-column and upsert attempts all fail', () => {
    const p = seedPlayer(); const o = seedPlayer(); const g = pendingGame(p, o);
    localSql(commit(p, g));
    const applied = game(g);
    const attempts = [
      'rating_after = 999', 'rd_after = 1', 'delta = 0', 'rating_after = 1, rd_after = 2, delta = 3',
      'rating_after = null', 'rd_after = null', 'delta = null',
      'rating_after = null, rd_after = null, delta = null',
      'rating_after = 999, delta = null',                       // multi-column: change one, clear another
      'player_score = 0, rating_after = rating_after + 1',      // unrelated column alongside
    ];
    for (const set of attempts) expect(() => localSql(`update public.ranked_games set ${set} where id='${g}'`), set).toThrow(/ranked_applied_state_monotonic|ranked_rating_context_immutable/);
    // upsert DO UPDATE is a BEFORE UPDATE too
    expect(() => localSql(`insert into public.ranked_games(id,player_id,opponent_id,player_score,opponent_score,game_type,rating_before,rd_before,source_match_id,rating_after,rd_after,delta)
      select id,player_id,opponent_id,player_score,opponent_score,game_type,rating_before,rd_before,source_match_id,1,1,1 from public.ranked_games where id='${g}'
      on conflict (player_id,source_match_id) do update set rating_after=null,rd_after=null,delta=null`)).toThrow(/ranked_applied_state_monotonic|ranked_games_applied_fields_coupled/);
    expect(game(g)).toBe(applied);
    // a write that changes nothing is allowed
    localSql(`update public.ranked_games set rating_after = rating_after, rd_after = rd_after, delta = delta where id='${g}'`);
  });

  it('the real RPC still drives pending -> applied for a context row and for a historical NULL-context row', () => {
    const p = seedPlayer(); const o = seedPlayer();
    const legacy = pendingGame(p, o, null); localSql(commit(p, legacy, false));
    expect(game(legacy)).toBe('830|300|30');
    const q = seedPlayer(); const withCtx = pendingGame(q, o); localSql(commit(q, withCtx));
    expect(game(withCtx)).toBe('830|300|30');
    expect(() => localSql(commit(q, withCtx))).toThrow('ranked_already_processed');
  });

  describe('legacy half-set rows: rollout gate and read-only preflight', () => {
    it('preflight prints GO when no half-set row exists', () => {
      const r = psqlFile(PREFLIGHT);
      expect(r.ok).toBe(true);
      expect(r.out).toMatch(/\bGO\b/);
      expect(r.out).not.toMatch(/STOP/);
    });

    it('preflight prints STOP and classifies each row; the migration refuses until reconciled; override is explicit', () => {
      const p = seedPlayer(); const o = seedPlayer(); const q = seedPlayer();
      const pendingShaped = insertHalfSet(p, o, { rd_after: 300, delta: 5 });      // rating_after NULL: selected by catch-up, blocks owner
      const appliedShaped = insertHalfSet(q, o, { rating_after: 810 });            // rating_after set: inert, frozen by the CHECK
      try {
        const report = psqlFile(PREFLIGHT);
        expect(report.ok).toBe(true);
        expect(report.out).toMatch(/STOP/);
        expect(report.out).toContain(pendingShaped); expect(report.out).toContain(appliedShaped);
        // pending-shaped: selected + blocking (t,t); applied-shaped: neither (f,f)
        expect(report.out).toMatch(new RegExp(`${pendingShaped}[^\\n]*pending_shaped\\s*\\|\\s*t\\s*\\|\\s*t`));
        expect(report.out).toMatch(new RegExp(`${appliedShaped}[^\\n]*applied_shaped\\s*\\|\\s*f\\s*\\|\\s*f`));
        // the preflight is read-only: it changed nothing
        expect(localSql(`select count(*) from public.ranked_games where id in ('${pendingShaped}','${appliedShaped}')`)).toBe('2');
        // the pending-shaped row really is a poison predecessor today
        expect(() => pendingGame(p, o)).toThrow('ranked_predecessor_pending');

        const refused = psqlFile(MIGRATION);
        expect(refused.ok).toBe(false);
        expect(refused.out).toContain('ranked_applied_state_half_set_rows');
        const acknowledged = psqlFile(MIGRATION, { PGOPTIONS: '-c racehorse.accept_half_set_ranked_rows=on' });
        expect(acknowledged.ok).toBe(true);
      } finally {
        localSql(`delete from public.ranked_games where id in ('${pendingShaped}','${appliedShaped}')`);
      }
      expect(psqlFile(PREFLIGHT).out).toMatch(/\bGO\b/);
      expect(psqlFile(MIGRATION).ok).toBe(true);   // re-runnable once reconciled
    });

    it('a deliberately reconciled legacy row can be completed in ONE statement and then satisfies the CHECK', () => {
      const p = seedPlayer(); const o = seedPlayer();
      const row = insertHalfSet(p, o, { rating_after: 810 });
      try {
        expect(() => localSql(`update public.ranked_games set rd_after = 300 where id='${row}'`)).toThrow('ranked_games_applied_fields_coupled');
        localSql(`update public.ranked_games set rd_after = 300, delta = 10 where id='${row}'`);
        expect(game(row)).toBe('810|300|10');
        expect(() => localSql(`update public.ranked_games set rating_after = null where id='${row}'`)).toThrow('ranked_applied_state_monotonic');
      } finally {
        localSql(`delete from public.ranked_games where id='${row}'`);
      }
    });
  });
});
