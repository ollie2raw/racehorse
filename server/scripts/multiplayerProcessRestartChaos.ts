/**
 * Multiplayer process-restart chaos harness — the path MP-JIT-1 widens.
 *
 * MP-JIT-1 (docs/mp-live-move-persist-latency.md) moved the `room_live_sessions`
 * snapshot persist for mid-hand moves off the broadcast critical path. This
 * script exercises the real persistence + hydration path that the deterministic
 * vitest integration test (`gameActionPersistRollback.integration.test.ts` →
 * "restart before the async persist lands") only simulates in-process:
 *
 *   1. spawn a real server (prod Supabase, cert mode)
 *   2. two throwaway authenticated accounts play a real match
 *   3. mid-hand: submit a move, then SIGKILL the server ~immediately
 *      (stands in for an OOM kill / crash — NOT a SIGTERM, which keeps the
 *      synchronous persist gate)
 *   4. respawn the server on the same port
 *   5. both clients reconnect + re-join → the room rehydrates from
 *      `room_live_sessions`; assert the join ack reports `hydrated`, both
 *      clients converge on ONE authoritative state, and the match can keep
 *      playing. Report whether the rehydrated sequence regressed vs what the
 *      clients last saw (MP-JIT-1's accepted-risk window — expected to be rare
 *      because the async persist usually lands in the sub-second before the
 *      kill, but this is exactly the window the fix trades for latency).
 *
 * Net-zero: deletes the two auth users + the `matches` row afterward.
 *
 *   export VITE_SUPABASE_ANON_KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' ../client/.env | cut -d= -f2-)
 *   npm run chaos:multiplayer-restart
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import '../src/loadEnv';

type Ack = Record<string, unknown> & { ok?: boolean; error?: string };
type Tile = { high: number; low: number };
type Move = { type: string; tile?: Tile; position?: string };
type GState = {
  playerIds: string[];
  currentPlayerIndex: number;
  handNumber: number;
  handOver: boolean;
  gameOver: boolean;
  sequence: number;
  board: unknown;
};
type StateUpdate = { you?: string; legalMoves?: Move[]; canDraw?: boolean; state?: GState };

const PORT = Number(process.env.CHAOS_PORT ?? 3199);
const baseUrl = `http://127.0.0.1:${PORT}`;
const serverRoot = join(__dirname, '..');
const supabaseUrl = req('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = req('SUPABASE_SERVICE_KEY');
const anonKey = req('VITE_SUPABASE_ANON_KEY');
const timeoutMs = 30_000;

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sb<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function createUser(prefix: string) {
  const email = `${prefix}-${randomUUID()}@racehorse-test.invalid`;
  const password = `Rh-${randomUUID()}-Aa9!`;
  const created = await sb<{ id?: string }>(`/auth/v1/admin/users`, {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const signed = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await signed.json()) as { access_token?: string };
  if (!created.id || !body.access_token) throw new Error('ephemeral credentials incomplete');
  return { id: created.id, accessToken: body.access_token };
}

async function deleteUser(id: string) {
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => {});
}

function portFree(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port: PORT });
    s.once('connect', () => {
      s.destroy();
      resolve(false);
    });
    s.once('error', () => resolve(true));
  });
}

async function spawnServer(): Promise<ChildProcess> {
  for (let i = 0; i < 40 && !(await portFree()); i += 1) await sleep(250);
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join(serverRoot, 'src/index.ts')],
    {
      cwd: serverRoot,
      env: {
        ...process.env,
        PORT: String(PORT),
        MP_PRIVATE_CERT_MODE: '1',
        TOURNAMENT_SCHEDULER_ENABLED: 'false',
        NODE_ENV: 'production',
      },
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  child.stderr?.on('data', (d) => process.stderr.write(`[srv] ${d}`));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return child;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('server did not become ready');
}

async function killHard(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL'); // whole process group
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !(await portFree())) await sleep(200);
}

function emitAck(socket: Socket, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.emit(event, ...args, (r: Ack) => {
      clearTimeout(timer);
      resolve(r ?? {});
    });
  });
}

function connect(): Promise<Socket> {
  const socket = io(baseUrl, { transports: ['websocket'], reconnection: false, autoConnect: false });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timed out')), timeoutMs);
    socket.once('connect_error', reject);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.connect();
  });
}

type Client = {
  socket: Socket;
  seatId: string | null;
  latest: StateUpdate | null;
  identity: { username: string; userId: string; authToken: string };
};

function wire(client: Client) {
  client.socket.on('state:update', (p: StateUpdate) => {
    client.latest = p;
    if (typeof p.you === 'string' && p.you) client.seatId = p.you;
  });
}

async function waitFor(pred: () => boolean, ms = 12_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await sleep(60);
  }
  return false;
}

/** Plays exactly one action for whoever's turn it is. Returns false at game over. */
async function playOneMove(roomCode: string, host: Client, guest: Client): Promise<boolean> {
  const ref = host.latest?.state;
  if (!ref || ref.gameOver) return false;
  if (ref.handOver) {
    await emitAck(host.socket, 'hand:ready', roomCode, ref.handNumber).catch(() => ({}));
    await emitAck(guest.socket, 'hand:ready', roomCode, ref.handNumber).catch(() => ({}));
    await waitFor(() => {
      const s = host.latest?.state;
      return Boolean(s && (s.gameOver || (!s.handOver && s.handNumber !== ref.handNumber)));
    });
    return true;
  }
  const cur = [host, guest].find((c) => c.seatId === ref.playerIds[ref.currentPlayerIndex]);
  if (!cur) {
    await sleep(80);
    return true;
  }
  const legal = cur.latest?.legalMoves ?? [];
  const play = legal.find((m) => m.type === 'play' && m.tile && m.position);
  const action = play
    ? { type: 'MOVE', move: { tile: play.tile, position: play.position }, requestId: randomUUID() }
    : cur.latest?.canDraw
      ? { type: 'DRAW', requestId: randomUUID() }
      : { type: 'PASS', requestId: randomUUID() };
  const seqBefore = ref.sequence;
  const resp = await emitAck(cur.socket, 'game:action', roomCode, action).catch(() => ({ ok: false }));
  if (!resp?.ok) {
    await sleep(150);
    return true;
  }
  await waitFor(() => {
    const s = host.latest?.state;
    return Boolean(s && (s.sequence !== seqBefore || s.gameOver || s.handOver));
  });
  return true;
}

function boardKey(s: GState | undefined) {
  return JSON.stringify({ seq: s?.sequence, board: s?.board, cur: s?.currentPlayerIndex });
}

async function main() {
  const host = await createUser('mp-chaos-host');
  const guest = await createUser('mp-chaos-guest');
  const userIds = [host.id, guest.id];
  let child: ChildProcess | null = null;
  let roomCode = '';
  const result: Record<string, unknown> = {};
  try {
    child = await spawnServer();

    let hostC: Client = {
      socket: await connect(),
      seatId: null,
      latest: null,
      identity: { username: 'ChaosHost', userId: host.id, authToken: host.accessToken },
    };
    let guestC: Client = {
      socket: await connect(),
      seatId: null,
      latest: null,
      identity: { username: 'ChaosGuest', userId: guest.id, authToken: guest.accessToken },
    };
    wire(hostC);
    wire(guestC);

    await Promise.all([
      emitAck(hostC.socket, 'presence:identify', hostC.identity),
      emitAck(guestC.socket, 'presence:identify', guestC.identity),
    ]);
    const created = await emitAck(hostC.socket, 'room:create', {
      ...hostC.identity,
      winningScore: 30,
      skipPregameDraw: true,
    });
    if (!created.ok) throw new Error(`room:create failed: ${created.error}`);
    roomCode = String(created.roomCode);
    if (typeof created.you === 'string') hostC.seatId = created.you;
    const joined = await emitAck(guestC.socket, 'room:join', roomCode, guestC.identity);
    if (typeof joined.you === 'string') guestC.seatId = joined.you;
    await emitAck(guestC.socket, 'player:ready', roomCode);
    const started = await emitAck(hostC.socket, 'game:start', roomCode);
    if (!started.ok) throw new Error(`game:start failed: ${started.error}`);
    await waitFor(() => Boolean(hostC.latest?.state && guestC.latest?.state), 15_000);

    for (let i = 0; i < 8; i += 1) {
      if (hostC.latest?.state?.gameOver || hostC.latest?.state?.handOver) break;
      await playOneMove(roomCode, hostC, guestC);
    }
    await sleep(1500); // let the async persist land for those moves

    const lastSeenBeforeKill = hostC.latest?.state?.sequence ?? null;
    result.sequenceBeforeKill = lastSeenBeforeKill;

    // Submit one more move, then SIGKILL ~immediately.
    const ref = hostC.latest!.state!;
    const cur = [hostC, guestC].find((c) => c.seatId === ref.playerIds[ref.currentPlayerIndex])!;
    const legal = cur.latest?.legalMoves ?? [];
    const play = legal.find((m) => m.type === 'play' && m.tile && m.position);
    const action = play
      ? { type: 'MOVE', move: { tile: play.tile, position: play.position }, requestId: randomUUID() }
      : cur.latest?.canDraw
        ? { type: 'DRAW', requestId: randomUUID() }
        : { type: 'PASS', requestId: randomUUID() };
    cur.socket.emit('game:action', roomCode, action, () => {});
    await sleep(20); // broadcast frame goes out; persist likely still in flight
    await killHard(child);
    child = null;
    hostC.socket.disconnect();
    guestC.socket.disconnect();
    result.killedAfterSubmittingMove = true;

    child = await spawnServer();

    hostC = { ...hostC, socket: await connect(), seatId: hostC.seatId, latest: null };
    guestC = { ...guestC, socket: await connect(), seatId: guestC.seatId, latest: null };
    wire(hostC);
    wire(guestC);
    await Promise.all([
      emitAck(hostC.socket, 'presence:identify', hostC.identity),
      emitAck(guestC.socket, 'presence:identify', guestC.identity),
    ]);
    const rejoinHost = await emitAck(hostC.socket, 'room:join', roomCode, hostC.identity);
    const rejoinGuest = await emitAck(guestC.socket, 'room:join', roomCode, guestC.identity);
    for (const [c, rj] of [
      [hostC, rejoinHost],
      [guestC, rejoinGuest],
    ] as const) {
      if (rj.state && typeof rj.state === 'object') {
        c.latest = { state: rj.state as GState, legalMoves: (rj.legalMoves as Move[]) ?? [], canDraw: Boolean(rj.canDraw) };
      }
      if (typeof rj.you === 'string') c.seatId = rj.you;
    }
    result.rejoin = {
      host: { ok: rejoinHost.ok, hydrationOutcome: rejoinHost.hydrationOutcome ?? null, error: rejoinHost.error ?? null },
      guest: { ok: rejoinGuest.ok, hydrationOutcome: rejoinGuest.hydrationOutcome ?? null, error: rejoinGuest.error ?? null },
    };

    await waitFor(() => Boolean(hostC.latest?.state && guestC.latest?.state), 15_000);
    const hostState = hostC.latest?.state;
    const guestState = guestC.latest?.state;
    result.rehydratedSequence = hostState?.sequence ?? null;
    result.sequenceRegressed =
      typeof lastSeenBeforeKill === 'number' &&
      typeof hostState?.sequence === 'number' &&
      hostState.sequence < lastSeenBeforeKill;
    result.clientsAgreeAfterRehydrate = boardKey(hostState) === boardKey(guestState);

    // The match must be playable past the restart.
    let progressed = 0;
    const seqAtResume = hostState?.sequence ?? -1;
    for (let i = 0; i < 20 && progressed < 4; i += 1) {
      if (hostC.latest?.state?.gameOver) break;
      await playOneMove(roomCode, hostC, guestC);
      if ((hostC.latest?.state?.sequence ?? -1) > seqAtResume) progressed += 1;
    }
    result.movesPlayedAfterRestart = progressed;
    result.finalSequence = hostC.latest?.state?.sequence ?? null;
    result.clientsAgreeAfterResumePlay =
      boardKey(hostC.latest?.state) === boardKey(guestC.latest?.state);

    hostC.socket.disconnect();
    guestC.socket.disconnect();

    process.stdout.write(`\n=== PROCESS-RESTART CHAOS RESULT ===\n${JSON.stringify(result, null, 2)}\n`);
    const rejoinOk =
      (result.rejoin as any).host.ok &&
      (result.rejoin as any).guest.ok &&
      ['hydrated', 'already_in_memory'].includes((result.rejoin as any).host.hydrationOutcome);
    const pass =
      rejoinOk &&
      result.clientsAgreeAfterRehydrate === true &&
      (result.movesPlayedAfterRestart as number) >= 4 &&
      result.clientsAgreeAfterResumePlay === true;
    if (!pass) {
      process.exitCode = 1;
      process.stderr.write('\nCHAOS CHECK FAILED\n');
    } else {
      process.stdout.write(
        `\nCHAOS CHECK PASSED — room rehydrated (${(result.rejoin as any).host.hydrationOutcome}), clients converged, match played on.` +
          (result.sequenceRegressed
            ? ` (sequence regressed ${lastSeenBeforeKill} -> ${result.rehydratedSequence} — the accepted-risk window; clients accepted the authoritative rollback.)\n`
            : ` (no sequence regression this run — the async persist landed before the kill.)\n`),
      );
    }
  } finally {
    await killHard(child);
    if (roomCode) {
      await sb(`/rest/v1/matches?room_code=eq.${roomCode}`, { method: 'DELETE' }).catch(() => {});
    }
    await Promise.all(userIds.map(deleteUser));
    const leftover = await sb<unknown[]>(
      `/rest/v1/ranked_games?player_id=in.(${userIds.join(',')})`,
    ).catch(() => []);
    process.stdout.write(`cleanup: leftover ranked_games = ${leftover.length}\n`);
  }
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
