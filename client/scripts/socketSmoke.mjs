import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { io } from 'socket.io-client';

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
    roomUpdates: [],
    stateUpdates: [],
    spectateUpdates: [],
    drawAnimations: [],
    connectErrors: [],
  };

  socket.on('room:update', (payload) => state.roomUpdates.push(payload));
  socket.on('state:update', (payload) => state.stateUpdates.push(payload));
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

function getClientBySocketId(clients, socketId) {
  return clients.find((client) => client.socket.id === socketId) ?? null;
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
    const current = getClientBySocketId(connectedClients, currentId);
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

async function waitForDrawActiveState(client, active) {
  const already = latestState(client)?.state?.__drawSequenceActive;
  if (already === active) return latestState(client);
  return onceWithTimeout(
    client.socket,
    'state:update',
    (payload) => payload?.state?.__drawSequenceActive === active,
  );
}

async function waitForPlayableClient(clients, roomCode, maxSteps = 20) {
  for (let step = 0; step < maxSteps; step += 1) {
    const playable = getActivePlayer(clients);
    if (playable) return playable;

    const currentId = getCurrentPlayerId(clients[0]);
    const current = getClientBySocketId(clients, currentId);
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
    const current = getClientBySocketId(clients, currentId);
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
  const startResp = await emitAck(alpha.socket, 'game:start', roomCode);
  assert(startResp?.ok, `game:start failed: ${startResp?.error ?? 'unknown'}`);
  const [alphaGameState, bravoGameState] = await Promise.all([
    waitForStateCount(alpha, alphaStateCountBeforeStart + 1, 'state:update'),
    waitForStateCount(bravo, bravoStateCountBeforeStart + 1, 'state:update'),
  ]);
  assert(alphaGameState?.state, 'alpha did not receive initial game state');
  assert(bravoGameState?.state, 'bravo did not receive initial game state');

  const alphaId = alpha.socket.id;
  const bravoId = bravo.socket.id;
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
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code from create');

      const bravoJoin = await emitAck(
        bravo.socket,
        'room:join',
        roomCode,
        { username: bravo.state.username, userId: bravo.state.userId },
      );
      assert(bravoJoin?.ok, 'bravo failed to join room');
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
        spectatorStart?.ok === false && /only room players/i.test(String(spectatorStart?.error ?? '')),
        'spectator was allowed to start the game',
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
        assert(rejoinResp.you === bravoReconnect.socket.id, 'rejoined socket id mismatch');
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
            latestAlphaRoster.players.some((player) => player.id === bravoReconnect.socket.id),
          'alpha roster did not migrate to bravo reconnect socket',
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
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code');

      const joinResp = await emitAck(
        bravo.socket,
        'room:join',
        roomCode,
        { username: bravo.state.username, userId: bravo.state.userId },
      );
      assert(joinResp?.ok, 'bravo failed to join');
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
        spectatorAction?.ok === false && /spectators cannot act/i.test(String(spectatorAction?.error ?? '')),
        'spectator action was not rejected',
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
        assert(migrateResp.you === bravoClone.socket.id, 'migration did not bind new socket id');

        await waitForRoomCount(alpha, 2);
        const alphaRoster = latestRoomUpdate(alpha);
        assert(
          Array.isArray(alphaRoster?.players) &&
            alphaRoster.players.some((player) => player.id === bravoClone.socket.id),
          'room roster did not replace old bravo socket id during migration',
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
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code');

      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'bravo failed to join');
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
      const beforeHand = before?.players?.[firstActive.socket.id]?.hand ?? [];
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
      const afterHand = after.players?.[firstActive.socket.id]?.hand ?? [];
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
        assert(rejoinResp.you === reconnected.socket.id, 'rejoin did not bind new socket id');
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
          !((reconnectAfter.state.players?.[reconnected.socket.id]?.hand ?? []).some((tile) =>
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

async function scenarioDrawActiveActionGuards() {
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
      for (let step = 0; step < 30; step += 1) {
        const currentId = getCurrentPlayerId(alpha);
        const current = getClientBySocketId(clients, currentId);
        assert(current, 'could not identify current player while seeking draw window');
        const hasPlayMove = Boolean(getPlayableMove(current));
        const canDrawNow = Boolean(latestState(current)?.canDraw);
        if (!hasPlayMove && canDrawNow) {
          drawer = current;
          break;
        }

        assert(hasPlayMove, 'expected a playable move before reaching a draw window');
        const move = getPlayableMove(current);
        const resp = await emitAck(current.socket, 'game:action', roomCode, {
          type: 'MOVE',
          move: { tile: move.tile, position: move.position },
        });
        assert(resp?.ok, `setup MOVE failed while seeking draw window: ${resp?.error ?? 'unknown'}`);
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
      assert(actorAfter?.state?.__drawSequenceActive !== true, 'manual DRAW left drawer in draw-active');
      assert(otherAfter?.state?.__drawSequenceActive !== true, 'manual DRAW left opponent in draw-active');
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
      const ownHand = state.players?.[actor.socket.id]?.hand ?? [];
      assert(!ownHand.some((tile) => tileEquals(tile, move.tile)), 'actor still sees played tile in own hand');
    } else if (!state.handOver && !state.gameOver) {
      const actorHand = state.players?.[actor.socket.id]?.hand ?? [];
      assert(actorHand.length === 0, `${client.state.label} received actor hand during active play`);
    }

    const currentId = state.playerIds[state.currentPlayerIndex];
    const legalMoves = Array.isArray(payload?.legalMoves) ? payload.legalMoves : [];
    if (!state.handOver && !state.gameOver && client.socket.id !== currentId) {
      assert(legalMoves.length === 0, `${client.state.label} received legal moves while inactive`);
      assert(payload?.canDraw === false, `${client.state.label} canDraw true while inactive`);
    }
    if (!state.handOver && !state.gameOver && client.socket.id === currentId) {
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
        assert(beforeState.playerIds[beforeState.currentPlayerIndex] === actor.socket.id, 'actor was not current player');
        assert(
          (beforeState.players?.[actor.socket.id]?.hand ?? []).some((tile) => tileEquals(tile, move.tile)),
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
      const roomCode = createResp.roomCode;
      assert(roomCode, 'missing room code');

      const joinResp = await emitAck(
        guest.socket,
        'room:join',
        roomCode,
        { username: guest.state.username, userId: guest.state.userId },
      );
      assert(joinResp?.ok, 'generic guest failed initial join');
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
        assert(rejoinResp.you === guestReconnect.socket.id, 'generic guest reconnect socket id mismatch');
        assert(
          Array.isArray(rejoinResp.players) &&
            rejoinResp.players.some((player) => player.id === guestReconnect.socket.id && player.userId === 'guest_smoke_player'),
          'generic guest seat was not migrated to reconnect socket',
        );
        assert(
          rejoinResp.state?.players?.[guestReconnect.socket.id]?.hand?.length === 7 ||
            Array.isArray(rejoinResp.state?.players?.[guestReconnect.socket.id]?.hand),
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
      const roomCode = createResp.roomCode;

      // 2. Bravo joins so room is full
      const joinResp = await emitAck(bravo.socket, 'room:join', roomCode, {
        username: bravo.state.username,
        userId: bravo.state.userId,
      });
      assert(joinResp?.ok, 'bravo failed to join room');
      await waitForRoomCount(alpha, 2);

      await startTwoPlayerGame(alpha, bravo, roomCode);

      // 3. alpha2 connects with SAME userId while alpha is still connected
      const alpha2 = createClient('alpha2', 'same-user-a', 'Alpha');
      try {
        await alpha2.connectAndIdentify();

        // 4. alpha2 attempts room:join
        const join2Resp = await emitAck(alpha2.socket, 'room:join', roomCode, {
          username: 'Alpha',
          userId: 'same-user-a',
        });

        // 5. Assert response ok === false
        assert(join2Resp?.ok === false, 'alpha2 should have been rejected');

        // 6. Assert error includes already_connected
        assert(
          String(join2Resp?.error).includes('already_connected'),
          `Expected already_connected error, got: ${join2Resp?.error}`,
        );

        // 7. Assert alpha is still connected and still receives/owns its seat
        const alphaState = latestState(alpha);
        assert(alphaState?.state?.playerIds.includes(alpha.socket.id), 'alpha should still own its seat');

        // 8. Disconnect alpha
        alpha.disconnect();
        await delay(250);

        // 9. alpha2 attempts room:join again
        const join3Resp = await emitAck(alpha2.socket, 'room:join', roomCode, {
          username: 'Alpha',
          userId: 'same-user-a',
        });

        // 10. Assert response ok === true
        assert(join3Resp?.ok, `alpha2 should have successfully rejoined after alpha disconnected: ${join3Resp?.error}`);
        assert(join3Resp.you === alpha2.socket.id, 'alpha2 should now own the seat');
      } finally {
        alpha2.disconnect();
      }

      return {
        roomCode,
        checks: {
          preventedActiveSeatTakeover: true,
          reconnectStillWorksAfterDisconnect: true,
        },
      };
    },
  );
}

const scenarios = [
  { name: 'lifecycle-reconnect', run: scenarioLifecycleReconnect },
  { name: 'room-switch-cleanup', run: scenarioRoomSwitchCleanup },
  { name: 'seat-migration-and-spectator-rejection', run: scenarioSeatMigrationAndSpectatorRejection },
  { name: 'mid-hand-action-reliability', run: scenarioMidHandActionReliability },
  { name: 'draw-active-action-guards', run: scenarioDrawActiveActionGuards },
  { name: 'post-move-stability', run: scenarioPostMoveStability },
  { name: 'start-and-hand-ready-guards', run: scenarioStartAndHandReadyGuards },
  { name: 'guest-seat-reconnect', run: scenarioGuestSeatReconnect },
  { name: 'tokenless-uuid-claim-rejected', run: scenarioTokenlessUuidClaimRejected },
  { name: 'hand-ended-replay', run: scenarioHandEndedReplay },
  { name: 'identity-freeze', run: scenarioIdentityFreeze },
  { name: 'same-user-active-seat-takeover', run: scenarioSameUserActiveSeatTakeover },
];

async function main() {
  await waitForServerReady();
  const results = [];
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration += 1) {
    for (const scenario of scenarios) {
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
