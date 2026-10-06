/**
 * Ranked-match process-restart chaos (S1 follow-up, #335).
 *
 * `multiplayerProcessRestartChaos.ts` proves a room rehydrates after a SIGKILL
 * but never finishes the match, so it never reaches the ranked path. This one
 * plays a real authenticated two-player match to GAME OVER through a restart:
 *
 *   1. spawn a real server (cert mode, so winningScore=5 ends in ~1 hand)
 *   2. two throwaway accounts play a few moves; submit one more, SIGKILL
 *   3. respawn, both rejoin; read the stored live session straight from
 *      Supabase and verify each seat's move log (strict) as the restarted
 *      server will see it — full row or S1 entries, whichever the flag wrote
 *   4. play on to game over
 *   5. assert: 2 `ranked_games` rows (one per player, shared source_match_id,
 *      Glicko applied — the server writes them only after both move logs pass
 *      strict verification), no `private_move_log_verification_failed` event,
 *      a `matches` row, and a `room_match_logs` archive whose events run
 *      1..last_event_sequence with no gap
 *
 * Deletes every row it created (users, room rows, telemetry) and verifies 0
 * leftovers. Run it with LIVE_SESSION_LOG_ENTRIES unset and with `true`; the
 * spawned server inherits the flag.
 *
 *   npm run chaos:ranked-restart                                # flag off
 *   LIVE_SESSION_LOG_ENTRIES=true npm run chaos:ranked-restart  # flag on
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import '../src/loadEnv';
import { assertNotProductionSupabase } from '../src/platform/env/productionSupabaseGuard';
import { verifyPlayerMoveLog } from '../src/ghost/verifier';
import type { GhostMoveLogEntry } from '../src/ghost/service';

type Ack = Record<string, unknown> & { ok?: boolean; error?: string };
type Tile = { high: number; low: number };
type Move = { type: string; tile?: Tile; position?: string };
type GState = {
  playerIds: string[];
  currentPlayerIndex: number;
  handNumber: number;
  handOver: boolean;
  gameOver: boolean;
  winnerId: string | null;
  sequence: number;
  board: unknown;
  players: Record<string, { score?: number }>;
  config?: { winningScore?: number };
};
type StateUpdate = { you?: string; legalMoves?: Move[]; canDraw?: boolean; state?: GState };
type Client = {
  socket: Socket;
  seatId: string | null;
  latest: StateUpdate | null;
  identity: { username: string; userId: string; authToken: string };
};

const PORT = Number(process.env.CHAOS_PORT ?? 3198);
const baseUrl = `http://127.0.0.1:${PORT}`;
const serverRoot = join(__dirname, '..');
const supabaseUrl = req('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = req('SUPABASE_SERVICE_KEY');
const anonKey = req('VITE_SUPABASE_ANON_KEY');
const WINNING_SCORE = 5;
const MOVES_BEFORE_KILL = Number(process.env.CHAOS_MOVES_BEFORE_KILL ?? 6);
const timeoutMs = 30_000;
const flagOn = process.env.LIVE_SESSION_LOG_ENTRIES === 'true';

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
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `${prefix.replace(/[^a-z0-9_]/gi, '')}${randomUUID().slice(0, 6)}` },
    }),
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
  const child = spawn(process.execPath, ['--import', 'tsx', join(serverRoot, 'src/index.ts')], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      MP_PRIVATE_CERT_MODE: '1',
      TOURNAMENT_SCHEDULER_ENABLED: 'false',
      // The room_match_logs archive is written this long after both players
      // leave (default 5 min; 60 s is the floor).
      ROOM_CLEANUP_GRACE_MS: '60000',
      NODE_ENV: 'production',
    },
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
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
    process.kill(-child.pid, 'SIGKILL');
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

/** The authoritative view: whichever client holds the highest sequence. */
function refState(host: Client, guest: Client): GState | undefined {
  return [host.latest?.state, guest.latest?.state]
    .filter((s): s is GState => Boolean(s))
    .sort((a, b) => b.sequence - a.sequence)[0];
}

function nextAction(cur: Client) {
  const legal = cur.latest?.legalMoves ?? [];
  const play = legal.find((m) => m.type === 'play' && m.tile && m.position);
  return play
    ? { type: 'MOVE', move: { tile: play.tile, position: play.position }, requestId: randomUUID() }
    : cur.latest?.canDraw
      ? { type: 'DRAW', requestId: randomUUID() }
      : { type: 'PASS', requestId: randomUUID() };
}

/** One step: an action for whoever's turn it is, or hand:ready at hand over. */
async function step(roomCode: string, host: Client, guest: Client): Promise<'over' | 'acted' | 'waited'> {
  const ref = refState(host, guest);
  if (!ref) {
    await sleep(100);
    return 'waited';
  }
  if (ref.gameOver) return 'over';
  if (ref.handOver) {
    await emitAck(host.socket, 'hand:ready', roomCode, ref.handNumber).catch(() => ({}));
    await emitAck(guest.socket, 'hand:ready', roomCode, ref.handNumber).catch(() => ({}));
    await waitFor(() => {
      const s = refState(host, guest);
      return Boolean(s && (s.gameOver || (!s.handOver && s.handNumber !== ref.handNumber)));
    });
    return 'acted';
  }
  const cur = [host, guest].find((c) => c.seatId === ref.playerIds[ref.currentPlayerIndex]);
  if (!cur || (cur.latest?.state?.sequence ?? -1) < ref.sequence) {
    if (cur) await waitFor(() => (cur.latest?.state?.sequence ?? -1) >= ref.sequence, 4000);
    else await sleep(80);
    return 'waited';
  }
  const resp = await emitAck(cur.socket, 'game:action', roomCode, nextAction(cur)).catch(() => ({ ok: false }));
  if (!resp?.ok) {
    await sleep(150);
    return 'waited';
  }
  await waitFor(() => {
    const s = refState(host, guest);
    return Boolean(s && (s.sequence !== ref.sequence || s.gameOver || s.handOver));
  });
  return 'acted';
}

function boardKey(s: GState | undefined) {
  return JSON.stringify({ seq: s?.sequence, board: s?.board, cur: s?.currentPlayerIndex });
}

/**
 * Each seat's move log exactly as a restarted server would load it: from the
 * full row (flag off) or from `room_live_session_entries`, truncated to the
 * snapshot's counts (flag on). Read straight from Supabase, not via the server.
 */
async function storedGhostLogs(roomCode: string) {
  const rows = await sb<Array<{ room_shell: Record<string, unknown> }>>(
    `/rest/v1/room_live_sessions?select=room_shell&room_code=eq.${roomCode}`,
  );
  const shell = rows[0]?.room_shell;
  if (!shell) return { logStorage: 'missing', logs: {} as Record<string, GhostMoveLogEntry[]> };
  if (shell.logStorage !== 'entries') {
    return {
      logStorage: 'row',
      logs: (shell.ghostMoveLogs ?? {}) as Record<string, GhostMoveLogEntry[]>,
    };
  }
  const counts = (shell.ghostMoveLogCounts ?? {}) as Record<string, number>;
  const entries = await sb<Array<{ stream: string; idx: number; entry: GhostMoveLogEntry }>>(
    `/rest/v1/room_live_session_entries?select=stream,idx,entry&room_code=eq.${roomCode}&stream=like.ghost:*&order=stream.asc,idx.asc`,
  );
  const logs: Record<string, GhostMoveLogEntry[]> = {};
  for (const [seatId, count] of Object.entries(counts)) {
    logs[seatId] = entries
      .filter((e) => e.stream === `ghost:${seatId}` && e.idx < count)
      .map((e) => e.entry);
  }
  return { logStorage: 'entries', logs };
}

async function main() {
  assertNotProductionSupabase('chaos:ranked-restart');
  const host = await createUser('mp-rkchaos-host');
  const guest = await createUser('mp-rkchaos-guest');
  const userIds = [host.id, guest.id];
  let child: ChildProcess | null = null;
  let roomCode = '';
  const result: Record<string, unknown> = { liveSessionLogEntries: flagOn };
  const failures: string[] = [];
  try {
    child = await spawnServer();
    let hostC: Client = {
      socket: await connect(),
      seatId: null,
      latest: null,
      identity: { username: 'RkChaosHost', userId: host.id, authToken: host.accessToken },
    };
    let guestC: Client = {
      socket: await connect(),
      seatId: null,
      latest: null,
      identity: { username: 'RkChaosGuest', userId: guest.id, authToken: guest.accessToken },
    };
    wire(hostC);
    wire(guestC);
    await Promise.all([
      emitAck(hostC.socket, 'presence:identify', hostC.identity),
      emitAck(guestC.socket, 'presence:identify', guestC.identity),
    ]);
    const created = await emitAck(hostC.socket, 'room:create', {
      ...hostC.identity,
      winningScore: WINNING_SCORE,
      skipPregameDraw: true,
    });
    if (!created.ok) throw new Error(`room:create failed: ${created.error}`);
    roomCode = String(created.roomCode);
    if (typeof created.you === 'string') hostC.seatId = created.you;
    const joined = await emitAck(guestC.socket, 'room:join', roomCode, guestC.identity);
    if (!joined.ok) throw new Error(`room:join failed: ${joined.error}`);
    if (typeof joined.you === 'string') guestC.seatId = joined.you;
    await emitAck(guestC.socket, 'player:ready', roomCode);
    const started = await emitAck(hostC.socket, 'game:start', roomCode);
    if (!started.ok) throw new Error(`game:start failed: ${started.error}`);
    await waitFor(() => Boolean(hostC.latest?.state && guestC.latest?.state), 15_000);
    result.winningScore = hostC.latest?.state?.config?.winningScore ?? null;

    let acted = 0;
    for (let i = 0; i < 60 && acted < MOVES_BEFORE_KILL; i += 1) {
      const s = refState(hostC, guestC);
      if (s?.gameOver || s?.handOver) break;
      if ((await step(roomCode, hostC, guestC)) === 'acted') acted += 1;
    }
    if (refState(hostC, guestC)?.gameOver) throw new Error('match ended before the kill; lower CHAOS_MOVES_BEFORE_KILL');
    await sleep(1500);
    const seqBeforeKill = refState(hostC, guestC)?.sequence ?? null;
    result.sequenceBeforeKill = seqBeforeKill;

    // Submit one more action, then SIGKILL while its persist is in flight.
    const ref = refState(hostC, guestC)!;
    const cur = [hostC, guestC].find((c) => c.seatId === ref.playerIds[ref.currentPlayerIndex]);
    if (cur && !ref.handOver) cur.socket.emit('game:action', roomCode, nextAction(cur), () => {});
    await sleep(20);
    await killHard(child);
    child = null;
    hostC.socket.disconnect();
    guestC.socket.disconnect();

    const stored = await storedGhostLogs(roomCode);
    child = await spawnServer();
    result.storedAfterKill = {
      logStorage: stored.logStorage,
      seats: Object.fromEntries(
        Object.entries(stored.logs).map(([seat, log]) => {
          const v = verifyPlayerMoveLog(log, { strictHandContinuity: true });
          return [seat, { entries: log.length, verified: v.ok, ...(v.ok ? {} : { reason: v.reason }) }];
        }),
      ),
    };
    const expectedStorage = flagOn ? 'entries' : 'row';
    if (stored.logStorage !== expectedStorage) failures.push(`stored log storage ${stored.logStorage}, expected ${expectedStorage}`);
    for (const [seat, info] of Object.entries((result.storedAfterKill as { seats: Record<string, { entries: number; verified: boolean }> }).seats)) {
      if (!info.verified) failures.push(`stored move log for ${seat} fails strict verification`);
    }
    if (Object.keys(stored.logs).length !== 2) failures.push(`expected 2 stored seat move logs, got ${Object.keys(stored.logs).length}`);

    hostC = { ...hostC, socket: await connect(), latest: null };
    guestC = { ...guestC, socket: await connect(), latest: null };
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
    if (!rejoinHost.ok || rejoinHost.hydrationOutcome !== 'hydrated') failures.push('host rejoin did not hydrate from Supabase');
    if (!rejoinGuest.ok) failures.push('guest rejoin failed');
    await waitFor(() => Boolean(hostC.latest?.state && guestC.latest?.state), 15_000);
    const rehydrated = hostC.latest?.state?.sequence ?? null;
    result.rehydratedSequence = rehydrated;
    result.sequenceRegressed = typeof seqBeforeKill === 'number' && typeof rehydrated === 'number' && rehydrated < seqBeforeKill;
    result.clientsAgreeAfterRehydrate = boardKey(hostC.latest?.state) === boardKey(guestC.latest?.state);
    if (!result.clientsAgreeAfterRehydrate) failures.push('clients disagree after rehydrate');

    const deadline = Date.now() + 180_000;
    let final: GState | undefined;
    while (Date.now() < deadline) {
      if ((await step(roomCode, hostC, guestC)) === 'over') {
        final = refState(hostC, guestC);
        break;
      }
    }
    if (!final?.gameOver) throw new Error('match did not reach game over after the restart');
    result.gameOver = {
      finalSequence: final.sequence,
      hands: final.handNumber,
      winnerSeatId: final.winnerId,
      scores: Object.fromEntries(Object.entries(final.players).map(([k, v]) => [k, v.score ?? null])),
    };
    hostC.socket.disconnect();
    guestC.socket.disconnect();

    // The deferred game-over persist and the Glicko RPC land a beat later.
    type RankedRow = { player_id: string; source_type: string; source_match_id: string | null; rating_after: number | null; delta: number | null; outcome: string | null };
    let ranked: RankedRow[] = [];
    const pollUntil = Date.now() + 45_000;
    while (Date.now() < pollUntil) {
      await sleep(2000);
      ranked = await sb<RankedRow[]>(
        `/rest/v1/ranked_games?player_id=in.(${userIds.join(',')})&select=player_id,source_type,source_match_id,rating_after,delta,outcome`,
      );
      if (ranked.length >= 2 && ranked.every((r) => r.rating_after !== null && r.delta !== null)) break;
    }
    type ArchiveRow = { match_id: string; status: string; last_event_sequence: number; event_count: number; events: Array<{ sequence?: number }>; participant_user_ids: string[] };
    let archive: ArchiveRow | undefined;
    const archiveUntil = Date.now() + 120_000;
    while (!archive && Date.now() < archiveUntil) {
      [archive] = await sb<ArchiveRow[]>(
        `/rest/v1/room_match_logs?room_code=eq.${roomCode}&select=match_id,status,last_event_sequence,event_count,events,participant_user_ids`,
      );
      if (!archive) await sleep(5000);
    }
    const failedVerification = await sb<unknown[]>(
      `/rest/v1/mp_authority_events?room_code=eq.${roomCode}&event=eq.private_move_log_verification_failed&select=event`,
    );
    const matchesRows = await sb<unknown[]>(`/rest/v1/matches?room_code=eq.${roomCode}&select=id,winner_user_id,loser_user_id,winner_score,loser_score`);

    const sequences = (archive?.events ?? []).map((e) => e.sequence ?? -1);
    const contiguous = sequences.every((s, i) => s === (sequences[0] ?? 1) + i);
    result.ranked = {
      rows: ranked.length,
      onePerPlayer: new Set(ranked.map((r) => r.player_id)).size === 2,
      sourceType: [...new Set(ranked.map((r) => r.source_type))],
      sharedSourceMatchId: new Set(ranked.map((r) => r.source_match_id)).size === 1 ? ranked[0]?.source_match_id ?? null : null,
      glickoApplied: ranked.length === 2 && ranked.every((r) => r.rating_after !== null && r.delta !== null),
      outcomes: ranked.map((r) => r.outcome),
    };
    result.moveLogVerificationFailedEvents = failedVerification.length;
    result.matchesRows = matchesRows.length;
    result.archive = archive
      ? {
          status: archive.status,
          eventCount: archive.event_count,
          lastEventSequence: archive.last_event_sequence,
          eventsContiguous: contiguous,
          sharedWithRanked: archive.match_id === (result.ranked as { sharedSourceMatchId: string | null }).sharedSourceMatchId,
          participants: archive.participant_user_ids.length,
        }
      : null;

    const rk = result.ranked as { rows: number; onePerPlayer: boolean; sourceType: string[]; sharedSourceMatchId: string | null; glickoApplied: boolean };
    if (rk.rows !== 2 || !rk.onePerPlayer) failures.push(`expected 2 ranked_games rows (one per player), got ${rk.rows}`);
    if (rk.sourceType.join() !== 'live_room') failures.push(`ranked source_type ${rk.sourceType.join()}`);
    if (!rk.sharedSourceMatchId) failures.push('ranked rows do not share one source_match_id');
    if (!rk.glickoApplied) failures.push('Glicko not applied to both ranked rows');
    if (failedVerification.length > 0) failures.push('server recorded private_move_log_verification_failed');
    if (matchesRows.length !== 1) failures.push(`expected 1 matches row, got ${matchesRows.length}`);
    if (!archive) failures.push('no room_match_logs archive');
    else {
      if (archive.status !== 'completed') failures.push(`archive status ${archive.status}`);
      if (!contiguous || archive.event_count !== sequences.length) failures.push('archived events are not contiguous');
      if (archive.match_id !== rk.sharedSourceMatchId) failures.push('archive match_id differs from ranked source_match_id');
    }
  } catch (error) {
    failures.push(`aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await killHard(child);
    result.failures = failures;
    process.stdout.write(`\n=== RANKED RESTART CHAOS RESULT ===\n${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(failures.length === 0 ? '\nRANKED RESTART CHAOS PASSED\n' : '\nRANKED RESTART CHAOS FAILED\n');
    if (failures.length > 0) process.exitCode = 1;

    // Net-zero: rows keyed by the room first, then the users (their ranked_games,
    // profiles and ghost rows cascade).
    const del = (path: string) => sb(path, { method: 'DELETE' }).catch((e) => process.stderr.write(`cleanup ${path}: ${e}\n`));
    const users = `(${userIds.join(',')})`;
    if (roomCode) {
      await del(`/rest/v1/matches?room_code=eq.${roomCode}`);
      await del(`/rest/v1/room_match_logs?room_code=eq.${roomCode}`);
      await del(`/rest/v1/room_live_sessions?room_code=eq.${roomCode}`);
      await del(`/rest/v1/mp_authority_events?room_code=eq.${roomCode}`);
    }
    await del(`/rest/v1/review_completion_jobs?user_id=in.${users}`);
    await del(`/rest/v1/game_reviews?user_id=in.${users}`);
    await Promise.all(userIds.map(deleteUser));
    const count = async (path: string) => (await sb<unknown[]>(path).catch(() => [{}])).length;
    const leftovers = {
      ranked_games: await count(`/rest/v1/ranked_games?player_id=in.${users}&select=id`),
      profiles: await count(`/rest/v1/profiles?id=in.${users}&select=id`),
      ghost_games: await count(`/rest/v1/ghost_games?user_id=in.${users}&select=id`),
      matches: roomCode ? await count(`/rest/v1/matches?room_code=eq.${roomCode}&select=id`) : 0,
      room_match_logs: roomCode ? await count(`/rest/v1/room_match_logs?room_code=eq.${roomCode}&select=match_id`) : 0,
      room_live_sessions: roomCode ? await count(`/rest/v1/room_live_sessions?room_code=eq.${roomCode}&select=room_code`) : 0,
      room_live_session_entries: roomCode ? await count(`/rest/v1/room_live_session_entries?room_code=eq.${roomCode}&select=idx`) : 0,
      mp_authority_events: roomCode ? await count(`/rest/v1/mp_authority_events?room_code=eq.${roomCode}&select=event`) : 0,
    };
    process.stdout.write(`cleanup leftovers: ${JSON.stringify(leftovers)}\n`);
  }
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
