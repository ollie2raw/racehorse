/**
 * Room GENERATION + writer-epoch fence against REAL PostgreSQL (owned loopback instance; same opt-in env as
 * terminalCompletionRecovery.postgres.integration.test.ts). Covers
 * supabase/migrations/2026-10-16_room_live_session_generation_fence.sql.
 *
 * Invariant under test: once room code R has advanced from match A to match B, no writer belonging to A can
 * modify or recreate the durable live state for R -- whatever state B is in, and whether or not R's live row
 * still exists.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { localSql, terminalDbEnabled, TERMINAL_DB_URL } from './terminalCompletionTestKit';

const run = terminalDbEnabled() ? describe : describe.skip;

type Put = { code: string; match: string; status?: string; seq?: number; ev?: number; shell?: Record<string, unknown>; state?: unknown; restore?: boolean; epoch?: unknown };
const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
function persistSql(p: Put): string {
  const session = {
    room_code: p.code, match_id: p.match, status: p.status ?? 'playing', source_type: 'private',
    game_state: p.state === undefined ? { sequence: p.seq ?? 0, marker: 'x' } : p.state,
    game_state_sequence: p.seq ?? 0, last_event_sequence: p.ev ?? 0,
    room_shell: { ...(p.shell ?? {}), ...(p.epoch === undefined ? {} : { writerEpoch: p.epoch }) },
  };
  return `select public.persist_room_live_session(${lit(session)}, '[]'::jsonb, ${p.restore ? 'true' : 'false'})`;
}
const put = (p: Put) => localSql(persistSql(p));
const rejects = (p: Put, needle: string) => expect(() => put(p)).toThrow(needle);
const snapshot = (code: string) => localSql(`select row_to_json(r)::text from (select room_code,match_id,status,game_state_sequence,last_event_sequence,game_state,room_shell from public.room_live_sessions where room_code='${code}') r`);
const exists = (code: string) => localSql(`select count(*) from public.room_live_sessions where room_code='${code}'`) === '1';
const del = (code: string) => localSql(`delete from public.room_live_sessions where room_code='${code}'`);
const newCode = () => `GF${randomUUID().slice(0, 6).toUpperCase()}`;
const LOGGED = { matchLogged: true, completionPending: false };
const OWING = { matchLogged: false, completionPending: true };

run('room generation fence (real PostgreSQL)', () => {
  it('guards the fixture assumption behind terminal-recovery test D: the test database runs in UTC like Supabase', () => {
    expect(localSql('show timezone')).toBe('UTC');
    expect(localSql("select now() - timezone('utc', now())::timestamptz = interval '0'")).toBe('t');
  });

  describe('cross-match: an old match can never touch a newer match of the same room code', () => {
    const newerStates: Array<[string, Partial<Put>]> = [
      ['lobby', { status: 'lobby', seq: 0, ev: 0, state: null }],
      ['playing', { status: 'playing', seq: 3, ev: 4 }],
      ['hand_over', { status: 'hand_over', seq: 9, ev: 12 }],
      ['terminal (logged)', { status: 'game_over', seq: 21, ev: 30, shell: LOGGED }],
      ['terminal (owing completion)', { status: 'game_over', seq: 21, ev: 30, shell: OWING }],
    ];
    it.each(newerStates)('B is %s: stale writes of A are refused, B stays byte-identical', (_label, b) => {
      const code = newCode(); const A = randomUUID(); const B = randomUUID();
      put({ code, match: A, status: 'playing', seq: 10, ev: 12 });
      // The room advances to B. When A is a non-terminal row it is replaced exactly as a rematch / new session does.
      if (b.shell === OWING) {
        put({ code, match: A, status: 'game_over', seq: 10, ev: 12, shell: LOGGED });
      }
      put({ code, match: B, ...(b as Put) });
      const before = snapshot(code);
      // A's process still holds a higher-sequence playing room, a lower one, and a terminal one.
      for (const stale of [{ seq: 11, ev: 13 }, { seq: 2, ev: 2 }, { seq: 50, ev: 60 }]) {
        expect(() => put({ code, match: A, status: 'playing', ...stale })).toThrow(/room_live_session_(stale_generation|owes_completion)/);
      }
      expect(() => put({ code, match: A, status: 'game_over', seq: 50, ev: 60, shell: LOGGED })).toThrow(/room_live_session_(stale_generation|owes_completion)/);
      expect(() => put({ code, match: A, status: 'playing', seq: 50, ev: 60, restore: true })).toThrow(/room_live_session_(stale_generation|owes_completion)/);
      expect(snapshot(code)).toBe(before);
    });

    it('the PATCH path (recovery bookkeeping) is untouched by the generation guard', () => {
      const code = newCode(); const A = randomUUID();
      put({ code, match: A, status: 'game_over', seq: 21, ev: 30, shell: OWING });
      localSql(`update public.room_live_sessions set room_shell = room_shell || '{"completionRecovery":{"attempts":1}}' where room_code='${code}'`);
      expect(JSON.parse(localSql(`select room_shell from public.room_live_sessions where room_code='${code}'`)).completionRecovery).toEqual({ attempts: 1 });
    });
  });

  describe('delete / recreate', () => {
    it('A finishes, its row is retired and deleted, then stale A wakes: A is not recreated', () => {
      const code = newCode(); const A = randomUUID();
      put({ code, match: A, status: 'playing', seq: 10, ev: 12 });
      put({ code, match: A, status: 'game_over', seq: 21, ev: 30, shell: LOGGED });
      del(code);
      expect(exists(code)).toBe(false);
      rejects({ code, match: A, status: 'playing', seq: 10, ev: 12 }, 'room_live_session_retired_match');
      rejects({ code, match: A, status: 'game_over', seq: 21, ev: 30, shell: LOGGED }, 'room_live_session_retired_match');
      expect(exists(code)).toBe(false);
    });

    it('A retired, a legitimate new session C takes the room code, then stale A writes: C survives', () => {
      const code = newCode(); const A = randomUUID(); const C = randomUUID();
      put({ code, match: A, status: 'game_over', seq: 21, ev: 30, shell: LOGGED });
      del(code);
      put({ code, match: C, status: 'lobby', seq: 0, ev: 0, state: null });
      put({ code, match: C, status: 'playing', seq: 4, ev: 5 });
      const before = snapshot(code);
      rejects({ code, match: A, status: 'playing', seq: 99, ev: 99 }, 'room_live_session_stale_generation');
      rejects({ code, match: A, status: 'playing', seq: 99, ev: 99, restore: true }, 'room_live_session_stale_generation');
      expect(snapshot(code)).toBe(before);
      // and after C also finishes and is deleted, neither C nor A can come back; D can.
      put({ code, match: C, status: 'game_over', seq: 8, ev: 9, shell: LOGGED }); del(code);
      rejects({ code, match: C, status: 'playing', seq: 8, ev: 9 }, 'room_live_session_retired_match');
      rejects({ code, match: A, status: 'playing', seq: 1, ev: 1, restore: true }, 'room_live_session_stale_generation');
      const D = randomUUID(); put({ code, match: D, status: 'lobby', seq: 0, ev: 0, state: null });
      expect(JSON.parse(snapshot(code)).match_id).toBe(D);
    });

    it('the one legitimate recreation: restore of the NEWEST retired match (guard.restoreLiveSession)', () => {
      const code = newCode(); const A = randomUUID();
      put({ code, match: A, status: 'abandoned', seq: 7, ev: 8 });
      del(code);
      rejects({ code, match: A, status: 'playing', seq: 7, ev: 8 }, 'room_live_session_retired_match'); // plain upsert (BRIDGE) fails closed
      put({ code, match: A, status: 'playing', seq: 7, ev: 8, restore: true });
      expect(exists(code)).toBe(true);
      put({ code, match: A, status: 'playing', seq: 8, ev: 9 }); // and it is an ordinary live match again
    });

    it('a restore flag set by one call does not leak into the next call (transaction-local)', () => {
      const code = newCode(); const A = randomUUID();
      put({ code, match: A, status: 'abandoned', seq: 7, ev: 8 }); del(code);
      put({ code, match: A, status: 'playing', seq: 7, ev: 8, restore: true });
      del(code);
      rejects({ code, match: A, status: 'playing', seq: 7, ev: 8 }, 'room_live_session_retired_match');
    });
  });

  it('serializes a concurrent advance (A -> B) against a stale A write: B always survives', async () => {
    for (let i = 0; i < 6; i += 1) {
      const code = newCode(); const A = randomUUID(); const B = randomUUID();
      put({ code, match: A, status: 'playing', seq: 10, ev: 12 });
      const psql = (sql: string) => new Promise<{ code: number | null; err: string }>((resolve) => {
        const c = spawn(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', TERMINAL_DB_URL, '-c', sql]);
        let err = ''; c.stderr.on('data', (d) => { err += String(d); }); c.on('close', (k) => resolve({ code: k, err }));
      });
      const advance = psql(`begin; ${persistSql({ code, match: B, status: 'lobby', seq: 0, ev: 0, state: null })}; select pg_sleep(0.6); commit`);
      await new Promise((r) => setTimeout(r, 250 + (i % 3) * 100));
      const stale = await psql(persistSql({ code, match: A, status: 'playing', seq: 11, ev: 13 }));
      const adv = await advance;
      expect(adv.code).toBe(0);
      expect(stale.code).toBe(1); // blocked on the advisory lock, then refused once B is committed
      expect(stale.err).toMatch(/room_live_session_stale_generation/);
      expect(JSON.parse(snapshot(code)).match_id).toBe(B);
    }
  });

  describe('writer epoch (equal sequence does not mean same writer)', () => {
    it('an OLDER process cannot overwrite a NEWER process at an equal sequence tuple', () => {
      const code = newCode(); const M = randomUUID();
      put({ code, match: M, seq: 10, ev: 12, epoch: 5, shell: { ready: 'new' }, state: { sequence: 10, board: 'new' } });
      const before = snapshot(code);
      rejects({ code, match: M, seq: 10, ev: 12, epoch: 3, shell: { ready: 'old' }, state: { sequence: 10, board: 'old' } }, 'room_live_session_stale_writer');
      rejects({ code, match: M, seq: 40, ev: 50, epoch: 3 }, 'room_live_session_stale_writer'); // even a HIGHER sequence
      rejects({ code, match: M, seq: 10, ev: 12, shell: {}, state: { sequence: 10, board: 'legacy' } }, 'room_live_session_stale_writer'); // epoch-less (BRIDGE) writer
      expect(snapshot(code)).toBe(before);
    });
    it('the SAME process may rewrite an equal tuple with a different payload (response-loss retry, ready flags)', () => {
      const code = newCode(); const M = randomUUID();
      put({ code, match: M, seq: 10, ev: 12, epoch: 5, state: { sequence: 10, action: 'X' } });
      put({ code, match: M, seq: 10, ev: 12, epoch: 5, state: { sequence: 10, action: 'Y' } });
      put({ code, match: M, seq: 10, ev: 12, epoch: 5, state: { sequence: 10, action: 'Y' }, shell: { nextHandReady: ['a'] } });
      expect(JSON.parse(snapshot(code)).game_state.action).toBe('Y');
    });
    it('a NEWER process takes over at an equal or higher tuple; a legacy row yields to any epoch', () => {
      const code = newCode(); const M = randomUUID();
      put({ code, match: M, seq: 10, ev: 12 });                 // legacy / BRIDGE writer: epoch 0
      put({ code, match: M, seq: 10, ev: 12, epoch: 4 });       // NEW process takes over
      put({ code, match: M, seq: 10, ev: 12, epoch: 9 });       // a still newer process
      rejects({ code, match: M, seq: 10, ev: 12, epoch: 4 }, 'room_live_session_stale_writer');
    });
    it('a lower sequence is still refused even from a newer process (it hydrated stale state): fail closed', () => {
      const code = newCode(); const M = randomUUID();
      put({ code, match: M, seq: 20, ev: 22, epoch: 4 });
      rejects({ code, match: M, seq: 12, ev: 14, epoch: 9 }, 'room_live_session_stale_write');
    });
    it('malformed epochs are treated as 0 and never raise a cast error or bypass the fence', () => {
      const code = newCode(); const M = randomUUID();
      put({ code, match: M, seq: 10, ev: 12, epoch: 5 });
      for (const bad of ['abc', null, -7, { x: 1 }, [9], true, '9999']) {
        rejects({ code, match: M, seq: 10, ev: 12, epoch: bad }, 'room_live_session_stale_writer');
      }
      const code2 = newCode(); const M2 = randomUUID();
      put({ code: code2, match: M2, seq: 1, ev: 1, epoch: 'abc' });
      put({ code: code2, match: M2, seq: 2, ev: 2, epoch: null });
    });
  });

  describe('ordering key is NULL-safe and explicit (historical / malformed sequence values)', () => {
    const upsertRaw = (code: string, match: string, cols: string, vals: string) =>
      localSql(`insert into public.room_live_sessions(room_code,match_id,status,source_type,${cols}) values ('${code}','${match}','playing','private',${vals})
        on conflict (room_code) do update set ${cols.split(',').map((c) => `${c}=excluded.${c}`).join(',')}`);
    it('NULL components never silently bypass the fence (rejected by the fence or by NOT NULL, never stored)', () => {
      const code = newCode(); const M = randomUUID();
      put({ code, match: M, seq: 10, ev: 12 });
      const before = snapshot(code);
      expect(() => upsertRaw(code, M, 'game_state_sequence,last_event_sequence', 'null,5')).toThrow();
      expect(() => upsertRaw(code, M, 'game_state_sequence,last_event_sequence', '10,null')).toThrow();
      expect(snapshot(code)).toBe(before);
    });
    it('uses the larger of the column and game_state.sequence; missing / non-numeric state sequence counts as the column alone', () => {
      const code = newCode(); const M = randomUUID();
      put({ code, match: M, seq: 21, ev: 30, state: { sequence: 21 } });
      rejects({ code, match: M, seq: 0, ev: 30, state: { sequence: 5 } }, 'room_live_session_stale_write'); // column lies low, state is old
      rejects({ code, match: M, seq: 3, ev: 30, state: { sequence: 'nope' } }, 'room_live_session_stale_write');
      rejects({ code, match: M, seq: 3, ev: 30, state: {} }, 'room_live_session_stale_write');
      rejects({ code, match: M, seq: -4, ev: 30, state: null }, 'room_live_session_stale_write');
      put({ code, match: M, seq: 0, ev: 31, state: { sequence: 22 } });                      // column lies low, state is newer: accepted
    });
    it('zero and negative stored values order numerically; an old shell that is not an object is tolerated', () => {
      const code = newCode(); const M = randomUUID();
      put({ code, match: M, seq: 0, ev: 0, state: null });
      put({ code, match: M, seq: 0, ev: 0, state: null });            // equal accepted
      put({ code, match: M, seq: 0, ev: 1, state: null });
      localSql(`update public.room_live_sessions set room_shell='[]'::jsonb where room_code='${code}'`);
      put({ code, match: M, seq: 1, ev: 2, state: null });
      localSql(`update public.room_live_sessions set room_shell='null'::jsonb where room_code='${code}'`);
      put({ code, match: M, seq: 2, ev: 3, state: null });
      const neg = newCode(); const N = randomUUID();
      put({ code: neg, match: N, seq: -3, ev: 0, state: null });
      put({ code: neg, match: N, seq: -2, ev: 0, state: null });
      rejects({ code: neg, match: N, seq: -3, ev: 0, state: null }, 'room_live_session_stale_write');
    });
  });
});
