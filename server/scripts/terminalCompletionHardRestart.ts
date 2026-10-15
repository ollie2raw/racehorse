/**
 * Terminal-completion HARD process-restart acceptance test (R1).
 *
 * Runs the REAL server (tsx src/index.ts) as a child process against an OWNED local PostgreSQL +
 * PostgREST (+ a synthetic loopback `/auth/v1/user`), and kills it with SIGKILL — no shutdown
 * handler runs — at the exact durable boundary under test:
 *
 *   boundary-b   two accounts play a real match to GAME OVER. The terminal snapshot commits
 *                (status=game_over, completionPending=true). The process is SIGKILLed the instant
 *                its first completion request (after the snapshot, before any completion write)
 *                reaches the database tier. A FRESH process then boots, discovers the stranded
 *                terminal room, finalizes it, and must not restore it as a playable room.
 *   replay-crash same start, but the FIRST recovery process is SIGKILLed after its first ranked
 *                row COMMITS and before the response (crash during replay, before acknowledgment).
 *                A THIRD process finishes it. Exactly one logical completion overall.
 *
 *   precontract-ghost (run alone, on a freshly built PRE-CONTRACT database) the integrated Ghost acceptance:
 *                two accounts, boundary-B SIGKILL, restart converges core completion with seat B Ghost work
 *                durably deferred, restart again, apply the real Ghost contract, restart, deferred seat
 *                drains exactly once, restart again is a no-op.
 *
 * Refuses anything but the exact loopback test instances. Usage (see server/test/fixtures/README.md):
 *   TERMINAL_R1_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1 \
 *   TERMINAL_R1_POSTGREST_URL=http://127.0.0.1:55440 npx tsx scripts/terminalCompletionHardRestart.ts
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, openSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { startLocalPostgrestGateway, type LocalPostgrestGateway } from '../test/support/localPostgrestGateway';

const DB_URL = 'postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1';
const REST_URL = 'http://127.0.0.1:55440';
if (process.env.TERMINAL_R1_TEST_DATABASE_URL !== DB_URL || process.env.TERMINAL_R1_POSTGREST_URL !== REST_URL) {
  throw new Error('Refusing to run: exact owned loopback test database/PostgREST not configured');
}
const PORT = Number(process.env.HARD_RESTART_PORT ?? 3198);
const GATEWAY_PORT = Number(process.env.HARD_RESTART_GATEWAY_PORT ?? 55442);
const baseUrl = `http://127.0.0.1:${PORT}`;
const serverRoot = join(__dirname, '..');
const timeoutMs = 30_000;
const WINNING_SCORE = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function serviceJwt(): string {
  const message = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 7200 })}`;
  return `${message}.${createHmac('sha256', 'racehorse-forfeit-r1-local-validation-only-secret').update(message).digest('base64url')}`;
}
const SERVICE_KEY = serviceJwt();

function sql(query: string): string {
  return execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', DB_URL, '-c', query], {
    encoding: 'utf8',
    timeout: 15_000,
  }).trim();
}

type Ack = Record<string, unknown> & { ok?: boolean; error?: string };
type Tile = { high: number; low: number };
type Move = { type: string; tile?: Tile; position?: string };
type GState = {
  playerIds: string[]; currentPlayerIndex: number; handNumber: number; handOver: boolean; gameOver: boolean;
  winnerId: string | null; sequence: number; board: unknown; players: Record<string, { score?: number }>;
};
type StateUpdate = { you?: string; legalMoves?: Move[]; canDraw?: boolean; state?: GState };
type Client = { socket: Socket; seatId: string | null; latest: StateUpdate | null; identity: { username: string; userId: string; authToken: string } };

const tokens = new Map<string, string>();
let gateway: LocalPostgrestGateway;

function createUser(prefix: string) {
  const id = randomUUID();
  const name = `${prefix}${id.replace(/-/g, '').slice(0, 8)}`;
  sql(`insert into auth.users(id,email,raw_user_meta_data) values ('${id}','${name}@racehorse-test.invalid','{"username":"${name}"}')`);
  sql(`update public.profiles set glicko_rating=1500, glicko_rd=200, glicko_vol=0.06, ranked_games_played=30, provisional=false, peak_rating=1500 where id='${id}'`);
  const token = `hard-restart-${randomUUID()}`;
  tokens.set(token, id);
  return { id, name, token };
}

function portFree(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port: PORT });
    s.once('connect', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(true));
  });
}

const cwd = mkdtempSync(join(tmpdir(), 'rh-hard-restart-'));
let serverGeneration = 0;
const spawned: ChildProcess[] = [];
async function spawnServer(extraEnv: Record<string, string> = {}): Promise<ChildProcess> {
  for (let i = 0; i < 40 && !(await portFree()); i += 1) await sleep(250);
  serverGeneration += 1;
  const child = spawn(
    process.execPath,
    ['--import', 'file:///home/user/racehorse/node_modules/tsx/dist/loader.mjs', join(serverRoot, 'src/index.ts')],
    {
      cwd,
      env: {
        ...process.env,
        PORT: String(PORT),
        SUPABASE_URL: gateway.url,
        SUPABASE_SERVICE_KEY: SERVICE_KEY,
        VITE_SUPABASE_ANON_KEY: SERVICE_KEY,
        MP_PRIVATE_CERT_MODE: '1',
        TOURNAMENT_SCHEDULER_ENABLED: 'false',
        ROOM_CLEANUP_GRACE_MS: '60000',
        TERMINAL_COMPLETION_RECOVERY_BOOT_DELAY_MS: '2000',
        GHOST_DEFERRED_DRAIN_BOOT_DELAY_MS: '2000',
        NODE_ENV: 'production',
        ...extraEnv,
      },
      detached: true,
      stdio: ['ignore', process.env.HARD_RESTART_SERVER_LOG ? openSync(process.env.HARD_RESTART_SERVER_LOG, 'a') : 'ignore', 'pipe'],
    },
  );
  spawned.push(child);
  child.stderr?.on('data', (d) => process.stderr.write(`[srv${serverGeneration}] ${d}`));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return child;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('server did not become ready');
}

function killHardNow(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
}
async function killHard(child: ChildProcess | null): Promise<void> {
  killHardNow(child);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !(await portFree())) await sleep(200);
}

function emitAck(socket: Socket, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.emit(event, ...args, (r: Ack) => { clearTimeout(timer); resolve(r ?? {}); });
  });
}
function connect(): Promise<Socket> {
  const socket = io(baseUrl, { transports: ['websocket'], reconnection: false, autoConnect: false });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timed out')), timeoutMs);
    socket.once('connect_error', reject);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.connect();
  });
}
function wire(client: Client) {
  client.socket.on('state:update', (p: StateUpdate) => {
    client.latest = p;
    if (typeof p.you === 'string' && p.you) client.seatId = p.you;
  });
}
async function waitFor(pred: () => boolean, ms = 12_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (pred()) return true; await sleep(60); }
  return false;
}
function refState(host: Client, guest: Client): GState | undefined {
  return [host.latest?.state, guest.latest?.state].filter((s): s is GState => Boolean(s)).sort((a, b) => b.sequence - a.sequence)[0];
}
function nextAction(cur: Client) {
  const legal = cur.latest?.legalMoves ?? [];
  const play = legal.find((m) => m.type === 'play' && m.tile && m.position);
  return play
    ? { type: 'MOVE', move: { tile: play.tile, position: play.position }, requestId: randomUUID() }
    : cur.latest?.canDraw ? { type: 'DRAW', requestId: randomUUID() } : { type: 'PASS', requestId: randomUUID() };
}
async function step(roomCode: string, host: Client, guest: Client): Promise<'over' | 'acted' | 'waited'> {
  const ref = refState(host, guest);
  if (!ref) { await sleep(100); return 'waited'; }
  if (ref.gameOver) return 'over';
  if (ref.handOver) {
    await emitAck(host.socket, 'hand:ready', roomCode, ref.handNumber).catch(() => ({}));
    await emitAck(guest.socket, 'hand:ready', roomCode, ref.handNumber).catch(() => ({}));
    await waitFor(() => { const s = refState(host, guest); return Boolean(s && (s.gameOver || (!s.handOver && s.handNumber !== ref.handNumber))); });
    return 'acted';
  }
  const cur = [host, guest].find((c) => c.seatId === ref.playerIds[ref.currentPlayerIndex]);
  if (!cur || (cur.latest?.state?.sequence ?? -1) < ref.sequence) {
    if (cur) await waitFor(() => (cur.latest?.state?.sequence ?? -1) >= ref.sequence, 4000); else await sleep(80);
    return 'waited';
  }
  const resp = await emitAck(cur.socket, 'game:action', roomCode, nextAction(cur)).catch(() => ({ ok: false }));
  if (!resp?.ok) { await sleep(150); return 'waited'; }
  await waitFor(() => { const s = refState(host, guest); return Boolean(s && (s.sequence !== ref.sequence || s.gameOver || s.handOver)); });
  return 'acted';
}

/** Plays a real match until the child dies (we kill it at the boundary) or game over is reached. */
async function playUntilServerDies(roomCode: string, host: Client, guest: Client, child: ChildProcess) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    if (refState(host, guest)?.gameOver) { await sleep(1500); continue; }
    await step(roomCode, host, guest);
  }
}

const count = (query: string) => Number(sql(query));
type Snapshot = {
  liveRow: string; ranked: number; receipts: number; matches: number; archive: number; activity: number;
  completionPending: string; matchLogged: string; ghostGames: number; ghostDeferred: number;
};
const legacyConstraintPresent = () =>
  count(`select count(*) from pg_constraint where conname='ghost_games_match_id_unique' and conrelid='public.ghost_games'::regclass`) === 1;
function snapshot(roomCode: string, ids: string[]): Snapshot {
  const idList = ids.map((i) => `'${i}'`).join(',');
  return {
    liveRow: sql(`select coalesce(max(status),'none') from public.room_live_sessions where room_code='${roomCode}'`),
    completionPending: sql(`select coalesce(max(room_shell->>'completionPending'),'-') from public.room_live_sessions where room_code='${roomCode}'`),
    matchLogged: sql(`select coalesce(max(room_shell->>'matchLogged'),'-') from public.room_live_sessions where room_code='${roomCode}'`),
    ranked: count(`select count(*) from public.ranked_games where player_id in (${idList})`),
    receipts: count(`select count(*) from public.rating_periods where user_id in (${idList})`),
    matches: count(`select count(*) from public.matches where room_code='${roomCode}'`),
    archive: count(`select count(*) from public.room_match_logs where room_code='${roomCode}'`),
    activity: count(`select count(*) from public.activity_feed where user_id in (${idList})`),
    ghostGames: count(`select count(*) from public.ghost_games where user_id in (${idList})`),
    ghostDeferred: count(`select count(*) from public.ghost_deferred_completions where user_id in (${idList})`),
  };
}

async function playToTerminalWithKill(arm: (roomCode: string) => void) {
  const host = createUser('hr-host');
  const guest = createUser('hr-guest');
  const child = await spawnServer();
  const hostC: Client = { socket: await connect(), seatId: null, latest: null, identity: { username: host.name, userId: host.id, authToken: host.token } };
  const guestC: Client = { socket: await connect(), seatId: null, latest: null, identity: { username: guest.name, userId: guest.id, authToken: guest.token } };
  wire(hostC); wire(guestC);
  await Promise.all([emitAck(hostC.socket, 'presence:identify', hostC.identity), emitAck(guestC.socket, 'presence:identify', guestC.identity)]);
  const created = await emitAck(hostC.socket, 'room:create', { ...hostC.identity, winningScore: WINNING_SCORE, skipPregameDraw: true });
  if (!created.ok) throw new Error(`room:create failed: ${created.error}`);
  const roomCode = String(created.roomCode);
  if (typeof created.you === 'string') hostC.seatId = created.you;
  const joined = await emitAck(guestC.socket, 'room:join', roomCode, guestC.identity);
  if (!joined.ok) throw new Error(`room:join failed: ${joined.error}`);
  if (typeof joined.you === 'string') guestC.seatId = joined.you;
  await emitAck(guestC.socket, 'player:ready', roomCode);
  const started = await emitAck(hostC.socket, 'game:start', roomCode);
  if (!started.ok) throw new Error(`game:start failed: ${started.error}`);
  await waitFor(() => Boolean(hostC.latest?.state && guestC.latest?.state), 15_000);
  arm(roomCode);
  (globalThis as { __child?: ChildProcess }).__child = child;
  await playUntilServerDies(roomCode, hostC, guestC, child);
  hostC.socket.disconnect(); guestC.socket.disconnect();
  await killHard(child); // make sure the port is free (it is already dead)
  return { host, guest, roomCode, ids: [host.id, guest.id] };
}

async function waitDb(pred: () => boolean, ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (pred()) return true; await sleep(500); }
  return false;
}

async function assertNotPlayable(roomCode: string, who: { id: string; token: string; name: string }, failures: string[]) {
  const sock = await connect();
  try {
    await emitAck(sock, 'presence:identify', { username: who.name, userId: who.id, authToken: who.token });
    const rejoin = await emitAck(sock, 'room:join', roomCode, { username: who.name, userId: who.id, authToken: who.token });
    if (rejoin.ok && rejoin.state) failures.push('completed room was restored as a playable room');
    return { ok: rejoin.ok ?? false, error: rejoin.error ?? null, hydrationOutcome: rejoin.hydrationOutcome ?? null };
  } finally { sock.disconnect(); }
}

async function scenarioBoundaryB(result: Record<string, unknown>, failures: string[]) {
  sql('truncate public.ghost_deferred_completions, public.ghost_games, public.room_live_sessions, public.room_match_logs, public.ranked_games, public.rating_periods, public.matches, public.activity_feed, public.bot_match_pending cascade');
  gateway.reset();
  let child: ChildProcess | null = null;
  const played = await playToTerminalWithKill((roomCode) => {
    let terminalSeen = false;
    gateway.faults.push({
      name: 'sigkill-at-first-completion-request',
      phase: 'before',
      match: (r, body) => {
        if (r.method === 'POST' && r.path.startsWith('/room_live_sessions') && body.includes(`"room_code":"${roomCode}"`) && body.includes('"status":"game_over"')) terminalSeen = true;
        return terminalSeen && r.method === 'GET' && r.path.startsWith('/scheduled_tournament_matches') && r.path.includes(roomCode);
      },
      onFired: () => killHardNow((globalThis as { __child?: ChildProcess }).__child ?? null),
    });
  });
  const { roomCode, ids } = played;
  const afterKill = snapshot(roomCode, ids);
  result.boundaryB_afterKill = afterKill;
  if (afterKill.liveRow !== 'game_over') failures.push(`B: expected durable game_over snapshot, got ${afterKill.liveRow}`);
  if (afterKill.completionPending !== 'true' || afterKill.matchLogged !== 'false') failures.push('B: terminal snapshot is not marked pending/unlogged');
  if (afterKill.ranked !== 0 || afterKill.archive !== 0) failures.push('B: completion was written before the kill (boundary not exercised)');

  child = await spawnServer(); // FRESH process; no memory of the match
  try {
    const done = await waitDb(() => {
      const s = snapshot(roomCode, ids);
      return s.ranked === 2 && s.liveRow === 'none';
    }, 90_000);
    if (!done) failures.push('B: the fresh process did not finalize the stranded terminal completion');
    await sleep(25_000); // let the ranking catch-up (boot 20s) settle pending ratings; recovery must not duplicate
    const final = snapshot(roomCode, ids);
    result.boundaryB_final = final;
    if (final.ranked !== 2) failures.push(`B: expected exactly 2 ranked rows, got ${final.ranked}`);
    if (final.receipts !== 2) failures.push(`B: expected exactly 2 rating receipts, got ${final.receipts}`);
    if (final.matches !== 1) failures.push(`B: expected exactly 1 matches row, got ${final.matches}`);
    if (final.archive !== 1) failures.push(`B: expected exactly 1 archive row, got ${final.archive}`);
    if (final.liveRow !== 'none') failures.push(`B: terminal live row not cleaned up (${final.liveRow})`);
    if (final.ghostGames + final.ghostDeferred !== 2) failures.push(`B: ghost seats completed (${final.ghostGames}) + deferred (${final.ghostDeferred}) != 2`);
    if (legacyConstraintPresent() ? final.ghostGames !== 1 || final.ghostDeferred !== 1 : final.ghostGames !== 2 || final.ghostDeferred !== 0) failures.push(`B: unexpected Ghost state for the live schema: ${JSON.stringify({ ghostGames: final.ghostGames, ghostDeferred: final.ghostDeferred })}`);
    result.boundaryB_rejoin = await assertNotPlayable(roomCode, played.host, failures);
  } finally {
    await killHard(child);
  }
}

async function scenarioReplayCrash(result: Record<string, unknown>, failures: string[]) {
  sql('truncate public.ghost_deferred_completions, public.ghost_games, public.room_live_sessions, public.room_match_logs, public.ranked_games, public.rating_periods, public.matches, public.activity_feed, public.bot_match_pending cascade');
  gateway.reset();
  const played = await playToTerminalWithKill((roomCode) => {
    let terminalSeen = false;
    gateway.faults.push({
      name: 'sigkill-first-process-at-completion',
      phase: 'before',
      match: (r, body) => {
        if (r.method === 'POST' && r.path.startsWith('/room_live_sessions') && body.includes(`"room_code":"${roomCode}"`) && body.includes('"status":"game_over"')) terminalSeen = true;
        return terminalSeen && r.method === 'GET' && r.path.startsWith('/scheduled_tournament_matches') && r.path.includes(roomCode);
      },
      onFired: () => killHardNow((globalThis as { __child?: ChildProcess }).__child ?? null),
    });
  });
  const { roomCode, ids } = played;
  gateway.faults.length = 0;
  // Recovery process #1: SIGKILLed after its first ranked row COMMITS, before it can acknowledge.
  const first = await spawnServer();
  (globalThis as { __child?: ChildProcess }).__child = first;
  gateway.faults.push({
    name: 'sigkill-recovery-after-first-commit',
    phase: 'crash',
    match: (r) => r.method === 'POST' && r.path.startsWith('/ranked_games'),
    onFired: () => killHardNow(first),
  });
  const crashed = await waitDb(() => snapshot(roomCode, ids).ranked >= 1, 60_000);
  await sleep(500);
  gateway.releaseHeld('sigkill-recovery-after-first-commit');
  await killHard(first);
  const midway = snapshot(roomCode, ids);
  result.replayCrash_afterRecoveryCrash = midway;
  if (!crashed || midway.ranked !== 1) failures.push(`R: expected exactly 1 committed ranked row at the crash, got ${midway.ranked}`);
  if (midway.liveRow !== 'game_over') failures.push('R: terminal row was lost by the recovery crash');

  gateway.faults.length = 0;
  const second = await spawnServer(); // recovery process #2 (fresh)
  try {
    const done = await waitDb(() => {
      const s = snapshot(roomCode, ids);
      return s.ranked === 2 && s.liveRow === 'none';
    }, 90_000);
    if (!done) failures.push('R: the second recovery process did not converge');
    await sleep(25_000);
    const final = snapshot(roomCode, ids);
    result.replayCrash_final = final;
    if (final.ranked !== 2) failures.push(`R: expected exactly 2 ranked rows, got ${final.ranked}`);
    if (final.receipts !== 2) failures.push(`R: expected exactly 2 rating receipts, got ${final.receipts}`);
    if (final.matches !== 1) failures.push(`R: expected exactly 1 matches row, got ${final.matches}`);
    if (final.archive !== 1) failures.push(`R: expected exactly 1 archive row, got ${final.archive}`);
    if (final.ghostGames + final.ghostDeferred !== 2) failures.push(`R: ghost seats completed (${final.ghostGames}) + deferred (${final.ghostDeferred}) != 2`);
    if (legacyConstraintPresent() ? final.ghostGames !== 1 || final.ghostDeferred !== 1 : final.ghostGames !== 2 || final.ghostDeferred !== 0) failures.push(`R: unexpected Ghost state for the live schema: ${JSON.stringify({ ghostGames: final.ghostGames, ghostDeferred: final.ghostDeferred })}`);
    result.replayCrash_rejoin = await assertNotPlayable(roomCode, played.host, failures);
  } finally {
    await killHard(second);
  }
}

/**
 * Integrated acceptance (pre-contract NEW schema -> Ghost contract). Mutates the database by applying
 * the REAL Ghost contract migration, so it must run last and needs a freshly built pre-contract DB.
 */
async function scenarioPreContractGhost(result: Record<string, unknown>, failures: string[]) {
  if (!legacyConstraintPresent()) { failures.push('G: database is not in the pre-contract schema (rebuild with TERMINAL_TEST_SCHEMA=pre-contract)'); return; }
  sql('truncate public.ghost_deferred_completions, public.ghost_games, public.room_live_sessions, public.room_match_logs, public.ranked_games, public.rating_periods, public.matches, public.activity_feed, public.bot_match_pending cascade');
  gateway.reset();
  const played = await playToTerminalWithKill((roomCode) => {
    let terminalSeen = false;
    gateway.faults.push({
      name: 'sigkill-ghost-boundary-b',
      phase: 'before',
      match: (r, body) => {
        if (r.method === 'POST' && r.path.startsWith('/room_live_sessions') && body.includes(`"room_code":"${roomCode}"`) && body.includes('"status":"game_over"')) terminalSeen = true;
        return terminalSeen && r.method === 'GET' && r.path.startsWith('/scheduled_tournament_matches') && r.path.includes(roomCode);
      },
      onFired: () => killHardNow((globalThis as { __child?: ChildProcess }).__child ?? null),
    });
  });
  const { roomCode, ids } = played;
  const killed = snapshot(roomCode, ids);
  result.ghost_1_afterKill = killed;
  if (killed.liveRow !== 'game_over' || killed.completionPending !== 'true') failures.push('G1: boundary B was not durable (terminal pending snapshot missing)');
  if (killed.ranked !== 0 || killed.ghostGames !== 0 || killed.ghostDeferred !== 0) failures.push('G1: completion effects existed before the kill');

  gateway.faults.length = 0;
  let proc = await spawnServer(); // fresh process #2: replay the terminal completion pre-contract
  const converged = await waitDb(() => { const s = snapshot(roomCode, ids); return s.ranked === 2 && s.liveRow === 'none' && s.ghostDeferred === 1; }, 90_000);
  if (!converged) failures.push('G2: core completion did not converge pre-contract (a Ghost conflict must not strand it)');
  await sleep(6_000);
  const core = snapshot(roomCode, ids);
  result.ghost_2_preContractFinal = core;
  if (core.ranked !== 2 || core.receipts !== 2 || core.matches !== 1 || core.archive !== 1) failures.push(`G2: core completion not exactly-once: ${JSON.stringify(core)}`);
  if (core.ghostGames !== 1 || core.ghostDeferred !== 1) failures.push(`G2: expected 1 completed + 1 deferred Ghost seat, got ${core.ghostGames}+${core.ghostDeferred}`);
  if (core.liveRow !== 'none') failures.push(`G2: terminal room not finalized (${core.liveRow})`);
  result.ghost_2_rejoin = await assertNotPlayable(roomCode, played.host, failures);
  const deferredUser = sql(`select user_id from public.ghost_deferred_completions limit 1`);
  const completedUser = sql(`select user_id from public.ghost_games where user_id in ('${ids[0]}','${ids[1]}')`);
  if (deferredUser === completedUser || !(ids as string[]).includes(deferredUser)) failures.push('G2: deferred and completed Ghost seats are not the two distinct accounts');

  // Restart again: the deferral must survive and not be retried into the ground.
  await killHard(proc);
  gateway.reset();
  proc = await spawnServer();
  await sleep(8_000); // boot drain at +2s
  const drainRequests = gateway.count((r) => r.path.startsWith('/ghost_deferred_completions') || r.path.includes('complete_ghost_rating_v2'));
  await killHard(proc);
  const afterRestart = snapshot(roomCode, ids);
  result.ghost_3_afterSecondRestart = { ...afterRestart, drainRequests };
  if (afterRestart.ghostDeferred !== 1 || afterRestart.ghostGames !== 1) failures.push(`G3: deferred seat changed across restart: ${afterRestart.ghostGames}+${afterRestart.ghostDeferred}`);
  if (afterRestart.ranked !== 2 || afterRestart.receipts !== 2 || afterRestart.matches !== 1) failures.push('G3: restart duplicated core effects');
  if (drainRequests > 3) failures.push(`G3: pre-contract drain made ${drainRequests} Ghost requests in one boot (retry storm?)`);

  const gamesPlayed = () => count(`select coalesce(sum(games_played),0) from public.ghost_profiles where user_id in ('${ids[0]}','${ids[1]}')`);
  const gamesBeforeDrain = gamesPlayed();
  const expectedIncrement = count(`select count(*) from public.ghost_deferred_completions where apply_rating and greatest(final_score,opponent_score) >= 10 and opponent_rating is not null`);
  // Apply the REAL Ghost contract, then restart: the boot sweep drains the deferred seat.
  execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', DB_URL, '-f', join(serverRoot, '../supabase/migrations/2026-10-13_ghost_user_match_uniqueness.sql')], { encoding: 'utf8' });
  if (legacyConstraintPresent()) failures.push('G4: contract migration did not remove the legacy constraint');
  proc = await spawnServer();
  const drained = await waitDb(() => snapshot(roomCode, ids).ghostDeferred === 0, 60_000);
  await sleep(6_000);
  await killHard(proc);
  const finalG = snapshot(roomCode, ids);
  result.ghost_4_postContractFinal = finalG;
  if (!drained) failures.push('G4: deferred Ghost seat did not drain after the contract');
  if (finalG.ghostGames !== 2 || finalG.ghostDeferred !== 0) failures.push(`G4: expected 2 Ghost rows and 0 deferred, got ${finalG.ghostGames}+${finalG.ghostDeferred}`);
  if (count(`select count(distinct user_id) from public.ghost_games where user_id in ('${ids[0]}','${ids[1]}')`) !== 2) failures.push('G4: not exactly one Ghost completion per account');
  if (count(`select count(*) from public.ghost_games where user_id in ('${ids[0]}','${ids[1]}') and rating_applied_at is not null`) !== 2) failures.push('G4: a Ghost completion lacks its rating receipt');
  if (gamesPlayed() - gamesBeforeDrain !== expectedIncrement) failures.push(`G4: deferred seat rated ${gamesPlayed() - gamesBeforeDrain} times, expected ${expectedIncrement} (exactly once, or zero when the result is not rating-eligible)`);
  if (finalG.ranked !== 2 || finalG.receipts !== 2 || finalG.matches !== 1 || finalG.archive !== 1 || finalG.activity !== core.activity) failures.push(`G4: core/ranked/stat effects changed by the Ghost drain: ${JSON.stringify(finalG)} vs ${JSON.stringify(core)}`);

  // One more restart: replay is a no-op.
  proc = await spawnServer();
  await sleep(8_000);
  await killHard(proc);
  const again = snapshot(roomCode, ids);
  if (JSON.stringify(again) !== JSON.stringify(finalG) || gamesPlayed() - gamesBeforeDrain !== expectedIncrement) failures.push(`G5: another restart changed state: ${JSON.stringify(again)}`);
  result.ghost_5_afterThirdRestart = again;
}

async function main() {
  gateway = await startLocalPostgrestGateway({
    upstream: REST_URL,
    port: GATEWAY_PORT,
    intercept: (req) => {
      if (req.method === 'GET' && req.url.startsWith('/auth/v1/user')) {
        const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const id = tokens.get(token);
        return id ? { status: 200, json: { id, aud: 'authenticated', role: 'authenticated' } } : { status: 401, json: { message: 'invalid token' } };
      }
      return null;
    },
  });
  const result: Record<string, unknown> = {};
  const failures: string[] = [];
  const only = process.argv[2];
  try {
    if (!only || only === 'boundary-b') await scenarioBoundaryB(result, failures);
    if (!only || only === 'replay-crash') await scenarioReplayCrash(result, failures);
    if (only === 'precontract-ghost') await scenarioPreContractGhost(result, failures);
  } catch (error) {
    failures.push(`aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  } finally {
    for (const c of spawned) killHardNow(c);
    await gateway.close();
    result.failures = failures;
    process.stdout.write(`\n=== TERMINAL COMPLETION HARD RESTART RESULT ===\n${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(failures.length === 0 ? '\nTERMINAL COMPLETION HARD RESTART PASSED\n' : '\nTERMINAL COMPLETION HARD RESTART FAILED\n');
    if (failures.length > 0) process.exitCode = 1;
  }
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
