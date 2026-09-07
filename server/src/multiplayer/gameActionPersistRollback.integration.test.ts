/**
 * Two-client integration: live private match with real room-session handlers.
 *
 * Covers MP-JIT-1 (docs/mp-live-move-persist-latency.md): a mid-hand move
 * broadcasts immediately and persists the room snapshot off the critical path;
 * a persist that cannot be proven durable does NOT roll back the already-
 * broadcast move — it is recorded via operational telemetry. Terminal /
 * hand-boundary moves and the graceful-shutdown window keep the original
 * mutate-then-persist-then-broadcast rollback contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as operationalTelemetry from '../operationalTelemetry';
import {
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
} from '../rooms';
import { resetGameActionIdempotencyForTests } from './gameActionIdempotency';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';
import { applyLiveSessionRow } from './applyLiveSessionRoom';
import { verifyPlayerMoveLog } from '../ghost/verifier';
import {
  buildLiveSessionRow,
  resetLiveRoomPersistenceForTests,
  setForceLiveRoomFlushUnrecoverableForTests,
  type LiveRosterEntry,
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

  it('mid-hand move: broadcasts before persist; a non-durable persist does not roll back or silence the opponent (MP-JIT-1)', async () => {
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
    const failMove = await findPlayMoveForCurrentTurn(
      roomCode,
      hostSeatId,
      hostHandlers,
      guestHandlers,
    );
    const actorId = failMove.currentId;
    const actorHandlers = actorId === hostSeatId ? hostHandlers : guestHandlers;
    const opponentSocket = actorId === hostSeatId ? guestSocket : hostSocket;

    // ── Step 2: force the room-snapshot persist to fail for the next move ──
    setForceLiveRoomFlushUnrecoverableForTests(true);
    const telemetrySpy = vi
      .spyOn(operationalTelemetry, 'recordOperationalFailure')
      .mockImplementation(() => {});

    const baselineState = structuredClone(getRoom(roomCode).state!);
    const baselineSequence = baselineState.sequence;
    expect(
      baselineState.playerIds[baselineState.currentPlayerIndex],
      'step2 baseline is actor turn',
    ).toBe(actorId);
    expect(baselineState.handOver || baselineState.gameOver, 'step2 baseline is mid-hand').toBe(
      false,
    );
    expect(
      baselineState.players[actorId].hand.length,
      'step2 actor has multiple tiles (move will not end the hand)',
    ).toBeGreaterThan(1);

    hostSocket.emit.mockClear();
    guestSocket.emit.mockClear();

    const failPayload = {
      type: 'MOVE' as const,
      requestId: 'step2-midhand-move',
      move: { tile: failMove.playMove!.tile, position: failMove.playMove!.position },
    };
    const failAck = vi.fn();
    await actorHandlers.get('game:action')?.(roomCode, failPayload, failAck);
    await new Promise((r) => setTimeout(r, 0)); // let the async persist gate settle

    // ── Step 3: the opponent DOES receive the move — it is authoritative ────
    expect(
      stateUpdateCalls(opponentSocket).length,
      'step3 B received the broadcast',
    ).toBeGreaterThan(0);
    const step3B = latestStateUpdate(opponentSocket);
    expect(step3B?.state?.sequence, 'step3 B sees the advanced sequence').toBeGreaterThan(
      baselineSequence,
    );

    // ── Step 4: actor ack is ok; server state advanced, NOT rolled back ────
    expect(failAck, 'step4 ok ack').toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    const afterFail = getRoom(roomCode).state!;
    expect(afterFail.sequence, 'step4 server sequence advanced').toBeGreaterThan(baselineSequence);
    expect(
      afterFail.players[actorId].hand.length,
      'step4 tile consumed from actor hand',
    ).toBe(baselineState.players[actorId].hand.length - 1);

    // ── Step 5: the non-durable persist is recorded, not silent ────────────
    expect(telemetrySpy, 'step5 persist lag recorded').toHaveBeenCalledWith(
      expect.stringMatching(/live_room_move_persist_(uncommitted|failed)/),
      expect.anything(),
      expect.objectContaining({ roomCode }),
    );
    // (A genuine Supabase failure also flips the room to `degraded`, gating new
    // joins / new hands but not gameplay — see the durability-policy tests. The
    // flush-unrecoverable injection here only forces the recoverability check.)

    // ── Step 6: persistence recovers; next move persists; clients stay in sync ─
    setForceLiveRoomFlushUnrecoverableForTests(false);
    telemetrySpy.mockClear();
    hostSocket.emit.mockClear();
    guestSocket.emit.mockClear();

    const recover = await findPlayMoveForCurrentTurn(
      roomCode,
      hostSeatId,
      hostHandlers,
      guestHandlers,
    );
    const recoverHandlers = recover.currentId === hostSeatId ? hostHandlers : guestHandlers;
    const recoverActorSocket = recover.currentId === hostSeatId ? hostSocket : guestSocket;
    const recoverOppSocket = recover.currentId === hostSeatId ? guestSocket : hostSocket;
    const successAck = vi.fn();
    await recoverHandlers.get('game:action')?.(
      roomCode,
      {
        type: 'MOVE',
        requestId: 'step6-success-move',
        move: { tile: recover.playMove!.tile, position: recover.playMove!.position },
      },
      successAck,
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(successAck, 'step6 success ack').toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );
    const afterSuccess = getRoom(roomCode).state!;
    expect(afterSuccess.sequence, 'step6 sequence advanced').toBeGreaterThan(baselineSequence);
    expect(getRoom(roomCode).durability.status, 'step6 room healthy').toBe('healthy');
    expect(telemetrySpy, 'step6 no new persist-lag telemetry').not.toHaveBeenCalled();

    const finalA = latestStateUpdate(recoverActorSocket);
    const finalB = latestStateUpdate(recoverOppSocket);
    expect(finalA?.state?.sequence, 'step6 actor client seq').toBe(afterSuccess.sequence);
    expect(finalB?.state?.sequence, 'step6 opp client seq').toBe(afterSuccess.sequence);
    expect(finalA?.state?.board, 'step6 boards agree').toEqual(finalB?.state?.board);
    expect(
      getRoom(roomCode).pendingForcedDrawBroadcast,
      'step6 no pending forced draw',
    ).toBeUndefined();
  });

  // MP-JIT-1 ACCEPTED RISK — documented, not fixed. An uncontrolled restart
  // (OOM / crash — SIGTERM deploys keep the synchronous gate) between a mid-hand
  // move's broadcast and its async snapshot persist rehydrates the room one move
  // behind. This test pins exactly what that looks like.
  it('restart before the async persist lands: server rehydrates one move behind (MP-JIT-1 accepted risk)', async () => {
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
    const roster: LiveRosterEntry[] = [
      { seatId: hostSeatId, userId: 'host-user', username: 'Host' },
      { seatId: guestSeatId, userId: 'guest-user', username: 'Guest' },
    ];

    // Play a few real, durably-persisted moves.
    for (let i = 0; i < 3; i += 1) {
      const step = await findPlayMoveForCurrentTurn(roomCode, hostSeatId, hostHandlers, guestHandlers);
      const stepHandlers = step.currentId === hostSeatId ? hostHandlers : guestHandlers;
      const ack = vi.fn();
      await stepHandlers.get('game:action')?.(
        roomCode,
        {
          type: 'MOVE',
          requestId: `persisted-${i}`,
          move: { tile: step.playMove!.tile, position: step.playMove!.position },
        },
        ack,
      );
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      await new Promise((r) => setTimeout(r, 0));
    }

    // Capture the durable snapshot AS OF NOW — this is what `room_live_sessions`
    // holds. `buildLiveSessionRow` reads the same room state the real persist does.
    const persistedRow = buildLiveSessionRow(getRoom(roomCode), roster);
    const persistedSequence = getRoom(roomCode).state!.sequence;
    const persistedGhostLogTotal = Object.values(getRoom(roomCode).ghostMoveLogs).reduce(
      (sum, log) => sum + log.length,
      0,
    );

    // One more real move — it broadcasts, but its snapshot persist is forced
    // non-durable (stands in for "process died before the async upsert landed").
    const lost = await findPlayMoveForCurrentTurn(roomCode, hostSeatId, hostHandlers, guestHandlers);
    const lostHandlers = lost.currentId === hostSeatId ? hostHandlers : guestHandlers;
    setForceLiveRoomFlushUnrecoverableForTests(true);
    const lostAck = vi.fn();
    await lostHandlers.get('game:action')?.(
      roomCode,
      {
        type: 'MOVE',
        requestId: 'lost-move',
        move: { tile: lost.playMove!.tile, position: lost.playMove!.position },
      },
      lostAck,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(lostAck, 'the lost move still broadcasts + acks ok').toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );
    const clientSawSequence = getRoom(roomCode).state!.sequence;
    expect(clientSawSequence, 'clients saw the advanced sequence').toBeGreaterThan(persistedSequence);
    const ghostLogTotalAfterLostMove = Object.values(getRoom(roomCode).ghostMoveLogs).reduce(
      (sum, log) => sum + log.length,
      0,
    );

    // ── "restart": wipe in-memory state, rehydrate from the last durable snapshot ──
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetLiveRoomPersistenceForTests();
    resetGameActionIdempotencyForTests();
    const applied = applyLiveSessionRow(persistedRow);
    expect(applied, 'rehydrated from the persisted snapshot').not.toBeNull();
    const rehydrated = getRoom(roomCode);

    // (1) SEQUENCE REGRESSION — the server is one move behind what clients saw.
    //     On resync the clients' watermark (clientSawSequence) is ahead of the
    //     server, so `evaluateSequenceWatermark` reports a regression and the
    //     clients accept the rollback to `persistedSequence`.
    expect(rehydrated.state!.sequence, 'rehydrated at the persisted sequence').toBe(persistedSequence);
    expect(rehydrated.state!.sequence).toBeLessThan(clientSawSequence);

    // (2) GHOST-LOG GAP AT REHYDRATION — the lost move's ghost-log entry is absent.
    const rehydratedGhostLogTotal = Object.values(rehydrated.ghostMoveLogs).reduce(
      (sum, log) => sum + log.length,
      0,
    );
    expect(rehydratedGhostLogTotal, 'rehydrated log matches the persisted snapshot').toBe(
      persistedGhostLogTotal,
    );
    expect(
      rehydratedGhostLogTotal,
      'rehydrated log is shorter than what the clients had witnessed',
    ).toBeLessThan(ghostLogTotalAfterLostMove);

    // (3) WHAT DOES *NOT* HAPPEN — the rehydrated server log is a consistent
    //     prefix, so move-log verification still passes. The missing move is
    //     re-applied when the acting client resyncs and replays; it does not
    //     silently fail verification / drop the match's Glicko rating. The real
    //     residual damage is a transient visible desync, plus (only if the acting
    //     player also never reconnects) that one move being discarded.
    for (const log of Object.values(rehydrated.ghostMoveLogs)) {
      if (log.length === 0) continue;
      expect(
        verifyPlayerMoveLog(log, { strictHandContinuity: true }).ok,
        'rehydrated per-seat move log still verifies',
      ).toBe(true);
    }
  });
});
