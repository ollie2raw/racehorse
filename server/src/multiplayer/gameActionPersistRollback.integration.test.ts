/**
 * Two-client integration: live private match with real room-session handlers.
 * Drives PR-MP-C mutate-then-persist rollback through flush-failure injection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
} from '../rooms';
import { GAME_ACTION_PERSIST_RETRY_MESSAGE } from './registerGameplayActionHandlers';
import { resetGameActionIdempotencyForTests } from './gameActionIdempotency';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';
import {
  resetLiveRoomPersistenceForTests,
  setForceLiveRoomFlushUnrecoverableForTests,
} from './roomLivePersistence';
import { initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';
import { registerRoomSessionHandlers } from './registerRoomSessionHandlers';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async () => []),
}));

const sessionDeps = {
  resolveSocketIdentity: async (config: { username?: string; userId?: string | null }) => ({
    username: typeof config.username === 'string' ? config.username : 'Guest',
    userId: typeof config.userId === 'string' ? config.userId : null,
  }),
  normalizeUsername: (value: unknown) => (typeof value === 'string' ? value : 'Guest'),
  normalizeUserId: (value: unknown) => (typeof value === 'string' ? value : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => undefined,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  maybeFinalizeTournamentMatch: () => undefined,
  persistRoomMatchLog: async () => undefined,
  onGameOver: () => null,
  finalizeTournamentMatch: () => undefined,
};

function makeSocket(label: string, userId: string) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    id: `sock-${label}`,
    data: {
      userId,
      username: label,
    } as Record<string, unknown>,
    rooms: new Set<string>(),
    connected: true,
    on: (event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    join: (roomCode: string) => {
      socket.rooms.add(roomCode);
    },
    leave: (roomCode: string) => {
      socket.rooms.delete(roomCode);
    },
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  socket.rooms.add(socket.id);
  return { socket: socket as any, handlers };
}

function makeIoRoomTarget() {
  const emit = vi.fn();
  return {
    emit,
    except: vi.fn(() => ({ emit: vi.fn() })),
  };
}

function makeTwoPlayerIo(hostSocket: any, guestSocket: any, roomCode: string) {
  const roomMembers = new Set([hostSocket.id, guestSocket.id]);
  return {
    sockets: {
      sockets: new Map([
        [hostSocket.id, hostSocket],
        [guestSocket.id, guestSocket],
      ]),
      adapter: {
        rooms: new Map<string, Set<string>>([[roomCode, roomMembers]]),
      },
    },
    to: vi.fn(() => makeIoRoomTarget()),
  } as any;
}

function stateUpdateCalls(socket: { emit: ReturnType<typeof vi.fn> }) {
  return socket.emit.mock.calls.filter(([event]) => event === 'state:update');
}

function latestStateUpdate(socket: { emit: ReturnType<typeof vi.fn> }) {
  const updates = stateUpdateCalls(socket);
  return updates[updates.length - 1]?.[1] ?? null;
}

function gameplayEmitEvents(socket: { emit: ReturnType<typeof vi.fn> }) {
  return socket.emit.mock.calls
    .map(([event]) => event as string)
    .filter((event) =>
      ['state:update', 'forcedDraw:animation', 'hand:ended', 'game:over'].includes(event),
    );
}

function boardFingerprint(state: any) {
  return {
    sequence: state?.sequence ?? null,
    currentPlayerIndex: state?.currentPlayerIndex ?? null,
    handNumber: state?.handNumber ?? null,
    board: state?.board ?? null,
    consecutivePasses: state?.consecutivePasses ?? null,
    boneyardCount: Array.isArray(state?.boneyard) ? state.boneyard.length : null,
    scores: Object.fromEntries(
      Object.entries(state?.players ?? {}).map(([id, player]: [string, any]) => [
        id,
        player?.score ?? null,
      ]),
    ),
    handLengths: Object.fromEntries(
      Object.entries(state?.players ?? {}).map(([id, player]: [string, any]) => [
        id,
        Array.isArray(player?.hand) ? player.hand.length : null,
      ]),
    ),
  };
}

async function startPrivateMatch(
  io: any,
  hostHandlers: Map<string, (...args: any[]) => void>,
  guestHandlers: Map<string, (...args: any[]) => void>,
  hostSocket: any,
  guestSocket: any,
) {
  const hostAck = vi.fn();
  await hostHandlers.get('room:create')?.(
    { username: 'Host', userId: 'host-user', skipPregameDraw: true },
    hostAck,
  );
  expect(hostAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  const roomCode = hostAck.mock.calls[0][0].roomCode as string;
  const hostSeatId = hostAck.mock.calls[0][0].you as string;

  io.sockets.adapter.rooms.set(roomCode, new Set([hostSocket.id, guestSocket.id]));

  const guestJoinAck = vi.fn();
  await guestHandlers.get('room:join')?.(
    roomCode,
    { username: 'Guest', userId: 'guest-user' },
    guestJoinAck,
  );
  expect(guestJoinAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  const guestSeatId = guestJoinAck.mock.calls[0][0].you as string;

  setRoomRoster(roomCode, [
    { id: hostSeatId, socketId: hostSocket.id, username: 'Host', userId: 'host-user' },
    { id: guestSeatId, socketId: guestSocket.id, username: 'Guest', userId: 'guest-user' },
  ]);

  await guestHandlers.get('player:ready')?.(roomCode, vi.fn());

  hostSocket.emit.mockClear();
  guestSocket.emit.mockClear();

  const startAck = vi.fn();
  await hostHandlers.get('game:start')?.(roomCode, startAck);
  expect(startAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));

  return { roomCode, hostSeatId, guestSeatId };
}

async function findPlayMoveForCurrentTurn(
  roomCode: string,
  hostSeatId: string,
  hostHandlers: Map<string, (...args: any[]) => void>,
  guestHandlers: Map<string, (...args: any[]) => void>,
) {
  for (let step = 0; step < 24; step += 1) {
    const room = getRoom(roomCode);
    const currentId = room.state!.playerIds[room.state!.currentPlayerIndex];
    const activeHandlers = currentId === hostSeatId ? hostHandlers : guestHandlers;
    const legalMoves = getRoomLegalMoves(roomCode, currentId);
    const playMove = legalMoves.find((move) => move.type === 'play' && move.tile);
    if (playMove) {
      return { currentId, activeHandlers, playMove };
    }
    if (getRoomCanDraw(roomCode, currentId)) {
      const ack = vi.fn();
      await activeHandlers.get('game:action')?.(
        roomCode,
        { type: 'DRAW', requestId: `setup-draw-${step}` },
        ack,
      );
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      continue;
    }
    if (legalMoves.some((move) => move.type === 'pass')) {
      const ack = vi.fn();
      await activeHandlers.get('game:action')?.(
        roomCode,
        { type: 'PASS', requestId: `setup-pass-${step}` },
        ack,
      );
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      continue;
    }
    break;
  }
  throw new Error('Could not reach a playable MOVE for integration test');
}

describe('PR-MP-C two-client game:action persist rollback integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGameActionIdempotencyForTests();
    resetLiveRoomPersistenceForTests();
    resetLiveRoomPersistHookForTests();
    resetRoomGameplayLocksForTests();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
  });

  it('steps 1–6: happy move → forced flush fail → silent B → A retry → recover', async () => {
    const { socket: hostSocket, handlers: hostHandlers } = makeSocket('Host', 'host-user');
    const { socket: guestSocket, handlers: guestHandlers } = makeSocket('Guest', 'guest-user');

    const io = makeTwoPlayerIo(hostSocket, guestSocket, 'PENDING');
    initRoomSession(io, sessionDeps);
    registerRoomSessionHandlers(io, hostSocket);
    registerRoomSessionHandlers(io, guestSocket);

    const { roomCode, hostSeatId, guestSeatId } = await startPrivateMatch(
      io,
      hostHandlers,
      guestHandlers,
      hostSocket,
      guestSocket,
    );

    // ── Step 1: normal move; both seats get matching state:update ───────────
    const first = await findPlayMoveForCurrentTurn(
      roomCode,
      hostSeatId,
      hostHandlers,
      guestHandlers,
    );
    const seatAId = first.currentId;
    const seatBId = seatAId === hostSeatId ? guestSeatId : hostSeatId;
    const seatAHandlers = seatAId === hostSeatId ? hostHandlers : guestHandlers;
    const seatASocket = seatAId === hostSeatId ? hostSocket : guestSocket;
    const seatBSocket = seatAId === hostSeatId ? guestSocket : hostSocket;

    hostSocket.emit.mockClear();
    guestSocket.emit.mockClear();

    const step1SeqBefore = getRoom(roomCode).state!.sequence;
    const step1Ack = vi.fn();
    await seatAHandlers.get('game:action')?.(
      roomCode,
      {
        type: 'MOVE',
        requestId: 'step1-ok-move',
        move: { tile: first.playMove!.tile, position: first.playMove!.position },
      },
      step1Ack,
    );
    expect(step1Ack, 'step1 ack').toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    const step1Server = getRoom(roomCode).state!;
    expect(step1Server.sequence, 'step1 sequence advanced').toBeGreaterThan(step1SeqBefore);

    const step1A = latestStateUpdate(seatASocket);
    const step1B = latestStateUpdate(seatBSocket);
    expect(step1A?.state?.sequence, 'step1 A state:update').toBe(step1Server.sequence);
    expect(step1B?.state?.sequence, 'step1 B state:update').toBe(step1Server.sequence);
    expect(boardFingerprint(step1A?.state).board, 'step1 A/B board match').toEqual(
      boardFingerprint(step1B?.state).board,
    );
    expect(step1A?.state?.players?.[seatBId]?.hand ?? [], 'step1 A masks B hand').toEqual([]);
    expect(step1B?.state?.players?.[seatAId]?.hand ?? [], 'step1 B masks A hand').toEqual([]);

    // Advance until Seat A again has a playable MOVE (may pass/draw through B).
    let failMove = await findPlayMoveForCurrentTurn(
      roomCode,
      hostSeatId,
      hostHandlers,
      guestHandlers,
    );
    // Prefer keeping the same logical actor if possible; otherwise use whoever has the turn.
    const actorId = failMove.currentId;
    const actorHandlers = actorId === hostSeatId ? hostHandlers : guestHandlers;
    const actorSocket = actorId === hostSeatId ? hostSocket : guestSocket;
    const opponentSocket = actorId === hostSeatId ? guestSocket : hostSocket;
    const opponentId = actorId === hostSeatId ? guestSeatId : hostSeatId;

    // ── Step 2: force flush failure on next move ────────────────────────────
    setForceLiveRoomFlushUnrecoverableForTests(true);

    const baselineState = structuredClone(getRoom(roomCode).state!);
    const baselineSequence = baselineState.sequence;
    const baselineTurnSeat = baselineState.playerIds[baselineState.currentPlayerIndex];
    expect(baselineTurnSeat, 'step2 baseline is actor turn').toBe(actorId);

    // Capture last client snapshots before clearing emit spies for the failure window.
    const actorClientBefore = structuredClone(latestStateUpdate(actorSocket));
    expect(actorClientBefore?.state?.sequence, 'step2 actor has prior state:update').toBe(
      baselineSequence,
    );

    hostSocket.emit.mockClear();
    guestSocket.emit.mockClear();
    const opponentEventsBefore = gameplayEmitEvents(opponentSocket).length;
    const failPayload = {
      type: 'MOVE' as const,
      requestId: 'step2-fail-move',
      move: { tile: failMove.playMove!.tile, position: failMove.playMove!.position },
    };
    const failAck = vi.fn();
    await actorHandlers.get('game:action')?.(roomCode, failPayload, failAck);

    // ── Step 3: Seat B receives nothing ─────────────────────────────────────
    expect(gameplayEmitEvents(opponentSocket).length, 'step3 B no gameplay emits').toBe(
      opponentEventsBefore,
    );
    expect(stateUpdateCalls(opponentSocket).length, 'step3 B no state:update').toBe(0);

    // ── Step 4: Seat A uncertain + board matches rolled-back server ─────────
    expect(failAck, 'step4 uncertain ack').toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        uncertain: true,
        error: GAME_ACTION_PERSIST_RETRY_MESSAGE,
        sequence: baselineSequence,
      }),
    );
    expect(stateUpdateCalls(actorSocket).length, 'step4 A no state:update on fail').toBe(0);

    const rolledBack = getRoom(roomCode).state!;
    expect(rolledBack.sequence, 'step4 server sequence rolled back').toBe(baselineSequence);
    expect(rolledBack.playerIds[rolledBack.currentPlayerIndex], 'step4 still actor turn').toBe(
      actorId,
    );
    expect(boardFingerprint(rolledBack), 'step4 server board == baseline').toEqual(
      boardFingerprint(baselineState),
    );
    expect(rolledBack.players[actorId].hand, 'step4 actor hand == baseline').toEqual(
      baselineState.players[actorId].hand,
    );
    expect(rolledBack.board, 'step4 board deep-equal baseline').toEqual(baselineState.board);

    // Actor "client" still holds last successful snapshot; must agree with server baseline.
    const actorClientNow = latestStateUpdate(actorSocket) ?? actorClientBefore;
    expect(actorClientNow?.state?.sequence, 'step4 client seq == server').toBe(rolledBack.sequence);
    expect(actorClientNow?.state?.board, 'step4 client board == server').toEqual(rolledBack.board);
    expect(
      actorClientNow?.state?.players?.[actorId]?.hand,
      'step4 client hand == server',
    ).toEqual(rolledBack.players[actorId].hand);
    expect(
      actorClientNow?.state?.currentPlayerIndex,
      'step4 client turn index == server',
    ).toBe(rolledBack.currentPlayerIndex);

    // ── Step 5: rapid retries while failure forced ──────────────────────────
    hostSocket.emit.mockClear();
    guestSocket.emit.mockClear();
    const rapidAcks = [vi.fn(), vi.fn(), vi.fn()];
    for (let i = 0; i < 3; i += 1) {
      // Re-read legal move each time (board unchanged, but keep realistic).
      const legal = getRoomLegalMoves(roomCode, actorId);
      const play = legal.find(
        (m) =>
          m.type === 'play' &&
          m.tile &&
          m.tile.low === failMove.playMove!.tile!.low &&
          m.tile.high === failMove.playMove!.tile!.high &&
          m.position === failMove.playMove!.position,
      );
      expect(play, `step5 legal play still available attempt ${i + 1}`).toBeTruthy();
      await actorHandlers.get('game:action')?.(
        roomCode,
        {
          type: 'MOVE',
          requestId: `step5-retry-${i}`,
          move: { tile: play!.tile, position: play!.position },
        },
        rapidAcks[i],
      );
    }

    for (let i = 0; i < 3; i += 1) {
      expect(rapidAcks[i], `step5 ack ${i + 1}`).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          uncertain: true,
          error: GAME_ACTION_PERSIST_RETRY_MESSAGE,
          sequence: baselineSequence,
        }),
      );
    }
    const afterRapid = getRoom(roomCode).state!;
    expect(afterRapid.sequence, 'step5 sequence stuck at baseline').toBe(baselineSequence);
    expect(afterRapid.playerIds[afterRapid.currentPlayerIndex], 'step5 still actor turn').toBe(
      actorId,
    );
    expect(boardFingerprint(afterRapid), 'step5 board unchanged').toEqual(
      boardFingerprint(baselineState),
    );
    expect(stateUpdateCalls(opponentSocket).length, 'step5 B still silent').toBe(0);
    expect(stateUpdateCalls(actorSocket).length, 'step5 A still no broadcast').toBe(0);

    // ── Step 6: clear force; retry succeeds; B receives update ──────────────
    setForceLiveRoomFlushUnrecoverableForTests(false);
    hostSocket.emit.mockClear();
    guestSocket.emit.mockClear();

    const legalFinal = getRoomLegalMoves(roomCode, actorId);
    const playFinal = legalFinal.find(
      (m) =>
        m.type === 'play' &&
        m.tile &&
        m.tile.low === failMove.playMove!.tile!.low &&
        m.tile.high === failMove.playMove!.tile!.high &&
        m.position === failMove.playMove!.position,
    );
    expect(playFinal, 'step6 same play still legal').toBeTruthy();

    const successAck = vi.fn();
    await actorHandlers.get('game:action')?.(
      roomCode,
      {
        type: 'MOVE',
        requestId: 'step6-success-move',
        move: { tile: playFinal!.tile, position: playFinal!.position },
      },
      successAck,
    );

    expect(successAck, 'step6 success ack').toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );
    const afterSuccess = getRoom(roomCode).state!;
    // Engine bumps sequence on play and again on turn advance (not a leftover from failed attempts).
    expect(afterSuccess.sequence, 'step6 sequence advanced').toBeGreaterThan(baselineSequence);
    expect(
      afterSuccess.players[actorId].hand.length,
      'step6 exactly one tile consumed from actor hand',
    ).toBe(baselineState.players[actorId].hand.length - 1);
    expect(stateUpdateCalls(opponentSocket).length, 'step6 B received state:update').toBeGreaterThan(
      0,
    );
    expect(stateUpdateCalls(actorSocket).length, 'step6 A received state:update').toBeGreaterThan(0);

    const finalA = latestStateUpdate(actorSocket);
    const finalB = latestStateUpdate(opponentSocket);
    expect(finalA?.state?.sequence, 'step6 A client seq').toBe(afterSuccess.sequence);
    expect(finalB?.state?.sequence, 'step6 B client seq').toBe(afterSuccess.sequence);
    expect(finalA?.state?.board, 'step6 A/B boards agree').toEqual(finalB?.state?.board);
    expect(finalB?.state?.players?.[actorId]?.hand ?? [], 'step6 B still masks A hand').toEqual([]);
    expect(finalA?.state?.players?.[opponentId]?.hand ?? [], 'step6 A still masks B hand').toEqual(
      [],
    );
    // No leftover pending forced-draw from failed attempts.
    expect(getRoom(roomCode).pendingForcedDrawBroadcast, 'step6 no pending forced draw').toBeUndefined();
  });
});
