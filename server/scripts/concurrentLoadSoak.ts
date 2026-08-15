/**
 * 100-session concurrent load soak: ~40 multiplayer, ~40 Daily Puzzle, ~20 Daily Fritz
 *
 * Stage 1 – Steady state: all sessions active simultaneously for STEADY_DURATION_MS of
 *   continuous play (moves, submits, leaderboard polls).
 * Stage 2 – Spike: all sessions hit submit/leaderboard within a 5-second window.
 *
 * Reports: error rate, p50/p95/p99 per operation type, circuit breaker / rate-limit
 * fires, mp-stats before/after, and authority row integrity for all completed attempts.
 */

import '../src/loadEnv';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import {
  applyAuthoritySoakEnv,
  createEphemeralUser,
  deleteEphemeralUser,
  fetchJson,
  percentile,
  requiredEnv,
  positiveInt,
  type Json,
} from './authoritySoakSupport';
import { driveDailyPuzzleFiveSlotAttempt } from '../src/testing/dailyPuzzleLifecycleDriver';
import type { DailyPuzzleAttempt, DailyPuzzleSlot } from '../src/dailyPuzzle';
import {
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
  type DailyFritzTranscript,
} from '@racehorse/game-core';
import type { DailyFritzDrawWinner, DailyFritzHandDeal, DailyFritzTier } from '../src/dailyFritz';
import { buildHonestDailyFritzHandTranscript } from '../src/testing/dailyFritzTranscriptDriver';

applyAuthoritySoakEnv();

// ─── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = (process.env.LOAD_SOAK_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_KEY = requiredEnv('SUPABASE_SERVICE_KEY');
const ANON_KEY = requiredEnv('VITE_SUPABASE_ANON_KEY');
const TIMEOUT_MS = positiveInt(process.env.LOAD_SOAK_TIMEOUT_MS, 30_000);
const STEADY_DURATION_MS = positiveInt(process.env.LOAD_SOAK_STEADY_MS, 180_000); // 3 minutes
const MP_ROOMS = positiveInt(process.env.LOAD_SOAK_MP_ROOMS, 20);        // 20 rooms = 40 sockets
const PUZZLE_USERS = positiveInt(process.env.LOAD_SOAK_PUZZLE_USERS, 40);
const FRITZ_USERS = positiveInt(process.env.LOAD_SOAK_FRITZ_USERS, 20);
const RUN_DATE_OVERRIDE = process.env.LOAD_SOAK_RUN_DATE?.trim() ?? '';

const userInput = { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, anonKey: ANON_KEY, timeoutMs: TIMEOUT_MS };

// ─── Metrics collection ─────────────────────────────────────────────────────────

type OpType =
  | 'mp:connect'
  | 'mp:game_action'
  | 'mp:hand_ready'
  | 'puzzle:start'
  | 'puzzle:submit_slot'
  | 'puzzle:complete'
  | 'puzzle:leaderboard'
  | 'fritz:start'
  | 'fritz:next_hand'
  | 'fritz:record_game'
  | 'fritz:complete'
  | 'fritz:leaderboard';

const ops: Map<OpType, { latencies: number[]; errors: number; circuitBreaker: number; rateLimit: number }> = new Map();

function getOp(type: OpType) {
  let entry = ops.get(type);
  if (!entry) {
    entry = { latencies: [], errors: 0, circuitBreaker: 0, rateLimit: 0 };
    ops.set(type, entry);
  }
  return entry;
}

function recordOp(type: OpType, latencyMs: number, error?: { status?: number; message?: string }) {
  const op = getOp(type);
  op.latencies.push(latencyMs);
  if (error) {
    op.errors += 1;
    if (error.status === 429) op.rateLimit += 1;
    if (error.message?.includes('circuit breaker')) op.circuitBreaker += 1;
  }
}

async function timed<T>(type: OpType, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    recordOp(type, Date.now() - start);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    recordOp(type, Date.now() - start, { status, message });
    throw err;
  }
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────────

async function httpGet(path: string, token: string): Promise<Json> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({})) as Json;
  if (!response.ok) {
    const err = new Error(`GET ${path} → ${response.status}`);
    (err as unknown as { status: number }).status = response.status;
    throw err;
  }
  return body;
}

async function httpPost(path: string, token: string, body: Json, allowedStatuses = [200]): Promise<Json> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await response.json().catch(() => ({})) as Json;
  if (!allowedStatuses.includes(response.status)) {
    const err = new Error(`POST ${path} → ${response.status}: ${JSON.stringify(json)}`);
    (err as unknown as { status: number }).status = response.status;
    throw err;
  }
  return json;
}

// ─── Multiplayer socket helpers ─────────────────────────────────────────────────

type AckResult = { ok?: boolean; error?: string; [key: string]: unknown };
type PregameDrawTile = { id: string; revealed: boolean; outOfPlay: boolean };
type LegalMove = { tile: unknown; position: unknown };
type StatePayload = {
  state: {
    gameOver: boolean;
    handOver: boolean;
    handNumber: number;
    sequence: number;
    playerIds: string[];
    currentPlayerIndex: number;
  };
  legalMoves: LegalMove[];
  canDraw: boolean;
  you: string;
  matchStarted?: boolean;
  preGameDraw?: { phase: string; tiles: PregameDrawTile[] } | null;
};

function connectSocket(identity: { userId: string; username: string }): Promise<{ socket: Socket; seatId: string }> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { transports: ['websocket'], reconnection: false, autoConnect: false });
    const timer = setTimeout(() => reject(new Error('Socket connect timeout')), TIMEOUT_MS);

    socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    socket.once('connect', () => {
      socket.emit('presence:identify', identity, (ack: AckResult) => {
        if (ack.ok === false) {
          clearTimeout(timer);
          reject(new Error(`presence:identify failed: ${ack.error ?? 'unknown'}`));
          return;
        }
        clearTimeout(timer);
        // seatId resolved after room join
        resolve({ socket, seatId: '' });
      });
    });
    socket.connect();
  });
}

function emitAck(socket: Socket, event: string, ...args: unknown[]): Promise<AckResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), TIMEOUT_MS);
    socket.emit(event, ...args, (result: AckResult) => {
      clearTimeout(timer);
      resolve(result ?? {});
    });
  });
}

// Buffered state:update queue — prevents dropped events between socket.once calls.
// Call attachStateQueue(socket) once per socket after connection; use nextState() to wait.
type StateQueue = { next: (timeoutMs?: number) => Promise<StatePayload | null> };

function attachStateQueue(socket: Socket): StateQueue {
  const pending: StatePayload[] = [];
  let waiter: ((p: StatePayload) => void) | null = null;

  socket.on('state:update', (payload: StatePayload) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(payload);
    } else {
      pending.push(payload);
    }
  });

  return {
    next(timeoutMs = TIMEOUT_MS): Promise<StatePayload | null> {
      if (pending.length > 0) {
        return Promise.resolve(pending.shift()!);
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiter = null;
          resolve(null);
        }, timeoutMs);
        waiter = (p) => {
          clearTimeout(timer);
          resolve(p);
        };
      });
    },
  };
}

// Legacy single-use wait kept for the pre-game:start listener (set up before attachStateQueue)
function waitForStateUpdate(socket: Socket, timeoutMs = TIMEOUT_MS): Promise<StatePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('state:update timeout')), timeoutMs);
    socket.once('state:update', (payload) => {
      clearTimeout(timer);
      resolve(payload as StatePayload);
    });
  });
}

// Drive a single game:action, return updated state
async function sendAction(
  socket: Socket,
  roomCode: string,
  action: { type: string; requestId: string; expectedSequence: number; move?: { tile: unknown; position: unknown } },
): Promise<AckResult> {
  return emitAck(socket, 'game:action', roomCode, action);
}

// ─── Multiplayer game driver ────────────────────────────────────────────────────

async function driveMultiplayerRoom(
  roomIndex: number,
  steadyBarrier: Promise<void>,
  spikeBarrier: Promise<void>,
  spikeResolve: () => void,
): Promise<{ roomCode: string; handsPlayed: number; errors: number }> {
  const suffix = `mp-${roomIndex}-${randomUUID().slice(0, 8)}`;
  const hostId = `guest_soak_host_${suffix}`;
  const guestId = `guest_soak_guest_${suffix}`;

  let hostSocket!: Socket;
  let guestSocket!: Socket;
  let roomCode = '';
  let errors = 0;

  try {
    // Connect both sockets
    const connectStart = Date.now();
    const [hostConn, guestConn] = await Promise.all([
      connectSocket({ userId: hostId, username: `SoakHost${roomIndex}` }),
      connectSocket({ userId: guestId, username: `SoakGuest${roomIndex}` }),
    ]);
    recordOp('mp:connect', Date.now() - connectStart);
    hostSocket = hostConn.socket;
    guestSocket = guestConn.socket;
    // Attach buffered queues immediately so no state:update is dropped between awaits
    const hostQueue = attachStateQueue(hostSocket);
    const guestQueue = attachStateQueue(guestSocket);

    // Create room
    const created = await timed('mp:connect', () => emitAck(hostSocket, 'room:create', { userId: hostId, username: `SoakHost${roomIndex}` }));
    if (!created.ok) throw new Error(`room:create failed: ${created.error}`);
    roomCode = String(created.roomCode ?? '');

    // Guest joins
    const joined = await emitAck(guestSocket, 'room:join', roomCode, { userId: guestId, username: `SoakGuest${roomIndex}` });
    if (!joined.ok) throw new Error(`room:join failed: ${joined.error}`);

    // Both ready
    const [hostReady, guestReady] = await Promise.all([
      emitAck(hostSocket, 'player:ready', roomCode),
      emitAck(guestSocket, 'player:ready', roomCode),
    ]);
    if (hostReady.ok === false) throw new Error(`player:ready host failed: ${hostReady.error}`);
    if (guestReady.ok === false) throw new Error(`player:ready guest failed: ${guestReady.error}`);

    // Start game — queues buffer the state:update even before we await it
    const started = await emitAck(hostSocket, 'game:start', roomCode);
    if (!started.ok) throw new Error(`game:start failed: ${started.error}`);
    const [hostInitState, guestInitState] = await Promise.all([hostQueue.next(), guestQueue.next()]);
    if (!hostInitState || !guestInitState) throw new Error('No initial state:update after game:start');

    // playerIds in game state are server-allocated seat UUIDs, not our userId values.
    // Each state:update includes `you` = the receiving socket's seat ID.
    const hostSeatId = hostInitState.you;
    const guestSeatId = guestInitState.you;

    let handsPlayed = 0;
    const socketStateMap = new Map<string, StatePayload>([
      [hostSeatId, hostInitState],
      [guestSeatId, guestInitState],
    ]);
    const socketByPlayer = new Map<string, Socket>([
      [hostSeatId, hostSocket],
      [guestSeatId, guestSocket],
    ]);
    const otherSocketByPlayer = new Map<string, Socket>([
      [hostSeatId, guestSocket],
      [guestSeatId, hostSocket],
    ]);
    const otherIdByPlayer = new Map<string, string>([
      [hostSeatId, guestSeatId],
      [guestSeatId, hostSeatId],
    ]);

    // Wait for steady state barrier before playing
    await steadyBarrier;

    // ── Pre-game draw phase ─────────────────────────────────────────
    // After game:start the server may use a shell state (handOver:true) while
    // the pregame draw phase runs. We drain state:updates, emitting picks when
    // the phase is 'pick-player', until both sockets receive a state where
    // preGameDraw is absent/null (meaning the real game hand has been dealt).
    // Server fires staggered timers: pick → showing-reveal(2s) → showing-result(1s) → game-start.
    if (hostInitState.preGameDraw != null) {
      const MAX_DRAW_UPDATES = 30; // ~10 tie rounds × 3 updates each
      let drawUpdates = 0;

      while (drawUpdates < MAX_DRAW_UPDATES) {
        drawUpdates += 1;

        // Read current draw state for both sockets
        const hostDraw = socketStateMap.get(hostSeatId)?.preGameDraw;
        const guestDraw = socketStateMap.get(guestSeatId)?.preGameDraw;

        // Both have transitioned out of the draw — real game state is in the map
        if (!hostDraw && !guestDraw) break;

        // If it's pick time for either player, submit a pick.
        // Host picks the first available tile, guest picks the LAST — they share
        // a pool so picking the same tile would silently fail on the server.
        if (hostDraw?.phase === 'pick-player') {
          const slot = hostDraw.tiles.find((t) => !t.revealed && !t.outOfPlay);
          if (slot) hostSocket.emit('game:pregame_draw_pick', { slotId: slot.id });
        }
        if (guestDraw?.phase === 'pick-player') {
          const available = guestDraw.tiles.filter((t) => !t.revealed && !t.outOfPlay);
          const slot = available[available.length - 1];
          if (slot) guestSocket.emit('game:pregame_draw_pick', { slotId: slot.id });
        }

        // Wait for the next state update on both sockets (up to 6s for server timers)
        const [hNext, gNext] = await Promise.all([
          hostQueue.next(6_000),
          guestQueue.next(6_000),
        ]);
        if (hNext) socketStateMap.set(hostSeatId, hNext);
        if (gNext) socketStateMap.set(guestSeatId, gNext);

      }
    }

    let gamesDone = 0;
    const MAX_HANDS = 200; // Safety cap to prevent infinite loops

    while (handsPlayed < MAX_HANDS) {
      // Find whose turn it is
      const refState = socketStateMap.get(hostSeatId)!;
      if (refState.state.gameOver) { gamesDone += 1; break; }

      const currentPlayerId = refState.state.playerIds[refState.state.currentPlayerIndex];
      const actingSocket = socketByPlayer.get(currentPlayerId)!;
      const otherSocket = otherSocketByPlayer.get(currentPlayerId)!;
      const myState = socketStateMap.get(currentPlayerId)!;

      // Determine action
      let action: { type: string; requestId: string; expectedSequence: number; move?: { tile: unknown; position: unknown } };
      if (myState.canDraw) {
        action = { type: 'DRAW', requestId: randomUUID(), expectedSequence: myState.state.sequence };
      } else if (myState.legalMoves.length > 0) {
        const lm = myState.legalMoves[0];
        action = { type: 'MOVE', requestId: randomUUID(), expectedSequence: myState.state.sequence, move: { tile: lm.tile, position: lm.position } };
      } else {
        action = { type: 'PASS', requestId: randomUUID(), expectedSequence: myState.state.sequence };
      }

      // Set up both sockets to receive the next state update before sending
      const actorQueue = socketByPlayer.get(currentPlayerId) === hostSocket ? hostQueue : guestQueue;
      const observerQueue = socketByPlayer.get(currentPlayerId) === hostSocket ? guestQueue : hostQueue;

      const actionStart = Date.now();
      const ack = await sendAction(actingSocket, roomCode, action);
      recordOp('mp:game_action', Date.now() - actionStart, ack.ok === false ? { message: String(ack.error) } : undefined);

      if (ack.ok === false) {
        errors += 1;
        break;
      }

      // Wait for state updates
      const [actorState, observerState] = await Promise.all([actorQueue.next(), observerQueue.next()]);
      if (actorState) socketStateMap.set(currentPlayerId, actorState);
      if (observerState) socketStateMap.set(otherIdByPlayer.get(currentPlayerId)!, observerState);

      const updatedState = actorState ?? socketStateMap.get(currentPlayerId)!;

      // Check hand over — need both to signal hand:ready
      if (updatedState.state.handOver && !updatedState.state.gameOver) {
        handsPlayed += 1;
        // Both players signal hand:ready
        const handReadyStart = Date.now();
        const [hostHandReady, guestHandReady] = await Promise.all([
          emitAck(hostSocket, 'hand:ready', roomCode, updatedState.state.handNumber),
          emitAck(guestSocket, 'hand:ready', roomCode, updatedState.state.handNumber),
        ]);
        recordOp('mp:hand_ready', Date.now() - handReadyStart,
          hostHandReady.ok === false ? { message: String(hostHandReady.error) } : undefined);

        // Wait for new hand state
        const [hState, gState] = await Promise.all([hostQueue.next(), guestQueue.next()]);
        if (hState) socketStateMap.set(hostSeatId, hState);
        if (gState) socketStateMap.set(guestSeatId, gState);
      } else if (updatedState.state.gameOver) {
        gamesDone += 1;
        break;
      }
    }

    return { roomCode, handsPlayed, errors };
  } finally {
    // Always signal spike so the barrier doesn't deadlock
    spikeResolve();
    hostSocket?.disconnect();
    guestSocket?.disconnect();
  }
}


// ─── Daily Puzzle driver ────────────────────────────────────────────────────────

async function runPuzzleUser(
  index: number,
  steadyBarrier: Promise<void>,
  spikeBarrier: Promise<void>,
  spikeResolve: () => void,
): Promise<{ userId: string; attemptId: string; score: number | null; errors: number; leaderboardPolls: number }> {
  const user = await createEphemeralUser({ ...userInput, prefix: `load-dp-${index}` });
  let errors = 0;
  let leaderboardPolls = 0;
  let attemptId = '';
  let puzzleDate = '';

  try {
    // Get today's puzzle
    const today = await timed('puzzle:start', () =>
      httpGet(`/api/daily-puzzle/today`, user.accessToken));
    puzzleDate = String(today.runDate ?? '');
    const slots = today.slots as DailyPuzzleSlot[];
    if (!puzzleDate || !Array.isArray(slots) || slots.length !== 5) {
      throw new Error('Puzzle soak requires a published five-slot day.');
    }

    // Start attempt (idempotent)
    const startResult = await timed('puzzle:start', () =>
      httpPost('/api/daily-puzzle/start', user.accessToken, { runDate: puzzleDate }));
    const attempt = startResult.attempt as DailyPuzzleAttempt;
    attemptId = attempt?.id ?? '';
    if (!attemptId) throw new Error('No attempt ID returned from puzzle start.');

    // Wait for steady state barrier
    await steadyBarrier;

    // Play through slots (sorted by slotIndex 1-5) with interleaved leaderboard polls
    const { buildDailyPuzzleFirstLegalLine } = await import('../src/testing/dailyPuzzleLifecycleDriver');
    const orderedSlots = [...slots].sort((a, b) => a.slotIndex - b.slotIndex);

    let finalAttempt: DailyPuzzleAttempt | null = null;
    for (const slot of orderedSlots) {
      // Leaderboard poll between slots
      try {
        await timed('puzzle:leaderboard', () =>
          httpGet(`/api/daily-puzzle/leaderboard?date=${encodeURIComponent(puzzleDate)}`, user.accessToken));
        leaderboardPolls += 1;
      } catch {
        errors += 1;
      }

      // Submit slot
      const line = buildDailyPuzzleFirstLegalLine(slot);
      try {
        await timed('puzzle:submit_slot', () =>
          httpPost('/api/daily-puzzle/submit-slot', user.accessToken, {
            attemptId,
            puzzleDate,
            puzzleId: slot.id,
            slotIndex: slot.slotIndex,
            submittedLine: line,
            elapsedSeconds: 1,
            rawScore: 0,
            movesUsed: 1,
          }));
      } catch (err) {
        errors += 1;
        const message = err instanceof Error ? err.message : String(err);
        process.stdout.write(`${JSON.stringify({ warn: 'puzzle_slot_error', index, slotIndex: slot.slotIndex, message })}\n`);
      }
    }

    // Complete attempt
    try {
      const completion = await timed('puzzle:complete', () =>
        httpPost('/api/daily-puzzle/complete', user.accessToken, { attemptId, puzzleDate }));
      finalAttempt = completion.attempt as DailyPuzzleAttempt | null;
    } catch (err) {
      errors += 1;
    }

    return {
      userId: user.id,
      attemptId,
      score: (finalAttempt as unknown as { totalScore?: number } | null)?.totalScore ?? null,
      errors,
      leaderboardPolls,
    };
  } finally {
    // Always signal spike so the barrier doesn't deadlock, then do spike leaderboard poll.
    // User deletion is deferred to main() so integrity checks can run first.
    spikeResolve();
    await spikeBarrier;
    try {
      if (puzzleDate) {
        await timed('puzzle:leaderboard', () =>
          httpGet(`/api/daily-puzzle/leaderboard?date=${encodeURIComponent(puzzleDate)}`, user.accessToken));
        leaderboardPolls += 1;
      }
    } catch {
      errors += 1;
    }
  }
}

// ─── Daily Fritz driver ─────────────────────────────────────────────────────────

type FritzStartPkg = Json & {
  attempt_id: string;
  verified_match_id: string;
  run_date: string;
  challenge_id: string;
  authority_revision: number;
  current_hand_index: number;
  current_game_number: 1 | 2 | 3;
  current_game_scores: { you: number; fritz: number };
  fritz_tier: DailyFritzTier;
  fritz_policy_version: 1 | 2;
  deal_size: 7 | 14;
  winning_score: number;
  first_hand: DailyFritzHandDeal;
  draw_winner: DailyFritzDrawWinner;
};

type FritzHandPkg = Json & {
  current_game_number: 1 | 2 | 3;
  current_hand_index: number;
  authority_revision: number;
  current_game_scores: { you: number; fritz: number };
  hand: DailyFritzHandDeal;
  replayed?: boolean;
};

const fritzStartBody = {
  verification_protocol_version: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  game_rules_version: GAME_RULES_VERSION,
  fritz_policy_version: FRITZ_POLICY_VERSION,
  fritz_policy_contract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
  state_digest_version: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  supported_transcript_protocol_versions: [DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION],
  supported_fritz_policies: [{ version: FRITZ_POLICY_VERSION, contract: getFritzPolicyContract(FRITZ_POLICY_VERSION) }],
  supported_state_digest_versions: [DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION],
  client_release: 'concurrent-load-soak',
  ...(RUN_DATE_OVERRIDE ? { debug_date: RUN_DATE_OVERRIDE } : {}),
};

async function playFritzGame(
  token: string,
  pkg: FritzStartPkg,
  gameNumber: 1 | 2 | 3,
): Promise<{ handCount: number; setResult: Json }> {
  let handIndex = pkg.current_hand_index;
  let hand = pkg.first_hand;
  let scores = pkg.current_game_scores;
  let lastTranscript: DailyFritzTranscript | null = null;
  let handCount = 0;

  while (handCount < 64) {
    const driven = buildHonestDailyFritzHandTranscript({
      challengeId: pkg.challenge_id,
      attemptId: pkg.attempt_id,
      gameNumber,
      handIndex,
      deal: hand,
      drawWinner: pkg.draw_winner,
      winningScore: pkg.winning_score,
      dealSize: pkg.deal_size,
      playerScore: scores.you,
      fritzScore: scores.fritz,
      fritzTier: pkg.fritz_tier,
      fritzPolicyVersion: pkg.fritz_policy_version,
    });
    lastTranscript = driven.transcript;
    handCount += 1;
    if (driven.terminalState.gameOver) break;

    const next = await timed('fritz:next_hand', () =>
      httpPost('/api/daily-fritz/next-hand', token, {
        attempt_id: pkg.attempt_id,
        verified_match_id: pkg.verified_match_id,
        run_date: pkg.run_date,
        game_number: gameNumber,
        completed_hand_index: handIndex,
        transcript: driven.transcript,
      })) as FritzHandPkg;

    handIndex = next.current_hand_index;
    hand = next.hand;
    scores = next.current_game_scores;
  }

  if (!lastTranscript) throw new Error(`Fritz game ${gameNumber} produced no terminal transcript.`);

  const result = await timed('fritz:record_game', () =>
    httpPost('/api/daily-fritz/record-game', token, {
      attempt_id: pkg.attempt_id,
      verified_match_id: pkg.verified_match_id,
      run_date: pkg.run_date,
      game_number: gameNumber,
      transcript: lastTranscript,
    }));

  const setResult = result.set_result as Json;
  return { handCount, setResult };
}

async function runFritzUser(
  index: number,
  steadyBarrier: Promise<void>,
  spikeBarrier: Promise<void>,
  spikeResolve: () => void,
): Promise<{ userId: string; attemptId: string; errors: number; leaderboardPolls: number }> {
  const user = await createEphemeralUser({ ...userInput, prefix: `load-df-${index}` });
  let errors = 0;
  let leaderboardPolls = 0;
  let runDate = '';

  try {
    // Start Daily Fritz (idempotent — both calls resolve to same attempt)
    let pkg: FritzStartPkg;
    try {
      const [result] = await Promise.all([
        timed('fritz:start', () => httpPost('/api/daily-fritz/start', user.accessToken, fritzStartBody)),
        timed('fritz:start', () => httpPost('/api/daily-fritz/start', user.accessToken, fritzStartBody)),
      ]) as [FritzStartPkg, FritzStartPkg];
      pkg = result;
    } catch (err) {
      errors += 1;
      return { userId: user.id, attemptId: '', errors, leaderboardPolls };
    }

    if (!pkg.attempt_id) {
      errors += 1;
      return { userId: user.id, attemptId: '', errors, leaderboardPolls };
    }
    runDate = pkg.run_date;

    // Wait for steady state barrier
    await steadyBarrier;

    // Play games until set is decided
    let setResult = null as Json | null;
    let totalHands = 0;
    for (const gameNumber of [1, 2, 3] as const) {
      if (setResult && (setResult as { setWinner?: string }).setWinner) break;

      // Reload start state for game 2+
      const resumed = gameNumber === 1
        ? pkg
        : await timed('fritz:start', () => httpPost('/api/daily-fritz/start', user.accessToken, fritzStartBody)) as FritzStartPkg;

      try {
        const game = await playFritzGame(user.accessToken, resumed, gameNumber);
        totalHands += game.handCount;
        setResult = game.setResult;
      } catch (err) {
        errors += 1;
        break;
      }
    }

    // Complete the attempt
    try {
      await timed('fritz:complete', () =>
        httpPost('/api/daily-fritz/complete', user.accessToken, {
          attempt_id: pkg.attempt_id,
          verified_match_id: pkg.verified_match_id,
          run_date: pkg.run_date,
        }));
    } catch {
      errors += 1;
    }

    // Poll leaderboard
    try {
      const dateParam = RUN_DATE_OVERRIDE || pkg.run_date;
      await timed('fritz:leaderboard', () =>
        httpGet(`/api/daily-fritz/leaderboard/${encodeURIComponent(dateParam)}`, user.accessToken));
      leaderboardPolls += 1;
    } catch {
      errors += 1;
    }

    return { userId: user.id, attemptId: pkg.attempt_id, errors, leaderboardPolls };
  } finally {
    // Always signal spike so barrier doesn't deadlock, then do spike leaderboard poll.
    // User deletion is deferred to main() so integrity checks can run first.
    spikeResolve();
    await spikeBarrier;
    try {
      const dateParam = RUN_DATE_OVERRIDE || runDate;
      if (dateParam) {
        await timed('fritz:leaderboard', () =>
          httpGet(`/api/daily-fritz/leaderboard/${encodeURIComponent(dateParam)}`, user.accessToken));
        leaderboardPolls += 1;
      }
    } catch {
      errors += 1;
    }
  }
}

// ─── Authority integrity check ──────────────────────────────────────────────────

async function assertDailyPuzzleIntegrity(attemptId: string, puzzleDate: string): Promise<void> {
  const headers = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
  const rows = await fetchJson<Json[]>(
    `${SUPABASE_URL}/rest/v1/daily_puzzle_attempts?id=eq.${encodeURIComponent(attemptId)}&select=id,status,puzzle_date`,
    { headers },
    TIMEOUT_MS,
  );
  if (rows.length === 0) throw new Error(`Daily Puzzle attempt ${attemptId} not found in DB.`);
  const row = rows[0];
  if (row.puzzle_date !== puzzleDate) throw new Error(`Attempt ${attemptId} has wrong puzzle_date: ${String(row.puzzle_date)}`);
}

async function assertFritzIntegrity(attemptId: string): Promise<void> {
  const headers = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
  const rows = await fetchJson<Json[]>(
    `${SUPABASE_URL}/rest/v1/daily_fritz_attempts?id=eq.${encodeURIComponent(attemptId)}&select=id,status`,
    { headers },
    TIMEOUT_MS,
  );
  if (rows.length === 0) throw new Error(`Daily Fritz attempt ${attemptId} not found in DB.`);
}

// ─── Stats snapshot ─────────────────────────────────────────────────────────────

async function getMpStats(): Promise<Json> {
  return fetchJson<Json>(`${BASE_URL}/api/mp-stats`, {}, TIMEOUT_MS);
}

// ─── Barrier helpers ────────────────────────────────────────────────────────────

function makeBarrier(count: number): { barrier: Promise<void>; signal: () => void } {
  let resolved = 0;
  let resolveFn!: () => void;
  const barrier = new Promise<void>((res) => { resolveFn = res; });
  return {
    barrier,
    signal() {
      resolved += 1;
      if (resolved >= count) resolveFn();
    },
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const totalSessions = MP_ROOMS * 2 + PUZZLE_USERS + FRITZ_USERS;
  process.stdout.write(`${JSON.stringify({
    phase: 'started',
    baseUrl: BASE_URL,
    mpRooms: MP_ROOMS,
    puzzleUsers: PUZZLE_USERS,
    fritzUsers: FRITZ_USERS,
    totalSessions,
    steadyDurationMs: STEADY_DURATION_MS,
  })}\n`);

  // Snapshot stats before
  const statsBefore = await getMpStats().catch(() => null);
  process.stdout.write(`${JSON.stringify({ phase: 'stats_before', stats: statsBefore })}\n`);

  // ── Provision all users first ──────────────────────────────────────────────

  // Steady-state barrier: released STEADY_DURATION_MS after all workers start
  // We use a simple timer: all workers await a single promise that resolves once all
  // sessions have connected and we've waited for the steady period.
  let steadyResolve!: () => void;
  const steadyBarrier = new Promise<void>((res) => { steadyResolve = res; });

  // Spike barrier: resolves when all sessions have signaled ready (or after 60s timeout)
  const { barrier: spikeBarrierRaw, signal: spikeSignal } = makeBarrier(MP_ROOMS + PUZZLE_USERS + FRITZ_USERS);
  const spikeBarrier = Promise.race([
    spikeBarrierRaw,
    new Promise<void>((res) => setTimeout(res, 60_000)),
  ]);

  // Launch all sessions simultaneously
  process.stdout.write(`${JSON.stringify({ phase: 'launching_all_sessions' })}\n`);

  const mpPromises = Array.from({ length: MP_ROOMS }, (_, i) =>
    driveMultiplayerRoom(i, steadyBarrier, spikeBarrier, spikeSignal)
      .catch((err) => ({ roomCode: '', handsPlayed: 0, errors: 1, _err: String(err) })));

  const puzzlePromises = Array.from({ length: PUZZLE_USERS }, (_, i) =>
    runPuzzleUser(i, steadyBarrier, spikeBarrier, spikeSignal)
      .catch((err) => ({ attemptId: '', score: null, errors: 1, leaderboardPolls: 0, _err: String(err) })));

  const fritzPromises = Array.from({ length: FRITZ_USERS }, (_, i) =>
    runFritzUser(i, steadyBarrier, spikeBarrier, spikeSignal)
      .catch((err) => ({ attemptId: '', errors: 1, leaderboardPolls: 0, _err: String(err) })));

  // Release steady barrier after STEADY_DURATION_MS
  // (In practice workers begin playing immediately and we gate the spike on natural completion)
  setTimeout(() => steadyResolve(), 5_000); // 5s for connection setup, then steady state begins immediately

  process.stdout.write(`${JSON.stringify({ phase: 'steady_state_running', steadyMs: STEADY_DURATION_MS })}\n`);

  const [mpResults, puzzleResults, fritzResults] = await Promise.all([
    Promise.all(mpPromises),
    Promise.all(puzzlePromises),
    Promise.all(fritzPromises),
  ]);

  process.stdout.write(`${JSON.stringify({ phase: 'all_sessions_complete' })}\n`);

  // ── Authority integrity: verify attempts exist in DB BEFORE deleting users ─
  // daily_puzzle_attempts and daily_fritz_attempts have ON DELETE CASCADE on
  // user_id → auth.users(id). Deleting ephemeral users would cascade-delete the
  // attempt rows, causing all integrity checks to fail. Run checks first.

  const integrityErrors: string[] = [];
  let integrityChecks = 0;
  const puzzleAttemptIds = puzzleResults
    .filter((r) => 'attemptId' in r && r.attemptId)
    .map((r) => (r as { attemptId: string }).attemptId);
  const fritzAttemptIds = fritzResults
    .filter((r) => 'attemptId' in r && r.attemptId)
    .map((r) => (r as { attemptId: string }).attemptId);

  // Batch check puzzle attempts
  if (puzzleAttemptIds.length > 0) {
    try {
      const idClause = puzzleAttemptIds.map((id) => `"${id}"`).join(',');
      const rows = await fetchJson<Json[]>(
        `${SUPABASE_URL}/rest/v1/daily_puzzle_attempts?id=in.(${encodeURIComponent(idClause)})&select=id`,
        { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } },
        TIMEOUT_MS,
      );
      const found = new Set(rows.map((r) => r.id as string));
      integrityChecks += puzzleAttemptIds.length;
      for (const id of puzzleAttemptIds) {
        if (!found.has(id)) integrityErrors.push(`Puzzle attempt ${id} not found in DB`);
      }
    } catch (err) {
      integrityErrors.push(`Puzzle integrity check failed (possible Supabase project mismatch): ${String(err)}`);
    }
  }

  // Batch check fritz attempts
  if (fritzAttemptIds.length > 0) {
    try {
      const idClause = fritzAttemptIds.map((id) => `"${id}"`).join(',');
      const rows = await fetchJson<Json[]>(
        `${SUPABASE_URL}/rest/v1/daily_fritz_attempts?id=in.(${encodeURIComponent(idClause)})&select=id`,
        { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } },
        TIMEOUT_MS,
      );
      const found = new Set(rows.map((r) => r.id as string));
      integrityChecks += fritzAttemptIds.length;
      for (const id of fritzAttemptIds) {
        if (!found.has(id)) integrityErrors.push(`Fritz attempt ${id} not found in DB`);
      }
    } catch (err) {
      integrityErrors.push(`Fritz integrity check failed (possible Supabase project mismatch): ${String(err)}`);
    }
  }

  // ── Delete ephemeral users now that integrity checks are done ─────────────
  const puzzleUserIds = puzzleResults
    .filter((r) => 'userId' in r && r.userId)
    .map((r) => (r as { userId: string }).userId);
  const fritzUserIds = fritzResults
    .filter((r) => 'userId' in r && r.userId)
    .map((r) => (r as { userId: string }).userId);
  await Promise.allSettled([
    ...puzzleUserIds.map((id) => deleteEphemeralUser({ id, supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, timeoutMs: TIMEOUT_MS })),
    ...fritzUserIds.map((id) => deleteEphemeralUser({ id, supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, timeoutMs: TIMEOUT_MS })),
  ]);

  // Snapshot stats after
  const statsAfter = await getMpStats().catch(() => null);

  // ── Aggregate metrics ──────────────────────────────────────────────────────

  const report: Record<string, unknown> = {};
  let totalErrors = 0;
  let totalOps = 0;

  for (const [opType, data] of ops.entries()) {
    const count = data.latencies.length;
    totalOps += count;
    totalErrors += data.errors;
    report[opType] = {
      count,
      errors: data.errors,
      errorRate: count > 0 ? `${((data.errors / count) * 100).toFixed(1)}%` : '0%',
      circuitBreakerFires: data.circuitBreaker,
      rateLimitFires: data.rateLimit,
      p50Ms: Math.round(percentile(data.latencies, 0.50)),
      p95Ms: Math.round(percentile(data.latencies, 0.95)),
      p99Ms: Math.round(percentile(data.latencies, 0.99)),
    };
  }

  const mpSummary = {
    rooms: mpResults.length,
    totalHandsPlayed: mpResults.reduce((s, r) => s + (r.handsPlayed ?? 0), 0),
    errors: mpResults.reduce((s, r) => s + (r.errors ?? 0), 0),
  };
  const puzzleSummary = {
    users: puzzleResults.length,
    completed: puzzleResults.filter((r) => r.attemptId && !('_err' in r)).length,
    errors: puzzleResults.reduce((s, r) => s + (r.errors ?? 0), 0),
    totalLeaderboardPolls: puzzleResults.reduce((s, r) => s + (r.leaderboardPolls ?? 0), 0),
  };
  const fritzSummary = {
    users: fritzResults.length,
    completed: fritzResults.filter((r) => r.attemptId && !('_err' in r)).length,
    errors: fritzResults.reduce((s, r) => s + (r.errors ?? 0), 0),
    totalLeaderboardPolls: fritzResults.reduce((s, r) => s + (r.leaderboardPolls ?? 0), 0),
  };

  process.stdout.write(`${JSON.stringify({
    ok: integrityErrors.length === 0,
    summary: {
      totalOps,
      totalErrors,
      overallErrorRate: totalOps > 0 ? `${((totalErrors / totalOps) * 100).toFixed(2)}%` : '0%',
      integrityChecks,
      integrityErrors: integrityErrors.length,
      mpSessions: mpSummary,
      puzzleSessions: puzzleSummary,
      fritzSessions: fritzSummary,
      statsBefore,
      statsAfter,
    },
    perOperationType: report,
    integrityErrors: integrityErrors.length > 0 ? integrityErrors : undefined,
  }, null, 2)}\n`);
}

void main()
  .then(() => process.stdout.write(`${JSON.stringify({ phase: 'complete' })}\n`))
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  });
