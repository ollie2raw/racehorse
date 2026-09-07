/**
 * RK-8 live re-confirmation probe.
 *
 * Runs a real end-to-end authenticated multiplayer match between two throwaway
 * accounts against a locally-running server (which talks to prod Supabase),
 * plays it honestly to game-over, then reads the `ranked_games` rows that the
 * actual `insertRankedGameIdempotent()` on_conflict path wrote — not an inferred
 * proxy. Reports the raw rows. Cleans up every prod artifact afterward
 * (net-zero), same standard as the GM-1 / SA-6 live probes in HARDENING_PLAN.md.
 *
 * Requires the target server to be started with MP_PRIVATE_CERT_MODE=1 so the
 * host can request winningScore=5 and the match finishes in ~1 hand.
 *
 *   MP_PRIVATE_CERT_MODE=1 PORT=3101 npm run dev   # in one shell
 *   PROBE_BASE_URL=http://127.0.0.1:3101 tsx scripts/rankedMultiplayerRowProbe.ts
 */
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import '../src/loadEnv';

type Ack = Record<string, unknown> & { ok?: boolean; error?: string };
type Tile = { high: number; low: number };
type Move = { type: string; tile?: Tile; position?: string };
type StateUpdate = {
  you?: string;
  legalMoves?: Move[];
  canDraw?: boolean;
  state?: {
    playerIds: string[];
    currentPlayerIndex: number;
    handNumber: number;
    handOver: boolean;
    gameOver: boolean;
    winnerId: string | null;
    sequence: number;
    players: Record<string, { score?: number }>;
    config?: { winningScore?: number };
  };
};

const baseUrl = (process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:3101').replace(/\/$/, '');
const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = requiredEnv('SUPABASE_SERVICE_KEY');
const anonKey = requiredEnv('VITE_SUPABASE_ANON_KEY');
const timeoutMs = 30_000;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function createEphemeralUser(prefix: string) {
  const email = `${prefix}-${randomUUID()}@racehorse-test.invalid`;
  const password = `Rh-${randomUUID()}-Aa9!`;
  const created = await sb<{ id?: string }>(`/auth/v1/admin/users`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `${prefix.replace(/[^a-z0-9_]/gi, '')}${randomUUID().slice(0, 6)}` },
    }),
  });
  const signedResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!signedResponse.ok) throw new Error(`sign-in failed: ${signedResponse.status}`);
  const signed = (await signedResponse.json()) as { access_token?: string };
  if (!created.id || !signed.access_token) throw new Error('ephemeral credentials incomplete');
  return { id: created.id, accessToken: signed.access_token };
}

async function deleteEphemeralUser(id: string) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok && res.status !== 404) throw new Error(`user cleanup failed: ${res.status}`);
}

function emitAck(socket: Socket, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out.`)), timeoutMs);
    socket.emit(event, ...args, (response: Ack) => {
      clearTimeout(timer);
      resolve(response ?? {});
    });
  });
}

function connect(): Promise<Socket> {
  const socket = io(baseUrl, { transports: ['websocket'], reconnection: false, autoConnect: false });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out.')), timeoutMs);
    socket.once('connect_error', reject);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.connect();
  });
}

type Client = { socket: Socket; seatId: string | null; latest: StateUpdate | null };

async function waitFor(pred: () => boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(50);
  }
  throw new Error('waitFor timed out');
}

const actionTimings: Array<{ type: string; ackMs: number }> = [];

async function playToGameOver(
  roomCode: string,
  host: Client,
  guest: Client,
): Promise<StateUpdate['state']> {
  const clients = [host, guest];
  const deadline = Date.now() + 120_000;
  let noProgress = 0;
  while (Date.now() < deadline) {
    const ref = host.latest?.state;
    if (!ref) {
      await sleep(100);
      continue;
    }
    if (ref.gameOver) return ref;
    if (ref.handOver) {
      await emitAck(host.socket, 'hand:ready', roomCode, ref.handNumber);
      await emitAck(guest.socket, 'hand:ready', roomCode, ref.handNumber);
      await waitFor(() => {
        const s = host.latest?.state;
        return Boolean(s && (s.gameOver || (!s.handOver && s.handNumber !== ref.handNumber)));
      }, 10_000).catch(() => {});
      continue;
    }
    const currentSeat = ref.playerIds[ref.currentPlayerIndex];
    const cur = clients.find((c) => c.seatId === currentSeat);
    if (!cur) {
      await sleep(50);
      continue;
    }
    const legal = cur.latest?.legalMoves ?? [];
    const play = legal.find((m) => m.type === 'play' && m.tile && m.position);
    const action = play
      ? { type: 'MOVE', move: { tile: play.tile, position: play.position }, requestId: randomUUID() }
      : cur.latest?.canDraw
        ? { type: 'DRAW', requestId: randomUUID() }
        : { type: 'PASS', requestId: randomUUID() };
    const seqBefore = ref.sequence;
    const t0 = Date.now();
    const resp = await emitAck(cur.socket, 'game:action', roomCode, action);
    actionTimings.push({ type: action.type, ackMs: Date.now() - t0 });
    if (!resp?.ok) {
      noProgress += 1;
      if (noProgress > 25) {
        throw new Error(
          `stuck: last action ${action.type} -> ${JSON.stringify(resp)} ; ref=${JSON.stringify(ref)}`,
        );
      }
      await sleep(150);
      continue;
    }
    noProgress = 0;
    await waitFor(() => {
      const s = host.latest?.state;
      return Boolean(s && (s.sequence !== seqBefore || s.gameOver || s.handOver));
    }, 8000).catch(() => {});
  }
  throw new Error('playToGameOver timed out');
}

async function main(): Promise<void> {
  const host = await createEphemeralUser('mp-rk8-host');
  const guest = await createEphemeralUser('mp-rk8-guest');
  const userIds = [host.id, guest.id];
  let hostSocket: Socket | null = null;
  let guestSocket: Socket | null = null;
  let roomCode = '';
  try {
    [hostSocket, guestSocket] = await Promise.all([connect(), connect()]);
    const hostClient: Client = { socket: hostSocket, seatId: null, latest: null };
    const guestClient: Client = { socket: guestSocket, seatId: null, latest: null };
    for (const [sock, client] of [
      [hostSocket, hostClient],
      [guestSocket, guestClient],
    ] as const) {
      sock.on('state:update', (p: StateUpdate) => {
        client.latest = p;
        if (typeof p.you === 'string' && p.you) client.seatId = p.you;
      });
    }

    const hostIdentity = { username: 'Rk8Host', userId: host.id, authToken: host.accessToken };
    const guestIdentity = { username: 'Rk8Guest', userId: guest.id, authToken: guest.accessToken };

    const [hp, gp] = await Promise.all([
      emitAck(hostSocket, 'presence:identify', hostIdentity),
      emitAck(guestSocket, 'presence:identify', guestIdentity),
    ]);
    if (!hp.ok || !gp.ok) throw new Error('presence identify failed');

    const created = await emitAck(hostSocket, 'room:create', {
      ...hostIdentity,
      winningScore: 5,
      skipPregameDraw: true,
    });
    if (!created.ok) throw new Error(`room:create failed: ${created.error}`);
    roomCode = String(created.roomCode ?? '');
    if (typeof created.you === 'string') hostClient.seatId = created.you;

    const joined = await emitAck(guestSocket, 'room:join', roomCode, guestIdentity);
    if (!joined.ok) throw new Error(`room:join failed: ${joined.error}`);
    if (typeof joined.you === 'string') guestClient.seatId = joined.you;

    const ready = await emitAck(guestSocket, 'player:ready', roomCode);
    if (ready.ok === false) throw new Error(`player:ready failed: ${ready.error}`);

    const started = await emitAck(hostSocket, 'game:start', roomCode);
    if (!started.ok) throw new Error(`game:start failed: ${started.error}`);

    await waitFor(() => Boolean(hostClient.latest?.state && guestClient.latest?.state), 15_000);
    const winningScore = hostClient.latest?.state?.config?.winningScore;
    if (winningScore !== 5) {
      process.stderr.write(
        `WARNING: winningScore is ${winningScore}, not 5 — start the server with MP_PRIVATE_CERT_MODE=1. Continuing (match will be longer).\n`,
      );
    }

    const finalState = await playToGameOver(roomCode, hostClient, guestClient);
    const ackMsValues = actionTimings.map((t) => t.ackMs).sort((a, b) => a - b);
    process.stdout.write(
      `\n=== game:action emit→ack latency (n=${ackMsValues.length}) ===\n${JSON.stringify({
        perAction: actionTimings,
        min: ackMsValues[0],
        median: ackMsValues[Math.floor(ackMsValues.length / 2)],
        max: ackMsValues[ackMsValues.length - 1],
        mean: Math.round(ackMsValues.reduce((s, v) => s + v, 0) / ackMsValues.length),
      }, null, 2)}\n`,
    );
    process.stdout.write(
      `\nGAME OVER: ${JSON.stringify({
        roomCode,
        winnerSeatId: finalState?.winnerId,
        handNumber: finalState?.handNumber,
        scores: finalState?.players,
      })}\n`,
    );

    // Deferred game-over persist runs with retry backoff; give it room.
    let rows: unknown[] = [];
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await sleep(2000);
      rows = await sb<unknown[]>(
        `/rest/v1/ranked_games?player_id=in.(${userIds.join(',')})&order=played_at.desc`,
      );
      // Wait for the deferred Glicko RPC to also stamp rating_after/delta onto
      // the rows (processRealtimeMultiplayerGame runs a beat after the insert).
      if (rows.length >= 2 && rows.every((r: any) => r.rating_after !== null && r.delta !== null)) {
        break;
      }
    }

    process.stdout.write(`\n=== RAW ranked_games ROWS (service-role read) ===\n`);
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);

    const matches = await sb<unknown[]>(
      `/rest/v1/matches?room_code=eq.${roomCode}&select=id,mode,room_code,winner_user_id,loser_user_id,winner_score,loser_score`,
    );
    process.stdout.write(`\n=== matches row(s) for room ===\n${JSON.stringify(matches, null, 2)}\n`);

    const analysis = {
      rankedRowCount: rows.length,
      allMultiplayer: rows.every((r: any) => r.game_type === 'multiplayer'),
      allLiveRoomSource: rows.every((r: any) => r.source_type === 'live_room'),
      sharedSourceMatchId:
        rows.length > 0 && new Set(rows.map((r: any) => r.source_match_id)).size === 1
          ? (rows[0] as any).source_match_id
          : null,
      allSourceMatchIdNonNull: rows.every((r: any) => r.source_match_id),
      ratingApplied: rows.every((r: any) => r.rating_after !== null && r.delta !== null),
    };
    process.stdout.write(`\n=== ANALYSIS ===\n${JSON.stringify(analysis, null, 2)}\n`);
  } finally {
    hostSocket?.disconnect();
    guestSocket?.disconnect();
    await sleep(500);
    // Explicit cleanup: matches.winner/loser FK is ON DELETE SET NULL, so the
    // row survives a user delete — remove it by room_code first.
    if (roomCode) {
      await sb(`/rest/v1/matches?room_code=eq.${roomCode}`, { method: 'DELETE' }).catch((e) =>
        process.stderr.write(`matches cleanup: ${e}\n`),
      );
    }
    await Promise.all(userIds.map((id) => deleteEphemeralUser(id).catch((e) => process.stderr.write(`${e}\n`))));

    // Verify net-zero.
    const leftoverRanked = await sb<unknown[]>(
      `/rest/v1/ranked_games?player_id=in.(${userIds.join(',')})`,
    ).catch(() => []);
    const leftoverMatches = roomCode
      ? await sb<unknown[]>(`/rest/v1/matches?room_code=eq.${roomCode}`).catch(() => [])
      : [];
    process.stdout.write(
      `\n=== CLEANUP VERIFY ===\nleftover ranked_games: ${leftoverRanked.length}\nleftover matches: ${leftoverMatches.length}\n`,
    );
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
