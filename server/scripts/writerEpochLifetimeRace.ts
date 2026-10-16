/**
 * Failed-boot / later-boot writer-epoch race, with REAL artifact processes against real PostgreSQL + PostgREST.
 *
 * Invariant under test: a process's writer-order identity is fixed for its lifetime.
 *   1. process A boots FIRST and its epoch allocation FAILS (the RPC is unavailable during A's boot);
 *   2. the database recovers; process B boots LATER and gets a positive epoch N;
 *   3. B persists a room; a long time passes (default 70 s, longer than the former 60 s retry window);
 *   4. A persists the same room at an equal sequence with a different payload: A must be refused and must NEVER obtain N+1;
 *   5. A keeps persisting while the database is healthy: no further epoch RPC calls, one error log, no retry storm;
 *   6. A restarted process obtains a new, greater positive epoch normally.
 *
 *   TERMINAL_R1_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<pg>/racehorse_terminal_r1 \
 *   TERMINAL_R1_POSTGREST_URL=http://127.0.0.1:<rest> \
 *   npx tsx server/scripts/writerEpochLifetimeRace.ts --a=<artifact root> --b=<artifact root> [--wait=70000]
 *
 * Exit 0 when every check holds. Run with --a=<an artifact with a lazy / timed retry> to see it FAIL (negative control).
 */
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { tsxLoaderUrl } from './tsxLoader';

const DB_URL = process.env.TERMINAL_R1_TEST_DATABASE_URL ?? '';
const REST_URL = process.env.TERMINAL_R1_POSTGREST_URL ?? '';
if (!/^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/racehorse_terminal_r1$/.test(DB_URL) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(REST_URL)) {
  throw new Error('Refusing to run: exact owned loopback test database/PostgREST not configured');
}
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const aRoot = arg('a');
const bRoot = arg('b');
if (!aRoot || !bRoot) throw new Error('--a=<artifact root> and --b=<artifact root> are required');
const waitMs = Number(arg('wait') ?? 70_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const SERVICE_KEY = (() => {
  const message = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 7200 })}`;
  return `${message}.${createHmac('sha256', 'racehorse-forfeit-r1-local-validation-only-secret').update(message).digest('base64url')}`;
})();
const sql = (query: string): string =>
  execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', DB_URL, '-c', query], { encoding: 'utf8', timeout: 15_000 }).trim();

type Proc = { name: string; child: ChildProcess; allocationFailureLogs: () => number; call<T = any>(cmd: Record<string, unknown>): Promise<T> };
let seq = 0;
async function start(name: string, root: string, gatewayUrl: string): Promise<Proc> {
  const child = fork(`${__dirname}/roomOverlapRace.ts`, ['child'], {
    cwd: root,
    execArgv: ['--import', tsxLoaderUrl()],
    env: { ...process.env, ARTIFACT_ROOT: root, SUPABASE_URL: gatewayUrl, SUPABASE_SERVICE_KEY: SERVICE_KEY, VITE_SUPABASE_ANON_KEY: SERVICE_KEY, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let failureLogs = 0;
  const countFailureLogs = (d: unknown) => { failureLogs += String(d).split('\n').filter((l) => /writer epoch could not be allocated/.test(l)).length; };
  child.stdout?.on('data', countFailureLogs);
  child.stderr?.on('data', countFailureLogs);
  const pending = new Map<number, (v: unknown) => void>();
  await new Promise<void>((resolve) => child.on('message', (m: { id: number; payload: unknown }) => { if (m.id === -1) return resolve(); pending.get(m.id)?.(m.payload); pending.delete(m.id); }));
  return { name, child, allocationFailureLogs: () => failureLogs, call: (cmd) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve as (v: unknown) => void); child.send({ ...cmd, id }); }) };
}
const row = (code: string) => {
  const raw = sql(`select coalesce((select row_to_json(r)::text from (select game_state_sequence seq, (game_state->'players'->(engine_seat_ids[1])->>'score') score, room_shell->>'writerEpoch' epoch from public.room_live_sessions where room_code='${code}') r),'null')`);
  return raw === 'null' ? null : (JSON.parse(raw) as { seq: number; score: string; epoch: string | null });
};

async function main(): Promise<void> {
  const { startLocalPostgrestGateway } = await import('../test/support/localPostgrestGateway');
  const gateway = await startLocalPostgrestGateway({ upstream: REST_URL });
  const isEpochCall = (req: { path: string }) => req.path.includes('next_room_writer_epoch');
  const epochCalls = () => gateway.count(isEpochCall);
  sql('truncate public.room_live_sessions cascade');
  try { sql('truncate public.room_live_session_generations'); } catch { /* schema without the generation migration */ }
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}\n`);
    if (!ok) failures.push(name);
  };

  // 1. A boots first with the epoch RPC unavailable
  gateway.faults.push({ name: 'epoch-rpc-down', phase: 'before', match: (req) => isEpochCall(req), times: 1_000_000 });
  const A = await start('A', aRoot, gateway.url);
  await sleep(3_000);                                                  // A's boot allocation (and any transparent client retry) has failed
  const callsAtRecovery = epochCalls();
  gateway.faults.length = 0;                                           // 2. the database recovers
  const B = await start('B', bRoot, gateway.url);
  const id = randomUUID();
  const code = `LT${id.slice(0, 6).toUpperCase()}`;
  const seat = { a: `sa-${id.slice(0, 4)}`, b: `sb-${id.slice(0, 4)}` };
  const seed = (p: Proc, s: number, ev: number, score: number) => p.call({ op: 'build', code, matchId: id, a: seat.a, b: seat.b, kind: 'playing', seq: s, ev, score });
  await seed(A, 10, 12, 20);
  await seed(B, 12, 14, 30);
  await B.call({ op: 'persist' });                                     // 3. B (booted later) owns the room
  const epochB = Number(row(code)?.epoch);
  check('B (later boot) obtained a positive epoch', Number.isFinite(epochB) && epochB > 0, `B stamped epoch ${epochB}`);

  process.stdout.write(`      ...waiting ${Math.round(waitMs / 1000)}s (longer than the former 60s window)\n`);
  await sleep(waitMs);

  // 4. A persists an equal-sequence, different-payload snapshot
  await A.call({ op: 'advance', seq: 12, ev: 14, score: 99 });
  const first = await A.call({ op: 'persist' });
  const afterFirst = row(code);
  check('A (older process, failed allocation) is refused at the equal-sequence tie', afterFirst?.score === '30' && first.durability !== 'healthy', `db score=${afterFirst?.score} epoch=${afterFirst?.epoch}; A durability=${first.durability}`);
  check('A never obtained N+1: the stored epoch is still B\'s', Number(afterFirst?.epoch) === epochB, `stored epoch ${afterFirst?.epoch}, B ${epochB}`);

  // 5. the database is healthy; A keeps persisting; nothing changes and nothing storms
  for (let i = 0; i < 3; i += 1) { await A.call({ op: 'schedule' }); await sleep(2_000); }
  const idle = await A.call({ op: 'idle', ms: 6_000 });
  check('A stays at its original lifetime identity: no further epoch RPC after the failed boot', epochCalls() - callsAtRecovery === 1 /* B's boot only */, `epoch RPC calls after recovery: ${epochCalls() - callsAtRecovery} (B's boot = 1)`);
  check('no retry storm: automatic requests while refused and idle', idle.requests <= 2, `${idle.requests} automatic request(s) in 6s`);
  check('exactly one allocation-failure log line from A', A.allocationFailureLogs() === 1, `${A.allocationFailureLogs()} line(s)`);
  check('the contested room is still B\'s authoritative state', row(code)?.score === '30', `db score=${row(code)?.score}`);

  // 6. a restarted A obtains a new, greater epoch normally
  A.child.kill('SIGKILL');
  const A2 = await start('A2', aRoot, gateway.url);
  const id2 = randomUUID();
  const code2 = `LU${id2.slice(0, 6).toUpperCase()}`;
  await A2.call({ op: 'build', code: code2, matchId: id2, a: `sa-${id2.slice(0, 4)}`, b: `sb-${id2.slice(0, 4)}`, kind: 'playing', seq: 1, ev: 1, score: 1 });
  await A2.call({ op: 'persist' });
  const epochA2 = Number(row(code2)?.epoch);
  check('a restart obtains a new, greater positive epoch', epochA2 > epochB, `restarted A stamped ${epochA2} (> ${epochB})`);

  for (const p of [A2, B]) p.child.kill('SIGKILL');
  await gateway.close();
  process.stdout.write(failures.length === 0 ? '\nALL PASS\n' : `\nFAILED: ${failures.join('; ')}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
void main();
