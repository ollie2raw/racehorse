#!/usr/bin/env node
/**
 * Two socket clients play a private multiplayer match against a running server (no browser, no sign-in: guest ids), and time
 * the hand boundary. The repo version of the drivers behind docs/perf-budget.md's multiplayer rows.
 *
 *   node scripts/perf/mpMatchDriver.mjs --server http://127.0.0.1:3001 --mode boundary [--boundaries 2] [--order guest-first,host-first] [--gap 30]
 *   node scripts/perf/mpMatchDriver.mjs --server http://127.0.0.1:3001 --mode full [--winning 30]
 *
 * boundary: plays hands until each hand-over, waits 2.8 s (the server's 2.5 s minimum hand-over time), then both players send hand:ready
 *   `--gap` ms apart in the given order and records, per boundary: both acks (ms from each emit), the time both clients are dealt the
 *   next hand, and the tile that ended the hand (ack / seen by the opponent). The result is printed as JSON; with a Supabase stub started with a
 *   timeline file, perfBudgetsTier1.mjs joins it with the writes the server made.
 * full: plays one match to game over (used with the server CPU window, eventLoopWindow.cjs).
 * Needs the server's MP_PRIVATE_CERT_MODE only for a 5-point match; the default winning score is 30.
 */
import { io } from 'socket.io-client';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TIMEOUT_MS = Number(process.env.MP_DRIVER_TIMEOUT_MS ?? 60_000);

function emitAck(socket, event, ...args) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), TIMEOUT_MS);
    socket.emit(event, ...args, (resp) => { clearTimeout(timer); resolve(resp); });
  });
}

async function waitFor(condition, what, timeoutMs = TIMEOUT_MS) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await delay(10);
  }
}

function makeClient(server, label, userId) {
  const socket = io(server, { transports: ['websocket'], reconnection: false, autoConnect: false, timeout: TIMEOUT_MS });
  const client = { socket, label, userId, seat: null, updates: [], last: null, connected: false };
  socket.on('state:update', (payload) => {
    payload.__t = Date.now();
    client.updates.push(payload);
    client.last = payload;
    if (typeof payload?.you === 'string' && payload.you) client.seat = payload.you;
  });
  client.connect = async () => {
    const connected = new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    socket.connect();
    await connected;
    const resp = await emitAck(socket, 'presence:identify', { userId, username: label });
    if (!resp?.ok) throw new Error(`${label} presence:identify failed`);
  };
  return client;
}

async function startMatch(server, winningScore) {
  const host = makeClient(server, 'host', 'perf-host');
  const guest = makeClient(server, 'guest', 'perf-guest');
  await host.connect();
  await guest.connect();
  const created = await emitAck(host.socket, 'room:create', { username: 'host', userId: host.userId, winningScore, skipPregameDraw: true });
  if (!created?.ok) throw new Error(`room:create failed: ${created?.error}`);
  host.seat = created.you;
  const roomCode = created.roomCode;
  const joined = await emitAck(guest.socket, 'room:join', roomCode, { username: 'guest', userId: guest.userId });
  if (!joined?.ok) throw new Error(`room:join failed: ${joined?.error}`);
  guest.seat = joined.you;
  const ready = await emitAck(guest.socket, 'player:ready', roomCode);
  if (ready?.ok === false) throw new Error(`player:ready failed: ${ready?.error}`);
  const before = [host.updates.length, guest.updates.length];
  const started = await emitAck(host.socket, 'game:start', roomCode);
  if (!started?.ok) throw new Error(`game:start failed: ${started?.error}`);
  await waitFor(() => host.updates.length > before[0] && guest.updates.length > before[1], 'the first state');
  return { host, guest, roomCode, clients: [host, guest] };
}

const stateOf = (client) => client.last?.state ?? null;

/** Plays moves until a hand is over (or the game); returns the last action's timing. */
async function playHand(match) {
  const { clients, roomCode } = match;
  let last = null;
  for (let step = 0; step < 400; step += 1) {
    const state = stateOf(clients[0]);
    if (state?.handOver || state?.gameOver) return last;
    const currentSeat = state.playerIds[state.currentPlayerIndex];
    const mover = clients.find((c) => c.seat === currentSeat);
    if (!mover) throw new Error('could not find the player to move');
    const payload = mover.last;
    const play = (payload?.legalMoves ?? []).find((m) => m?.type === 'play' && m.tile && m.position);
    const action = play ? { type: 'MOVE', move: { tile: play.tile, position: play.position } } : payload?.canDraw ? { type: 'DRAW' } : { type: 'PASS' };
    const tEmit = Date.now();
    const resp = await emitAck(mover.socket, 'game:action', roomCode, { ...action, requestId: `drv-${tEmit}-${step}` });
    const tAck = Date.now();
    if (!resp?.ok) throw new Error(`action failed: ${resp?.error}`);
    last = { mover: mover.label, type: action.type, tEmit, tAck };
    const target = typeof resp.sequence === 'number' ? resp.sequence : (state.sequence ?? 0) + 1;
    await waitFor(() => clients.every((c) => (stateOf(c)?.sequence ?? -1) >= target), 'both clients to see the move');
    await delay(30);
  }
  throw new Error('the hand did not end');
}

export async function runBoundaryScenario({ server, boundaries = 2, order = ['guest-first', 'host-first'], gapMs = 30, winningScore = 30 }) {
  const match = await startMatch(server, winningScore);
  const { host, guest, roomCode, clients } = match;
  const results = [];
  try {
    for (let b = 0; b < boundaries; b += 1) {
      const last = await playHand(match);
      await waitFor(() => clients.every((c) => stateOf(c)?.handOver || stateOf(c)?.gameOver), 'both clients to see the hand over');
      const state = stateOf(host);
      if (state.gameOver) break; // the match ended on this hand: no boundary to time
      const hand = state.handNumber;
      const seenAt = (client) => client.updates.find((u) => u.state?.handOver && u.state.handNumber === hand && u.__t >= (last?.tEmit ?? 0))?.__t ?? null;
      const handOverSeen = Math.min(seenAt(host) ?? Infinity, seenAt(guest) ?? Infinity);
      await delay(Math.max(0, handOverSeen + 2800 - Date.now()));
      const ord = order[b % order.length];
      const [first, second] = ord === 'guest-first' ? [guest, host] : [host, guest];
      const tFirst = Date.now();
      const p1 = emitAck(first.socket, 'hand:ready', roomCode, hand).then((r) => ({ r, t: Date.now() }));
      await delay(gapMs);
      const tSecond = Date.now();
      const p2 = emitAck(second.socket, 'hand:ready', roomCode, hand).then((r) => ({ r, t: Date.now() }));
      const [a1, a2] = await Promise.all([p1, p2]);
      const dealtAt = (client) => client.updates.find((u) => u.state && u.state.handNumber === hand + 1 && !u.state.handOver && u.__t >= tFirst)?.__t ?? null;
      await waitFor(() => dealtAt(host) && dealtAt(guest), 'the next hand to be dealt', 15_000).catch(() => undefined);
      const opponent = last?.mover === 'host' ? guest : host;
      results.push({
        boundary: b + 1, hand, order: ord, gapMs,
        firstAckMs: a1.t - tFirst, secondAckMs: a2.t - tSecond,
        firstOk: a1.r?.ok, secondOk: a2.r?.ok, secondStarted: Boolean(a2.r?.started),
        dealtMs: Math.max(dealtAt(host) ?? NaN, dealtAt(guest) ?? NaN) - tFirst,
        handEnding: last ? { ackMs: last.tAck - last.tEmit, seenByOpponentMs: (seenAt(opponent) ?? NaN) - last.tEmit } : null,
        // epoch ms, for joining with the stub's timeline
        tFirst, tSecond, tSecondAck: a2.t, tDealt: Math.max(dealtAt(host) ?? 0, dealtAt(guest) ?? 0),
      });
      await delay(300);
    }
  } finally {
    for (const c of clients) c.socket.disconnect();
  }
  return { roomCode, boundaries: results };
}

export async function playFullMatch({ server, winningScore = 30, maxHands = 80 }) {
  const match = await startMatch(server, winningScore);
  const { host, roomCode, clients } = match;
  const startedAt = Date.now();
  let hands = 0;
  let actions = 0;
  try {
    for (let h = 0; h < maxHands; h += 1) {
      await playHand(match);
      hands += 1;
      await waitFor(() => clients.every((c) => stateOf(c)?.handOver || stateOf(c)?.gameOver), 'the hand to be over on both clients');
      if (stateOf(host).gameOver) break;
      const hand = stateOf(host).handNumber;
      for (const c of clients) {
        const r = await emitAck(c.socket, 'hand:ready', roomCode, hand);
        if (r?.ok === false && !r.ignored) throw new Error(`hand:ready failed: ${r.error}`);
      }
      await waitFor(() => clients.every((c) => stateOf(c)?.handNumber === hand + 1 && !stateOf(c)?.handOver), 'the next hand');
    }
    actions = stateOf(host)?.sequence ?? 0;
    return { roomCode, hands, gameOver: Boolean(stateOf(host)?.gameOver), sequence: actions, ms: Date.now() - startedAt };
  } finally {
    for (const c of clients) c.socket.disconnect();
  }
}

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '') && args.server) {
  const server = args.server;
  try {
    const out = args.mode === 'full'
      ? await playFullMatch({ server, winningScore: Number(args.winning ?? 30) })
      : await runBoundaryScenario({ server, boundaries: Number(args.boundaries ?? 2), order: (args.order ?? 'guest-first,host-first').split(','), gapMs: Number(args.gap ?? 30), winningScore: Number(args.winning ?? 30) });
    console.log(JSON.stringify(out, null, 1));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  }
}
