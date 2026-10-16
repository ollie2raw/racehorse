/**
 * Terminal-completion recovery against REAL PostgreSQL + PostgREST (owned loopback instance), with
 * deterministic HTTP-boundary faults around real commits. Opt-in: see server/test/fixtures/README.md
 * ("Terminal completion R1") for setup. Skipped unless both loopback URLs match exactly.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalPostgrestGateway, type LocalPostgrestGateway } from '../../test/support/localPostgrestGateway';

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
const matchLog = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('../stats/matchLog', () => ({
  appendMatch: vi.fn(async (entry: { id?: string }) => {
    if (entry.id && !matchLog.ids.includes(entry.id)) matchLog.ids.push(entry.id);
    return entry;
  }),
}));

import { assertNotProductionSupabase } from '../platform/env/productionSupabaseGuard';
import { createReservedRoom, deleteRoom, peekRoom } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { processAllPendingRatingGames, resetRatingCatchUpForTests } from '../ranking/periodService';
import { runRoomRetention } from './roomRetentionReaper';
import { createGameOverPersistScheduler } from '../realtime/gameOverPersistence';
import { persistRoomMatchLog } from './roomMatchLogPersistence';
import { ensureRoomHydrated, loadLiveRoomSession } from './roomLivePersistence';
import { setRoomRoster } from './roomSession';
import { buildGameOverReplayInput } from './terminalCompletionRecovery';
import {
  recoverStrandedTerminalCompletions,
  resetTerminalCompletionRecoveryForTests,
  TERMINAL_RECOVERY_MAX_ATTEMPTS,
} from './terminalCompletionRecovery';
import {
  localSql,
  mkTerminalGameState,
  seedAccount,
  seedTerminalSession,
  terminalDbEnabled,
  truncateCompletionTables,
  TERMINAL_POSTGREST_URL,
} from './terminalCompletionTestKit';
import { randomUUID } from 'node:crypto';

const run = terminalDbEnabled() ? describe : describe.skip;
const FAR_FUTURE = () => Date.now() + 60_000;
const sweep = (extra: Parameters<typeof recoverStrandedTerminalCompletions>[0] = {}) =>
  recoverStrandedTerminalCompletions({ now: FAR_FUTURE(), minAgeMs: 0, ...extra });

let gateway: LocalPostgrestGateway;

const shell = (code: string) =>
  JSON.parse(localSql(`select room_shell from public.room_live_sessions where room_code='${code}'`)) as Record<string, unknown>;
const rowExists = (code: string) => Number(localSql(`select count(*) from public.room_live_sessions where room_code='${code}'`)) === 1;
const rankedFor = (matchId: string) =>
  JSON.parse(
    localSql(`select coalesce(json_agg(json_build_object('player',player_id,'delta',delta,'after',rating_after,'ctx',rating_context,'outcome',outcome,'score',player_score,'opp',opponent_score) order by player_id),'[]') from public.ranked_games where source_match_id='${matchId}'`),
  ) as Array<{ player: string; delta: number | null; after: number | null; ctx: { treatment: string; cause: string } | null; outcome: string; score: number; opp: number }>;
const receipts = (...ids: string[]) =>
  Number(localSql(`select count(*) from public.rating_periods where user_id in (${ids.map((id) => `'${id}'`).join(',')})`));
const archive = (matchId: string) => Number(localSql(`select count(*) from public.room_match_logs where match_id='${matchId}'`));

run('terminal completion recovery (real PostgreSQL + PostgREST)', () => {
  beforeAll(async () => {
    assertNotProductionSupabase('terminal completion R1 local PostgreSQL');
    gateway = await startLocalPostgrestGateway({ upstream: TERMINAL_POSTGREST_URL, port: 55441 });
    holder.url = gateway.url;
  });
  afterAll(async () => {
    await gateway?.close();
  });
  beforeEach(() => {
    truncateCompletionTables();
    gateway.reset();
    matchLog.ids.length = 0;
    resetTerminalCompletionRecoveryForTests();
    resetRatingCatchUpForTests();
  });
  afterEach(() => {
    gateway.faults.length = 0;
  });

  describe('crash boundaries (ranked human vs human, normal completion)', () => {
    async function rankedGame() {
      const a = seedAccount('tca', 1500);
      const b = seedAccount('tcb', 1500);
      const seeded = await seedTerminalSession({
        seatA: { userId: a, username: 'A' },
        seatB: { userId: b, username: 'B' },
        scores: { a: 60, b: 42 },
      });
      return { a, b, ...seeded };
    }

    it('A: crash BEFORE the terminal snapshot — row is non-terminal, the sweep ignores it and spends one request', async () => {
      const a = seedAccount('tca');
      const b = seedAccount('tcb');
      const s = await seedTerminalSession({ seatA: { userId: a }, seatB: { userId: b }, nonTerminal: true });
      expect(localSql(`select status from public.room_live_sessions where room_code='${s.code}'`)).toBe('playing');
      gateway.reset();
      const result = await sweep();
      expect(result.scanned).toBe(0);
      expect(gateway.requests).toHaveLength(1); // the single lightweight scan
      expect(rankedFor(s.matchId)).toEqual([]);
    });

    it('B: terminal snapshot durable, completion never attempted — a fresh sweep replays it exactly once', async () => {
      const g = await rankedGame();
      expect(shell(g.code)).toMatchObject({ completionPending: true, matchLogged: false });
      expect(rankedFor(g.matchId)).toEqual([]);

      const result = await sweep();
      expect(result.outcomes.recovered).toBe(1);

      const rows = rankedFor(g.matchId);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.after !== null && r.delta !== null)).toBe(true);
      expect(receipts(g.a, g.b)).toBe(2);
      expect(rows.find((r) => r.player === g.a)).toMatchObject({ outcome: 'win', score: 60, opp: 42, ctx: { treatment: 'standard', cause: 'completed' } });
      expect(matchLog.ids).toEqual([g.matchId]);
      // marker flipped, archive written, row eligible for (and given) normal cleanup
      expect(archive(g.matchId)).toBe(1);
      expect(rowExists(g.code)).toBe(false);
      expect(peekRoom(g.code)).toBeUndefined(); // never reopened as an active room
    });

    it('C1: completion request lost BEFORE commit — replay completes, still one logical completion', async () => {
      const g = await rankedGame();
      gateway.faults.push({ name: 'lose-ranked-a', phase: 'before', match: (r) => r.method === 'POST' && r.path.startsWith('/ranked_games') });
      const first = await sweep();
      expect(first.outcomes.failed).toBe(1);
      expect(rankedFor(g.matchId).length).toBeLessThan(2);
      // a lost request is infrastructure: recorded as a transient failure, NOT against the quarantine budget
      expect(shell(g.code)).toMatchObject({ completionPending: true, completionRecovery: { attempts: 0, transientFailures: 1 } });

      const second = await sweep();
      expect(second.outcomes.recovered).toBe(1);
      expect(rankedFor(g.matchId)).toHaveLength(2);
      expect(receipts(g.a, g.b)).toBe(2);
    });

    it('C2: completion COMMITTED but response lost — replay is a duplicate no-op; the rating catch-up owns the pending rating once', async () => {
      const g = await rankedGame();
      gateway.faults.push({ name: 'drop-ranked-response', phase: 'after', times: 1, match: (r) => r.method === 'POST' && r.path.startsWith('/ranked_games') });
      const first = await sweep();
      expect(first.outcomes.failed).toBe(1);
      expect(rankedFor(g.matchId)).toHaveLength(1); // seat A committed; its response was lost
      expect(receipts(g.a, g.b)).toBe(0); // no rating applied: the unit never completed

      const second = await sweep();
      expect(second.outcomes.recovered).toBe(1);
      expect(rankedFor(g.matchId)).toHaveLength(2); // no duplicate rows
      // The existing catch-up owns every committed-but-unrated ranked_games row.
      const catchUp = await processAllPendingRatingGames();
      expect(catchUp.errors).toEqual([]);
      expect(receipts(g.a, g.b)).toBe(2);
      await processAllPendingRatingGames(); // and running it again changes nothing
      expect(receipts(g.a, g.b)).toBe(2);
      expect(rankedFor(g.matchId).every((r) => r.after !== null)).toBe(true);
    });

    it('D: completion committed, room marker still false — replay finds only duplicates and sets the marker', async () => {
      const g = await rankedGame();
      const first = await sweep();
      expect(first.outcomes.recovered).toBe(1);
      // Re-create the pre-marker durable state: terminal row restored with matchLogged=false. The sweep retired and deleted the
      // row, and the database (correctly) refuses to recreate a retired match unless the writer declares restore intent -- the
      // same intent guard.restoreLiveSession declares. The flag is transaction-local and the match is still the room's newest.
      localSql(`select set_config('racehorse.room_restore','on',true); insert into public.room_live_sessions (room_code,match_id,status,source_type,game_state,game_state_sequence,room_shell,engine_seat_ids,roster,events,participant_user_ids)
        values ('${g.code}','${g.matchId}','game_over','private',
        '${JSON.stringify((await readStateFromArchive(g.matchId)))}'::jsonb,21,
        '{"matchLogged":false,"completionPending":true,"config":{"winningScore":60},"durabilityCommit":null}'::jsonb,
        array['${g.seatA}','${g.seatB}'],
        '[{"seatId":"${g.seatA}","userId":"${g.a}","username":"A"},{"seatId":"${g.seatB}","userId":"${g.b}","username":"B"}]'::jsonb,'[]'::jsonb,array['${g.a}','${g.b}']::uuid[])`);
      const rowsBefore = rankedFor(g.matchId);
      const second = await sweep();
      expect(second.outcomes.recovered).toBe(1);
      expect(rankedFor(g.matchId)).toEqual(rowsBefore); // byte-identical: no duplicate effects
      expect(receipts(g.a, g.b)).toBe(2);
      expect(rowExists(g.code)).toBe(false);
    });

    it('E: marker committed, archive/cleanup not done — never rescanned, and the ordinary reaper may collect it', async () => {
      const g = await rankedGame();
      await sweep();
      // Simulate crash after the marker: a logged-but-undeleted terminal row.
      const s2 = await seedTerminalSession({
        seatA: { userId: g.a }, seatB: { userId: g.b }, matchLogged: true,
      });
      expect(shell(s2.code)).toMatchObject({ completionPending: false, matchLogged: true });
      gateway.reset();
      const result = await sweep();
      expect(result.scanned).toBe(0);
      expect(gateway.requests).toHaveLength(1);
      localSql(`update public.room_live_sessions set updated_at = now() - interval '8 days' where room_code='${s2.code}'`);
      const reaped = await runRoomRetention();
      expect(reaped.liveSessionsDeleted).toBe(1);
      expect(rowExists(s2.code)).toBe(false);
    });

    it('G: the recovery process crashes before acknowledging (marker write lost) — a fresh sweep converges without duplicates', async () => {
      const g = await rankedGame();
      gateway.faults.push({
        name: 'lose-marker',
        phase: 'before',
        times: 4,
        match: (r) => r.method === 'PATCH' && r.path.startsWith('/room_live_sessions'),
      });
      const first = await sweep();
      expect(first.outcomes.recovered + first.outcomes.raced + first.outcomes.failed).toBeGreaterThanOrEqual(1);
      expect(rowExists(g.code)).toBe(true);
      const rowsAfterFirst = rankedFor(g.matchId);
      expect(rowsAfterFirst).toHaveLength(2);

      gateway.faults.length = 0;
      const second = await sweep();
      expect(second.outcomes.recovered).toBe(1);
      expect(rankedFor(g.matchId)).toHaveLength(2);
      expect(receipts(g.a, g.b)).toBe(2);
      expect(rowExists(g.code)).toBe(false);
    });

    it('cleanup guard: the retention reaper never deletes an unlogged terminal row, even when old', async () => {
      const g = await rankedGame();
      localSql(`update public.room_live_sessions set updated_at = now() - interval '30 days' where room_code='${g.code}'`);
      await runRoomRetention();
      expect(rowExists(g.code)).toBe(true);
      const result = await sweep();
      expect(result.outcomes.recovered).toBe(1);
    });

    it('two concurrent sweeps and a foreground-equivalent replay produce one logical completion', async () => {
      const g = await rankedGame();
      const [x, y] = await Promise.all([sweep(), sweep()]);
      expect(x).toBe(y); // single-flight: the same sweep result
      expect(rankedFor(g.matchId)).toHaveLength(2);
      expect(receipts(g.a, g.b)).toBe(2);
      expect(matchLog.ids).toEqual([g.matchId]);
    });
  });

  describe('mode matrix', () => {
    const settle = async () => {
      const result = await sweep();
      expect(result.outcomes.recovered).toBe(1);
    };

    it('unranked human vs human (guests): logged once, no ranked rows, archived, row cleaned up', async () => {
      const s = await seedTerminalSession({ seatA: { userId: 'guest_a1' }, seatB: { userId: 'guest_b1' } });
      await settle();
      expect(rankedFor(s.matchId)).toEqual([]);
      expect(matchLog.ids).toEqual([s.matchId]);
      expect(archive(s.matchId)).toBe(1);
      expect(rowExists(s.code)).toBe(false);
    });

    it('account vs guest: no ranked rows (an opponent without an account is never rated)', async () => {
      const a = seedAccount('tcm');
      const s = await seedTerminalSession({ seatA: { userId: a }, seatB: { userId: 'guest_b2' } });
      await settle();
      expect(rankedFor(s.matchId)).toEqual([]);
      expect(rowExists(s.code)).toBe(false);
    });

    it('authenticated Fritz room: pending-Fritz row resolved, activity written once, nothing rated here', async () => {
      const human = seedAccount('tcf');
      const s = await seedTerminalSession({
        seatA: { userId: human, username: 'Human' },
        seatB: { seatId: 'bot:fritz:elite-1', userId: null, username: 'Fritz' },
        fritzTier: 'elite',
        scores: { a: 60, b: 20 },
      });
      localSql(`insert into public.bot_match_pending(user_id,fritz_tier,room_code,resolved) values ('${human}','elite','${s.code}',false)`);
      await settle();
      expect(localSql(`select resolved from public.bot_match_pending where room_code='${s.code}'`)).toBe('t');
      // writeMatchActivity is fire-and-forget by design: give the detached write a moment, then
      // assert exactly one deduped row for the human (the bot has no feed).
      const deadline = Date.now() + 3000;
      const activityCount = () => Number(localSql(`select count(*) from public.activity_feed where dedupe_key like '%${s.matchId}%'`));
      while (activityCount() === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(activityCount()).toBe(1);
      expect(rankedFor(s.matchId)).toEqual([]);
      expect(rowExists(s.code)).toBe(false);
    });

    it('guest Fritz room: logged with no account or rating writes', async () => {
      const s = await seedTerminalSession({
        seatA: { userId: 'guest_h1' },
        seatB: { seatId: 'bot:fritz:elite-2', userId: null, username: 'Fritz' },
      });
      await settle();
      expect(rankedFor(s.matchId)).toEqual([]);
      expect(matchLog.ids).toEqual([s.matchId]);
    });

    it('ordinary forfeit: replayed with the durable reason, the leaver loses even when ahead on points', async () => {
      const a = seedAccount('tfa', 1500);
      const b = seedAccount('tfb', 1500);
      const s = await seedTerminalSession({
        kind: 'forfeit',
        seatA: { userId: a },
        seatB: { userId: b },
        scores: { a: 40, b: 10 }, // A leads, but A quits
        abandonerUserId: a,
        forfeitReason: 'manual',
      });
      expect(shell(s.code)).toMatchObject({ completionPending: true, abandonedForfeitReason: 'manual' });
      await settle();
      const rows = rankedFor(s.matchId);
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.player === a)).toMatchObject({ outcome: 'loss', score: 40, opp: 10, ctx: { treatment: 'standard', cause: 'manual_forfeit' } });
      expect(rows.find((r) => r.player === b)).toMatchObject({ outcome: 'win' });
      expect(receipts(a, b)).toBe(2);
      expect(rowExists(s.code)).toBe(false);
    });

    it('disconnect forfeit keeps its half-weight treatment through a restart replay (parity with an uninterrupted forfeit)', async () => {
      const delta = async (reason: 'manual' | 'disconnect_timeout') => {
        const a = seedAccount('tda', 1500);
        const b = seedAccount('tdb', 1500);
        const s = await seedTerminalSession({
          kind: 'forfeit', seatA: { userId: a }, seatB: { userId: b }, scores: { a: 20, b: 20 },
          abandonerUserId: a, forfeitReason: reason,
        });
        const result = await sweep();
        expect(result.outcomes.recovered).toBe(1);
        const rows = rankedFor(s.matchId);
        return { loser: rows.find((r) => r.player === a)!, ctx: rows[0]!.ctx! };
      };
      const manual = await delta('manual');
      const disconnect = await delta('disconnect_timeout');
      expect(disconnect.ctx).toMatchObject({ treatment: 'disconnect_forfeit', cause: 'disconnect_timeout' });
      expect(manual.loser.delta!).toBeLessThan(0);
      expect(disconnect.loser.delta! / manual.loser.delta!).toBeCloseTo(0.5, 5);
    });

    it('a forfeit that never produced rated rows (guest seat) owes nothing and is never scanned', async () => {
      const a = seedAccount('tga');
      const s = await seedTerminalSession({
        kind: 'forfeit', seatA: { userId: a }, seatB: { userId: 'guest_x' }, abandonerUserId: a,
      });
      expect(shell(s.code)).toMatchObject({ completionPending: false });
      gateway.reset();
      const result = await sweep();
      expect(result.scanned).toBe(0);
    });

    it('tournament-owned terminal rows are out of scope and never touched', async () => {
      const a = seedAccount('tta');
      const b = seedAccount('ttb');
      const s = await seedTerminalSession({ seatA: { userId: a }, seatB: { userId: b }, sourceType: 'tournament' });
      const result = await sweep();
      expect(result.scanned).toBe(0);
      expect(rowExists(s.code)).toBe(true);
      expect(rankedFor(s.matchId)).toEqual([]);
    });

    it('a room this process still owns is skipped while its foreground completion is pending, and taken over once it gave up', async () => {
      const a = seedAccount('tla');
      const b = seedAccount('tlb');
      const s = await seedTerminalSession({ seatA: { userId: a }, seatB: { userId: b } });
      const live = createReservedRoom(s.code, { winningScore: 60 });
      live.matchId = s.matchId;
      live.gameOverPersistStatus = 'pending';
      const skipped = await sweep();
      expect(skipped.outcomes.skipped_live).toBe(1);
      expect(rankedFor(s.matchId)).toEqual([]);

      live.gameOverPersistStatus = 'failed';
      const taken = await sweep();
      expect(taken.outcomes.recovered).toBe(1);
      expect(live.matchLogged).toBe(true);
      expect(live.gameOverPersistStatus).toBe('succeeded'); // unblocks a waiting rematch
      deleteRoom(s.code);
    });
  });

  describe('poison rows, fairness and request budget', () => {
    function bulkStranded(count: number, options: { logged?: boolean; startAgoMinutes?: number; seed?: string } = {}) {
      const rows: string[] = [];
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const code = `BK${(options.seed ?? 'S')}${String(i).padStart(3, '0')}`.slice(0, 8).toUpperCase();
        const matchId = randomUUID();
        ids.push(code);
        const seatA = `seat-a-${code}`;
        const seatB = `seat-b-${code}`;
        const state = mkTerminalGameState(seatA, seatB, { a: 60, b: 11 });
        const shellJson = {
          matchLogged: options.logged === true,
          completionPending: options.logged === true ? false : true,
          config: { winningScore: 60 },
        };
        const roster = [
          { seatId: seatA, userId: null, username: 'A' },
          { seatId: seatB, userId: null, username: 'B' },
        ];
        const ageMinutes = (options.startAgoMinutes ?? 60) - i * 0.01; // strictly increasing age order: i=0 is oldest
        rows.push(`('${code}','${matchId}','game_over','private',$j$${JSON.stringify(state)}$j$::jsonb,21,$j$${JSON.stringify(shellJson)}$j$::jsonb,array['${seatA}','${seatB}'],$j$${JSON.stringify(roster)}$j$::jsonb,'[]'::jsonb,'{}',now() - interval '${ageMinutes} minutes')`);
      }
      localSql(`insert into public.room_live_sessions (room_code,match_id,status,source_type,game_state,game_state_sequence,room_shell,engine_seat_ids,roster,events,participant_user_ids,updated_at) values ${rows.join(',')}`);
      return ids;
    }

    it('nothing stranded: exactly one lightweight request', async () => {
      const result = await sweep();
      expect(result.scanned).toBe(0);
      expect(gateway.requests).toHaveLength(1);
      expect(gateway.requests[0]!.path).toContain('select=room_code%2Cmatch_id%2Cstatus%2Cupdated_at');
      expect(gateway.requests[0]!.path).not.toContain('game_state');
    });

    it('one stranded room: a fixed, small request count', async () => {
      const [code] = bulkStranded(1);
      gateway.reset();
      const result = await sweep();
      expect(result.outcomes.recovered).toBe(1);
      const perRow = gateway.requests.length;
      // scan + load + marker(GET,PATCH) + (no events => no archive) + delete + ordinary pipeline reads
      expect(perRow).toBeLessThanOrEqual(8);
      expect(rowExists(code!)).toBe(false);
      (globalThis as { __perRowRequests?: number }).__perRowRequests = perRow;
    });

    it('100 already-completed terminal rooms cost one request and zero loads', async () => {
      bulkStranded(100, { logged: true, seed: 'L' });
      gateway.reset();
      const result = await sweep();
      expect(result.scanned).toBe(0);
      expect(gateway.requests).toHaveLength(1);
    });

    it('100 genuinely stranded rooms: bounded per sweep, oldest first, linear (no N+1), and fully drained', async () => {
      const codes = bulkStranded(100, { seed: 'G' });
      gateway.reset();
      const first = await sweep();
      expect(first.outcomes.recovered).toBe(25); // TERMINAL_RECOVERY_MAX_ROWS_PER_SWEEP
      const firstSweepRequests = gateway.requests.length;
      const perRow = (globalThis as { __perRowRequests?: number }).__perRowRequests ?? 8;
      expect(firstSweepRequests).toBeLessThanOrEqual(25 * perRow + 4);
      // deterministic ordering: the 25 oldest rows are the ones that were handled
      const remaining = new Set(localSql(`select room_code from public.room_live_sessions`).split('\n'));
      for (const code of codes.slice(0, 25)) expect(remaining.has(code)).toBe(false);
      for (const code of codes.slice(25)) expect(remaining.has(code)).toBe(true);

      for (let i = 0; i < 3; i += 1) await sweep();
      expect(Number(localSql('select count(*) from public.room_live_sessions'))).toBe(0);
      // linear in handled rows: ~perRow requests each, never a per-row re-scan
      expect(gateway.requests.length).toBeLessThanOrEqual(100 * perRow + 16);
    });

    it('a malformed terminal row is quarantined once and never blocks the valid row behind it', async () => {
      const bad = bulkStranded(1, { seed: 'BAD', startAgoMinutes: 120 })[0]!;
      localSql(`update public.room_live_sessions set game_state=null where room_code='${bad}'`);
      const [good] = bulkStranded(1, { seed: 'OK', startAgoMinutes: 30 });
      const first = await sweep();
      expect(first.outcomes.quarantined).toBe(1);
      expect(first.outcomes.recovered).toBe(1);
      expect(rowExists(good!)).toBe(false);
      expect(shell(bad)).toMatchObject({ completionPending: true, completionRecovery: { attempts: 1 } });
      expect((shell(bad).completionRecovery as { quarantinedAt?: string }).quarantinedAt).toBeTruthy();

      gateway.reset();
      const second = await sweep();
      expect(second.scanned).toBe(0); // no poison loop: the quarantined row is excluded server-side
      expect(gateway.requests).toHaveLength(1);
      // and it is retained for an operator: the reaper will not delete it
      localSql(`update public.room_live_sessions set updated_at = now() - interval '30 days' where room_code='${bad}'`);
      await runRoomRetention();
      expect(rowExists(bad)).toBe(true);
    });

    it('a long infrastructure outage never quarantines a legitimate completion; it completes when the outage ends', async () => {
      const acct1 = seedAccount('tou1');
      const acct2 = seedAccount('tou2');
      const seeded = await seedTerminalSession({ seatA: { userId: acct1 }, seatB: { userId: acct2 } });
      const stranded = seeded.code;
      const matchId = seeded.matchId;
      gateway.faults.push({ name: 'outage', phase: 'before', times: 999, match: (r) => r.method === 'POST' && r.path.startsWith('/ranked_games') });
      for (let i = 1; i <= TERMINAL_RECOVERY_MAX_ATTEMPTS + 3; i += 1) {
        const r = await sweep();
        expect(r.outcomes.quarantined).toBe(0);
        expect(r.outcomes.failed).toBe(1);
      }
      const during = shell(stranded).completionRecovery as { attempts: number; transientFailures: number; quarantinedAt?: string };
      expect(during.attempts).toBe(0);
      expect(during.transientFailures).toBe(TERMINAL_RECOVERY_MAX_ATTEMPTS + 3);
      expect(during.quarantinedAt).toBeUndefined();
      expect(shell(stranded).completionPending).toBe(true);
      expect(rankedFor(matchId)).toEqual([]);
      gateway.faults.length = 0;
      const recovered = await sweep();
      expect(recovered.outcomes.recovered).toBe(1);
      expect(rankedFor(matchId)).toHaveLength(2);
      expect(rowExists(stranded)).toBe(false);
    });

    it('a persistently failing row backs off behind younger rows and quarantines after the attempt ceiling', async () => {
      const [poison] = bulkStranded(1, { seed: 'PZ', startAgoMinutes: 120 });
      const poisonMatch = localSql(`select match_id from public.room_live_sessions where room_code='${poison}'`);
      const { appendMatch } = await import('../stats/matchLog');
      vi.mocked(appendMatch).mockImplementation(async (entry: { id?: string }) => {
        if (entry.id === poisonMatch) throw new Error('permanent_downstream_failure');
        if (entry.id && !matchLog.ids.includes(entry.id)) matchLog.ids.push(entry.id);
        return entry as never;
      });
      try {
        for (let attempt = 1; attempt <= TERMINAL_RECOVERY_MAX_ATTEMPTS; attempt += 1) {
          const [fresh] = bulkStranded(1, { seed: `F${attempt}`, startAgoMinutes: 10 });
          const result = await sweep();
          expect(rowExists(fresh!)).toBe(false); // younger valid rows are never starved by the poison row
          if (attempt < TERMINAL_RECOVERY_MAX_ATTEMPTS) {
            expect(result.outcomes.failed).toBe(1);
            expect(shell(poison!)).toMatchObject({ completionRecovery: { attempts: attempt } });
            expect((shell(poison!).completionRecovery as { quarantinedAt?: string }).quarantinedAt).toBeUndefined();
          } else {
            expect(result.outcomes.quarantined).toBe(1);
          }
        }
        gateway.reset();
        expect((await sweep()).scanned).toBe(0);
        expect(gateway.requests).toHaveLength(1);
        expect(rowExists(poison!)).toBe(true);
      } finally {
        const real = await import('../stats/matchLog');
        vi.mocked(real.appendMatch).mockImplementation(async (entry: { id?: string }) => {
          if (entry.id && !matchLog.ids.includes(entry.id)) matchLog.ids.push(entry.id);
          return entry as never;
        });
      }
    });
  });

  describe('foreground interaction, cleanup guard and hydration', () => {
    it('foreground gives up (all attempts lost before commit) -> row retained at cleanup -> fresh sweep completes it', async () => {
      const a = seedAccount('tfg1');
      const b = seedAccount('tfg2');
      const s = await seedTerminalSession({ seatA: { userId: a }, seatB: { userId: b } });
      const loaded = await loadLiveRoomSession(s.code);
      if (loaded.kind !== 'found') throw new Error('seed row missing');
      const input = buildGameOverReplayInput(loaded.row);
      // The foreground scheduler works on the live room object: register an equivalent one.
      const live = createReservedRoom(s.code, { winningScore: 60 });
      live.matchId = s.matchId;
      live.players = [s.seatA, s.seatB];
      live.state = loaded.row.game_state;
      live.events = loaded.row.events;
      live.eventSequence = loaded.row.last_event_sequence;
      setRoomRoster(s.code, s.roster);
      gateway.faults.push({ name: 'lose-all', phase: 'before', times: 99, match: (r) => r.method === 'POST' && r.path.startsWith('/ranked_games') });
      const io = { to: () => ({ emit: () => undefined }) } as never;
      const outcome = await createGameOverPersistScheduler(io)({ ...input, room: live, replayRoster: undefined })();
      expect(outcome).toBe('failed');
      expect(live.matchLogged).toBe(false);
      expect(live.gameOverPersistStatus).toBe('failed');
      gateway.faults.length = 0;

      // normal cleanup archives the match but must NOT delete the only replay source
      await persistRoomMatchLog(live, 'completed');
      expect(archive(s.matchId)).toBe(1);
      expect(rowExists(s.code)).toBe(true);
      expect(shell(s.code)).toMatchObject({ completionPending: true });
      deleteRoom(s.code);

      const result = await sweep();
      expect(result.outcomes.recovered).toBe(1);
      expect(rankedFor(s.matchId)).toHaveLength(2);
      expect(rowExists(s.code)).toBe(false);
    }, 30_000);

    it('once the completion is logged, ordinary cleanup deletes the row (control for the guard)', async () => {
      const a = seedAccount('tfg3');
      const b = seedAccount('tfg4');
      const s = await seedTerminalSession({ seatA: { userId: a }, seatB: { userId: b } });
      const loaded = await loadLiveRoomSession(s.code);
      if (loaded.kind !== 'found') throw new Error('seed row missing');
      const live = createReservedRoom(s.code, { winningScore: 60 });
      live.matchId = s.matchId;
      live.players = [s.seatA, s.seatB];
      live.state = loaded.row.game_state;
      live.events = loaded.row.events;
      live.matchLogged = true;
      setRoomRoster(s.code, s.roster);
      await persistRoomMatchLog(live, 'completed');
      expect(rowExists(s.code)).toBe(false);
      deleteRoom(s.code);
    });

    it('a stranded terminal room is evidence, not a playable room: hydration still refuses it and recovery never registers it', async () => {
      const a = seedAccount('tfh1');
      const b = seedAccount('tfh2');
      const s = await seedTerminalSession({ seatA: { userId: a }, seatB: { userId: b } });
      const hydrated = await ensureRoomHydrated(s.code);
      expect(hydrated).toMatchObject({ kind: 'snapshot_stale', error: 'snapshot_terminal' });
      expect(peekRoom(s.code)).toBeUndefined();
      await sweep();
      expect(peekRoom(s.code)).toBeUndefined();
      expect(await ensureRoomHydrated(s.code)).toMatchObject({ kind: 'not_found' });
    });

    it('foreground retry racing the sweep: one logical completion, the catch-up owns the pending rating', async () => {
      const a = seedAccount('tfr1');
      const b = seedAccount('tfr2');
      const s = await seedTerminalSession({ seatA: { userId: a }, seatB: { userId: b } });
      const loaded = await loadLiveRoomSession(s.code);
      if (loaded.kind !== 'found') throw new Error('seed row missing');
      const { replayGameOverCompletion } = await import('../realtime/gameOverPersistence');
      await Promise.all([
        sweep(),
        replayGameOverCompletion(buildGameOverReplayInput(loaded.row)),
        replayGameOverCompletion(buildGameOverReplayInput(loaded.row)),
      ]);
      await processAllPendingRatingGames();
      await processAllPendingRatingGames();
      expect(rankedFor(s.matchId)).toHaveLength(2);
      expect(receipts(a, b)).toBe(2);
      await sweep(); // whichever did not mark it yet
      expect(rowExists(s.code)).toBe(false);
    });
  });
});

async function readStateFromArchive(matchId: string): Promise<unknown> {
  const rows = await supabaseFetch<Array<{ state_snapshot: unknown }>>(
    `/rest/v1/room_match_logs?select=state_snapshot&match_id=eq.${matchId}`,
  );
  return rows[0]!.state_snapshot;
}
