/**
 * Two-PROCESS stale-writer race against real PostgreSQL + PostgREST (owned loopback instance).
 *
 * Models Render's zero-downtime replacement: an OLD instance (process A) still holds an older in-memory
 * room and keeps persisting, while a NEW instance (process B) has already persisted a newer / terminal
 * snapshot of the SAME room. A third process (R) is the restart-time terminal-completion sweep. All
 * three run the real server modules (persistLiveRoomSessionNow, recoverStrandedTerminalCompletions).
 *
 * Asserts, for every iteration and every timing mode:
 *   - the database rejects/no-ops the stale writer (the stale process observes a `failed` durability result),
 *   - the newer terminal row is logically intact (status, sequence, completionPending, recovery shell),
 *   - the sweep discovers it and completes it EXACTLY once (2 ranked rows, 2 receipts, 1 match, row deleted),
 *   - a second sweep adds nothing.
 *
 *   TERMINAL_R1_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1 \
 *   TERMINAL_R1_POSTGREST_URL=http://127.0.0.1:55440 npx tsx server/scripts/roomStateMonotonicityRace.ts [iterations]
 */
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DB_URL = 'postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1';
const REST_URL = 'http://127.0.0.1:55440';
if (process.env.TERMINAL_R1_TEST_DATABASE_URL !== DB_URL || process.env.TERMINAL_R1_POSTGREST_URL !== REST_URL) {
  throw new Error('Refusing to run: exact owned loopback test database/PostgREST not configured');
}
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const SERVICE_KEY = (() => {
  const message = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 7200 })}`;
  return `${message}.${createHmac('sha256', 'racehorse-forfeit-r1-local-validation-only-secret').update(message).digest('base64url')}`;
})();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------ child roles
type Cmd =
  | { op: 'build'; code: string; matchId: string; a: string; b: string; userA: string; userB: string; kind: 'older' | 'terminal'; seq: number }
  | { op: 'advance'; seq: number }
  | { op: 'persist' }
  | { op: 'recover' };

async function childMain(): Promise<void> {
  const [{ createReservedRoom }, { setRoomRoster }, kit, persistence, recovery, durability] = await Promise.all([
    import('../src/rooms'),
    import('../src/multiplayer/roomSession'),
    import('../src/multiplayer/terminalCompletionTestKit'),
    import('../src/multiplayer/roomLivePersistence'),
    import('../src/multiplayer/terminalCompletionRecovery'),
    import('../src/multiplayer/roomDurability'),
  ]);
  let room: ReturnType<typeof createReservedRoom> | null = null;
  let roster: Array<{ seatId: string; userId: string | null; username: string }> = [];
  persistence.configureLiveRoomPersistence({ resolveRoster: () => roster });
  process.on('message', async (cmd: Cmd & { id: number }) => {
    const reply = (payload: unknown) => process.send?.({ id: cmd.id, payload });
    try {
      if (cmd.op === 'build') {
        room = createReservedRoom(cmd.code, { winningScore: 60 });
        room.matchId = cmd.matchId;
        room.players = [cmd.a, cmd.b];
        room.eventLogVersion = 1;
        room.eventSequence = cmd.seq + 9;
        room.state = kit.mkTerminalGameState(cmd.a, cmd.b, { a: cmd.kind === 'terminal' ? 60 : 20, b: 42 }, cmd.kind === 'terminal'
          ? { sequence: cmd.seq } : { gameOver: false, handOver: false, winnerId: null, sequence: cmd.seq });
        room.matchLogged = false;
        room.leadTracker = { aId: cmd.a, bId: cmd.b, maxLeadA: 7, maxLeadB: 3 };
        const players = [
          { id: cmd.a, socketId: '', username: 'Alice', userId: cmd.userA },
          { id: cmd.b, socketId: '', username: 'Bob', userId: cmd.userB },
        ];
        roster = players.map((p) => ({ seatId: p.id, userId: p.userId, username: p.username }));
        setRoomRoster(cmd.code, players);
        durability.markRoomDurabilityPending(room);
        return reply({ ok: true });
      }
      if (cmd.op === 'advance') {
        room!.state = { ...room!.state!, sequence: cmd.seq } as ReturnType<typeof kit.mkTerminalGameState>;
        room!.eventSequence = cmd.seq + 9;
        durability.markRoomDurabilityPending(room!); // what notifyLiveRoomStateCommitted does on every real mutation
        return reply({ ok: true });
      }
      if (cmd.op === 'persist') {
        const ok = await persistence.persistLiveRoomSessionNow(room!, roster);
        return reply({ ok, durability: room!.durability.status, error: room!.durability.lastError });
      }
      if (cmd.op === 'recover') {
        const result = await recovery.recoverStrandedTerminalCompletions({ now: Date.now() + 60_000, minAgeMs: 0 });
        return reply({ outcomes: result.outcomes });
      }
    } catch (error) {
      reply({ thrown: error instanceof Error ? error.message : String(error) });
    }
  });
  process.send?.({ id: -1, payload: 'ready' });
}

if (process.argv[2] === 'child') {
  void childMain();
} else {
  void parentMain();
}

// ------------------------------------------------------------------------------------------------ parent
function sql(query: string): string {
  return execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', DB_URL, '-c', query], { encoding: 'utf8', timeout: 15_000 }).trim();
}
type Proc = { name: string; child: ChildProcess; call<T = any>(cmd: Cmd): Promise<T> };
let proc_id = 0;
async function startProc(name: string, gatewayUrl: string, cwd: string): Promise<Proc> {
  const loader = pathToFileURL(join(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
  const child = fork(__filename, ['child'], {
    cwd,
    execArgv: ['--import', loader],
    env: { ...process.env, SUPABASE_URL: gatewayUrl, SUPABASE_SERVICE_KEY: SERVICE_KEY, VITE_SUPABASE_ANON_KEY: SERVICE_KEY, NODE_ENV: 'development' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  child.stderr?.on('data', (d) => { if (process.env.RACE_VERBOSE) process.stderr.write(`[${name}] ${d}`); });
  const pending = new Map<number, (v: unknown) => void>();
  await new Promise<void>((resolve, reject) => {
    child.on('message', (m: { id: number; payload: unknown }) => {
      if (m.id === -1) return resolve();
      pending.get(m.id)?.(m.payload);
      pending.delete(m.id);
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`${name} exited early (${code})`)));
  });
  return {
    name, child,
    call: (cmd) => new Promise((resolve) => { const id = ++proc_id; pending.set(id, resolve as (v: unknown) => void); child.send({ ...cmd, id }); }),
  };
}

const failures: string[] = [];
const check = (label: string, ok: boolean, detail?: unknown) => { if (!ok) failures.push(`${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`); };

async function parentMain(): Promise<void> {
  const iterations = Number(process.argv[2] ?? 40);
  const { startLocalPostgrestGateway } = await import('../test/support/localPostgrestGateway');
  const gateway = await startLocalPostgrestGateway({ upstream: REST_URL });
  const cwd = mkdtempSync(join(tmpdir(), 'rh-state-race-'));
  const [A, B, R] = await Promise.all([startProc('OLD(A)', gateway.url, cwd), startProc('NEW(B)', gateway.url, cwd), startProc('SWEEP(R)', gateway.url, cwd)]);
  const modes = ['stale-after', 'concurrent', 'zombie-higher-sequence', 'reverse-timing'] as const;
  const tally: Record<string, { runs: number; staleRejected: number; staleAccepted: number }> = {};
  sql('truncate public.room_live_sessions, public.room_match_logs, public.ranked_games, public.rating_periods, public.matches, public.activity_feed cascade');

  for (let i = 0; i < iterations; i += 1) {
    const mode = modes[i % modes.length]!;
    const t = (tally[mode] ??= { runs: 0, staleRejected: 0, staleAccepted: 0 });
    t.runs += 1;
    const mkUser = () => {
      const id = randomUUID();
      sql(`insert into auth.users(id,email,raw_user_meta_data) values ('${id}','${id}@racehorse-test.invalid','{"username":"r${id.replace(/-/g, '').slice(0, 9)}"}')`);
      sql(`update public.profiles set glicko_rating=1500, glicko_rd=200, glicko_vol=0.06, ranked_games_played=30, provisional=false, peak_rating=1500 where id='${id}'`);
      return id;
    };
    const [userA, userB] = [mkUser(), mkUser()];
    const code = `RC${String(i).padStart(3, '0')}${randomUUID().slice(0, 2).toUpperCase()}`;
    const matchId = randomUUID();
    const seatA = `seat-a-${code}`; const seatB = `seat-b-${code}`;
    const base = { code, matchId, a: seatA, b: seatB, userA, userB };
    const tag = `[${i} ${mode}]`;

    // OLD instance has been playing this room; NEW instance later persists the terminal snapshot.
    await A.call({ op: 'build', ...base, kind: 'older', seq: 10 });
    const aFirst = await A.call({ op: 'persist' });
    check(`${tag} A initial persist`, aFirst.ok === true, aFirst);
    await B.call({ op: 'build', ...base, kind: 'terminal', seq: 21 });

    let staleResult: { ok: boolean; durability: string; error: string | null };
    if (mode === 'stale-after') {
      check(`${tag} B terminal persist`, (await B.call({ op: 'persist' })).ok === true);
      await A.call({ op: 'advance', seq: 11 });
      staleResult = await A.call({ op: 'persist' });
    } else if (mode === 'concurrent') {
      await A.call({ op: 'advance', seq: 11 });
      const jitter = Math.floor(Math.random() * 20);
      const first = Math.random() < 0.5;
      const [rb, ra] = await Promise.all([
        (async () => { if (first) await sleep(jitter); return B.call({ op: 'persist' }); })(),
        (async () => { if (!first) await sleep(jitter); return A.call({ op: 'persist' }); })(),
      ]);
      check(`${tag} B terminal persist`, rb.ok === true, rb);
      staleResult = ra; // may legitimately have landed BEFORE B (then B simply advances over it)
    } else if (mode === 'zombie-higher-sequence') {
      check(`${tag} B terminal persist`, (await B.call({ op: 'persist' })).ok === true);
      await A.call({ op: 'advance', seq: 25 }); // zombie ran ahead of the terminal sequence while still "playing"
      staleResult = await A.call({ op: 'persist' });
    } else {
      // reverse timing: the NEW instance wrote first; the OLD instance resumes much later with an older snapshot
      check(`${tag} B terminal persist`, (await B.call({ op: 'persist' })).ok === true);
      await sleep(20 + Math.floor(Math.random() * 30));
      await A.call({ op: 'advance', seq: 12 });
      staleResult = await A.call({ op: 'persist' });
    }
    if (staleResult.ok) t.staleAccepted += 1; else t.staleRejected += 1;
    const concurrentAWon = mode === 'concurrent' && staleResult.ok;
    if (!concurrentAWon) {
      check(`${tag} stale writer rejected`, staleResult.ok === false && staleResult.durability === 'failed', staleResult);
    }

    // The newer terminal row is intact whichever order won.
    const row = JSON.parse(sql(`select row_to_json(r)::text from (select status, game_state_sequence, last_event_sequence, match_id, room_shell from public.room_live_sessions where room_code='${code}') r`));
    check(`${tag} terminal status kept`, row.status === 'game_over', row.status);
    check(`${tag} sequence kept`, row.game_state_sequence === 21, row.game_state_sequence);
    check(`${tag} completionPending kept`, row.room_shell.completionPending === true && row.room_shell.matchLogged === false, row.room_shell);
    check(`${tag} match kept`, row.match_id === matchId);

    // The sweep still discovers it and completes it exactly once.
    const first = await R.call({ op: 'recover' });
    check(`${tag} sweep recovered exactly one`, first.outcomes?.recovered === 1, first);
    const rankedRows = Number(sql(`select count(*) from public.ranked_games where source_match_id='${matchId}'`));
    const receipts = Number(sql(`select count(*) from public.rating_periods where user_id in ('${userA}','${userB}')`));
    const matchRows = Number(sql(`select count(*) from public.matches where metadata->>'roomMatchId'='${matchId}'`));
    check(`${tag} ranked rows == 2`, rankedRows === 2, rankedRows);
    check(`${tag} receipts == 2`, receipts === 2, receipts);
    check(`${tag} match rows == 1`, matchRows === 1, matchRows);
    check(`${tag} live row retired after logged completion`, Number(sql(`select count(*) from public.room_live_sessions where room_code='${code}'`)) === 0);
    const second = await R.call({ op: 'recover' });
    check(`${tag} second sweep is a no-op`, (second.outcomes?.recovered ?? 0) === 0, second);
    check(`${tag} no duplicate effects`, Number(sql(`select count(*) from public.ranked_games where source_match_id='${matchId}'`)) === 2);
  }

  for (const p of [A, B, R]) p.child.kill('SIGKILL');
  await gateway.close();
  const result = { iterations, tally, failures };
  process.stdout.write(`\n=== ROOM STATE MONOTONICITY RACE RESULT ===\n${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(failures.length === 0 ? '\nROOM STATE MONOTONICITY RACE PASSED\n' : '\nROOM STATE MONOTONICITY RACE FAILED\n');
  process.exit(failures.length === 0 ? 0 : 1);
}
