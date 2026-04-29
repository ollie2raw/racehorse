import { io } from 'socket.io-client';

const SERVER_URL = process.env.SMOKE_SERVER_URL || 'http://127.0.0.1:3001';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const REPEAT_COUNT = Math.max(1, Number(process.env.SMOKE_REPEAT || 1));
const SETTLE_MS = Math.max(50, Number(process.env.SMOKE_SETTLE_MS || 250));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
    connectErrors: [],
  };

  socket.on('room:update', (payload) => state.roomUpdates.push(payload));
  socket.on('state:update', (payload) => state.stateUpdates.push(payload));
  socket.on('state:spectate', (payload) => state.spectateUpdates.push(payload));
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
        throw lastError instanceof Error ? lastError : new Error(`${label} failed to connect`);
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

      const currentFor = getActivePlayer([alpha, bravo]);
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

        const activeClient = getActivePlayer([alpha, bravoClone]);
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

      // Play until hand is over
      let iterations = 0;
      while (iterations < 100) {
        iterations++;
        const state = latestState(alpha)?.state;
        if (state?.handOver) break;

        const current = getActivePlayer([alpha, bravo]);
        if (!current) {
          // If no playable move, must draw
          const activeId = latestState(alpha).state.playerIds[latestState(alpha).state.currentPlayerIndex];
          const activeClient = alpha.socket.id === activeId ? alpha : bravo;
          await emitAck(activeClient.socket, 'game:action', roomCode, { type: 'DRAW' });
        } else {
          const move = getPlayableMove(current);
          await emitAck(current.socket, 'game:action', roomCode, {
            type: 'MOVE',
            move: { tile: move.tile, position: move.position },
          });
        }
        await delay(50);
      }

      const finalState = latestState(alpha)?.state;
      assert(finalState?.handOver, 'Hand did not end after 100 iterations');
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
  { name: 'guest-seat-reconnect', run: scenarioGuestSeatReconnect },
  { name: 'tokenless-uuid-claim-rejected', run: scenarioTokenlessUuidClaimRejected },
  { name: 'hand-ended-replay', run: scenarioHandEndedReplay },
  { name: 'identity-freeze', run: scenarioIdentityFreeze },
  { name: 'same-user-active-seat-takeover', run: scenarioSameUserActiveSeatTakeover },
];

async function main() {
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
