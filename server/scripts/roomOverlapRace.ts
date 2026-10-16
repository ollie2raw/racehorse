/**
 * Render-style OLD/NEW process OVERLAP against real PostgreSQL + PostgREST, with the REAL room-persistence code of two
 * different server artifacts running as separate OS processes:
 *
 *   --old=<worktree root>   the process that owns the room first (e.g. production 3a65ab1c)
 *   --new=<worktree root>   the process that starts later and takes the database over (e.g. BRIDGE 3ccd6ff8)
 *
 * Boot order is OLD then NEW, exactly like a Render replacement. Each scenario drives both processes at the same room code
 * and reports whether the STALE (OLD) writer's data LANDED in the database. Scenarios:
 *   lower-sequence       OLD holds an older sequence; NEW persisted newer; OLD writes
 *   equal-sequence       same (game_state_sequence, last_event_sequence), different gameplay payload; OLD writes after NEW
 *   terminal             NEW persisted game_over (completion owed); OLD writes a stale playing snapshot
 *   hydrate-then-old     NEW hydrates the room from the database while OLD's socket/room still exists, NEW writes, OLD writes
 *   old-after-takeover   NEW owns the room (newer match state); OLD keeps writing equal and lower snapshots
 *   cross-generation     the room advanced to a new match on NEW; OLD writes the previous match
 *   delete-recreate      NEW completes + archives (terminal then DELETE); OLD wakes and writes the finished match
 *   reconnect-delete     NEW archives (terminal then DELETE) and a reconnect revives the SAME room in the SAME process
 *
 *   --expect=broken     assert the stale OLD write LANDS (reproduces the defect; baseline schema)
 *   --expect=tie-only   assert every scenario is fenced except equal-sequence (legacy epoch 0 vs 0 cannot be ordered)
 *   --expect=closed     assert every OLD write is fenced and the legitimate same-process reconnect is NOT lost
 *
 *   TERMINAL_R1_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1 \
 *   TERMINAL_R1_POSTGREST_URL=http://127.0.0.1:55440 npx tsx server/scripts/roomOverlapRace.ts --old=<root> --new=<root> --expect=closed
 */
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tsxLoaderUrl } from './tsxLoader';

const DB_URL = 'postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1';
const REST_URL = 'http://127.0.0.1:55440';
if (process.env.TERMINAL_R1_TEST_DATABASE_URL !== DB_URL || process.env.TERMINAL_R1_POSTGREST_URL !== REST_URL) {
  throw new Error('Refusing to run: exact owned loopback test database/PostgREST not configured');
}
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const SERVICE_KEY = (() => {
  const message = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 7200 })}`;
  return `${message}.${createHmac('sha256', 'racehorse-forfeit-r1-local-validation-only-secret').update(message).digest('base64url')}`;
})();
const sql = (query: string): string =>
  execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', DB_URL, '-c', query], { encoding: 'utf8', timeout: 15_000 }).trim();

// ------------------------------------------------------------------------------------------------ child
type Cmd =
  | { op: 'build'; code: string; matchId: string; a: string; b: string; kind: 'playing' | 'terminal' | 'lobby'; seq: number; ev: number; score: number; logged?: boolean }
  | { op: 'hydrate'; code: string }
  | { op: 'advance'; seq: number; ev: number; score: number }
  | { op: 'persist' }
  | { op: 'archive'; status: 'completed' | 'abandoned' }
  | { op: 'schedule' }
  | { op: 'idle'; ms: number }
  | { op: 'epoch' };

async function childMain(): Promise<void> {
  const root = process.env.ARTIFACT_ROOT!;
  const src = (p: string) => import(join(root, 'server', 'src', p));
  const [rooms, session, persistence, durability] = await Promise.all([src('rooms'), src('multiplayer/roomSession'), src('multiplayer/roomLivePersistence'), src('multiplayer/roomDurability')]);
  const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });
  const state = (a: string, b: string, score: number, over: boolean, seq: number) => ({
    config: { maxPips: 6, tilesPerPlayer: 7, deadTileCount: 2, scoringMultiple: 5, blockedHandRule: 'lowestPips', endHandBonus: 'sumOpponentPenalties', winningScore: 60 },
    playerIds: [a, b], players: { [a]: { id: a, hand: [t(6, 5)], score }, [b]: { id: b, hand: [t(4, 4)], score: 10 } },
    board: null, boneyard: [t(6, 6), t(5, 4)], deadTiles: [t(0, 0), t(1, 1)], currentPlayerIndex: 0, handNumber: 3, handOpen: true,
    handOver: false, gameOver: over, winnerId: over ? a : null, consecutivePasses: 0, sequence: seq,
  });
  let room: any = null;
  let roster: Array<{ seatId: string; userId: string | null; username: string }> = [];
  persistence.configureLiveRoomPersistence({ resolveRoster: () => roster });   // boot wiring: the NEW artifacts allocate their writer epoch here
  const requestLog: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => { requestLog.push(`${init?.method ?? 'GET'} ${String(input).replace(/^https?:\/\/[^/]+/, '').split('?')[0]}`); return realFetch(input, init); }) as typeof fetch;
  const outcome = () => ({ ok: true, durability: room?.durability?.status, error: room?.durability?.lastError ?? null });
  process.on('message', async (cmd: Cmd & { id: number }) => {
    const reply = (payload: unknown) => process.send?.({ id: cmd.id, payload });
    try {
      if (cmd.op === 'build') {
        room = rooms.createReservedRoom(cmd.code, { winningScore: 60 });
        room.matchId = cmd.matchId; room.players = [cmd.a, cmd.b]; room.eventLogVersion = 1; room.eventSequence = cmd.ev;
        room.state = cmd.kind === 'lobby' ? null : state(cmd.a, cmd.b, cmd.score, cmd.kind === 'terminal', cmd.seq);
        room.matchLogged = cmd.logged === true;
        room.leadTracker = { aId: cmd.a, bId: cmd.b, maxLeadA: 1, maxLeadB: 1 };
        const players = [{ id: cmd.a, socketId: '', username: 'Alice', userId: null }, { id: cmd.b, socketId: '', username: 'Bob', userId: null }];
        roster = players.map((p) => ({ seatId: p.id, userId: p.userId, username: p.username }));
        session.setRoomRoster(cmd.code, players);
        durability.markRoomDurabilityPending(room);
        return reply({ ok: true });
      }
      if (cmd.op === 'hydrate') {
        const result = await persistence.ensureRoomHydrated(cmd.code);
        room = result.room ?? rooms.peekRoom?.(cmd.code) ?? null;
        roster = (session.getRoomRoster?.(cmd.code) ?? []).map((p: any) => ({ seatId: p.id, userId: p.userId ?? null, username: p.username }));
        return reply({ ok: true, kind: result.kind, sequence: room?.state?.sequence ?? null, score: room?.state?.players?.[room.players[0]]?.score ?? null });
      }
      if (cmd.op === 'advance') {
        room.state = { ...room.state, sequence: cmd.seq, players: { ...room.state.players, [room.players[0]]: { ...room.state.players[room.players[0]], score: cmd.score } } };
        room.eventSequence = cmd.ev;
        durability.markRoomDurabilityPending(room);
        return reply({ ok: true });
      }
      if (cmd.op === 'persist') {
        requestLog.length = 0;
        const ok = await persistence.persistLiveRoomSessionNow(room, roster);
        return reply({ ...outcome(), ok, requests: requestLog.length });
      }
      if (cmd.op === 'archive') {
        requestLog.length = 0;
        await persistence.finalizeAndDeleteLiveRoomSession(room, cmd.status);
        return reply({ ...outcome(), requests: requestLog.length });
      }
      if (cmd.op === 'schedule') {
        // what a gameplay handler / disconnect grace does after a failed persist: schedule + flush again
        requestLog.length = 0;
        persistence.schedulePersistLiveRoomSessionForRoom(room);
        await persistence.flushScheduledLiveRoomPersistence(room.code);
        return reply({ ...outcome(), requests: requestLog.length });
      }
      if (cmd.op === 'idle') {
        requestLog.length = 0;
        await new Promise((r) => setTimeout(r, cmd.ms));
        return reply({ requests: requestLog.length, durability: room?.durability?.status });
      }
      if (cmd.op === 'epoch') return reply({ epochPresent: typeof persistence.settleLiveRoomWriterEpoch === 'function' });
    } catch (error) {
      reply({ ok: false, thrown: error instanceof Error ? error.message : String(error) });
    }
  });
  process.send?.({ id: -1, payload: 'ready' });
}

if (process.argv[2] === 'child') void childMain();
else void parentMain();

// ------------------------------------------------------------------------------------------------ parent
type Proc = { name: string; child: ChildProcess; call<T = any>(cmd: Cmd): Promise<T> };
let seqId = 0;
async function startProc(name: string, root: string, gatewayUrl: string, cwd: string): Promise<Proc> {
  const child = fork(__filename, ['child'], {
    cwd, execArgv: ['--import', tsxLoaderUrl()],
    env: { ...process.env, ARTIFACT_ROOT: root, SUPABASE_URL: gatewayUrl, SUPABASE_SERVICE_KEY: SERVICE_KEY, VITE_SUPABASE_ANON_KEY: SERVICE_KEY, NODE_ENV: 'development' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  child.stderr?.on('data', (d) => { if (process.env.RACE_VERBOSE) process.stderr.write(`[${name}] ${d}`); });
  const pending = new Map<number, (v: unknown) => void>();
  await new Promise<void>((resolve, reject) => {
    child.on('message', (m: { id: number; payload: unknown }) => { if (m.id === -1) return resolve(); pending.get(m.id)?.(m.payload); pending.delete(m.id); });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`${name} exited early (${code})`)));
  });
  return { name, child, call: (cmd) => new Promise((resolve) => { const id = ++seqId; pending.set(id, resolve as (v: unknown) => void); child.send({ ...cmd, id }); }) };
}
const rowOf = (code: string) => {
  const raw = sql(`select coalesce((select row_to_json(r)::text from (select match_id, status, game_state_sequence, last_event_sequence, (game_state->'players'->(engine_seat_ids[1])->>'score') as score, room_shell->>'completionPending' as pending from public.room_live_sessions where room_code='${code}') r),'null')`);
  return raw === 'null' ? null : (JSON.parse(raw) as { match_id: string; status: string; game_state_sequence: number; last_event_sequence: number; score: string | null; pending: string | null });
};

async function parentMain(): Promise<void> {
  const oldRoot = arg('old'); const newRoot = arg('new'); const expect = arg('expect') ?? 'report';
  if (!oldRoot || !newRoot) throw new Error('--old=<root> and --new=<root> are required');
  const { startLocalPostgrestGateway } = await import('../test/support/localPostgrestGateway');
  const gateway = await startLocalPostgrestGateway({ upstream: REST_URL });
  const cwd = mkdtempSync(join(tmpdir(), 'rh-overlap-'));
  const OLD = await startProc('OLD', oldRoot, gateway.url, cwd);      // boots first
  const NEW = await startProc('NEW', newRoot, gateway.url, cwd);      // boots second: the replacement instance
  sql('truncate public.room_live_sessions cascade');
  try { sql('truncate public.room_live_session_generations'); } catch { /* schema without the generation migration */ }

  const results: Array<{ scenario: string; landed: boolean | null; detail: string }> = [];
  const note = (scenario: string, landed: boolean | null, detail: string) => results.push({ scenario, landed, detail });
  const mk = () => { const id = randomUUID(); return { code: `OV${id.slice(0, 6).toUpperCase()}`, A: id, a: `seat-a-${id.slice(0, 4)}`, b: `seat-b-${id.slice(0, 4)}` }; };
  const seed = async (p: Proc, r: ReturnType<typeof mk>, o: { match?: string; kind?: 'playing' | 'terminal' | 'lobby'; seq: number; ev: number; score: number; logged?: boolean }) =>
    p.call({ op: 'build', code: r.code, matchId: o.match ?? r.A, a: r.a, b: r.b, kind: o.kind ?? 'playing', seq: o.seq, ev: o.ev, score: o.score, logged: o.logged });

  // 1 lower-sequence --------------------------------------------------------------------------------------------------
  { const r = mk();
    await seed(OLD, r, { seq: 10, ev: 12, score: 20 }); await OLD.call({ op: 'persist' });
    await NEW.call({ op: 'hydrate', code: r.code }); await NEW.call({ op: 'advance', seq: 14, ev: 16, score: 40 });
    await NEW.call({ op: 'persist' });
    await OLD.call({ op: 'advance', seq: 11, ev: 13, score: 25 });
    const w = await OLD.call({ op: 'persist' }); const row = rowOf(r.code);
    note('lower-sequence', row?.game_state_sequence === 11, `db seq=${row?.game_state_sequence} score=${row?.score}; OLD durability=${w.durability}`); }

  // 2 equal-sequence, different payload ---------------------------------------------------------------------------------
  { const r = mk();
    await seed(OLD, r, { seq: 10, ev: 12, score: 20 }); await OLD.call({ op: 'persist' });
    await NEW.call({ op: 'hydrate', code: r.code }); await NEW.call({ op: 'advance', seq: 12, ev: 14, score: 30 });
    await NEW.call({ op: 'persist' });
    await OLD.call({ op: 'advance', seq: 12, ev: 14, score: 99 });
    const w = await OLD.call({ op: 'persist' }); const row = rowOf(r.code);
    note('equal-sequence', row?.score === '99', `db seq=${row?.game_state_sequence} score=${row?.score} (NEW wrote 30, OLD wrote 99); OLD durability=${w.durability}`); }

  // 3 terminal transition ------------------------------------------------------------------------------------------------
  { const r = mk();
    await seed(OLD, r, { seq: 20, ev: 25, score: 50 }); await OLD.call({ op: 'persist' });
    await NEW.call({ op: 'hydrate', code: r.code });
    await NEW.call({ op: 'build', code: r.code, matchId: r.A, a: r.a, b: r.b, kind: 'terminal', seq: 21, ev: 30, score: 60 }).catch(() => undefined);
    await NEW.call({ op: 'persist' });
    const terminal = rowOf(r.code);
    await OLD.call({ op: 'advance', seq: 21, ev: 30, score: 55 });   // OLD's room is still playing in memory (not game over)
    const w = await OLD.call({ op: 'persist' }); const row = rowOf(r.code);
    note('terminal', terminal?.status === 'game_over' && row?.status === 'playing', `terminal wrote status=${terminal?.status} pending=${terminal?.pending}; after OLD write status=${row?.status} pending=${row?.pending}; OLD durability=${w.durability}`); }

  // 4 hydrate on NEW while OLD still exists, then both write -----------------------------------------------------------
  { const r = mk();
    await seed(OLD, r, { seq: 10, ev: 12, score: 20 }); await OLD.call({ op: 'persist' });
    const h = await NEW.call({ op: 'hydrate', code: r.code });
    await OLD.call({ op: 'advance', seq: 13, ev: 15, score: 35 }); const ow = await OLD.call({ op: 'persist' });   // OLD is still the live owner here
    const afterOld = rowOf(r.code);
    await NEW.call({ op: 'advance', seq: 11, ev: 13, score: 22 }); const nw = await NEW.call({ op: 'persist' });  // NEW hydrated stale state, writes older sequence
    const row = rowOf(r.code);
    note('hydrate-then-old', row?.game_state_sequence === 11,
      `NEW hydrated (${h.kind}) seq=${h.sequence}; OLD wrote seq 13 (${ow.durability}); NEW's stale seq-11 write ${nw.durability === 'failed' || nw.durability === 'degraded' ? 'REFUSED' : 'landed'}; db seq=${afterOld?.game_state_sequence}->${row?.game_state_sequence}`); }

  // 5 old process writing after NEW has taken ownership -------------------------------------------------------------------
  { const r = mk();
    await seed(OLD, r, { seq: 10, ev: 12, score: 20 }); await OLD.call({ op: 'persist' });
    await NEW.call({ op: 'hydrate', code: r.code }); await NEW.call({ op: 'advance', seq: 12, ev: 14, score: 30 }); await NEW.call({ op: 'persist' });
    const attempt = async (seq: number, ev: number, score: number) => { await OLD.call({ op: 'advance', seq, ev, score }); await OLD.call({ op: 'persist' }); return rowOf(r.code)?.score === String(score); };
    const lower = await attempt(11, 13, 79);
    const equal = await attempt(12, 14, 77);
    note('takeover-lower', lower, `OLD's lower-sequence write (seq 11) ${lower ? 'LANDED over NEW seq 12' : 'refused'}`);
    note('takeover-equal', equal, `OLD's equal-sequence write (seq 12, score 77 vs NEW's 30) ${equal ? 'LANDED (tie won by the older process)' : 'refused'}`); }

  // 6 cross-generation -------------------------------------------------------------------------------------------------
  { const r = mk(); const B = randomUUID();
    await seed(OLD, r, { seq: 10, ev: 12, score: 20 }); await OLD.call({ op: 'persist' });
    await seed(NEW, r, { match: B, kind: 'lobby', seq: 0, ev: 0, score: 0 }); await NEW.call({ op: 'persist' });
    await OLD.call({ op: 'advance', seq: 11, ev: 13, score: 25 }); const w = await OLD.call({ op: 'persist' }); const row = rowOf(r.code);
    note('cross-generation', row?.match_id === r.A, `room is match ${row?.match_id === B ? 'B (NEW)' : row?.match_id === r.A ? 'A (OLD overwrote the newer match)' : '?'}; OLD durability=${w.durability}`); }

  // 7 delete / recreate --------------------------------------------------------------------------------------------------
  { const r = mk();
    await seed(OLD, r, { seq: 10, ev: 12, score: 20 }); await OLD.call({ op: 'persist' });
    await NEW.call({ op: 'hydrate', code: r.code });
    await NEW.call({ op: 'build', code: r.code, matchId: r.A, a: r.a, b: r.b, kind: 'terminal', seq: 21, ev: 30, score: 60, logged: true });
    await NEW.call({ op: 'persist' }); await NEW.call({ op: 'archive', status: 'completed' });
    const gone = rowOf(r.code) === null;
    await OLD.call({ op: 'advance', seq: 11, ev: 13, score: 25 }); const w = await OLD.call({ op: 'persist' }); const row = rowOf(r.code);
    note('delete-recreate', gone && row !== null, `after NEW's archive the row was ${gone ? 'deleted' : 'NOT deleted'}; after OLD wakes the row is ${row ? `RECREATED (status ${row.status}, seq ${row.game_state_sequence})` : 'absent'}; OLD durability=${w.durability}`); }

  // 8 reconnect after archive-delete, SAME process ------------------------------------------------------------------------
  { const r = mk();
    await seed(NEW, r, { seq: 10, ev: 12, score: 20 }); await NEW.call({ op: 'persist' });
    const arch = await NEW.call({ op: 'archive', status: 'abandoned' });
    const deleted = rowOf(r.code) === null;
    // a reconnect revives the room in the same process; the player acts and the room persists again
    await NEW.call({ op: 'advance', seq: 11, ev: 13, score: 25 });
    const first = await NEW.call({ op: 'persist' }); const second = await NEW.call({ op: 'persist' });
    const row = rowOf(r.code);
    note('reconnect-delete', row === null ? false : null /* null = informational: expected to be allowed */,
      `deleted=${deleted}; revived persist durability=${first.durability} requests=${first.requests} (again: ${second.durability}, ${second.requests}); row after=${row ? `present seq ${row.game_state_sequence}` : 'ABSENT (false terminal loss)'}; archive requests=${arch.requests}`);
    results[results.length - 1]!.landed = row === null ? true /* a loss */ : false; }

  // 9 no retry storm: a persistently refused OLD writer must not hammer the database ------------------------------------------
  { const r = mk(); const B = randomUUID();
    await seed(OLD, r, { seq: 10, ev: 12, score: 20 }); await OLD.call({ op: 'persist' });
    await seed(NEW, r, { match: B, kind: 'lobby', seq: 0, ev: 0, score: 0 }); await NEW.call({ op: 'persist' });
    await OLD.call({ op: 'advance', seq: 11, ev: 13, score: 25 });
    const first = await OLD.call({ op: 'persist' });
    const again = await OLD.call({ op: 'schedule' });
    const idle = await OLD.call({ op: 'idle', ms: 8000 });
    note('refusal-retry-storm', idle.requests > 4, `refused persist=${first.requests} request(s), re-schedule=${again.requests}, then ${idle.requests} automatic request(s) in 8s idle (durability ${idle.durability})`); }

  for (const p of [OLD, NEW]) p.child.kill('SIGKILL');
  await gateway.close();

  const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
  process.stdout.write(`\nOVERLAP RESULT  old=${oldRoot}  new=${newRoot}\n${pad('scenario', 22)}${pad('stale write', 14)}detail\n`);
  for (const r of results) process.stdout.write(`${pad(r.scenario, 22)}${pad(r.landed ? (r.scenario === 'reconnect-delete' ? 'LOST ROW' : 'LANDED') : 'fenced/ok', 14)}${r.detail}\n`);
  const landed = (name: string) => results.find((r) => r.scenario === name)?.landed === true;
  const failures: string[] = [];
  const stale = ['lower-sequence', 'terminal', 'hydrate-then-old', 'takeover-lower', 'cross-generation', 'delete-recreate', 'refusal-retry-storm'];
  if (expect === 'broken') { for (const s of ['lower-sequence', 'terminal', 'cross-generation', 'delete-recreate']) if (!landed(s)) failures.push(`${s}: expected the defect to reproduce`); }
  if (expect === 'tie-only') { for (const s of stale) if (landed(s)) failures.push(`${s}: stale write landed`); if (!landed('equal-sequence') || !landed('takeover-equal')) failures.push('equal-sequence tie: expected to remain (otherwise this mode is wrong)'); }
  if (expect === 'closed') { for (const s of [...stale, 'equal-sequence', 'takeover-equal']) if (landed(s)) failures.push(`${s}: stale write landed`); if (landed('reconnect-delete')) failures.push('reconnect-delete: the legitimate reconnect lost its row'); }
  process.stdout.write(`\nexpectation "${expect}": ${failures.length === 0 ? 'MET' : `NOT MET -> ${failures.join('; ')}`}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
