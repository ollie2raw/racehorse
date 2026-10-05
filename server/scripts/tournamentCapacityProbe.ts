/**
 * Tournament v2 capacity probe (docs/tournament-v2-capacity.md).
 *
 * Spawns the real server (src/index.ts, NODE_ENV=production) against a local
 * stub Supabase, and drives scripted guest pairs through private 30-point
 * matches: the same room runtime tournament matches use. Never touches a real
 * Supabase project: SUPABASE_URL is forced to the in-process stub.
 *
 *   cd server
 *   MATCHES=20 THINK_MS=0 DURATION_S=120 npx tsx scripts/tournamentCapacityProbe.ts
 *   MATCHES=16 THINK_MS=2500 DURATION_S=90 THROTTLE_QUOTA_MS=5 \
 *     THROTTLE_SCRIPT=scripts/cfsThrottle.py npx tsx scripts/tournamentCapacityProbe.ts
 *
 * THROTTLE_QUOTA_MS emulates a CFS CPU quota per 100 ms (macOS only; see
 * cfsThrottle.py). Reports server CPU time, RSS, action-ack and /healthz
 * latency percentiles, and stub Supabase requests and bytes by path. Guest
 * sockets are rate-limited per IP, so the probe raises those limits for its
 * own server process only.
 */
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { io, type Socket } from 'socket.io-client';

const SERVER_ROOT = process.env.SERVER_ROOT ?? join(__dirname, '..');
const PORT = Number(process.env.PORT_PROBE ?? 3197);
const STUB_PORT = Number(process.env.STUB_PORT ?? 54397);
const MATCHES = Number(process.env.MATCHES ?? 10);
const THINK_MS = Number(process.env.THINK_MS ?? 0);
const DURATION_S = Number(process.env.DURATION_S ?? 0); // 0 = run every match to game over
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── stub Supabase ────────────────────────────────────────────────────────────
const stubCounts = new Map<string, number>();
const stubBytes = new Map<string, { total: number; max: number }>();
let stubBytesIn = 0;
const stub = http.createServer((req, res) => {
  let body = 0;
  req.on('data', (c: Buffer) => { body += c.length; });
  req.on('end', () => {
    stubBytesIn += body;
    const path = (req.url ?? '').split('?')[0];
    const key = `${req.method} ${path}`;
    stubCounts.set(key, (stubCounts.get(key) ?? 0) + 1);
    const sb = stubBytes.get(key) ?? { total: 0, max: 0 }; sb.total += body; sb.max = Math.max(sb.max, body); stubBytes.set(key, sb);
    if (path.startsWith('/auth/')) { res.writeHead(401).end('{}'); return; }
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-range': '*/0' }).end('[]');
      return;
    }
    if (path.startsWith('/rest/v1/rpc/')) { res.writeHead(200, { 'content-type': 'application/json' }).end('null'); return; }
    res.writeHead(201, { 'content-type': 'application/json' }).end('[]');
  });
});

// ── server process ───────────────────────────────────────────────────────────
async function spawnServer(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: SERVER_ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(PORT),
      NODE_ENV: 'production',
      SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
      SUPABASE_SERVICE_KEY: 'stub-service-key',
      SUPABASE_ANON_KEY: 'stub-anon-key',
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
      ...Object.fromEntries(['LIMIT_ROOM_CREATE_MAX','LIMIT_ROOM_JOIN_MAX','LIMIT_GAME_ACTION_MAX','LIMIT_HAND_READY_MAX','LIMIT_PLAYER_READY_MAX','LIMIT_DEFAULT_MAX','LIMIT_FAILED_ROOM_LOOKUPS_MAX'].map((k) => [k, '1000000'])),
    },
    stdio: ['ignore', process.env.LOG_FILE ? openSync(process.env.LOG_FILE, 'w') : 'ignore', 'pipe'],
  });
  let err = '';
  child.stderr?.on('data', (d) => { err += String(d); if (err.length > 20000) err = err.slice(-10000); });
  child.on('exit', (code) => { if (code) console.error('server exited', code, err.slice(-2000)); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return child;
    } catch { /* not up */ }
    await sleep(300);
  }
  throw new Error(`server not ready\n${err.slice(-3000)}`);
}

function cpuSecondsOf(pid: number): number {
  const t = execSync(`ps -o time= -p ${pid}`).toString().trim(); // [[dd-]hh:]mm:ss.cc
  const parts = t.split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
function rssMbOf(pid: number): number {
  return Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024;
}

// ── clients ──────────────────────────────────────────────────────────────────
type Move = { type: string; tile?: unknown; position?: string };
type GState = { playerIds: string[]; currentPlayerIndex: number; handNumber: number; handOver: boolean; gameOver: boolean; sequence: number };
type Upd = { you?: string; legalMoves?: Move[]; canDraw?: boolean; state?: GState };
type Client = { socket: Socket; seat: string | null; latest: Upd | null };

function connect(): Promise<Socket> {
  const s = io(base, { transports: ['websocket'], reconnection: false, autoConnect: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 20_000);
    s.once('connect_error', reject);
    s.once('connect', () => { clearTimeout(t); resolve(s); });
    s.connect();
  });
}
function ack(s: Socket, ev: string, ...args: unknown[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 20_000);
    s.emit(ev, ...args, (r: Record<string, unknown>) => { clearTimeout(t); resolve(r ?? {}); });
  });
}
async function waitFor(pred: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await sleep(20); }
  return false;
}

let totalActions = 0;
const ackLatencies: number[] = [];
let completedMatches = 0;
let stopAt = Infinity;

async function runMatch(i: number) {
  const a: Client = { socket: await connect(), seat: null, latest: null };
  const b: Client = { socket: await connect(), seat: null, latest: null };
  let last: GState | undefined; let stamp = 0;
  for (const c of [a, b]) c.socket.on('state:update', (p: Upd) => { c.latest = p; if (p.you) c.seat = p.you; if (p.state) { last = p.state; stamp += 1; } });
  const created = await ack(a.socket, 'room:create', { username: `PA${i}`, winningScore: 30, skipPregameDraw: true });
  if (!created.ok) throw new Error(`create: ${created.error}`);
  const code = String(created.roomCode);
  a.seat = String(created.you);
  const joined = await ack(b.socket, 'room:join', code, { username: `PB${i}` });
  if (joined.you) b.seat = String(joined.you);
  await ack(b.socket, 'player:ready', code);
  const started = await ack(a.socket, 'game:start', code);
  if (!started.ok) throw new Error(`start: ${started.error}`);
  const ok = await waitFor(() => Boolean(a.latest?.state && b.latest?.state), 15_000);
  if (process.env.DEBUG) console.error('match', i, 'started', ok, code);
  const newest = () => last;
  while (Date.now() < stopAt) {
    const ref = newest();
    if (!ref) { await sleep(50); continue; }
    if (ref.gameOver) { completedMatches += 1; break; }
    if (ref.handOver) {
      await ack(a.socket, 'hand:ready', code, ref.handNumber);
      await ack(b.socket, 'hand:ready', code, ref.handNumber);
      await waitFor(() => { const s = newest(); return Boolean(s && (s.gameOver || (!s.handOver && s.handNumber !== ref.handNumber))); });
      continue;
    }
    const cur = [a, b].find((c) => c.seat === ref.playerIds[ref.currentPlayerIndex]);
    if (!cur) { await sleep(40); continue; }
    if (THINK_MS) await sleep(THINK_MS * (0.5 + Math.random()));
    const legal = cur.latest?.legalMoves ?? [];
    const play = legal.find((m) => m.type === 'play' && m.tile && m.position);
    const action = play
      ? { type: 'MOVE', move: { tile: play.tile, position: play.position }, requestId: randomUUID() }
      : cur.latest?.canDraw ? { type: 'DRAW', requestId: randomUUID() } : { type: 'PASS', requestId: randomUUID() };
    const seq = ref.sequence; const stamp0 = stamp;
    const t0 = performance.now();
    const r = await ack(cur.socket, 'game:action', code, action);
    ackLatencies.push(performance.now() - t0);
    if (!r.ok) { await sleep(100); continue; }
    totalActions += 1;
    if (process.env.DEBUG && totalActions % 20 === 0) console.error('actions', totalActions, 'match', i, 'seq', a.latest?.state?.sequence);
    await waitFor(() => stamp !== stamp0, 5000); void seq;
  }
  a.socket.disconnect(); b.socket.disconnect();
}

function pct(xs: number[], p: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
}

async function main() {
  await new Promise<void>((r) => stub.listen(STUB_PORT, '127.0.0.1', r));
  const server = await spawnServer();
  const pid = server.pid!;
  await sleep(3000); // let boot work settle
  let throttle: ChildProcess | null = null;
  let throttleOut = '';
  if (process.env.THROTTLE_QUOTA_MS) {
    throttle = spawn('python3', [process.env.THROTTLE_SCRIPT ?? join(__dirname, 'cfsThrottle.py'), String(pid), process.env.THROTTLE_QUOTA_MS], { stdio: ['ignore', 'pipe', 'inherit'] });
    throttle.stdout?.on('data', (d) => { throttleOut += String(d); });
    await sleep(500);
  }
  const idleCpu0 = cpuSecondsOf(pid);
  const idleRss = rssMbOf(pid);
  await sleep(5000);
  const idleCpuPerS = (cpuSecondsOf(pid) - idleCpu0) / 5;
  stubCounts.clear(); stubBytes.clear(); stubBytesIn = 0;

  const cpu0 = cpuSecondsOf(pid);
  const t0 = Date.now();
  if (DURATION_S) stopAt = t0 + DURATION_S * 1000;
  let peakRss = 0;
  const rssTimer = setInterval(() => { try { peakRss = Math.max(peakRss, rssMbOf(pid)); } catch { /* gone */ } }, 1000);
  // Probe-side lag of HTTP /healthz round trip, as a proxy for server loop delay.
  const healthLat: number[] = [];
  const hTimer = setInterval(async () => {
    const h0 = performance.now();
    try { await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(10_000) }); healthLat.push(performance.now() - h0); } catch { healthLat.push(10_000); }
  }, 500);
  const clientLag = monitorEventLoopDelay({ resolution: 20 }); clientLag.enable();

  const results = await Promise.allSettled(Array.from({ length: MATCHES }, (_, i) => runMatch(i)));
  const wall = (Date.now() - t0) / 1000;
  clearInterval(rssTimer); clearInterval(hTimer);
  const cpu = cpuSecondsOf(pid) - cpu0;
  const failures = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason).slice(0, 160));
  const stubTotal = [...stubCounts.values()].reduce((x, y) => x + y, 0);
  const report = {
    matches: MATCHES, thinkMs: THINK_MS, wallS: Math.round(wall),
    completedMatches, failures: failures.slice(0, 5), failureCount: failures.length,
    actions: totalActions,
    server: {
      idleCpuPctOneCore: Math.round(idleCpuPerS * 1000) / 10,
      idleRssMb: Math.round(idleRss), peakRssMb: Math.round(peakRss),
      cpuS: Math.round(cpu * 100) / 100,
      cpuPctOneCore: Math.round((cpu / wall) * 1000) / 10,
      cpuMsPerAction: totalActions ? Math.round((cpu * 1000 / totalActions) * 100) / 100 : null,
      rssPerMatchMb: Math.round(((peakRss - idleRss) / MATCHES) * 100) / 100,
    },
    actionAckMs: { p50: pct(ackLatencies, 0.5), p95: pct(ackLatencies, 0.95), p99: pct(ackLatencies, 0.99), max: pct(ackLatencies, 1) },
    healthzMs: { p50: pct(healthLat, 0.5), p95: pct(healthLat, 0.95), max: pct(healthLat, 1) },
    stub: { requests: stubTotal, perAction: totalActions ? Math.round((stubTotal / totalActions) * 100) / 100 : null, kbIn: Math.round(stubBytesIn / 1024),
      top: [...stubCounts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8),
      bytesByPath: [...stubBytes.entries()].sort((x, y) => y[1].total - x[1].total).slice(0, 5).map(([k, v]) => [k, Math.round(v.total / 1024) + 'KB', 'avg ' + Math.round(v.total / Math.max(1, stubCounts.get(k) ?? 1) / 1024) + 'KB', 'max ' + Math.round(v.max / 1024) + 'KB']) },
  };
  if (throttle) { throttle.kill('SIGTERM'); await sleep(300); (report as Record<string, unknown>).throttle = { quotaMs: Number(process.env.THROTTLE_QUOTA_MS), summary: throttleOut.trim() }; }
  console.log(JSON.stringify(report, null, 2));
  server.kill('SIGKILL');
  stub.close();
  process.exit(0);
}
void main();
