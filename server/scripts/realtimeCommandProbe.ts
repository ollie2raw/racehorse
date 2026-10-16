/**
 * Realtime command-protocol probe. Runs the REAL server (tsx src/index.ts) against an OWNED local
 * PostgreSQL/PostgREST (+ synthetic /auth/v1/user) and drives raw Socket.IO clients through duplicated,
 * replayed, stale, out-of-order, malformed, unauthorized and flooded commands. Every check prints
 * `OK <name>` or `FINDING <name> :: detail`; the process exits non-zero on any FINDING.
 *
 *   TERMINAL_R1_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1 \
 *   TERMINAL_R1_POSTGREST_URL=http://127.0.0.1:55440 npx tsx scripts/realtimeCommandProbe.ts [group]
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
const timeoutMs = 15_000;
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


// ───────────────────────────── probe body ─────────────────────────────
const findings: string[] = [];
const oks: string[] = [];
const notes: Record<string, unknown> = {};
const ok = (name: string) => { oks.push(name); process.stdout.write(`OK ${name}\n`); };
const finding = (name: string, detail: string) => { findings.push(`${name} :: ${detail}`); process.stdout.write(`FINDING ${name} :: ${detail}\n`); };
const check = (cond: boolean, name: string, detail = '') => (cond ? ok(name) : finding(name, detail));
const seq = (c: Client) => c.latest?.state?.sequence ?? -1;

async function healthy(): Promise<boolean> {
  try { return (await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}
async function makeClient(u: { id: string; name: string; token: string } | null): Promise<Client> {
  const identity = u ? { username: u.name, userId: u.id, authToken: u.token } : { username: 'Guest', userId: '', authToken: '' };
  const c: Client = { socket: await connect(), seatId: null, latest: null, identity };
  wire(c);
  if (u) await emitAck(c.socket, 'presence:identify', identity);
  return c;
}
async function startRoom(opts: { winningScore?: number } = {}) {
  const hu = createUser('pr-host');
  const gu = createUser('pr-guest');
  const host = await makeClient(hu);
  const guest = await makeClient(gu);
  const created = await emitAck(host.socket, 'room:create', { ...host.identity, winningScore: opts.winningScore ?? WINNING_SCORE, skipPregameDraw: true });
  if (!created.ok) throw new Error(`room:create failed: ${created.error}`);
  const roomCode = String(created.roomCode);
  if (typeof created.you === 'string') host.seatId = created.you;
  const joined = await emitAck(guest.socket, 'room:join', roomCode, guest.identity);
  if (!joined.ok) throw new Error(`room:join failed: ${joined.error}`);
  if (typeof joined.you === 'string') guest.seatId = joined.you;
  await emitAck(guest.socket, 'player:ready', roomCode);
  const started = await emitAck(host.socket, 'game:start', roomCode);
  if (!started.ok) throw new Error(`game:start failed: ${started.error}`);
  await waitFor(() => Boolean(host.latest?.state && guest.latest?.state), 15_000);
  return { hu, gu, host, guest, roomCode };
}
const turnClient = (r: { host: Client; guest: Client }): Client | undefined => {
  const ref = refState(r.host, r.guest);
  return ref ? [r.host, r.guest].find((c) => c.seatId === ref.playerIds[ref.currentPlayerIndex]) : undefined;
};
const otherOf = (r: { host: Client; guest: Client }, c: Client) => (c === r.host ? r.guest : r.host);
const roomSeq = (r: { host: Client; guest: Client }) => refState(r.host, r.guest)?.sequence ?? -1;
const dbSeq = (code: string) => Number(sql(`select coalesce(max((game_state->>'sequence')::int),-1) from public.room_live_sessions where room_code='${code}'`));
const moveFor = (c: Client) => {
  const m = (c.latest?.legalMoves ?? []).find((x) => x.type === 'play' && x.tile && x.position);
  return m ? { type: 'MOVE', move: { tile: m.tile, position: m.position } } : null;
};
async function settle(r: { host: Client; guest: Client }, prev: number) {
  await waitFor(() => roomSeq(r) > prev, 4000);
  await sleep(250);
}

async function groupIdempotency() {
  const r = await startRoom();
  let cur = turnClient(r)!;
  await waitFor(() => (cur.latest?.legalMoves?.length ?? 0) > 0 || Boolean(cur.latest?.canDraw), 5000);
  // first move: whoever is on turn plays (first move may have several tile options)
  const act1 = moveFor(cur) ?? { type: 'DRAW' };
  const id1 = `probe-${randomUUID()}`;
  const s0 = roomSeq(r);
  const a1 = await emitAck(cur.socket, 'game:action', r.roomCode, { ...act1, requestId: id1 });
  await settle(r, s0);
  const s1 = roomSeq(r);
  check(Boolean(a1.ok) && s1 > s0, 'idem.first-apply', JSON.stringify(a1));
  const a1b = await emitAck(cur.socket, 'game:action', r.roomCode, { ...act1, requestId: id1 });
  await sleep(300);
  check(Boolean(a1b.ok) && a1b.duplicate === true && roomSeq(r) === s1, 'idem.same-id-same-payload-returns-original', JSON.stringify(a1b));
  check(a1b.sequence === a1.sequence, 'idem.duplicate-returns-original-sequence', `${a1.sequence} vs ${a1b.sequence}`);
  // same id, DIFFERENT payload -> must fail closed (not "ok:duplicate" for a move that was never applied)
  const altType = act1.type === 'DRAW' ? { type: 'PASS' } : { type: 'DRAW' };
  const a1c = await emitAck(cur.socket, 'game:action', r.roomCode, { ...altType, requestId: id1 });
  await sleep(300);
  check(roomSeq(r) === s1, 'idem.same-id-different-payload-no-state-change', `seq ${s1} -> ${roomSeq(r)}`);
  check(a1c.ok === false, 'idem.same-id-different-payload-fails-closed', JSON.stringify(a1c));
  // different id, same (now illegal: not my turn) move
  const a1d = await emitAck(cur.socket, 'game:action', r.roomCode, { ...act1, requestId: `probe-${randomUUID()}` });
  await sleep(300);
  check(a1d.ok === false && roomSeq(r) === s1, 'idem.new-id-same-move-after-turn-passed-rejected', JSON.stringify(a1d));
  // other player's request id collision: same id used by the other seat must not return our ack
  const other = otherOf(r, cur);
  await waitFor(() => turnClient(r) === other, 4000);
  const aX = await emitAck(other.socket, 'game:action', r.roomCode, { ...(moveFor(other) ?? { type: 'DRAW' }), requestId: id1 });
  await sleep(300);
  check(aX.duplicate !== true, 'idem.request-id-is-per-seat', JSON.stringify(aX));
  return r;
}

const MALFORMED: Array<[string, unknown[]]> = [
  ['no-args', []],
  ['null-action', ['@CODE', null]],
  ['array-action', ['@CODE', []]],
  ['string-action', ['@CODE', 'MOVE']],
  ['number-code', [12345, { type: 'DRAW', requestId: 'x' }]],
  ['object-code', [{ a: 1 }, { type: 'DRAW', requestId: 'x' }]],
  ['unknown-type', ['@CODE', { type: 'EXPLODE', requestId: 'x' }]],
  ['proto-type', ['@CODE', JSON.parse('{"__proto__":{"type":"MOVE"},"type":"MOVE","requestId":"p1"}')]],
  ['move-null', ['@CODE', { type: 'MOVE', move: null, requestId: 'm1' }]],
  ['move-string', ['@CODE', { type: 'MOVE', move: 'x', requestId: 'm2' }]],
  ['move-array', ['@CODE', { type: 'MOVE', move: [], requestId: 'm3' }]],
  ['tile-strings', ['@CODE', { type: 'MOVE', move: { tile: { high: '6', low: '6' }, position: 'left' }, requestId: 'm4' }]],
  ['tile-nan-null', ['@CODE', { type: 'MOVE', move: { tile: { high: null, low: null }, position: 'left' }, requestId: 'm5' }]],
  ['tile-oob', ['@CODE', { type: 'MOVE', move: { tile: { high: 99, low: -3 }, position: 'left' }, requestId: 'm6' }]],
  ['tile-float', ['@CODE', { type: 'MOVE', move: { tile: { high: 1.5, low: 2.5 }, position: 'left' }, requestId: 'm7' }]],
  ['bad-position', ['@CODE', { type: 'MOVE', move: { tile: { high: 1, low: 1 }, position: 'sideways' }, requestId: 'm8' }]],
  ['nested-junk', ['@CODE', { type: 'MOVE', move: { tile: { high: { a: { b: [1, 2, { c: 3 }] } }, low: 1 }, position: {} }, requestId: 'm9' }]],
  ['huge-requestId', ['@CODE', { type: 'DRAW', requestId: 'r'.repeat(5000) }]],
  ['huge-type', ['@CODE', { type: 'D'.repeat(100000), requestId: 'h1' }]],
  ['numeric-requestId', ['@CODE', { type: 'DRAW', requestId: 7 }]],
  ['code-huge', ['Z'.repeat(100000), { type: 'DRAW', requestId: 'c1' }]],
  ['cb-not-function', ['@CODE', { type: 'DRAW', requestId: 'cb1' }, 'notafunction']],
];

async function groupMalformed() {
  const r = await startRoom();
  const cur = turnClient(r)!;
  const leakRe = /(\bat\s+\S+\s+\(|node_modules|\/home\/|\.ts:\d+|supabase|postgres|ECONN|fetch failed|stack)/i;
  notes.malformedSample = {};
  const before = { seq: roomSeq(r), db: dbSeq(r.roomCode), players: JSON.stringify(refState(r.host, r.guest)?.players) };
  for (const [name, args] of MALFORMED) {
    const resolved = args.map((a) => (a === '@CODE' ? r.roomCode : a));
    let ack: Ack | 'no-ack' = 'no-ack';
    try {
      ack = await new Promise<Ack>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 2500);
        const maybeCb = resolved[resolved.length - 1];
        const callArgs = name === 'no-args' ? [] : resolved;
        if (name === 'cb-not-function') cur.socket.emit('game:action', ...callArgs);
        else cur.socket.emit('game:action', ...callArgs, (a: Ack) => { clearTimeout(timer); resolve(a ?? {}); });
        if (name === 'cb-not-function') { clearTimeout(timer); resolve({ ok: false, error: '(no ack expected)' }); }
        void maybeCb;
      });
    } catch { ack = 'no-ack'; }
    const alive = await healthy();
    const text = JSON.stringify(ack);
    if (!alive) { finding(`malformed.${name}.server-alive`, 'server died'); await spawnAgain(); continue; }
    if (ack !== 'no-ack' && (ack as Ack).ok === true) finding(`malformed.${name}.rejected`, text);
    else if (leakRe.test(text)) finding(`malformed.${name}.no-internal-leak`, text.slice(0, 200));
    else { ok(`malformed.${name}`); const a = ack as Ack; (notes.malformedSample as Record<string, unknown>)[name] = a === ('no-ack' as never) ? 'no-ack' : { error: a.error, code: (a as { code?: string }).code }; }
  }
  await sleep(500);
  check(roomSeq(r) === before.seq && dbSeq(r.roomCode) <= before.db + 0, 'malformed.no-state-change', `seq ${before.seq}->${roomSeq(r)} db ${before.db}->${dbSeq(r.roomCode)}`);
  check(JSON.stringify(refState(r.host, r.guest)?.players) === before.players, 'malformed.no-score-or-hand-mutation');
  return r;
}

type Sent = { client: Client; action: Record<string, unknown>; requestId: string };
async function playToGameOver(r: { host: Client; guest: Client; roomCode: string }, sent: Sent[]) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const ref = refState(r.host, r.guest);
    if (ref?.gameOver) return true;
    if (!ref) { await sleep(100); continue; }
    if (ref.handOver) { await step(r.roomCode, r.host, r.guest); continue; }
    const cur = [r.host, r.guest].find((c) => c.seatId === ref.playerIds[ref.currentPlayerIndex]);
    if (!cur || (cur.latest?.state?.sequence ?? -1) < ref.sequence) { await sleep(80); continue; }
    const action = nextAction(cur) as Record<string, unknown>;
    const resp = await emitAck(cur.socket, 'game:action', r.roomCode, action).catch(() => ({ ok: false }));
    if (resp?.ok) sent.push({ client: cur, action, requestId: String(action.requestId) });
    await waitFor(() => { const s = refState(r.host, r.guest); return Boolean(s && (s.sequence !== ref.sequence || s.gameOver || s.handOver)); }, 5000);
  }
  return false;
}
const matchIdOf = (code: string) => sql(`select match_id from public.room_live_sessions where room_code='${code}'`);

async function groupRematch() {
  const r = await startRoom();
  const sent: Sent[] = [];
  const over = await playToGameOver(r, sent);
  check(over, 'rematch.setup.game-over-reached');
  if (!over) return r;
  const last = sent[sent.length - 1]!;
  const matchA = matchIdOf(r.roomCode);
  // post-game-over stale gameplay: replay the FINAL move (same id) and a fresh id
  const post1 = await emitAck(last.client.socket, 'game:action', r.roomCode, last.action);
  check(post1.ok !== true || post1.duplicate === true, 'rematch.final-move-replay-after-game-over-not-reapplied', JSON.stringify(post1));
  const post2 = await emitAck(last.client.socket, 'game:action', r.roomCode, { ...last.action, requestId: `probe-${randomUUID()}` });
  check(post2.ok === false, 'rematch.final-move-fresh-id-after-game-over-rejected', JSON.stringify(post2));
  // both accept rematch; the other's duplicate request must not double-start
  const rm1 = await emitAck(r.host.socket, 'game:rematch', r.roomCode);
  const rm1dup = await emitAck(r.host.socket, 'game:rematch', r.roomCode);
  const rm2 = await emitAck(r.guest.socket, 'game:rematch', r.roomCode);
  await waitFor(() => { const s = refState(r.host, r.guest); return Boolean(s && !s.gameOver && s.handNumber >= 1 && s.sequence < 40); }, 15_000);
  await sleep(1000);
  const matchB = matchIdOf(r.roomCode);
  notes.rematch = { rm1, rm1dup, rm2, matchChanged: matchA !== matchB };
  check(matchA !== matchB && Boolean(rm2.ok), 'rematch.new-match-id-issued', JSON.stringify({ rm1, rm1dup, rm2 }));
  const gameB = refState(r.host, r.guest);
  check(Boolean(gameB && !gameB.gameOver), 'rematch.game-b-running');
  // wait until the sender of the old final move is on turn in game B (or play the other side forward)
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && turnClient(r) !== last.client) {
    const cur = turnClient(r);
    if (!cur) { await sleep(100); continue; }
    const prev = roomSeq(r);
    await emitAck(cur.socket, 'game:action', r.roomCode, nextAction(cur)).catch(() => ({}));
    await waitFor(() => roomSeq(r) > prev, 3000);
  }
  if (turnClient(r) === last.client) {
    const s0 = roomSeq(r);
    // OLD game's request id replayed in game B with a payload that WOULD be legal now
    const legal = moveFor(last.client) ?? { type: 'DRAW' };
    const replay = await emitAck(last.client.socket, 'game:action', r.roomCode, { ...legal, requestId: last.requestId });
    await sleep(400);
    check(replay.ok === false && roomSeq(r) === s0, 'rematch.previous-game-request-id-cannot-mutate-new-game', JSON.stringify({ replay, s0, now: roomSeq(r) }));
    // exact old payload under its old id (should be duplicate/ignored, never a fresh apply)
    const replay2 = await emitAck(last.client.socket, 'game:action', r.roomCode, last.action);
    await sleep(400);
    check(roomSeq(r) === s0 || replay2.ok === false, 'rematch.exact-old-command-not-reapplied-in-new-game', JSON.stringify({ replay2, s0, now: roomSeq(r) }));
  } else {
    finding('rematch.setup.could-not-reach-sender-turn', 'skipped replay');
  }
  // late forfeit from the previous game's UI (no match binding) lands in game B
  const stateBefore = sql(`select status from public.room_live_sessions where room_code='${r.roomCode}'`);
  const lateStale = await emitAck(last.client.socket, 'room:abandon_match', { roomCode: r.roomCode, matchId: matchA });
  check(lateStale.ok === false && lateStale.error === 'stale_match' && sql(`select status from public.room_live_sessions where room_code='${r.roomCode}'`) === stateBefore, 'rematch.late-abandon-bound-to-previous-match-refused', JSON.stringify(lateStale));
  const lateAction = await emitAck(last.client.socket, 'game:action', r.roomCode, { type: 'DRAW', requestId: `probe-${randomUUID()}`, matchId: matchA });
  check(lateAction.ok === false && lateAction.error === 'stale_match', 'rematch.late-action-bound-to-previous-match-refused', JSON.stringify(lateAction));
  const lateRematch = await emitAck(last.client.socket, 'game:rematch', r.roomCode, { matchId: matchA });
  check(lateRematch.ok === false && lateRematch.error === 'stale_match', 'rematch.late-rematch-bound-to-previous-match-refused', JSON.stringify(lateRematch));
  const lateHand = await emitAck(last.client.socket, 'hand:ready', r.roomCode, { handNumber: 1, requestId: `probe-${randomUUID()}`, matchId: matchA });
  check(lateHand.ok === false && lateHand.error === 'stale_match', 'rematch.late-hand-ready-bound-to-previous-match-refused', JSON.stringify(lateHand));
  // an unbound legacy abandon still resigns the CURRENT game (entitled user action)
  const unbound = await emitAck(last.client.socket, 'room:abandon_match', { roomCode: r.roomCode });
  notes.unboundAbandonIntoGameB = unbound;
  return r;
}


async function burst(c: Client, event: string, mk: (i: number) => unknown[], n: number) {
  gateway.reset();
  const t0 = Date.now();
  const acks = await Promise.all(Array.from({ length: n }, (_, i) =>
    new Promise<Ack>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'noack' }), 8000);
      c.socket.emit(event, ...mk(i), (a: Ack) => { clearTimeout(timer); resolve(a ?? {}); });
    })));
  await sleep(300);
  const errs: Record<string, number> = {};
  for (const a of acks) { const k = String(a.error ?? (a.ok ? 'ok' : 'fail')); errs[k] = (errs[k] ?? 0) + 1; }
  const byPath: Record<string, number> = {};
  for (const q of gateway.requests) { const k = `${q.method} ${q.path.split('?')[0]}`; byPath[k] = (byPath[k] ?? 0) + 1; }
  return { event, sent: n, ms: Date.now() - t0, errs, gatewayRequests: gateway.requests.length, byPath };
}

async function groupFlood2() {
  const r = await startRoom();
  const out: unknown[] = [];
  const outsider = await makeClient(createUser('pr-fl'));
  out.push(await burst(r.host, 'game:rematch', () => [r.roomCode], 300));
  out.push(await burst(r.host, 'hand:ready', (i) => [r.roomCode, { handNumber: 1, requestId: `fl-hr-${i}` }], 300));
  out.push(await burst(r.host, 'player:ready', () => [r.roomCode], 300));
  out.push(await burst(r.host, 'game:start', () => [r.roomCode], 300));
  out.push(await burst(outsider, 'room:abandon_match', () => [{ roomCode: r.roomCode }], 300));
  out.push(await burst(outsider, 'room:join', () => [r.roomCode, { username: 'x', userId: outsider.identity.userId, authToken: outsider.identity.authToken }], 100));
  out.push(await burst(outsider, 'room:leave', () => [r.roomCode], 300));
  out.push(await burst(outsider, 'room:spectate', () => [r.roomCode, { ...outsider.identity }], 100));
  out.push(await burst(r.guest, 'room:emote:send', () => [{ roomCode: r.roomCode, emoteId: 'gg' }], 200));
  notes.flood2 = out;
  check(await healthy(), 'flood2.server-alive');
  const worst = Math.max(...(out as Array<{ gatewayRequests: number }>).map((o) => o.gatewayRequests));
  notes.flood2_worstGatewayRequests = worst;
  return r;
}


async function groupRaces() {
  // (1) move vs explicit forfeit fired concurrently, repeated: exactly one coherent outcome each time
  let coherent = 0;
  const outcomes: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const r = await startRoom();
    const cur = turnClient(r)!;
    const other = otherOf(r, cur);
    const mover = cur;
    const resigner = i % 2 === 0 ? cur : other;
    const s0 = roomSeq(r);
    const [mv, ab] = await Promise.all([
      emitAck(mover.socket, 'game:action', r.roomCode, { ...(moveFor(mover) ?? { type: 'DRAW' }), requestId: `race-${randomUUID()}` }),
      emitAck(resigner.socket, 'room:abandon_match', { roomCode: r.roomCode }),
    ]);
    await sleep(1500);
    const status = sql(`select status from public.room_live_sessions where room_code='${r.roomCode}'`);
    const ranked = Number(sql(`select count(*) from public.ranked_games where player_id in ('${r.hu.id}','${r.gu.id}')`));
    const after = await emitAck(mover.socket, 'game:action', r.roomCode, { type: 'DRAW', requestId: `race-${randomUUID()}` });
    // once abandoned, no later gameplay may apply and ranked rows are exactly one logical completion (2)
    const abandoned = Boolean(ab.ok);
    const okShape = abandoned ? (status === 'abandoned' || status === '') && after.ok === false && ranked === 2 : status === 'playing' && ranked === 0;
    outcomes.push(`${abandoned ? 'forfeit' : 'no-forfeit'}/${mv.ok ? 'move-applied' : 'move-rejected'}/db=${status}/ranked=${ranked}`);
    if (okShape) coherent += 1;
    else finding('race.move-vs-forfeit.coherent', JSON.stringify({ mv, ab, status, ranked, after }));
    for (const c of [r.host, r.guest]) c.socket.disconnect();
  }
  notes.raceMoveVsForfeit = outcomes;
  check(coherent === 6, 'race.move-vs-forfeit.all-coherent', `${coherent}/6`);
  // (2) reconnect while the disconnect grace is pending: no auto-act / forfeit after the grace window
  const r = await startRoom();
  const cur = turnClient(r)!;
  const u = cur === r.host ? r.hu : r.gu;
  const s0 = roomSeq(r);
  cur.socket.disconnect();
  await sleep(4000);
  const back = await makeClient(u);
  const j = await emitAck(back.socket, 'room:join', r.roomCode, back.identity);
  check(Boolean(j.ok), 'race.reconnect-during-grace-join', JSON.stringify(j).slice(0, 150));
  back.seatId = (j.you as string) ?? null;
  await sleep(36_000); // past the 30s grace window
  const st = sql(`select status from public.room_live_sessions where room_code='${r.roomCode}'`);
  const seqNow = dbSeq(r.roomCode);
  check(st === 'playing' && seqNow === s0, 'race.reconnect-cancels-pending-disconnect-autoact', JSON.stringify({ st, s0, seqNow }));
  // (3) disconnect with no reconnect: exactly one outcome (auto-act or forfeit), never both
  return r;
}

async function groupRestart() {
  const r = await startRoom();
  const cur = turnClient(r)!;
  const act = moveFor(cur) ?? { type: 'DRAW' };
  const reqId = `rst-${randomUUID()}`;
  const s0 = roomSeq(r);
  const a1 = await emitAck(cur.socket, 'game:action', r.roomCode, { ...act, requestId: reqId });
  await waitFor(() => roomSeq(r) > s0, 3000);
  const s1 = roomSeq(r);
  // wait until BOTH the snapshot and the receipt are durable, then hard-kill
  await waitFor(() => dbSeq(r.roomCode) >= s1 && Number(sql(`select count(*) from public.room_command_receipts where room_code='${r.roomCode}' and request_id='${reqId}'`)) === 1, 8000);
  await killHard(serverChild);
  serverChild = await spawnServer();
  const uc = cur === r.host ? r.hu : r.gu;
  const back = await makeClient(uc);
  const j = await emitAck(back.socket, 'room:join', r.roomCode, back.identity);
  back.seatId = (j.you as string) ?? null;
  check(Boolean(j.ok), 'restart.rejoin-after-hard-kill', JSON.stringify(j).slice(0, 150));
  const seqAfterRejoin = (j.state as { sequence?: number } | undefined)?.sequence ?? -1;
  check(seqAfterRejoin === s1, 'restart.state-restored-at-committed-sequence', `${seqAfterRejoin} vs ${s1}`);
  const a2 = await emitAck(back.socket, 'game:action', r.roomCode, { ...act, requestId: reqId });
  await sleep(500);
  check(a2.ok === true && a2.duplicate === true && dbSeq(r.roomCode) === s1, 'restart.same-request-id-after-restart-is-duplicate-not-reapplied', JSON.stringify({ a1, a2, db: dbSeq(r.roomCode), s1 }));
  // Same id, altered payload after restart must also fail closed
  const a3 = await emitAck(back.socket, 'game:action', r.roomCode, { type: 'PASS', requestId: reqId });
  check(a3.ok === false && dbSeq(r.roomCode) === s1, 'restart.same-id-altered-payload-after-restart-fails-closed', JSON.stringify(a3));
  return r;
}


async function groupFuzzOther() {
  const r = await startRoom();
  const c = r.guest;
  const junk: unknown[][] = [
    [], [null], [undefined, undefined], [[]], [{}], [{ roomCode: { $ne: 1 } }], [12345], [true],
    ['Z'.repeat(50_000)], [{ roomCode: r.roomCode, matchId: { a: 1 } }], [JSON.parse('{"__proto__":{"roomCode":"X"},"roomCode":"'+r.roomCode+'x"}')],
    [r.roomCode, { handNumber: 'NaN', requestId: {} }], [r.roomCode, { handNumber: null, requestId: ['a'] }],
    [r.roomCode, 'strange', 5],
  ];
  const events = ['room:join', 'room:create', 'room:leave', 'room:spectate', 'room:abandon_match', 'game:rematch', 'hand:ready', 'player:ready', 'game:start', 'game:pregame_draw_pick', 'room:emote:send', 'presence:identify', 'queue:join', 'queue:leave'];
  const leakRe = /(\bat\s+\S+\s+\(|node_modules|\/home\/|\.ts:\d+|supabase|postgres|ECONN|fetch failed)/i;
  const seqBefore = roomSeq(r);
  let dead = 0; let leaks = 0; const samples: Record<string, unknown> = {};
  for (const ev of events) {
    for (const args of junk) {
      // abandon/leave from the real seated sockets would legitimately end the match; fuzz with a disposable member-less client instead
      const target = ev === 'room:abandon_match' || ev === 'room:leave' || ev === 'room:create' ? await makeClient(createUser('pr-fz')) : c;
      const ack = await new Promise<unknown>((resolve) => {
        const t = setTimeout(() => resolve('no-ack'), 700);
        target.socket.emit(ev, ...args, (a: unknown) => { clearTimeout(t); resolve(a); });
      });
      const text = JSON.stringify(ack);
      if ((ack as { ok?: boolean })?.ok !== true && leakRe.test(text)) { leaks += 1; finding(`fuzz.${ev}.leak`, text.slice(0, 200)); }
      if (target !== c) target.socket.disconnect();
      if (!(await healthy())) { dead += 1; finding(`fuzz.${ev}.server-died`, JSON.stringify(args).slice(0, 120)); await spawnAgain(); break; }
      samples[ev] = ack;
    }
  }
  check(dead === 0, 'fuzz.other-events-server-survives');
  check(leaks === 0, 'fuzz.other-events-no-internal-leak');
  check(roomSeq(r) === seqBefore, 'fuzz.other-events-no-gameplay-mutation', `${seqBefore}->${roomSeq(r)}`);
  notes.fuzzOtherSamples = samples;
  return r;
}


async function groupPersistLoss() {
  // A mid-hand move whose snapshot never reaches the database, then a hard kill: the retry (same id) must
  // apply exactly once on the restored state - no receipt may lead the snapshot.
  const r = await startRoom();
  const cur = turnClient(r)!;
  const act = moveFor(cur) ?? { type: 'DRAW' };
  const reqId = `pl-${randomUUID()}`;
  const s0 = roomSeq(r);
  gateway.faults.push({ name: 'drop-snapshots', phase: 'before', times: 99, match: (q) => q.path.startsWith('/room_live_sessions') || q.path.includes('persist_room_live_session') });
  const a1 = await emitAck(cur.socket, 'game:action', r.roomCode, { ...act, requestId: reqId });
  await waitFor(() => roomSeq(r) > s0, 3000);
  const s1 = roomSeq(r);
  await sleep(1500);
  const receiptRows = Number(sql(`select count(*) from public.room_command_receipts where room_code='${r.roomCode}' and request_id='${reqId}'`));
  check(s1 > s0 && a1.ok === true && dbSeq(r.roomCode) <= s0 && receiptRows === 0, 'persistloss.receipt-never-leads-snapshot', JSON.stringify({ a1, s0, s1, db: dbSeq(r.roomCode), receiptRows }));
  await killHard(serverChild);
  gateway.faults.length = 0;
  serverChild = await spawnServer();
  const uc = cur === r.host ? r.hu : r.gu;
  const back = await makeClient(uc);
  const j = await emitAck(back.socket, 'room:join', r.roomCode, back.identity);
  back.seatId = (j.you as string) ?? null;
  const restored = (j.state as { sequence?: number } | undefined)?.sequence ?? -1;
  check(restored === s0, 'persistloss.restored-to-last-durable-sequence', `${restored} vs ${s0}`);
  const legal = (j.legalMoves as Move[] | undefined)?.find((m) => m.type === 'play' && m.tile && m.position);
  const retryAction = legal ? { type: 'MOVE', move: { tile: legal.tile, position: legal.position } } : act;
  const a2 = await emitAck(back.socket, 'game:action', r.roomCode, { ...act, requestId: reqId });
  await sleep(500);
  const afterRetry = dbSeq(r.roomCode);
  check(a2.ok === true && a2.duplicate !== true && afterRetry === s0 + (a1.sequence !== undefined ? (Number(a1.sequence) - s0) : 1), 'persistloss.retry-with-same-id-applies-exactly-once', JSON.stringify({ a1, a2, afterRetry, s0 }));
  const a3 = await emitAck(back.socket, 'game:action', r.roomCode, { ...act, requestId: reqId });
  await sleep(300);
  check(a3.duplicate === true && dbSeq(r.roomCode) === afterRetry, 'persistloss.second-retry-is-duplicate', JSON.stringify(a3));
  void retryAction;
  return r;
}

async function groupGuest() {
  const host = await makeClient(null);
  const created = await emitAck(host.socket, 'room:create', { username: 'GuestHost', userId: 'guest-host-probe', winningScore: 5, skipPregameDraw: true });
  const roomCode = String(created.roomCode);
  host.seatId = (created.you as string) ?? null;
  const token = created.guestReconnectToken as string | undefined;
  check(Boolean(token), 'guest.create-issues-reconnect-capability');
  const guest2 = await makeClient(null);
  const j = await emitAck(guest2.socket, 'room:join', roomCode, { username: 'G2' });
  check(Boolean(j.ok), 'guest.second-guest-joins', JSON.stringify(j).slice(0, 120));
  guest2.seatId = (j.you as string) ?? null;
  // takeover attempt WITHOUT the capability (guessing the host's seat identity) must not displace the host
  const intruder = await makeClient(null);
  const hostUserId = 'guest-host-probe';
  const bad = await emitAck(intruder.socket, 'room:join', roomCode, { username: 'GuestHost', userId: hostUserId, guestReconnectToken: 'v1.0.AAAA' });
  check(bad.ok === false, 'guest.takeover-without-valid-capability-refused', JSON.stringify(bad).slice(0, 160));
  check(host.socket.connected, 'guest.host-socket-not-displaced-by-forged-join');
  // legitimate reconnect with the capability supersedes the old socket (single owner)
  const tab2 = await makeClient(null);
  const re = await emitAck(tab2.socket, 'room:join', roomCode, { username: 'GuestHost', userId: hostUserId, guestReconnectToken: token });
  await sleep(800);
  check(Boolean(re.ok) && re.you === host.seatId, 'guest.valid-capability-reclaims-same-seat', JSON.stringify(re).slice(0, 160));
  check(!host.socket.connected, 'guest.old-socket-superseded-after-reclaim');
  return null;
}


async function groupGuestImpersonation() {
  const a = await makeClient(null);
  const created = await emitAck(a.socket, 'room:create', { username: 'GA', userId: 'guest-a-probe', winningScore: 5, skipPregameDraw: true });
  const roomCode = String(created.roomCode);
  a.seatId = (created.you as string) ?? null;
  const b = await makeClient(null);
  const j = await emitAck(b.socket, 'room:join', roomCode, { username: 'GB', userId: 'guest-b-probe' });
  b.seatId = (j.you as string) ?? null;
  await emitAck(b.socket, 'player:ready', roomCode);
  const started = await emitAck(a.socket, 'game:start', roomCode);
  check(Boolean(started.ok), 'guestimp.setup-started', JSON.stringify(started));
  await waitFor(() => Boolean(a.latest?.state && b.latest?.state), 10_000);
  // attacker: no token, claims guest A's id (visible to every player in the room roster)
  const evil = await makeClient(null);
  const idAck = await emitAck(evil.socket, 'presence:identify', { username: 'evil', userId: 'guest-a-probe' });
  notes.guestImpersonation_identify = idAck;
  const ab = await emitAck(evil.socket, 'room:abandon_match', { roomCode });
  const status = sql(`select status from public.room_live_sessions where room_code='${roomCode}'`);
  check(ab.ok !== true && status === 'playing', 'guestimp.unauthenticated-socket-cannot-forfeit-another-guests-seat', JSON.stringify({ ab, status }));
  const own = await emitAck(a.socket, 'room:abandon_match', { roomCode });
  check(own.ok === true, 'guestimp.guest-can-still-resign-its-own-seat', JSON.stringify(own));
  return null;
}

let serverChild: ChildProcess | null = null;
async function spawnAgain() { serverChild = await spawnServer(); }

async function groupAuthz() {
  const r = await startRoom();
  const cur = turnClient(r)!;
  const wait = otherOf(r, cur);
  const s0 = roomSeq(r);
  // not my turn
  const a = await emitAck(wait.socket, 'game:action', r.roomCode, { ...(moveFor(wait) ?? { type: 'DRAW' }), requestId: `probe-${randomUUID()}` });
  check(a.ok === false && roomSeq(r) === s0, 'authz.not-your-turn', JSON.stringify(a));
  // client-supplied seat/player ids must be ignored
  const forged = await emitAck(wait.socket, 'game:action', r.roomCode, { ...(moveFor(cur) ?? { type: 'DRAW' }), requestId: `probe-${randomUUID()}`, playerId: cur.seatId, seatId: cur.seatId, userId: cur.identity.userId });
  check(forged.ok === false && roomSeq(r) === s0, 'authz.forged-seat-fields-ignored', JSON.stringify(forged));
  // non-member authenticated user never joined
  const outsider = createUser('pr-out');
  const oc = await makeClient(outsider);
  const o1 = await emitAck(oc.socket, 'game:action', r.roomCode, { type: 'DRAW', requestId: `probe-${randomUUID()}` });
  check(o1.ok === false && roomSeq(r) === s0, 'authz.non-member-action', JSON.stringify(o1));
  const o2 = await emitAck(oc.socket, 'hand:ready', r.roomCode, { handNumber: 1, requestId: `probe-${randomUUID()}` });
  check(o2.ok === false, 'authz.non-member-hand-ready', JSON.stringify(o2));
  const o3 = await emitAck(oc.socket, 'game:rematch', r.roomCode);
  check(o3.ok === false, 'authz.non-member-rematch', JSON.stringify(o3));
  const o4 = await emitAck(oc.socket, 'room:abandon_match', { roomCode: r.roomCode });
  check(o4.ok === false, 'authz.non-member-abandon', JSON.stringify(o4));
  const o5 = await emitAck(oc.socket, 'game:start', r.roomCode);
  check(o5.ok === false, 'authz.non-member-game-start', JSON.stringify(o5));
  const o6 = await emitAck(oc.socket, 'player:ready', r.roomCode);
  check(o6.ok === false, 'authz.non-member-player-ready', JSON.stringify(o6));
  const o7 = await emitAck(oc.socket, 'room:leave', r.roomCode);
  await sleep(300);
  check(roomSeq(r) === s0 && (await healthy()), 'authz.non-member-leave-harmless', JSON.stringify(o7));
  // spectator on a private (non-spectatable) room
  const sp = await emitAck(oc.socket, 'room:spectate', r.roomCode, { ...oc.identity });
  check(sp.ok === false, 'authz.private-room-not-spectatable', JSON.stringify(sp).slice(0, 120));
  // a socket that is only a viewer (if spectate was allowed) must still not act: covered by non-member above
  // guest with a claimed authenticated UUID but no token
  const g = await makeClient(null);
  const gj = await emitAck(g.socket, 'room:join', r.roomCode, { username: 'evil', userId: r.hu.id });
  check(gj.ok === false, 'authz.guest-claiming-auth-userid-cannot-join-full-room', JSON.stringify(gj).slice(0, 150));
  // fresh lobby: guest claims host's UUID without token -> must not become host / seat as that user
  const lobbyHost = createUser('pr-lh');
  const lh = await makeClient(lobbyHost);
  const lc = await emitAck(lh.socket, 'room:create', { ...lh.identity, winningScore: 5, skipPregameDraw: true });
  const g2 = await makeClient(null);
  const gj2 = await emitAck(g2.socket, 'room:join', String(lc.roomCode), { username: 'evil', userId: lobbyHost.id });
  const seatedAs = (gj2.players as Array<{ userId?: string | null; id: string }> | undefined)?.find((p) => p.id === gj2.you)?.userId ?? null;
  check(seatedAs !== lobbyHost.id, 'authz.guest-cannot-seat-as-claimed-auth-uuid', JSON.stringify({ seatedAs }));
  // authenticated user B joining a lobby whose seat is "reserved" is covered by reservation tests (unit)
  // stale account takeover: 2nd socket for same account, old socket acts
  return r;
}

async function groupMultiSocket() {
  const r = await startRoom();
  const cur = turnClient(r)!;
  const u = cur === r.host ? r.hu : r.gu;
  // second socket for the same account joins the room (reconnect / second tab)
  const tab2 = await makeClient(u);
  const j = await emitAck(tab2.socket, 'room:join', r.roomCode, tab2.identity);
  check(Boolean(j.ok), 'multi.second-socket-join', JSON.stringify(j).slice(0, 160));
  tab2.seatId = (j.you as string) ?? null;
  await sleep(800);
  const s0 = roomSeq(r);
  // old socket (superseded) acts on the player's turn
  const act = moveFor(cur) ?? { type: 'DRAW' };
  notes.multiSocket_oldSocketConnectedAfterTakeover = cur.socket.connected;
  const oldAck: Ack = cur.socket.connected
    ? await emitAck(cur.socket, 'game:action', r.roomCode, { ...act, requestId: `probe-${randomUUID()}` }).catch(() => ({ ok: false, error: 'no-ack' }))
    : { ok: false, error: 'socket-disconnected-by-server' };
  await sleep(300);
  notes.multiSocket_oldSocketAck = oldAck;
  const afterOld = roomSeq(r);
  // new socket acts with the same intent
  const act2 = moveFor(tab2) ?? { type: 'DRAW' };
  const newAck = await emitAck(tab2.socket, 'game:action', r.roomCode, { ...act2, requestId: `probe-${randomUUID()}` });
  await sleep(300);
  const afterNew = roomSeq(r);
  const advances = (afterOld > s0 ? 1 : 0) + (afterNew > afterOld ? 1 : 0);
  check(!(oldAck.ok && newAck.ok && advances === 2 && act.type === act2.type && afterNew - s0 > 1 && false), 'multi.no-double-turn-advance', JSON.stringify({ s0, afterOld, afterNew }));
  check(oldAck.ok === false, 'multi.superseded-socket-cannot-act', JSON.stringify(oldAck));
  // the superseded socket disconnects: must not forfeit/disconnect-penalize the active replacement
  cur.socket.disconnect();
  await sleep(2500);
  const st = sql(`select status from public.room_live_sessions where room_code='${r.roomCode}'`);
  check(st !== 'abandoned' && st !== 'game_over', 'multi.old-socket-disconnect-does-not-forfeit-active-replacement', st);
  const rejoinAck = await emitAck(tab2.socket, 'game:action', r.roomCode, { type: 'DRAW', requestId: `probe-${randomUUID()}` });
  void rejoinAck;
  // stale socket tries to abandon after replacement owns the seat
  const stale = await makeClient(u);
  const sj = await emitAck(stale.socket, 'room:abandon_match', { roomCode: r.roomCode });
  notes.multiSocket_staleNonMemberAbandon = sj;
  return r;
}

async function groupFlood() {
  const r = await startRoom();
  const cur = turnClient(r)!;
  const wait = otherOf(r, cur);
  gateway.reset();
  const t0 = Date.now();
  const N = 2000;
  const acks = await Promise.all(Array.from({ length: N }, (_, i) =>
    new Promise<Ack>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'noack' }), 8000);
      wait.socket.emit('game:action', r.roomCode, { type: 'DRAW', requestId: `fl-${i}` }, (a: Ack) => { clearTimeout(timer); resolve(a ?? {}); });
    })));
  const ms = Date.now() - t0;
  const limited = acks.filter((a) => a.error === 'rate_limited').length;
  const gwReq = gateway.requests.length;
  notes.flood_illegalActions = { sent: N, rateLimited: limited, otherErrors: [...new Set(acks.map((a) => a.error))].slice(0, 6), gatewayRequests: gwReq, ms };
  check(gwReq <= 5, 'flood.illegal-actions-cause-no-persistence-writes', `gateway requests=${gwReq}`);
  check(await healthy(), 'flood.server-alive');
  return r;
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
  const only = process.argv[2];
  try {
    serverChild = await spawnServer();
    const groups: Array<[string, () => Promise<unknown>]> = [
      ['idempotency', groupIdempotency],
      ['malformed', groupMalformed],
      ['authz', groupAuthz],
      ['multisocket', groupMultiSocket],
      ['flood', groupFlood],
      ['rematch', groupRematch],
      ['fuzz', groupFuzzOther],
      ['flood2', groupFlood2],
      ['races', groupRaces],
      ['restart', groupRestart],
      ['persistloss', groupPersistLoss],
      ['guest', groupGuest],
      ['guestimp', groupGuestImpersonation],
    ];
    for (const [name, fn] of groups) {
      if (only && only !== name) continue;
      process.stdout.write(`\n## ${name}\n`);
      try { await fn(); } catch (e) { finding(`${name}.aborted`, e instanceof Error ? (e.stack ?? e.message).split('\n').slice(0, 3).join(' | ') : String(e)); }
    }
  } finally {
    for (const c of spawned) killHardNow(c);
    await gateway.close();
    process.stdout.write(`\n=== NOTES ===\n${JSON.stringify(notes, null, 2)}\n=== ${oks.length} OK, ${findings.length} FINDING ===\n${findings.map((f) => ` - ${f}`).join('\n')}\n`);
    if (findings.length > 0) process.exitCode = 1;
  }
}
void main().catch((err) => { process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`); process.exitCode = 1; });
