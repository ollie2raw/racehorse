import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { io } from 'socket.io-client';

/**
 * Canonical open-ends scoring (server build). Run `npm run build --prefix server`
 * before socket smoke if this import fails.
 */
const require = createRequire(import.meta.url);
const { computeOpenEndsSum } = require('../../server/dist/game/openEndsGeometry.js');
const { computePlayScore, simulatePlacement } = require('../../server/dist/game/scoring.js');

const SERVER_URL = process.env.SMOKE_SERVER_URL || 'http://127.0.0.1:3001';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const REPEAT_COUNT = Math.max(1, Number(process.env.SMOKE_REPEAT || 1));
const SETTLE_MS = Math.max(50, Number(process.env.SMOKE_SETTLE_MS || 250));

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getPortListenerDetails() {
  try {
    const output = execFileSync(
      'lsof',
      ['-nP', `-iTCP:${SERVER_ENDPOINT.port}`, '-sTCP:LISTEN'],
      { encoding: 'utf8' },
    ).trim();
    return output || `no listener on tcp:${SERVER_ENDPOINT.port}`;
  } catch {
    return `no listener on tcp:${SERVER_ENDPOINT.port}`;
  }
}

function waitForTcpReady(timeoutMs = TIMEOUT_MS) {
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

async function waitForServerReady(timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await waitForTcpReady(Math.min(1000, timeoutMs));
      return;
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }
  throw new Error(
    [
      `server not ready at ${SERVER_URL}`,
      `timeoutMs=${timeoutMs}`,
      `portCheck=${getPortListenerDetails()}`,
      `lastError=${lastError instanceof Error ? lastError.message : String(lastError)}`,
    ].join(' | '),
  );
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
    spectateUpdates: [],
    drawAnimations: [],
    connectErrors: [],
  };

  socket.on('room:update', (payload) => state.roomUpdates.push(payload));
  socket.on('state:update', (payload) => {
    state.stateUpdates.push(payload);
    if (typeof payload?.you === 'string' && payload.you) {
      state.youSeatId = payload.you;
    }
  });
  socket.on('state:spectate', (payload) => state.spectateUpdates.push(payload));
  socket.on('game:draw_animation', (payload) => state.drawAnimations.push(payload));
  socket.on('connect_error', (error) => state.connectErrors.push(error?.message || String(error)));

  async function connectAndIdentify() {
    if (!socket.connected) {
      let connected = false;
      let lastError = null;
      for (let attempt = 0; attempt < 3 && !connected; attempt += 1) {
        try {
          const waitForConnect = onceWithTimeout(socket, 'connect', () => true, TIMEOUT_MS);
          socket.connect();
          await waitForConnect;
          connected = true;
        } catch (error) {
          lastError = error;
          socket.disconnect();
          await delay(100 * (attempt + 1));
        }
      }
      if (!connected) {
        const baseMessage = lastError instanceof Error ? lastError.message : `${label} failed to connect`;
        throw new Error(
          [
            `${label} failed to connect`,
            `serverUrl=${SERVER_URL}`,
            `timeoutMs=${TIMEOUT_MS}`,
            `connectErrors=${JSON.stringify(state.connectErrors.slice(-5))}`,
            `portCheck=${getPortListenerDetails()}`,
            `lastError=${baseMessage}`,
          ].join(' | '),
        );
      }
    }
    const resp = await emitAck(socket, 'presence:identify', { userId, username });
    assert(resp?.ok, `${label} failed presence:identify`);
  }

  function disconnect() {
    if (socket.connected) {
      socket.disconnect();
    }
  }

  return { socket, state, connectAndIdentify, disconnect };
}

async function withClients(definitions, run) {
  const clients = definitions.map((def) => createClient(def.label, def.userId, def.username));
  try {
    for (const client of clients) {
      await client.connectAndIdentify();
    }
    const namedClients = Object.fromEntries(clients.map((client) => [client.state.label, client]));
    return await run(namedClients);
  } finally {
    for (const client of clients) {
      client.disconnect();
    }
    await delay(100);
  }
}

function latestRoomUpdate(client) {
  return client.state.roomUpdates[client.state.roomUpdates.length - 1] ?? null;
}

function latestRoomCount(client) {
  const last = latestRoomUpdate(client);
  return Array.isArray(last?.players) ? last.players.length : null;
}

function latestState(client, type = 'state:update') {
  const list = type === 'state:spectate' ? client.state.spectateUpdates : client.state.stateUpdates;
  return list[list.length - 1] ?? null;
}

async function waitForStateCount(client, minimumCount, type = 'state:update') {
  if (type === 'state:update' && client.state.stateUpdates.length >= minimumCount) {
    return latestState(client, type);
  }
  if (type === 'state:spectate' && client.state.spectateUpdates.length >= minimumCount) {
    return latestState(client, type);
  }
  return onceWithTimeout(
    client.socket,
    type,
    () =>
      type === 'state:update'
        ? client.state.stateUpdates.length >= minimumCount
        : client.state.spectateUpdates.length >= minimumCount,
  );
}

async function waitForDrawAnimationCount(client, minimumCount) {
  if (client.state.drawAnimations.length >= minimumCount) {
    return client.state.drawAnimations[client.state.drawAnimations.length - 1] ?? null;
  }
  return onceWithTimeout(client.socket, 'game:draw_animation', () => client.state.drawAnimations.length >= minimumCount);
}

async function waitForRoomCount(client, expectedCount, timeoutMs = TIMEOUT_MS) {
  if (latestRoomCount(client) === expectedCount) {
    return latestRoomUpdate(client);
  }
  return onceWithTimeout(
    client.socket,
    'room:update',
    (payload) => Array.isArray(payload?.players) && payload.players.length === expectedCount,
    timeoutMs,
  );
}

function getPlayableMove(client) {
  const state = latestState(client);
  const legalMoves = Array.isArray(state?.legalMoves) ? state.legalMoves : [];
  return legalMoves.find((move) => move?.type === 'play' && move?.tile && move?.position) ?? null;
}

function getCurrentPlayerId(client) {
  const state = latestState(client)?.state;
  if (!state) return null;
  return state.playerIds?.[state.currentPlayerIndex] ?? null;
}

function getClientBySeatId(clients, seatId) {
  if (!seatId) return null;
  return (
    clients.find((client) => {
      if (client.state.youSeatId === seatId) return true;
      const fromUpdate = latestState(client)?.you;
      return fromUpdate === seatId;
    }) ?? null
  );
}

function captureJoinSeat(client, resp) {
  if (typeof resp?.you === 'string' && resp.you) {
    client.state.youSeatId = resp.you;
  }
  if (resp?.state) {
    client.state.stateUpdates.push({
      state: resp.state,
      legalMoves: Array.isArray(resp.legalMoves) ? resp.legalMoves : [],
      canDraw: Boolean(resp.canDraw),
      you: resp.you,
    });
  }
}

function seatIdFor(client) {
  if (client.state.youSeatId) return client.state.youSeatId;
  const fromUpdate = latestState(client)?.you;
  if (typeof fromUpdate === 'string' && fromUpdate) {
    client.state.youSeatId = fromUpdate;
    return fromUpdate;
  }
  throw new Error(`${client.state.label} missing playerSeatId`);
}

function boardTileCount(board) {
  if (!board) return 0;
  const mainCount = Array.isArray(board.mainLine) ? board.mainLine.length : 0;
  const branchCount = Array.isArray(board.hubDoubles)
    ? board.hubDoubles.reduce(
        (sum, hub) =>
          sum +
          (Array.isArray(hub?.branches)
            ? hub.branches.reduce((branchSum, branch) => branchSum + (branch?.tiles?.length ?? 0), 0)
            : 0),
        0,
      )
    : 0;
  return mainCount + branchCount;
}

function tileEquals(a, b) {
  if (!a || !b) return false;
  return (a.low === b.low && a.high === b.high) || (a.low === b.high && a.high === b.low);
}

function parseBranchPosition(position) {
  if (typeof position !== 'string') return null;
  const match = /^branch-(\d+)-(\d+)$/.exec(position);
  if (!match) return null;
  return {
    hubIndex: Number(match[1]),
    armIndex: Number(match[2]),
  };
}

function computePlayScoreForMove(state, move) {
  if (!state || !move?.tile || !move?.position) return 0;
  const scoringMultiple = state.config?.scoringMultiple ?? 5;
  if (!state.board) {
    const sum = move.tile.low + move.tile.high;
    return sum % scoringMultiple === 0 ? sum / scoringMultiple : 0;
  }
  const nextBoard = simulatePlacement(state.board, move.tile, move.position);
  return computePlayScore(nextBoard, { scoringMultiple, winningScore: 100, maxPips: 6, deadTileCount: 0, tilesPerPlayer: 7 });
}

function isForcedDrawCandidate(client, move) {
  const state = latestState(client)?.state;
  if (!state || !move?.tile) return false;
  const ownHand = state.players?.[seatIdFor(client)]?.hand ?? [];
  const drawableCount = Math.max(0, (state.boneyard?.length ?? 0) - (state.config?.deadTileCount ?? 0));
  if (ownHand.length !== 1 || drawableCount === 0) return false;
  return move.tile.low === move.tile.high || computePlayScoreForMove(state, move) > 0;
}

function chooseForcedDrawSearchMove(client) {
  const payload = latestState(client);
  const legalMoves = Array.isArray(payload?.legalMoves) ? payload.legalMoves.filter((move) => move?.type === 'play' && move.tile && move.position) : [];
  const forcedCandidate = legalMoves.find((move) => isForcedDrawCandidate(client, move));
  if (forcedCandidate) return forcedCandidate;

  const quietMove = legalMoves.find((move) => move.tile.low !== move.tile.high && computePlayScoreForMove(payload?.state, move) === 0);
  if (quietMove) return quietMove;

  const nonDoubleMove = legalMoves.find((move) => move.tile.low !== move.tile.high);
  if (nonDoubleMove) return nonDoubleMove;

  return legalMoves[0] ?? null;
}

function listRawPlayablePositions(board, tile) {
  if (!tile) return [];
  if (!board) return ['left'];

  const positions = [];
  if (tile.low === board.leftEnd || tile.high === board.leftEnd) {
    positions.push('left');
  }
  if (tile.low === board.rightEnd || tile.high === board.rightEnd) {
    positions.push('right');
  }

  if (Array.isArray(board.hubDoubles)) {
    board.hubDoubles.forEach((hub, hubIndex) => {
      if (!hub?.isCrossed) return;
      if (!Array.isArray(hub.branches)) return;
      hub.branches.forEach((branch, armIndex) => {
        const openEnd = branch?.openEnd;
        if (typeof openEnd !== 'number') return;
        if (tile.low === openEnd || tile.high === openEnd) {
          positions.push(`branch-${hubIndex}-${armIndex}`);
        }
      });
    });
  }

  return [...new Set(positions)];
}

/** Returns a last-tile scoring/double placement that matches the board but is missing from legalMoves (regression guard). */
function findHiddenForcedDrawLikeMove(client) {
  const payload = latestState(client);
  const state = payload?.state;
  if (!state) return null;
  const ownHand = state.players?.[seatIdFor(client)]?.hand ?? [];
  const drawableCount = Math.max(0, (state.boneyard?.length ?? 0) - (state.config?.deadTileCount ?? 0));
  if (ownHand.length !== 1 || drawableCount === 0) return null;

  const [tile] = ownHand;
  if (!tile) return null;

  const rawPositions = listRawPlayablePositions(state.board, tile);
  for (const position of rawPositions) {
    const move = { type: 'play', tile, position };
    const isForcedLike = tile.low === tile.high || computePlayScoreForMove(state, move) > 0;
    if (!isForcedLike) continue;
    const legalMoves = Array.isArray(payload?.legalMoves) ? payload.legalMoves : [];
    const legal = legalMoves.some(
      (candidate) =>
        candidate?.type === 'play' &&
        candidate?.position === position &&
        tileEquals(candidate?.tile, tile),
    );
    if (!legal) return move;
  }

  return null;
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

async function waitForAllConnectedClientsSequence(clients, minimumSequence) {
  await Promise.all(
    clients
      .filter((client) => client.socket.connected)
      .map((client) => waitForSequenceAtLeast(client, minimumSequence)),
  );
}

async function waitForAllConnectedClientsHandOver(clients) {
  const connectedClients = clients.filter((client) => client.socket.connected);
  await Promise.all(
    connectedClients.map((client) => {
      if (latestState(client)?.state?.handOver === true) return Promise.resolve(latestState(client));
      return onceWithTimeout(
        client.socket,
        'state:update',
        (payload) => payload?.state?.handOver === true,
      );
    }),
  );
  return latestState(connectedClients[0])?.state ?? null;
}

async function waitForTurnReady(clients) {
  const connectedClients = clients.filter((client) => client.socket.connected);
  const readyNow = () => {
    const referenceState = latestState(connectedClients[0])?.state;
    if (!referenceState) return false;
    if (referenceState.handOver || referenceState.gameOver) return true;
    const currentId = referenceState.playerIds?.[referenceState.currentPlayerIndex];
    const current = getClientBySeatId(connectedClients, currentId);
    if (!current) return false;
    const currentPayload = latestState(current);
    const legalMoves = Array.isArray(currentPayload?.legalMoves) ? currentPayload.legalMoves : [];
    return Boolean(
      currentPayload?.canDraw ||
        legalMoves.some((move) => move?.type === 'play' || move?.type === 'pass'),
    );
  };

  if (readyNow()) return latestState(connectedClients[0])?.state ?? null;
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await Promise.race([
      Promise.all(
        connectedClients.map((client) =>
          onceWithTimeout(client.socket, 'state:update', () => true, Math.max(100, SETTLE_MS * 2)),
        ),
      ).catch(() => null),
      delay(Math.max(100, SETTLE_MS)),
    ]);
    if (readyNow()) return latestState(connectedClients[0])?.state ?? null;
  }
  throw new Error('turn did not become playable/drawable/passable after post-MOVE sequencing');
}

async function waitForPlayableClient(clients, roomCode, maxSteps = 20) {
  for (let step = 0; step < maxSteps; step += 1) {
    const playable = getActivePlayer(clients);
    if (playable) return playable;

    const currentId = getCurrentPlayerId(clients[0]);
    const current = getClientBySeatId(clients, currentId);
    assert(current, 'could not identify current player while searching for playable move');
    const stateBefore = latestState(current)?.state;
    const canDrawNow = Boolean(latestState(current)?.canDraw);
    const hasPassMove = Array.isArray(latestState(current)?.legalMoves)
      ? latestState(current).legalMoves.some((move) => move?.type === 'pass')
      : false;
    if (!canDrawNow && !hasPassMove) break;
    const resp = await emitAck(
      current.socket,
      'game:action',
      roomCode,
      canDrawNow ? { type: 'DRAW' } : { type: 'PASS' },
    );
    assert(resp?.ok, `advance action failed while seeking play: ${resp?.error ?? 'unknown'}`);
    const targetSequence =
      typeof resp.sequence === 'number' ? resp.sequence : (stateBefore?.sequence ?? 0) + 1;
    await waitForAllConnectedClientsSequence(clients, targetSequence);
    await delay(SETTLE_MS);
  }
  return getActivePlayer(clients);
}

async function playUntilHandOver(clients, roomCode, maxIterations = 120) {
  const progressTail = [];
  let lastSequence = latestState(clients[0])?.state?.sequence ?? null;
  let consecutiveNoProgress = 0;

  const snapshotProgress = (iteration, client, state, action, resp, beforeSequence) => {
    const payload = latestState(client);
    const legalMoves = Array.isArray(payload?.legalMoves) ? payload.legalMoves : [];
    const handCounts = state?.handCounts ?? {};
    return {
      iteration,
      sequence: state?.sequence ?? null,
      beforeSequence,
      ackSequence: typeof resp?.sequence === 'number' ? resp.sequence : null,
      handNumber: state?.handNumber ?? null,
      currentPlayerId: state?.playerIds?.[state.currentPlayerIndex] ?? null,
      currentClient: client?.state?.label ?? null,
      legalMovesCount: legalMoves.length,
      hasPlay: legalMoves.some((move) => move?.type === 'play'),
      canDraw: Boolean(payload?.canDraw),
      hasPass: legalMoves.some((move) => move?.type === 'pass'),
      boneyardLength: state?.boneyard?.length ?? null,
      handCounts,
      actionType: action?.type ?? null,
      ackOk: Boolean(resp?.ok),
      ackError: resp?.error ?? null,
      boardTileCount: boardTileCount(state?.board),
      consecutiveNoProgress,
    };
  };

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const state = latestState(clients[0])?.state;
    if (state?.handOver) return state;
    assert(state, 'missing state while playing to hand over');

    const currentId = state.playerIds[state.currentPlayerIndex];
    const current = getClientBySeatId(clients, currentId);
    assert(current, 'could not identify current player while playing to hand over');

    const move = getPlayableMove(current);
    const action = move
      ? { type: 'MOVE', move: { tile: move.tile, position: move.position } }
      : latestState(current)?.canDraw
        ? { type: 'DRAW' }
        : { type: 'PASS' };
    const beforeSequence = latestState(current)?.state?.sequence ?? state.sequence;
    const resp = await emitAck(current.socket, 'game:action', roomCode, action);
    const diagnostic = snapshotProgress(iteration + 1, current, state, action, resp, beforeSequence);
    progressTail.push(diagnostic);
    if (progressTail.length > 8) progressTail.shift();
    assert(
      resp?.ok,
      `action failed while playing to hand over: ${resp?.error ?? 'unknown'}; recent=${JSON.stringify(progressTail)}`,
    );
    const targetSequence =
      typeof resp.sequence === 'number' ? resp.sequence : beforeSequence + 1;
    await waitForAllConnectedClientsSequence(clients, targetSequence);
    const afterSequence = latestState(clients[0])?.state?.sequence ?? null;
    if (afterSequence === lastSequence) {
      consecutiveNoProgress += 1;
    } else {
      consecutiveNoProgress = 0;
      lastSequence = afterSequence;
    }
    if (consecutiveNoProgress >= 5) {
      throw new Error(`No sequence progress while playing to hand over; recent=${JSON.stringify(progressTail)}`);
    }
    if (clients.some((client) => client.socket.connected && latestState(client)?.state?.handOver === true)) {
      return await waitForAllConnectedClientsHandOver(clients);
    }
    await waitForTurnReady(clients);
    await delay(50);
  }
  throw new Error(`Hand did not end after ${maxIterations} iterations; recent=${JSON.stringify(progressTail)}`);
}

function getActivePlayer(clients) {
  return clients.find((client) => getPlayableMove(client));
}

function getInactivePlayer(clients) {
  return clients.find((client) => !getPlayableMove(client));
}

async function startTwoPlayerGame(alpha, bravo, roomCode) {
  const alphaStateCountBeforeStart = alpha.state.stateUpdates.length;
  const bravoStateCountBeforeStart = bravo.state.stateUpdates.length;
  const alphaSpectateCountBeforeStart = alpha.state.spectateUpdates.length;
  const bravoSpectateCountBeforeStart = bravo.state.spectateUpdates.length;
  const guestReadyResp = await emitAck(bravo.socket, 'player:ready', roomCode);
  assert(guestReadyResp?.ok !== false, `guest player:ready failed: ${guestReadyResp?.error ?? 'unknown'}`);
  const startResp = await emitAck(alpha.socket, 'game:start', roomCode);
  assert(startResp?.ok, `game:start failed: ${startResp?.error ?? 'unknown'}`);
  const [alphaGameState, bravoGameState] = await Promise.all([
    waitForStateCount(alpha, alphaStateCountBeforeStart + 1, 'state:update'),
    waitForStateCount(bravo, bravoStateCountBeforeStart + 1, 'state:update'),
  ]);
  assert(alphaGameState?.state, 'alpha did not receive initial game state');
  assert(bravoGameState?.state, 'bravo did not receive initial game state');

  const alphaId = seatIdFor(alpha);
  const bravoId = seatIdFor(bravo);
  assert(alphaId && bravoId, 'socket ids missing after game start');

  assert(alphaGameState.state.players?.[alphaId]?.hand?.length === 7, 'alpha local hand was not revealed with 7 tiles');
  assert(alphaGameState.state.players?.[bravoId]?.hand?.length === 0, 'alpha received opponent hand during active play');
  assert(alphaGameState.state.handCounts?.[alphaId] === 7, 'alpha handCounts missing own count');
  assert(alphaGameState.state.handCounts?.[bravoId] === 7, 'alpha handCounts missing opponent count');

  assert(bravoGameState.state.players?.[bravoId]?.hand?.length === 7, 'bravo local hand was not revealed with 7 tiles');
  assert(bravoGameState.state.players?.[alphaId]?.hand?.length === 0, 'bravo received opponent hand during active play');
  assert(bravoGameState.state.handCounts?.[bravoId] === 7, 'bravo handCounts missing own count');
  assert(bravoGameState.state.handCounts?.[alphaId] === 7, 'bravo handCounts missing opponent count');

  await delay(SETTLE_MS);
  assert(
    alpha.state.spectateUpdates.length === alphaSpectateCountBeforeStart,
    'alpha received a spectator snapshot as a seated player',
  );
  assert(
    bravo.state.spectateUpdates.length === bravoSpectateCountBeforeStart,
    'bravo received a spectator snapshot as a seated player',
  );
}

async function scenarioLifecycleReconnect() {
  return withClients(
    [
      { label: 'alpha', userId: 'smoke-user-a', username: 'SmokeA' },
      { label: 'bravo', userId: 'smoke-user-b', username: 'SmokeB' },
      { label: 'spectator', userId: 'smoke-user-s', username: 'SmokeS' },
    ],
    async ({ alpha, bravo, spectator }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      captureJoinSeat(alpha, createResp);
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code from create');

      const bravoJoin = await emitAck(
        bravo.socket,
        'room:join',
        roomCode,
        { username: bravo.state.username, userId: bravo.state.userId },
      );
      assert(bravoJoin?.ok, 'bravo failed to join room');
      captureJoinSeat(bravo, bravoJoin);
      await waitForRoomCount(alpha, 2);

      const leaveResp = await emitAck(bravo.socket, 'room:leave', roomCode);
      assert(leaveResp?.ok, 'bravo leave ack failed');
      await waitForRoomCount(alpha, 1);

      const bravoRejoin = await emitAck(
        bravo.socket,
        'room:join',
        roomCode,
        { username: bravo.state.username, userId: bravo.state.userId },
      );
      assert(bravoRejoin?.ok, 'bravo failed to rejoin after leave');
      captureJoinSeat(bravo, bravoRejoin);
      const bravoSeatId = bravoRejoin.you;
      await waitForRoomCount(alpha, 2);

      const spectateBeforeStartResp = await emitAck(
        spectator.socket,
        'room:spectate',
        roomCode,
        { username: spectator.state.username, userId: spectator.state.userId },
      );
      assert(spectateBeforeStartResp?.ok, 'spectator failed to spectate room before start');

      const spectatorStart = await emitAck(spectator.socket, 'game:start', roomCode);
      assert(
        spectatorStart?.ok === false &&
          (/only room players/i.test(String(spectatorStart?.error ?? '')) ||
            /player seat not found/i.test(String(spectatorStart?.error ?? ''))),
        `spectator was allowed to start the game: ${spectatorStart?.error ?? 'unknown'}`,
      );

      const nonHostStart = await emitAck(bravo.socket, 'game:start', roomCode);
      assert(
        nonHostStart?.ok === false && /only the room host/i.test(String(nonHostStart?.error ?? '')),
        'non-host player was allowed to start the game',
      );

      await startTwoPlayerGame(alpha, bravo, roomCode);

      await waitForStateCount(spectator, 1, 'state:spectate');
      const initialSpectatorState = latestState(spectator, 'state:spectate');
      assert(initialSpectatorState?.state, 'spectator did not receive initial state snapshot');

      const currentFor = await waitForPlayableClient([alpha, bravo], roomCode);
      assert(currentFor, 'could not identify active player');
      const playMove = getPlayableMove(currentFor);
      assert(playMove, 'no playable move found for active player');

      const preSpectateCount = spectator.state.spectateUpdates.length;
      const moveResp = await emitAck(currentFor.socket, 'game:action', roomCode, {
        type: 'MOVE',
        move: {
          tile: playMove.tile,
          position: playMove.position,
        },
      });
      assert(moveResp?.ok, `game:action failed: ${moveResp?.error ?? 'unknown'}`);
      await waitForStateCount(spectator, preSpectateCount + 1, 'state:spectate');

      const bravoDisconnectedStateCount = bravo.state.stateUpdates.length;
      bravo.disconnect();
      await delay(250);

      const bravoReconnect = createClient('bravoReconnect', 'smoke-user-b', 'SmokeB');
      try {
        await bravoReconnect.connectAndIdentify();
        const rejoinResp = await emitAck(
          bravoReconnect.socket,
          'room:join',
          roomCode,
          { username: bravoReconnect.state.username, userId: bravoReconnect.state.userId },
        );
        assert(rejoinResp?.ok, `rejoin after disconnect failed: ${rejoinResp?.error ?? 'unknown'}`);
        assert(rejoinResp.you === bravoSeatId, 'rejoined seat id mismatch');
        captureJoinSeat(bravoReconnect, rejoinResp);
        assert(
          Array.isArray(rejoinResp.players) && rejoinResp.players.length === 2,
          'room did not remain at 2 players after reconnect',
        );
        assert(Array.isArray(rejoinResp.legalMoves), 'rejoin response missing legalMoves');
        assert(typeof rejoinResp.canDraw === 'boolean', 'rejoin response missing canDraw');

        await waitForRoomCount(alpha, 2);
        const latestAlphaRoster = latestRoomUpdate(alpha);
        assert(
          Array.isArray(latestAlphaRoster?.players) &&
            latestAlphaRoster.players.some(
              (player) => player.id === bravoSeatId && player.socketId === bravoReconnect.socket.id,
            ),
          'alpha roster did not migrate reconnect socket onto stable seat',
        );
        assert(
          alpha.state.stateUpdates.length > 0 && spectator.state.spectateUpdates.length > 0,
          'expected ongoing state updates during lifecycle scenario',
        );

        return {
          roomCode,
          checks: {
            createJoin: true,
            leaveRejoin: true,
            spectatorStartRejected: true,
            nonHostStartRejected: true,
            startGame: true,
            spectateUpdates: spectator.state.spectateUpdates.length > 0,
            reconnectMigration: true,
            bravoStateUpdatesBeforeDisconnect: bravoDisconnectedStateCount,
          },
        };
      } finally {
        bravoReconnect.disconnect();
      }
    },
  );
}

async function scenarioRoomSwitchCleanup() {
  return withClients(
    [
      { label: 'alpha', userId: 'switch-user-a', username: 'SwitchA' },
      { label: 'bravo', userId: 'switch-user-b', username: 'SwitchB' },
    ],
    async ({ alpha, bravo }) => {
      const roomOneResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(roomOneResp?.ok, 'alpha failed to create room one');
      const roomOne = roomOneResp.roomCode;
      assert(roomOne, 'missing room one code');

      const joinRoomOne = await emitAck(
        bravo.socket,
        'room:join',
        roomOne,
        { username: bravo.state.username, userId: bravo.state.userId },
      );
      assert(joinRoomOne?.ok, 'bravo failed to join room one');
      await waitForRoomCount(alpha, 2);

      const roomTwoResp = await emitAck(bravo.socket, 'room:create', {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(roomTwoResp?.ok, 'bravo failed to create room two');
      const roomTwo = roomTwoResp.roomCode;
      assert(roomTwo && roomTwo !== roomOne, 'room two code missing or duplicated');

      await waitForRoomCount(alpha, 1);
      const alphaRoster = latestRoomUpdate(alpha);
      assert(
        Array.isArray(alphaRoster?.players) &&
          alphaRoster.players.every((player) => player.userId !== bravo.state.userId),
        'room one still contains bravo after room switch',
      );

      const alphaCreateSecondRoom = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(alphaCreateSecondRoom?.ok, 'alpha failed to leave room one by creating room three');
      const roomThree = alphaCreateSecondRoom.roomCode;
      assert(roomThree && roomThree !== roomOne && roomThree !== roomTwo, 'room three code invalid');

      const bravoJoinRoomThree = await emitAck(
        bravo.socket,
        'room:join',
        roomThree,
        { username: bravo.state.username, userId: bravo.state.userId },
      );
      assert(bravoJoinRoomThree?.ok, 'bravo failed to join alpha after room switch');
      await waitForRoomCount(alpha, 2);

      return {
        roomOne,
        roomTwo,
        roomThree,
        checks: {
          roomSwitchRemovedGhostSeat: true,
          createMovesSocketBetweenRooms: true,
        },
      };
    },
  );
}

async function scenarioSeatMigrationAndSpectatorRejection() {
  return withClients(
    [
      { label: 'alpha', userId: 'migrate-user-a', username: 'MigrateA' },
      { label: 'bravo', userId: 'migrate-user-b', username: 'MigrateB' },
      { label: 'spectator', userId: 'migrate-user-s', username: 'MigrateS' },
    ],
    async ({ alpha, bravo, spectator }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      captureJoinSeat(alpha, createResp);
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code');

      const joinResp = await emitAck(
        bravo.socket,
        'room:join',
        roomCode,
        { username: bravo.state.username, userId: bravo.state.userId },
      );
      assert(joinResp?.ok, 'bravo failed to join');
      captureJoinSeat(bravo, joinResp);
      await waitForRoomCount(alpha, 2);
      await startTwoPlayerGame(alpha, bravo, roomCode);

      const spectatorJoin = await emitAck(
        spectator.socket,
        'room:spectate',
        roomCode,
        { username: spectator.state.username, userId: spectator.state.userId },
      );
      assert(spectatorJoin?.ok, 'spectator failed to join as spectator');

      const spectatorAction = await emitAck(spectator.socket, 'game:action', roomCode, {
        type: 'MOVE',
        move: { tile: { low: 0, high: 0 }, position: 'left' },
      });
      assert(
        spectatorAction?.ok === false &&
          (/spectators cannot act/i.test(String(spectatorAction?.error ?? '')) ||
            /player seat not found/i.test(String(spectatorAction?.error ?? ''))),
        `spectator action was not rejected: ${spectatorAction?.error ?? 'unknown'}`,
      );

      // Disconnect bravo first, otherwise silent theft is rejected
      bravo.disconnect();
      await delay(250);

      const bravoClone = createClient('bravoClone', 'migrate-user-b', 'MigrateB');
      try {
        await bravoClone.connectAndIdentify();
        const migrateResp = await emitAck(
          bravoClone.socket,
          'room:join',
          roomCode,
          { username: bravoClone.state.username, userId: bravoClone.state.userId },
        );
        assert(migrateResp?.ok, `same-user seat migration failed: ${migrateResp?.error ?? 'unknown'}`);
        assert(migrateResp.you === joinResp.you, 'migration did not preserve stable seat id');
        captureJoinSeat(bravoClone, migrateResp);

        await waitForRoomCount(alpha, 2);
        const alphaRoster = latestRoomUpdate(alpha);
        assert(
          Array.isArray(alphaRoster?.players) &&
            alphaRoster.players.some(
              (player) => player.id === joinResp.you && player.socketId === bravoClone.socket.id,
            ),
          'room roster did not map reconnect socket onto stable seat during migration',
        );

        await waitForSequenceAtLeast(bravoClone, migrateResp.state?.sequence ?? 0);
        const activeClient = await waitForPlayableClient([alpha, bravoClone], roomCode);
        const inactiveClient = getInactivePlayer([alpha, bravoClone]);
        assert(activeClient && inactiveClient, 'could not identify active/inactive players after migration');
        const inactiveMove = getPlayableMove(inactiveClient);
        assert(!inactiveMove, 'inactive player unexpectedly had a playable move payload');

        return {
          roomCode,
          checks: {
            spectatorRejected: true,
            seatMigrationReplacedOldSocket: true,
          },
        };
      } finally {
        bravoClone.disconnect();
      }
    },
  );
}

async function scenarioMidHandActionReliability() {
  return withClients(
    [
      { label: 'alpha', userId: 'action-user-a', username: 'ActionA' },
      { label: 'bravo', userId: 'action-user-b', username: 'ActionB' },
    ],
    async ({ alpha, bravo }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      captureJoinSeat(alpha, createResp);
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code');

      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'bravo failed to join');
      captureJoinSeat(bravo, joinResp);
      await waitForRoomCount(alpha, 2);
      await startTwoPlayerGame(alpha, bravo, roomCode);

      const firstActive = await waitForPlayableClient([alpha, bravo], roomCode);
      assert(firstActive, 'could not identify active player with legal play');
      const firstInactive = firstActive === alpha ? bravo : alpha;
      const firstMove = getPlayableMove(firstActive);
      assert(firstMove, 'active player had no legal play');

      const inactiveResp = await emitAck(firstInactive.socket, 'game:action', roomCode, {
        type: 'MOVE',
        move: { tile: firstMove.tile, position: firstMove.position },
      });
      assert(inactiveResp?.ok === false, 'inactive player action unexpectedly succeeded');

      const before = latestState(firstActive)?.state;
      const beforeSequence = before?.sequence ?? 0;
      const beforeBoardCount = boardTileCount(before?.board);
      const beforeHand = before?.players?.[seatIdFor(firstActive)]?.hand ?? [];
      assert(beforeHand.some((tile) => tileEquals(tile, firstMove.tile)), 'played tile missing before action');

      const playResp = await emitAck(firstActive.socket, 'game:action', roomCode, {
        type: 'MOVE',
        move: { tile: firstMove.tile, position: firstMove.position },
      });
      assert(playResp?.ok, `legal play failed: ${playResp?.error ?? 'unknown'}`);
      assert(
        typeof playResp.sequence === 'number' && playResp.sequence > beforeSequence,
        'legal play ack did not include an advanced sequence',
      );
      const afterUpdate = await waitForSequenceAtLeast(firstActive, playResp.sequence);
      const after = afterUpdate.state;
      const afterHand = after.players?.[seatIdFor(firstActive)]?.hand ?? [];
      assert(after.sequence > beforeSequence, 'state sequence did not increase after legal play');
      assert(boardTileCount(after.board) > beforeBoardCount, 'board did not change after legal play');
      assert(!afterHand.some((tile) => tileEquals(tile, firstMove.tile)), 'played tile remained in active hand');

      const duplicateResp = await emitAck(firstActive.socket, 'game:action', roomCode, {
        type: 'MOVE',
        move: { tile: firstMove.tile, position: firstMove.position },
      });
      assert(duplicateResp?.ok === false, 'duplicate action unexpectedly succeeded');
      const duplicateSequence = latestState(firstActive)?.state?.sequence;
      await delay(SETTLE_MS);
      assert(
        latestState(firstActive)?.state?.sequence === duplicateSequence,
        'duplicate rejected action changed authoritative sequence',
      );

      const reconnectTarget = await waitForPlayableClient([alpha, bravo], roomCode);
      assert(reconnectTarget, 'could not find playable active player before reconnect');
      const reconnectUser = {
        userId: reconnectTarget.state.userId,
        username: reconnectTarget.state.username,
        label: `${reconnectTarget.state.label}Reconnect`,
      };
      reconnectTarget.disconnect();
      await delay(250);

      const reconnected = createClient(reconnectUser.label, reconnectUser.userId, reconnectUser.username);
      try {
        await reconnected.connectAndIdentify();
        const rejoinResp = await emitAck(reconnected.socket, 'room:join', roomCode, {
          username: reconnectUser.username,
          userId: reconnectUser.userId,
        });
        assert(rejoinResp?.ok, `rejoin before action failed: ${rejoinResp?.error ?? 'unknown'}`);
        assert(rejoinResp.you === seatIdFor(reconnectTarget), 'rejoin did not preserve stable seat id');
        captureJoinSeat(reconnected, rejoinResp);
        assert(Array.isArray(rejoinResp.legalMoves), 'rejoin response missing legalMoves');

        const liveClients = reconnectTarget === alpha ? [reconnected, bravo] : [alpha, reconnected];
        await waitForRoomCount(liveClients.find((client) => client !== reconnected), 2);
        await waitForSequenceAtLeast(reconnected, rejoinResp.state?.sequence ?? 0);
        const reconnectedPlayable = await waitForPlayableClient(liveClients, roomCode);
        assert(reconnectedPlayable === reconnected, 'reconnected active player did not regain playable turn');
        const reconnectMove = getPlayableMove(reconnected);
        assert(reconnectMove, 'reconnected player missing legal move');
        const reconnectBefore = latestState(reconnected)?.state;
        const reconnectResp = await emitAck(reconnected.socket, 'game:action', roomCode, {
          type: 'MOVE',
          move: { tile: reconnectMove.tile, position: reconnectMove.position },
        });
        assert(reconnectResp?.ok, `reconnected legal action failed: ${reconnectResp?.error ?? 'unknown'}`);
        assert(
          typeof reconnectResp.sequence === 'number' &&
            reconnectResp.sequence > (reconnectBefore?.sequence ?? 0),
          'reconnected action ack did not advance sequence',
        );
        const reconnectAfter = await waitForSequenceAtLeast(reconnected, reconnectResp.sequence);
        assert(
          !((reconnectAfter.state.players?.[seatIdFor(reconnected)]?.hand ?? []).some((tile) =>
            tileEquals(tile, reconnectMove.tile),
          )),
          'reconnected played tile remained in hand',
        );

        return {
          roomCode,
          checks: {
            legalActionAckedWithSequence: true,
            legalActionRemovedTileAndChangedBoard: true,
            inactiveActionRejected: true,
            duplicateActionRejectedWithoutMutation: true,
            reconnectActionWorksAfterMigration: true,
          },
        };
      } finally {
        reconnected.disconnect();
      }
    },
  );
}

async function scenarioManualDrawActionGuards() {
  return withClients(
    [
      { label: 'alpha', userId: 'draw-guard-user-a', username: 'DrawGuardA' },
      { label: 'bravo', userId: 'draw-guard-user-b', username: 'DrawGuardB' },
    ],
    async ({ alpha, bravo }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code');

      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'bravo failed to join');
      await waitForRoomCount(alpha, 2);
      await startTwoPlayerGame(alpha, bravo, roomCode);

      let drawer = null;
      const clients = [alpha, bravo];
      for (let step = 0; step < 80; step += 1) {
        // Stop early if the hand ended before we found a draw window.
        const referenceState = latestState(alpha)?.state;
        if (referenceState?.handOver || referenceState?.gameOver) break;

        const currentId = getCurrentPlayerId(alpha);
        const current = getClientBySeatId(clients, currentId);
        assert(current, 'could not identify current player while seeking draw window');
        const hasPlayMove = Boolean(getPlayableMove(current));
        const canDrawNow = Boolean(latestState(current)?.canDraw);

        if (!hasPlayMove && canDrawNow) {
          // Found a draw window: player has no legal play but may draw from boneyard.
          drawer = current;
          break;
        }

        // Advance the game. There are three possible states here:
        //   hasPlayMove=true                   → play the move
        //   !hasPlayMove && canDrawNow=true    → handled above (draw window found)
        //   !hasPlayMove && canDrawNow=false   → boneyard locked, no matching tile; must PASS
        // The old code asserted hasPlayMove here, which was wrong: after atomic DRAW a
        // forced-draw can exhaust the drawable boneyard, leaving the opponent in a
        // no-play / no-draw / must-PASS state before any draw window has been seen.
        let action;
        if (hasPlayMove) {
          const move = getPlayableMove(current);
          action = { type: 'MOVE', move: { tile: move.tile, position: move.position } };
        } else {
          action = { type: 'PASS' };
        }
        const resp = await emitAck(current.socket, 'game:action', roomCode, action);
        assert(resp?.ok, `action failed while seeking draw window: ${resp?.error ?? 'unknown'}`);
        await waitForAllConnectedClientsSequence(clients, resp.sequence);
        await waitForTurnReady(clients);
      }

      assert(drawer, 'could not reach a manual DRAW opportunity');
      const other = drawer === alpha ? bravo : alpha;

      const actorAnimationCountBefore = drawer.state.drawAnimations.length;
      const otherAnimationCountBefore = other.state.drawAnimations.length;
      const drawResp = await emitAck(drawer.socket, 'game:action', roomCode, { type: 'DRAW' });
      assert(drawResp?.ok, `DRAW failed: ${drawResp?.error ?? 'unknown'}`);
      await waitForAllConnectedClientsSequence(clients, drawResp.sequence);

      const actorAfter = latestState(drawer);
      const otherAfter = latestState(other);
      // __drawSequenceActive removed from GameState: atomicity guaranteed structurally.
      assert(
        typeof drawResp.sequence === 'number' && drawResp.sequence === actorAfter?.state?.sequence,
        'manual DRAW ack sequence did not match final authoritative state',
      );

      const actorAnimation = await waitForDrawAnimationCount(drawer, actorAnimationCountBefore + 1);
      const otherAnimation = await waitForDrawAnimationCount(other, otherAnimationCountBefore + 1);
      assert(Array.isArray(actorAnimation?.steps) && actorAnimation.steps.length > 0, 'drawer missing draw animation steps');
      assert(Array.isArray(otherAnimation?.steps) && otherAnimation.steps.length === actorAnimation.steps.length, 'opponent missing draw animation steps');
      assert(
        actorAnimation.steps.every((step) => step?.tile),
        'drawer animation did not include drawn tile identities',
      );
      assert(
        otherAnimation.steps.every((step) => step?.tile == null),
        'opponent animation leaked drawn tile identity',
      );

      const duplicateDrawResp = await emitAck(drawer.socket, 'game:action', roomCode, { type: 'DRAW' });
      assert(duplicateDrawResp?.ok === false, 'duplicate manual DRAW unexpectedly succeeded after final state');
      await waitForTurnReady(clients);

      return {
        roomCode,
        checks: {
          manualDrawAckedFinalSequence: true,
          manualDrawDidNotSetDrawActive: true,
          manualDrawAnimationDelivered: true,
          manualDrawRejectedDuplicateFollowUp: true,
        },
      };
    },
  );
}

async function scenarioForcedDrawAtomicBehavior() {
  // Tests the current effective MOVE forced-draw behavior:
  // - if a legal forced-draw candidate is reachable, it resolves atomically
  // - if the engine blocks last-tile scoring/double go-out moves before they become legal,
  //   the MOVE rejects cleanly instead of the smoke wandering forever
  return withClients(
    [
      { label: 'alpha', userId: 'forced-draw-user-a', username: 'ForcedDrawA' },
      { label: 'bravo', userId: 'forced-draw-user-b', username: 'ForcedDrawB' },
    ],
    async ({ alpha, bravo }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code');

      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'bravo failed to join');
      await waitForRoomCount(alpha, 2);
      await startTwoPlayerGame(alpha, bravo, roomCode);

      const clients = [alpha, bravo];
      let legalCandidateAttempts = 0;
      let blockedCandidateAttempts = 0;
      let rematchAttempts = 0;

      for (let step = 0; step < 320; step += 1) {
        const referenceState = latestState(alpha)?.state;
        assert(referenceState, 'missing reference state while seeking forced-draw scenario');

        if (referenceState.gameOver) {
          if (rematchAttempts >= 6) break;
          const firstRematch = await emitAck(alpha.socket, 'game:rematch', roomCode);
          assert(firstRematch?.ok, `alpha rematch failed while seeking forced draw: ${firstRematch?.error ?? 'unknown'}`);
          const secondRematch = await emitAck(bravo.socket, 'game:rematch', roomCode);
          assert(secondRematch?.ok, `bravo rematch failed while seeking forced draw: ${secondRematch?.error ?? 'unknown'}`);
          await waitForAllConnectedClientsSequence(clients, referenceState.sequence + 1);
          await waitForTurnReady(clients);
          rematchAttempts += 1;
          continue;
        }

        if (referenceState.handOver) {
          const handNumber = referenceState.handNumber;
          const firstReady = await emitAck(alpha.socket, 'hand:ready', roomCode, handNumber);
          assert(firstReady?.ok, `alpha hand:ready failed while seeking forced draw: ${firstReady?.error ?? 'unknown'}`);
          const secondReady = await emitAck(bravo.socket, 'hand:ready', roomCode, handNumber);
          assert(secondReady?.ok, `bravo hand:ready failed while seeking forced draw: ${secondReady?.error ?? 'unknown'}`);
          await waitForAllConnectedClientsSequence(clients, referenceState.sequence + 1);
          await waitForTurnReady(clients);
          continue;
        }

        const currentId = getCurrentPlayerId(alpha);
        const actor = getClientBySeatId(clients, currentId);
        assert(actor, 'could not identify current player while seeking forced draw');

        const candidateMove = chooseForcedDrawSearchMove(actor);
        if (candidateMove && isForcedDrawCandidate(actor, candidateMove)) {
          legalCandidateAttempts += 1;
          const other = actor === alpha ? bravo : alpha;
          const beforeState = latestState(actor)?.state;
          assert(beforeState, 'missing actor state before forced-draw candidate');
          const actorAnimCountBefore = actor.state.drawAnimations.length;
          const otherAnimCountBefore = other.state.drawAnimations.length;

          const moveResp = await emitAck(actor.socket, 'game:action', roomCode, {
            type: 'MOVE',
            move: { tile: candidateMove.tile, position: candidateMove.position },
          });
          assert(moveResp?.ok, `forced-draw candidate MOVE failed: ${moveResp?.error ?? 'unknown'}`);
          assert(
            typeof moveResp.sequence === 'number' && moveResp.sequence > beforeState.sequence,
            'forced-draw ack sequence must be strictly greater than pre-MOVE sequence (atomic: ack carries post-draw sequence)',
          );

          // Wait for animation payloads and final state convergence.
          const [actorAnim, otherAnim] = await Promise.all([
            waitForDrawAnimationCount(actor, actorAnimCountBefore + 1),
            waitForDrawAnimationCount(other, otherAnimCountBefore + 1),
          ]);
          await waitForAllConnectedClientsSequence(clients, moveResp.sequence);
          await waitForTurnReady(clients);

          // Invariant: draw_animation mode must be 'forced_draw'.
          assert(actorAnim?.mode === 'forced_draw', `actor got draw_animation with wrong mode: ${actorAnim?.mode}`);
          assert(otherAnim?.mode === 'forced_draw', `opponent got draw_animation with wrong mode: ${otherAnim?.mode}`);

          // Invariant: actor receives tile identities, opponent receives nulls.
          const actorSteps = Array.isArray(actorAnim?.steps) ? actorAnim.steps : [];
          const otherSteps = Array.isArray(otherAnim?.steps) ? otherAnim.steps : [];
          assert(actorSteps.length > 0, 'forced-draw animation had zero steps for actor');
          assert(
            actorSteps[0]?.tile != null,
            'forced-draw actor did not receive tile identity in first step',
          );
          assert(
            otherSteps.every((s) => s?.tile == null),
            'forced-draw opponent received tile identity in draw_animation steps',
          );

          // Invariant: both clients converge on identical final state.
          // (__drawSequenceActive removed from GameState; atomicity is structural.)
          const finalAlpha = latestState(alpha);
          const finalBravo = latestState(bravo);
          assert(finalAlpha?.state && finalBravo?.state, 'missing final forced-draw state');
          assert(
            finalAlpha.state.sequence === finalBravo.state.sequence,
            `forced-draw clients ended on different sequences: ${finalAlpha.state.sequence} vs ${finalBravo.state.sequence}`,
          );
          assert(
            finalAlpha.state.sequence === moveResp.sequence,
            `forced-draw ack sequence ${moveResp.sequence} does not match final broadcast sequence ${finalAlpha.state.sequence}`,
          );
          assert(finalAlpha.state.handNumber === finalBravo.state.handNumber, 'forced-draw clients ended on different hands');
          assert(boardTileCount(finalAlpha.state.board) === boardTileCount(finalBravo.state.board), 'forced-draw final boards differed');

          // Invariant: current player has a legal next action.
          const finalCurrentId = finalAlpha.state.playerIds[finalAlpha.state.currentPlayerIndex];
          const finalCurrent = getClientBySeatId(clients, finalCurrentId);
          assert(finalCurrent, 'forced-draw final current player missing');
          const finalPayload = latestState(finalCurrent);
          const finalLegalMoves = Array.isArray(finalPayload?.legalMoves) ? finalPayload.legalMoves : [];
          assert(
            Boolean(finalPayload?.canDraw) || finalLegalMoves.some((move) => move?.type === 'play' || move?.type === 'pass'),
            'forced-draw final state did not expose a legal next action',
          );

          return {
            roomCode,
            checks: {
              forcedDrawDetectedAfterMove: true,
              forcedDrawAckCarriesPostDrawSequence: true,
              forcedDrawNeverSetDrawActiveFlag: true,
              forcedDrawEmittedDrawAnimation: true,
              forcedDrawMaskedOpponentTile: true,
              forcedDrawFinalStatesAligned: true,
              forcedDrawAckSequenceMatchesBroadcast: true,
              legalCandidateAttempts,
              blockedCandidateAttempts,
            },
          };
        }

        const hiddenForcedDrawMove = findHiddenForcedDrawLikeMove(actor);
        if (hiddenForcedDrawMove) {
          blockedCandidateAttempts += 1;
          assert(
            false,
            `last-tile scoring/double placement hidden from legalMoves: ${hiddenForcedDrawMove.tile.low}|${hiddenForcedDrawMove.tile.high} @ ${hiddenForcedDrawMove.position}`,
          );
        }

        const move = candidateMove ?? getPlayableMove(actor);
        if (move) {
          const resp = await emitAck(actor.socket, 'game:action', roomCode, {
            type: 'MOVE',
            move: { tile: move.tile, position: move.position },
          });
          assert(resp?.ok, `setup MOVE failed while seeking forced draw: ${resp?.error ?? 'unknown'}`);
          await waitForAllConnectedClientsSequence(clients, resp.sequence);
          await waitForTurnReady(clients);
          continue;
        }

        const payload = latestState(actor);
        const canDrawNow = Boolean(payload?.canDraw);
        const hasPass = Array.isArray(payload?.legalMoves) && payload.legalMoves.some((move) => move?.type === 'pass');
        const resp = await emitAck(actor.socket, 'game:action', roomCode, canDrawNow ? { type: 'DRAW' } : { type: 'PASS' });
        assert(resp?.ok, `advance action failed while seeking forced draw: ${resp?.error ?? 'unknown'}`);
        await waitForAllConnectedClientsSequence(clients, resp.sequence);
        await waitForTurnReady(clients);
        assert(canDrawNow || hasPass, 'forced-draw search reached a turn with no action available');
      }

      throw new Error(
        `could not reach a forced-draw or blocked forced-draw-like scenario; legalCandidateAttempts=${legalCandidateAttempts}; blockedCandidateAttempts=${blockedCandidateAttempts}; rematchAttempts=${rematchAttempts}`,
      );
    },
  );
}

async function assertPostMoveState(clients, actor, move, beforeState, ackSequence) {
  await waitForAllConnectedClientsSequence(clients, ackSequence);

  const beforeBoardCount = boardTileCount(beforeState.board);
  for (const client of clients.filter((entry) => entry.socket.connected)) {
    const payload = latestState(client);
    const state = payload?.state;
    assert(state, `${client.state.label} missing post-MOVE state`);
    assert(
      typeof state.sequence === 'number' && state.sequence >= ackSequence,
      `${client.state.label} did not reach MOVE ack sequence`,
    );
    assert(boardTileCount(state.board) > beforeBoardCount, `${client.state.label} board did not include played tile`);
    assert(
      state.playerIds?.includes(state.playerIds[state.currentPlayerIndex]),
      `${client.state.label} current player index is invalid`,
    );

    if (client === actor) {
      const ownHand = state.players?.[seatIdFor(actor)]?.hand ?? [];
      assert(!ownHand.some((tile) => tileEquals(tile, move.tile)), 'actor still sees played tile in own hand');
    } else if (!state.handOver && !state.gameOver) {
      const actorHand = state.players?.[seatIdFor(actor)]?.hand ?? [];
      assert(actorHand.length === 0, `${client.state.label} received actor hand during active play`);
    }

    const currentId = state.playerIds[state.currentPlayerIndex];
    const legalMoves = Array.isArray(payload?.legalMoves) ? payload.legalMoves : [];
    if (!state.handOver && !state.gameOver && seatIdFor(client) !== currentId) {
      assert(legalMoves.length === 0, `${client.state.label} received legal moves while inactive`);
      assert(payload?.canDraw === false, `${client.state.label} canDraw true while inactive`);
    }
    if (!state.handOver && !state.gameOver && seatIdFor(client) === currentId) {
      const hasPlay = legalMoves.some((legalMove) => legalMove?.type === 'play');
      const hasPass = legalMoves.some((legalMove) => legalMove?.type === 'pass');
      assert(!payload?.canDraw || !hasPlay, `${client.state.label} canDraw true while legal play exists`);
      assert(payload?.canDraw || hasPlay || hasPass, `${client.state.label} current turn has no action available`);
    }
  }

  await waitForTurnReady(clients);
}

async function scenarioPostMoveStability() {
  return withClients(
    [
      { label: 'alpha', userId: 'post-move-user-a', username: 'PostMoveA' },
      { label: 'bravo', userId: 'post-move-user-b', username: 'PostMoveB' },
    ],
    async ({ alpha, bravo }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code');

      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'bravo failed to join');
      await waitForRoomCount(alpha, 2);
      await startTwoPlayerGame(alpha, bravo, roomCode);

      const clients = [alpha, bravo];
      let movesChecked = 0;
      for (let step = 0; step < 8 && movesChecked < 5; step += 1) {
        const actor = await waitForPlayableClient(clients, roomCode);
        assert(actor, 'could not identify active player with legal play during post-MOVE stability');
        const move = getPlayableMove(actor);
        assert(move, 'active player did not have a playable move during post-MOVE stability');
        const beforeState = latestState(actor)?.state;
        assert(beforeState, 'missing actor state before post-MOVE stability action');
        assert(beforeState.playerIds[beforeState.currentPlayerIndex] === seatIdFor(actor), 'actor was not current player');
        assert(
          (beforeState.players?.[seatIdFor(actor)]?.hand ?? []).some((tile) => tileEquals(tile, move.tile)),
          'actor did not have selected tile before post-MOVE stability action',
        );

        const resp = await emitAck(actor.socket, 'game:action', roomCode, {
          type: 'MOVE',
          move: { tile: move.tile, position: move.position },
        });
        assert(resp?.ok, `post-MOVE legal action failed: ${resp?.error ?? 'unknown'}`);
        assert(
          typeof resp.sequence === 'number' && resp.sequence > beforeState.sequence,
          'post-MOVE ack missing accepted placement sequence',
        );
        await assertPostMoveState(clients, actor, move, beforeState, resp.sequence);
        movesChecked += 1;
        if (latestState(actor)?.state?.handOver) break;
      }

      assert(movesChecked >= 3, `post-MOVE stability checked too few moves: ${movesChecked}`);

      const staleActor = await waitForPlayableClient(clients, roomCode);
      assert(staleActor, 'could not identify active player for stale MOVE rejection');
      const staleMove = getPlayableMove(staleActor);
      assert(staleMove, 'active player missing stale MOVE candidate');
      const staleBefore = latestState(staleActor)?.state;
      assert(staleBefore, 'missing stale MOVE setup state');
      const staleResp = await emitAck(staleActor.socket, 'game:action', roomCode, {
        type: 'MOVE',
        move: { tile: staleMove.tile, position: staleMove.position },
      });
      assert(staleResp?.ok, `stale setup MOVE failed: ${staleResp?.error ?? 'unknown'}`);
      await waitForAllConnectedClientsSequence(clients, staleResp.sequence);
      await waitForTurnReady(clients);

      const duplicateSequenceBefore = Math.max(
        ...clients.map((client) => latestState(client)?.state?.sequence ?? staleBefore.sequence),
      );
      const duplicateResp = await emitAck(staleActor.socket, 'game:action', roomCode, {
        type: 'MOVE',
        move: { tile: staleMove.tile, position: staleMove.position },
      });
      assert(duplicateResp?.ok === false, 'stale duplicate MOVE unexpectedly succeeded');
      await delay(SETTLE_MS);
      const duplicateSequenceAfter = Math.max(
        ...clients.map((client) => latestState(client)?.state?.sequence ?? duplicateSequenceBefore),
      );
      assert(
        duplicateSequenceAfter === duplicateSequenceBefore,
        'stale duplicate MOVE mutated authoritative sequence',
      );

      return {
        roomCode,
        checks: {
          repeatedMoveAcksHaveSequence: true,
          repeatedMovesReachBothClients: true,
          playedTilesRemovedFromActorHand: true,
          inactiveHandsRemainMasked: true,
          staleMoveRejectedWithoutMutation: true,
        },
      };
    },
  );
}

async function scenarioStartAndHandReadyGuards() {
  return withClients(
    [
      { label: 'alpha', userId: 'ready-user-a', username: 'ReadyA' },
      { label: 'bravo', userId: 'ready-user-b', username: 'ReadyB' },
    ],
    async ({ alpha, bravo }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code');

      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'bravo failed to join');
      await waitForRoomCount(alpha, 2);
      await startTwoPlayerGame(alpha, bravo, roomCode);

      const activeStartState = latestState(alpha)?.state;
      assert(activeStartState && !activeStartState.handOver, 'game did not start active hand');
      const duplicateStart = await emitAck(alpha.socket, 'game:start', roomCode);
      assert(duplicateStart?.ok === false, 'game:start reset or accepted an active match');
      assert(
        latestState(alpha)?.state?.handNumber === activeStartState.handNumber,
        'duplicate game:start changed hand number',
      );

      const handOverState = await playUntilHandOver([alpha, bravo], roomCode);
      assert(handOverState.handOver && !handOverState.gameOver, 'expected hand over before game over');
      const handOverHandNumber = handOverState.handNumber;

      const startDuringHandOver = await emitAck(alpha.socket, 'game:start', roomCode);
      assert(startDuringHandOver?.ok === false, 'game:start reset or accepted a hand-over match');
      assert(
        latestState(alpha)?.state?.handNumber === handOverHandNumber,
        'game:start during hand over changed hand number',
      );

      const staleReady = await emitAck(alpha.socket, 'hand:ready', roomCode, handOverHandNumber - 1);
      assert(staleReady?.ok === false && staleReady?.ignored, 'stale hand:ready was not ignored');
      assert(latestState(alpha)?.state?.handOver, 'stale hand:ready advanced the hand');

      const firstReady = await emitAck(alpha.socket, 'hand:ready', roomCode, handOverHandNumber);
      assert(firstReady?.ok && firstReady.started === false, 'first hand:ready should not start next hand alone');

      const secondReady = await emitAck(bravo.socket, 'hand:ready', roomCode, handOverHandNumber);
      assert(secondReady?.ok && secondReady.started === false, 'second current hand:ready should schedule next hand');
      assert(
        typeof secondReady.waitMs === 'number' && secondReady.waitMs >= 2000,
        `hand:ready did not report a meaningful server-side hold, got ${secondReady.waitMs}`,
      );
      await waitForAllConnectedClientsSequence([alpha, bravo], handOverState.sequence + 1);
      const nextState = latestState(alpha)?.state;
      assert(nextState?.handNumber === handOverHandNumber + 1, 'next hand did not start after both ready');
      assert(!nextState?.handOver, 'next hand state still marked handOver');

      return {
        roomCode,
        checks: {
          duplicateStartRejectedActive: true,
          duplicateStartRejectedHandOver: true,
          staleHandReadyIgnored: true,
          handReadyRequiresBothPlayers: true,
          handReadyHasServerHold: true,
        },
      };
    },
  );
}

async function scenarioTokenlessUuidClaimRejected() {
  return withClients(
    [
      {
        label: 'claimer',
        userId: 'uuid-claim-smoke',
        username: 'UuidClaim',
      },
    ],
    async ({ claimer }) => {
      const createResp = await emitAck(claimer.socket, 'room:create', {
        username: claimer.state.username,
        userId: '11111111-1111-4111-8111-111111111111',
      });
      assert(createResp?.ok, 'uuid claimer failed to create room');
      assert(
        Array.isArray(createResp.players) && createResp.players[0]?.userId === null,
        'tokenless UUID userId claim was trusted',
      );
      return {
        roomCode: createResp.roomCode,
        checks: {
          tokenlessUuidClaimRejected: true,
        },
      };
    },
  );
}

async function scenarioGuestSeatReconnect() {
  return withClients(
    [
      { label: 'host', userId: 'guest_smoke_host', username: 'Guest' },
      { label: 'guest', userId: 'guest_smoke_player', username: 'Guest' },
    ],
    async ({ host, guest }) => {
      const createResp = await emitAck(host.socket, 'room:create', {
        username: host.state.username,
        userId: host.state.userId,
      });
      assert(createResp?.ok, 'guest host failed to create room');
      captureJoinSeat(host, createResp);
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code');

      const joinResp = await emitAck(
        guest.socket,
        'room:join',
        roomCode,
        { username: guest.state.username, userId: guest.state.userId },
      );
      assert(joinResp?.ok, 'generic guest failed initial join');
      captureJoinSeat(guest, joinResp);
      await waitForRoomCount(host, 2);
      await startTwoPlayerGame(host, guest, roomCode);

      guest.disconnect();
      await delay(250);

      const guestReconnect = createClient('guestReconnect', 'guest_smoke_player', 'Guest');
      try {
        await guestReconnect.connectAndIdentify();
        const rejoinResp = await emitAck(
          guestReconnect.socket,
          'room:join',
          roomCode,
          { username: guestReconnect.state.username, userId: guestReconnect.state.userId },
        );
        assert(rejoinResp?.ok, `generic guest reconnect failed: ${rejoinResp?.error ?? 'unknown'}`);
        assert(rejoinResp.you === joinResp.you, 'generic guest reconnect seat id mismatch');
        captureJoinSeat(guestReconnect, rejoinResp);
        assert(
          Array.isArray(rejoinResp.players) &&
            rejoinResp.players.some(
              (player) => player.id === joinResp.you && player.userId === 'guest_smoke_player',
            ),
          'generic guest seat was not preserved on reconnect',
        );
        assert(
          rejoinResp.state?.players?.[joinResp.you]?.hand?.length === 7 ||
            Array.isArray(rejoinResp.state?.players?.[joinResp.you]?.hand),
          'generic guest reconnect did not receive local player state',
        );
        return {
          roomCode,
          checks: {
            stableGuestIdentityReconnect: true,
          },
        };
      } finally {
        guestReconnect.disconnect();
      }
    },
  );
}

async function scenarioHandEndedReplay() {
  return withClients(
    [
      { label: 'alpha', userId: 'replay-user-a', username: 'ReplayA' },
      { label: 'bravo', userId: 'replay-user-b', username: 'ReplayB' },
    ],
    async ({ alpha, bravo }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      const roomCode = createResp.roomCode;

      await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      await waitForRoomCount(alpha, 2);
      await startTwoPlayerGame(alpha, bravo, roomCode);

      const finalState = await playUntilHandOver([alpha, bravo], roomCode);
      assert(finalState?.handOver, 'Hand did not end before replay check');
      assert(!finalState?.gameOver, 'Game ended prematurely (unlikely with default scores)');

      // Now bravo disconnects and rejoins
      bravo.disconnect();
      await delay(200);

      const bravoRejoin = createClient('bravoRejoin', 'replay-user-b', 'ReplayB');
      try {
        await bravoRejoin.connectAndIdentify();

        // Prepare to catch hand:ended
        const handEndedPromise = onceWithTimeout(bravoRejoin.socket, 'hand:ended');

        const rejoinResp = await emitAck(
          bravoRejoin.socket,
          'room:join',
          roomCode,
          { username: bravoRejoin.state.username, userId: bravoRejoin.state.userId },
        );
        assert(rejoinResp?.ok, 'bravo failed to rejoin');

        const handEnded = await handEndedPromise;
        assert(handEnded.handNumber === finalState.handNumber, 'Replayed handNumber mismatch');
        assert(Array.isArray(handEnded.yourRemainingTiles), 'Missing yourRemainingTiles');
        assert(Array.isArray(handEnded.opponentRemainingTiles), 'Missing opponentRemainingTiles');
        assert(handEnded.pointsAwarded, 'Missing pointsAwarded');
        assert(handEnded.winnerId !== undefined, 'Missing winnerId');

        return {
          roomCode,
          checks: {
            handEndedReplayedOnJoin: true,
            personalizedPayloadCorrect: true,
          },
        };
      } finally {
        bravoRejoin.disconnect();
      }
    },
  );
}

async function scenarioIdentityFreeze() {
  return withClients(
    [
      { label: 'alpha', userId: 'freeze-user-a', username: 'FreezeA' },
      { label: 'bravo', userId: 'freeze-user-b', username: 'FreezeB' },
    ],
    async ({ alpha, bravo }) => {
      // 1. Alpha creates room
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      const roomCode = createResp.roomCode;

      // 2. Bravo joins
      const joinResp = await emitAck(
        bravo.socket,
        'room:join',
        roomCode,
        { username: bravo.state.username, userId: bravo.state.userId },
      );
      assert(joinResp?.ok, 'bravo failed to join room');
      await waitForRoomCount(alpha, 2);

      // 3. Bravo disconnects
      bravo.disconnect();
      await delay(250);

      // 4. PROVE: Reconnecting with a DIFFERENT identity fails (server rejects change in full room)
      const bravoEvil = createClient('bravoEvil', 'evil-id', 'FreezeB');
      try {
        await bravoEvil.connectAndIdentify();
        const rejoinResp = await emitAck(
          bravoEvil.socket,
          'room:join',
          roomCode,
          { username: 'FreezeB', userId: 'evil-id' },
        );
        assert(!rejoinResp?.ok, 'Server unexpectedly allowed identity change in full room');
        assert(
          /full/i.test(rejoinResp?.error ?? ''),
          `Expected "full" error for identity change, got: ${rejoinResp?.error}`,
        );
      } finally {
        bravoEvil.disconnect();
      }

      // 5. PROVE: Reconnecting with the ORIGINAL identity succeeds (frozen identity logic)
      const bravoReconnect = createClient('bravoReconnect', 'freeze-user-b', 'FreezeB');
      try {
        await bravoReconnect.connectAndIdentify();
        const rejoinResp = await emitAck(
          bravoReconnect.socket,
          'room:join',
          roomCode,
          { username: 'FreezeB', userId: 'freeze-user-b' },
        );
        assert(rejoinResp?.ok, `Rejoin with original identity failed: ${rejoinResp?.error}`);
        assert(rejoinResp.players.length === 2, 'Room player count mismatch');
      } finally {
        bravoReconnect.disconnect();
      }

      return {
        roomCode,
        checks: {
          serverRejectsChangedIdentity: true,
          serverAcceptsOriginalIdentity: true,
          identityFreezeNecessary: true,
        },
      };
    },
  );
}

async function scenarioSameUserActiveSeatTakeover() {
  return withClients(
    [
      { label: 'alpha', userId: 'same-user-a', username: 'Alpha' },
      { label: 'bravo', userId: 'user-b', username: 'Bravo' },
    ],
    async ({ alpha, bravo }) => {
      // 1. Alpha creates room
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      captureJoinSeat(alpha, createResp);
      const roomCode = createResp.roomCode;

      // 2. Bravo joins so room is full
      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'bravo failed to join room');
      captureJoinSeat(bravo, joinResp);
      await waitForRoomCount(alpha, 2);

      await startTwoPlayerGame(alpha, bravo, roomCode);

      // 3. alpha2 connects with SAME userId while alpha is still connected
      const alpha2 = createClient('alpha2', 'same-user-a', 'Alpha');
      try {
        await alpha2.connectAndIdentify();

        // 4. alpha2 attempts room:join while alpha is still connected — server supersedes old socket
        const join2Resp = await emitAck(alpha2.socket, 'room:join', roomCode, {
          username: 'Alpha',
          userId: 'same-user-a',
        });
        assert(join2Resp?.ok, `alpha2 supersede join failed: ${join2Resp?.error ?? 'unknown'}`);
        assert(join2Resp.you === seatIdFor(alpha), 'alpha2 should inherit the stable host seat');
        captureJoinSeat(alpha2, join2Resp);

        // 5. Original alpha socket was superseded; disconnect it cleanly
        alpha.disconnect();
        await delay(250);

        // 6. alpha2 can still play from the migrated seat after supersede
        const alpha2State = latestState(alpha2);
        assert(
          alpha2State?.state?.playerIds.includes(seatIdFor(alpha2)),
          'alpha2 should still own the host seat after supersede',
        );
      } finally {
        alpha2.disconnect();
      }

      return {
        roomCode,
        checks: {
          sameUserSupersedeJoinWorks: true,
          seatPreservedAfterSupersede: true,
        },
      };
    },
  );
}

async function scenarioHandMaskingAfterMove() {
  return withClients(
    [
      { label: 'alpha', userId: 'mask-user-a', username: 'MaskA' },
      { label: 'bravo', userId: 'mask-user-b', username: 'MaskB' },
    ],
    async ({ alpha, bravo }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      captureJoinSeat(alpha, createResp);
      const roomCode = createResp.roomCode;

      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'bravo failed to join');
      captureJoinSeat(bravo, joinResp);
      await waitForRoomCount(alpha, 2);
      await startTwoPlayerGame(alpha, bravo, roomCode);

      const active = await waitForPlayableClient([alpha, bravo], roomCode);
      const inactive = active === alpha ? bravo : alpha;
      const move = getPlayableMove(active);
      assert(move, 'active player missing legal move');

      const playResp = await emitAck(active.socket, 'game:action', roomCode, {
        type: 'MOVE',
        move: { tile: move.tile, position: move.position },
      });
      assert(playResp?.ok, `legal move failed: ${playResp?.error ?? 'unknown'}`);
      await waitForSequenceAtLeast(active, playResp.sequence);
      await waitForSequenceAtLeast(inactive, playResp.sequence);

      const activeState = latestState(active)?.state;
      const inactiveState = latestState(inactive)?.state;
      const activeSeat = seatIdFor(active);
      const inactiveSeat = seatIdFor(inactive);

      assert(activeState?.handOver !== true && activeState?.gameOver !== true, 'expected active mid-hand state');
      assert(activeState?.players?.[activeSeat]?.hand?.length >= 0, 'active player missing own hand array');
      assert(inactiveState?.players?.[inactiveSeat]?.hand?.length >= 0, 'inactive player missing own hand array');
      assert(
        (activeState?.players?.[inactiveSeat]?.hand ?? []).length === 0,
        'active player received opponent hidden hand after move',
      );
      assert(
        (inactiveState?.players?.[activeSeat]?.hand ?? []).length === 0,
        'inactive player received opponent hidden hand after move',
      );

      return {
        roomCode,
        checks: {
          opponentHandsHiddenAfterMove: true,
        },
      };
    },
  );
}

async function scenarioConcurrentActionSerialization() {
  return withClients(
    [
      { label: 'alpha', userId: 'serial-user-a', username: 'SerialA' },
      { label: 'bravo', userId: 'serial-user-b', username: 'SerialB' },
    ],
    async ({ alpha, bravo }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'alpha failed to create room');
      captureJoinSeat(alpha, createResp);
      const roomCode = createResp.roomCode;

      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'bravo failed to join');
      captureJoinSeat(bravo, joinResp);
      await waitForRoomCount(alpha, 2);
      await startTwoPlayerGame(alpha, bravo, roomCode);

      const active = await waitForPlayableClient([alpha, bravo], roomCode);
      const move = getPlayableMove(active);
      assert(move, 'active player missing legal move');
      const beforeSequence = latestState(active)?.state?.sequence ?? 0;
      const payload = { type: 'MOVE', move: { tile: move.tile, position: move.position } };

      const [respA, respB] = await Promise.all([
        emitAck(active.socket, 'game:action', roomCode, payload),
        emitAck(active.socket, 'game:action', roomCode, payload),
      ]);

      const okCount = [respA, respB].filter((resp) => resp?.ok === true).length;
      const failCount = [respA, respB].filter((resp) => resp?.ok === false).length;
      assert(okCount === 1, `expected exactly one concurrent action success, got ${okCount}`);
      assert(failCount === 1, `expected exactly one concurrent action failure, got ${failCount}`);

      await delay(SETTLE_MS);
      const afterSequence = latestState(active)?.state?.sequence ?? 0;
      assert(afterSequence === beforeSequence + 1, 'concurrent actions advanced sequence more than once');

      return {
        roomCode,
        checks: {
          singleSuccessOnConcurrentDuplicate: true,
          sequenceAdvancedOnce: true,
        },
      };
    },
  );
}

async function scenarioPrivateCreateJoinStartMove() {
  return withClients(
    [
      { label: 'alpha', userId: 'private-user-a', username: 'PrivateA' },
      { label: 'bravo', userId: 'private-user-b', username: 'PrivateB' },
    ],
    async ({ alpha, bravo }) => {
      const createResp = await emitAck(alpha.socket, 'room:create', {
        username: alpha.state.username,
        userId: alpha.state.userId,
      });
      assert(createResp?.ok, 'host failed to create private room');
      captureJoinSeat(alpha, createResp);
      const roomCode = createResp.roomCode;

      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'guest failed to join private room');
      captureJoinSeat(bravo, joinResp);
      await waitForRoomCount(alpha, 2);

      await emitAck(bravo.socket, 'player:ready', roomCode);
      const startResp = await emitAck(alpha.socket, 'game:start', roomCode);
      assert(startResp?.ok, `host start failed: ${startResp?.error ?? 'unknown'}`);

      await waitForStateCount(alpha, 1);
      await waitForStateCount(bravo, 1);

      const active = await waitForPlayableClient([alpha, bravo], roomCode);
      const inactive = active === alpha ? bravo : alpha;
      const move = getPlayableMove(active);
      assert(move, 'active player missing legal move');

      const wrongTurn = await emitAck(inactive.socket, 'game:action', roomCode, {
        type: 'MOVE',
        move: { tile: move.tile, position: move.position },
      });
      assert(wrongTurn?.ok === false, 'wrong-turn move unexpectedly succeeded');

      const beforeSequence = latestState(active)?.state?.sequence ?? 0;
      const playResp = await emitAck(active.socket, 'game:action', roomCode, {
        type: 'MOVE',
        move: { tile: move.tile, position: move.position },
      });
      assert(playResp?.ok, `legal move failed: ${playResp?.error ?? 'unknown'}`);
      await waitForSequenceAtLeast(alpha, playResp.sequence);
      await waitForSequenceAtLeast(bravo, playResp.sequence);
      assert(
        latestState(alpha)?.state?.sequence === latestState(bravo)?.state?.sequence,
        'players diverged after legal move',
      );
      assert(latestState(alpha)?.state?.sequence > beforeSequence, 'sequence did not advance');

      return {
        roomCode,
        checks: {
          privateCreateJoinStartMove: true,
          wrongTurnRejected: true,
          bothClientsSynced: true,
        },
      };
    },
  );
}

const scenarios = [
  { name: 'private-create-join-start-move', run: scenarioPrivateCreateJoinStartMove },
  { name: 'hand-masking-after-move', run: scenarioHandMaskingAfterMove },
  { name: 'concurrent-action-serialization', run: scenarioConcurrentActionSerialization },
  { name: 'lifecycle-reconnect', run: scenarioLifecycleReconnect },
  { name: 'room-switch-cleanup', run: scenarioRoomSwitchCleanup },
  { name: 'seat-migration-and-spectator-rejection', run: scenarioSeatMigrationAndSpectatorRejection },
  { name: 'mid-hand-action-reliability', run: scenarioMidHandActionReliability },
  { name: 'manual-draw-action-guards', run: scenarioManualDrawActionGuards },
  { name: 'forced-draw-atomic-behavior', run: scenarioForcedDrawAtomicBehavior },
  { name: 'post-move-stability', run: scenarioPostMoveStability },
  { name: 'start-and-hand-ready-guards', run: scenarioStartAndHandReadyGuards },
  { name: 'guest-seat-reconnect', run: scenarioGuestSeatReconnect },
  { name: 'tokenless-uuid-claim-rejected', run: scenarioTokenlessUuidClaimRejected },
  { name: 'hand-ended-replay', run: scenarioHandEndedReplay },
  { name: 'identity-freeze', run: scenarioIdentityFreeze },
  { name: 'same-user-active-seat-takeover', run: scenarioSameUserActiveSeatTakeover },
];

const SCENARIO_FILTER = process.env.SMOKE_ONLY?.split(',').map((name) => name.trim()).filter(Boolean);

async function main() {
  await waitForServerReady();
  const results = [];
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration += 1) {
    for (const scenario of scenarios) {
      if (SCENARIO_FILTER?.length && !SCENARIO_FILTER.includes(scenario.name)) {
        continue;
      }
      const startedAt = Date.now();
      let result;
      try {
        result = await scenario.run();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`[${scenario.name}][iteration ${iteration}] ${detail}`);
      }
      results.push({
        iteration,
        scenario: scenario.name,
        durationMs: Date.now() - startedAt,
        ...result,
      });
      await delay(SETTLE_MS);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        serverUrl: SERVER_URL,
        repeatCount: REPEAT_COUNT,
        settleMs: SETTLE_MS,
        scenarios: results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[socketSmoke] FAILED', error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
