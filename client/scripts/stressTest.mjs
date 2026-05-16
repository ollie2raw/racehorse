/**
 * Multiplayer stress test: 2 socket.io bot clients × 20 matchmade games.
 * Run: node client/scripts/stressTest.mjs
 */
import net from 'node:net';
import { io } from 'socket.io-client';

const SERVER_URL = process.env.STRESS_SERVER_URL || 'http://127.0.0.1:3001';
const GAME_COUNT = Math.max(1, Number(process.env.STRESS_GAMES || 20));
const TIMEOUT_MS = Number(process.env.STRESS_TIMEOUT_MS || 120_000);
const MATCHMAKE_TIMEOUT_MS = Number(process.env.STRESS_MATCHMAKE_TIMEOUT_MS || 30_000);
const SETTLE_MS = Math.max(50, Number(process.env.STRESS_SETTLE_MS || 100));
const MAX_TURNS_PER_GAME = Number(process.env.STRESS_MAX_TURNS || 800);

const SERVER_ENDPOINT = (() => {
  const parsed = new URL(SERVER_URL);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
  };
})();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function onceWithTimeout(socket, event, predicate = () => true, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const handler = (payload) => {
      try {
        if (!predicate(payload)) return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      } catch (error) {
        clearTimeout(timer);
        socket.off(event, handler);
        reject(error);
      }
    };

    socket.on(event, handler);
  });
}

async function emitAck(socket, event, ...args) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), TIMEOUT_MS);
    socket.emit(event, ...args, (resp) => {
      clearTimeout(timer);
      resolve(resp);
    });
  });
}

function waitForTcpReady(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: SERVER_ENDPOINT.host,
      port: SERVER_ENDPOINT.port,
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out waiting for tcp://${SERVER_ENDPOINT.host}:${SERVER_ENDPOINT.port}`));
    }, timeoutMs);
    const cleanup = () => clearTimeout(timer);
    socket.once('connect', () => {
      cleanup();
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error) => {
      cleanup();
      socket.destroy();
      reject(error);
    });
  });
}

async function waitForServerReady() {
  const deadline = Date.now() + 10_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await waitForTcpReady(1000);
      return;
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }
  throw new Error(`Server not ready at ${SERVER_URL}: ${lastError?.message ?? 'unknown'}`);
}

function createClient(label, userId, username) {
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    timeout: TIMEOUT_MS,
    reconnection: false,
    autoConnect: false,
  });

  const state = {
    label,
    userId,
    username,
    youSeatId: null,
    roomUpdates: [],
    stateUpdates: [],
    errors: [],
    notYourTurnCount: 0,
    tilesCrashCount: 0,
  };

  const recordError = (source, message) => {
    const text = String(message ?? '');
    if (!text) return;
    state.errors.push({ source, message: text });
    if (/not your turn/i.test(text)) state.notYourTurnCount += 1;
    if (/reading 'tiles'|\.tiles|missing BranchArm\.tiles/i.test(text)) {
      state.tilesCrashCount += 1;
    }
  };

  socket.on('room:update', (payload) => state.roomUpdates.push(payload));
  socket.on('state:update', (payload) => {
    state.stateUpdates.push(payload);
    if (typeof payload?.you === 'string' && payload.you) {
      state.youSeatId = payload.you;
    }
    try {
      validateBoardBranches(payload?.state?.board, `${label}:state:update`);
    } catch (error) {
      recordError('state:update', error instanceof Error ? error.message : String(error));
    }
  });
  socket.on('connect_error', (error) => {
    recordError('connect_error', error?.message || String(error));
  });

  async function connectAndIdentify() {
    if (!socket.connected) {
      const waitForConnect = onceWithTimeout(socket, 'connect', () => true, TIMEOUT_MS);
      socket.connect();
      await waitForConnect;
    }
    const resp = await emitAck(socket, 'presence:identify', { userId, username });
    if (!resp?.ok) {
      recordError('presence:identify', resp?.error ?? 'identify failed');
      throw new Error(`${label} presence:identify failed`);
    }
  }

  function disconnect() {
    if (socket.connected) socket.disconnect();
  }

  return { socket, state, connectAndIdentify, disconnect, recordError };
}

function validateBoardBranches(board, ctx) {
  if (!board?.hubDoubles) return;
  for (let hubIdx = 0; hubIdx < board.hubDoubles.length; hubIdx += 1) {
    const hub = board.hubDoubles[hubIdx];
    if (!hub?.branches) continue;
    for (let armIdx = 0; armIdx < hub.branches.length; armIdx += 1) {
      const arm = hub.branches[armIdx];
      if (arm == null) continue;
      if (!Array.isArray(arm.tiles)) {
        throw new Error(`${ctx} hub ${hubIdx} arm ${armIdx} missing .tiles array`);
      }
    }
  }
}

function latestState(client) {
  return client.state.stateUpdates[client.state.stateUpdates.length - 1] ?? null;
}

function seatIdFor(client) {
  if (client.state.youSeatId) return client.state.youSeatId;
  const fromUpdate = latestState(client)?.you;
  if (typeof fromUpdate === 'string' && fromUpdate) {
    client.state.youSeatId = fromUpdate;
    return fromUpdate;
  }
  throw new Error(`${client.state.label} missing seat id`);
}

function getClientBySeatId(clients, seatId) {
  return (
    clients.find((client) => {
      const fromState = client.state.youSeatId ?? latestState(client)?.you;
      return fromState === seatId;
    }) ?? null
  );
}

function getLegalActions(client) {
  const payload = latestState(client);
  const legalMoves = Array.isArray(payload?.legalMoves) ? payload.legalMoves : [];
  const actions = [];
  for (const move of legalMoves) {
    if (move?.type === 'play' && move?.tile && move?.position) {
      actions.push({
        type: 'MOVE',
        move: { tile: move.tile, position: move.position },
      });
    }
    if (move?.type === 'pass') {
      actions.push({ type: 'PASS' });
    }
  }
  if (payload?.canDraw) {
    actions.push({ type: 'DRAW' });
  }
  return actions;
}

async function waitForSequenceAtLeast(client, minimumSequence) {
  const current = latestState(client)?.state?.sequence;
  if (typeof current === 'number' && current >= minimumSequence) return latestState(client);
  return onceWithTimeout(
    client.socket,
    'state:update',
    (payload) => typeof payload?.state?.sequence === 'number' && payload.state.sequence >= minimumSequence,
  );
}

async function waitForAllClientsSequence(clients, minimumSequence) {
  await Promise.all(clients.map((client) => waitForSequenceAtLeast(client, minimumSequence)));
}

async function waitForGameState(clients) {
  const hasState = () => clients.every((client) => latestState(client)?.state);
  if (hasState()) return;
  await Promise.all(
    clients.map((client) =>
      onceWithTimeout(client.socket, 'state:update', () => Boolean(latestState(client)?.state), TIMEOUT_MS),
    ),
  );
}

function chooseRandomAction(client) {
  const actions = getLegalActions(client);
  if (actions.length === 0) return null;
  return pickRandom(actions);
}

async function advanceHandIfNeeded(clients, roomCode) {
  const reference = latestState(clients[0])?.state;
  if (!reference?.handOver || reference.gameOver) return reference;

  const handNumber = reference.handNumber;
  for (const client of clients) {
    const resp = await emitAck(client.socket, 'hand:ready', roomCode, handNumber);
    if (!resp?.ok) {
      client.recordError('hand:ready', resp?.error ?? 'hand:ready failed');
      throw new Error(`${client.state.label} hand:ready failed: ${resp?.error ?? 'unknown'}`);
    }
    if (resp?.error) client.recordError('hand:ready', resp.error);
  }
  await waitForAllClientsSequence(clients, reference.sequence + 1);
  await delay(SETTLE_MS);
  return latestState(clients[0])?.state ?? null;
}

async function playUntilGameOver(clients, roomCode) {
  await waitForGameState(clients);

  for (let turn = 0; turn < MAX_TURNS_PER_GAME; turn += 1) {
    let state = latestState(clients[0])?.state;
    if (!state) throw new Error('missing game state during play');
    if (state.gameOver) return state;

    if (state.handOver) {
      state = await advanceHandIfNeeded(clients, roomCode);
      if (state?.gameOver) return state;
      continue;
    }

    const currentId = state.playerIds?.[state.currentPlayerIndex];
    const current = getClientBySeatId(clients, currentId);
    if (!current) throw new Error(`unknown current player socket ${currentId}`);

    const action = chooseRandomAction(current);
    if (!action) {
      throw new Error(
        `${current.state.label} has no legal action at seq=${state.sequence} hand=${state.handNumber}`,
      );
    }

    const beforeSequence = state.sequence ?? 0;
    const resp = await emitAck(current.socket, 'game:action', roomCode, action);
    if (!resp?.ok) {
      current.recordError('game:action', resp?.error ?? 'game:action failed');
      throw new Error(`game:action failed: ${resp?.error ?? 'unknown'}`);
    }

    const targetSequence = typeof resp.sequence === 'number' ? resp.sequence : beforeSequence + 1;
    await waitForAllClientsSequence(clients, targetSequence);
    await delay(SETTLE_MS);
  }

  throw new Error(`game did not finish within ${MAX_TURNS_PER_GAME} turns`);
}

function winnerLabel(clients, finalState) {
  const winnerSeat = finalState?.winnerId;
  if (!winnerSeat) return 'draw/unknown';
  const winnerClient = clients.find((client) => seatIdFor(client) === winnerSeat);
  return winnerClient?.state?.label ?? winnerSeat;
}

function waitForQueueMatched(client) {
  return onceWithTimeout(client.socket, 'queue:matched', () => true, MATCHMAKE_TIMEOUT_MS);
}

async function runSingleGame(gameNumber) {
  const alpha = createClient('alpha', `stress-${gameNumber}-a`, `StressA${gameNumber}`);
  const bravo = createClient('bravo', `stress-${gameNumber}-b`, `StressB${gameNumber}`);
  const clients = [alpha, bravo];
  const gameErrors = [];
  let roomCode = null;

  const collectErrors = () => {
    for (const client of clients) {
      for (const entry of client.state.errors) {
        gameErrors.push(`${client.state.label}:${entry.source}: ${entry.message}`);
      }
    }
  };

  try {
    await Promise.all(clients.map((client) => client.connectAndIdentify()));

    const [joinAlpha, joinBravo] = await Promise.all([
      emitAck(alpha.socket, 'queue:join', { userId: alpha.state.userId, username: alpha.state.username }),
      emitAck(bravo.socket, 'queue:join', { userId: bravo.state.userId, username: bravo.state.username }),
    ]);

    if (!joinAlpha?.ok) {
      alpha.recordError('queue:join', joinAlpha?.error ?? 'queue:join failed');
      throw new Error(`alpha queue:join failed: ${joinAlpha?.error ?? 'unknown'}`);
    }
    if (!joinBravo?.ok) {
      bravo.recordError('queue:join', joinBravo?.error ?? 'queue:join failed');
      throw new Error(`bravo queue:join failed: ${joinBravo?.error ?? 'unknown'}`);
    }

    const [matchedAlpha, matchedBravo] = await Promise.all([
      waitForQueueMatched(alpha),
      waitForQueueMatched(bravo),
    ]);

    roomCode = matchedAlpha?.roomCode ?? matchedBravo?.roomCode;
    if (!roomCode) throw new Error('queue:matched missing roomCode');
    if (matchedAlpha?.roomCode && matchedBravo?.roomCode && matchedAlpha.roomCode !== matchedBravo.roomCode) {
      throw new Error(`room code mismatch: ${matchedAlpha.roomCode} vs ${matchedBravo.roomCode}`);
    }

    const [joinRoomAlpha, joinRoomBravo] = await Promise.all([
      emitAck(alpha.socket, 'room:join', roomCode, {
        username: alpha.state.username,
        userId: alpha.state.userId,
      }),
      emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      }),
    ]);

    if (!joinRoomAlpha?.ok) {
      alpha.recordError('room:join', joinRoomAlpha?.error ?? 'room:join failed');
      throw new Error(`alpha room:join failed: ${joinRoomAlpha?.error ?? 'unknown'}`);
    }
    if (!joinRoomBravo?.ok) {
      bravo.recordError('room:join', joinRoomBravo?.error ?? 'room:join failed');
      throw new Error(`bravo room:join failed: ${joinRoomBravo?.error ?? 'unknown'}`);
    }

    if (joinRoomAlpha.you) alpha.state.youSeatId = joinRoomAlpha.you;
    if (joinRoomBravo.you) bravo.state.youSeatId = joinRoomBravo.you;

    const finalState = await playUntilGameOver(clients, roomCode);
    collectErrors();

    const notYourTurn =
      alpha.state.notYourTurnCount + bravo.state.notYourTurnCount > 0 ||
      gameErrors.some((msg) => /not your turn/i.test(msg));
    const tilesCrash =
      alpha.state.tilesCrashCount + bravo.state.tilesCrashCount > 0 ||
      gameErrors.some((msg) => /\.tiles|reading 'tiles'|missing BranchArm\.tiles/i.test(msg));

    return {
      ok: true,
      roomCode,
      winner: winnerLabel(clients, finalState),
      scores: finalState?.scores ?? null,
      errors: gameErrors,
      notYourTurn,
      tilesCrash,
    };
  } catch (error) {
    collectErrors();
    const message = error instanceof Error ? error.message : String(error);
    gameErrors.push(message);

    const notYourTurn =
      alpha.state.notYourTurnCount + bravo.state.notYourTurnCount > 0 ||
      gameErrors.some((msg) => /not your turn/i.test(msg));
    const tilesCrash =
      alpha.state.tilesCrashCount + bravo.state.tilesCrashCount > 0 ||
      gameErrors.some((msg) => /\.tiles|reading 'tiles'|missing BranchArm\.tiles/i.test(msg));

    return {
      ok: false,
      winner: null,
      errors: gameErrors,
      notYourTurn,
      tilesCrash,
      failure: message,
    };
  } finally {
    for (const client of clients) {
      if (client.socket.connected) {
        try {
          await emitAck(client.socket, 'queue:leave', {});
        } catch {
          /* best-effort cleanup */
        }
        try {
          if (roomCode) await emitAck(client.socket, 'room:leave', roomCode);
        } catch {
          /* best-effort cleanup */
        }
      }
      client.disconnect();
    }
    await delay(SETTLE_MS);
  }
}

function logGameResult(gameNumber, result) {
  const status = result.ok ? 'OK' : 'FAIL';
  const winner = result.winner ?? 'n/a';
  const errSummary = result.errors.length ? result.errors.join(' | ') : 'none';
  console.log(
    `[game ${gameNumber}/${GAME_COUNT}] ${status} winner=${winner} errors=${errSummary} tilesCrash=${result.tilesCrash} notYourTurn=${result.notYourTurn}`,
  );
}

async function main() {
  console.log(`[stressTest] server=${SERVER_URL} games=${GAME_COUNT}`);
  await waitForServerReady();

  const results = [];
  for (let game = 1; game <= GAME_COUNT; game += 1) {
    const result = await runSingleGame(game);
    logGameResult(game, result);
    results.push({ game, ...result });
  }

  const clean = results.filter((r) => r.ok && r.errors.length === 0 && !r.notYourTurn && !r.tilesCrash);
  console.log('');
  console.log(`[stressTest] summary: ${clean.length}/${GAME_COUNT} games completed without errors`);
  if (clean.length < GAME_COUNT) {
    const failed = results.filter((r) => !r.ok || r.errors.length > 0 || r.notYourTurn || r.tilesCrash);
    console.log(`[stressTest] ${failed.length} game(s) had issues — see per-game logs above`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[stressTest] FAILED', error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
