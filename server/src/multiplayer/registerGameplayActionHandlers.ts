import type { Server, Socket } from 'socket.io';
import {
  act,
  captureRoomGameplaySnapshot,
  getRoom,
  HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE,
  isRoomLifecyclePersistUncertainError,
  readyForNextHand,
  rollbackRoomGameplayCommit,
} from '../rooms';
import { normalizeGameActionRequestId, withGameActionIdempotency } from './gameActionIdempotency';
import { childLogger } from '../logger';
import { recordOperationalFailure } from '../operationalTelemetry';

const log = childLogger('game-action');
import {
  flushScheduledLiveRoomPersistence,
  getLiveRoomDurabilityState,
  isLiveRoomDurablyRecoverable,
  isLiveRoomPersistenceShuttingDown,
} from './roomLivePersistence';
import { assertRoomDurabilityOperationAllowed } from './roomDurabilityPolicy';
import {
  broadcastStateUpdate,
  emitForcedDrawAnimationPayload,
  resolveActorSeatId,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';
import { emitMpAuthorityFunnel } from './mpAuthorityTelemetry';

/** Actor-facing copy when a move mutates memory but cannot be proven durable (then rolled back). */
export const GAME_ACTION_PERSIST_RETRY_MESSAGE = "Move couldn't be saved — try again.";

export { HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE };

function emitDebugTimingLog(
  room: { code: string; state?: { sequence?: number } | null },
  socket: Socket,
  action: { type?: string } | null | undefined,
  flushedRoomCodes: string[],
  durabilityStatus: string,
): void {
  const shouldLog =
    process.env.NODE_ENV !== 'production' ||
    process.env.MP_DEBUG === '1' ||
    process.env.DEBUG_MP === '1';
  if (!shouldLog) return;
  log.info(
    {
      roomCode: room.code,
      playerId: socket.id,
      action: action?.type,
      sequence: room.state?.sequence ?? null,
      flushedRoomCodes,
      durabilityStatus,
    },
    '',
  );
}

export type RegisterGameplayActionHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
};

function parseHandReadyArgs(arg2: unknown, arg3: unknown): {
  handNumber: number | undefined;
  requestId: string | null;
  cb: AckFn | undefined;
} {
  if (typeof arg2 === 'function') {
    return { handNumber: undefined, requestId: null, cb: arg2 as AckFn };
  }
  if (arg2 && typeof arg2 === 'object' && !Array.isArray(arg2)) {
    const payload = arg2 as { handNumber?: unknown; requestId?: unknown };
    const handNumber =
      typeof payload.handNumber === 'number' && Number.isFinite(payload.handNumber)
        ? payload.handNumber
        : undefined;
    return {
      handNumber,
      requestId: normalizeGameActionRequestId(payload.requestId),
      cb: typeof arg3 === 'function' ? (arg3 as AckFn) : undefined,
    };
  }
  return {
    handNumber: typeof arg2 === 'number' && Number.isFinite(arg2) ? arg2 : undefined,
    requestId: null,
    cb: typeof arg3 === 'function' ? (arg3 as AckFn) : undefined,
  };
}

export function registerGameplayActionHandlers(
  io: Server,
  socket: Socket,
  params: RegisterGameplayActionHandlersParams,
): void {
  const { handlerDeps } = params;

  socket.on('game:action', async (code, action, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    log.debug({ socketId: socket.id, roomCode, actionType: action?.type }, 'game:action received');
    try {
      if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
        if (typeof cb === 'function') cb({ ok: false, error: 'Invalid action payload.' });
        return;
      }
      if (!['DRAW', 'MOVE', 'PASS'].includes(action.type)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Unknown action type.' });
        return;
      }
      const requestId = normalizeGameActionRequestId((action as { requestId?: unknown }).requestId);
      if (!requestId) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Missing action requestId.' });
        return;
      }
      const existingRoom = getRoom(roomCode);
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      if (!existingRoom.players.includes(playerSeatId)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Spectators cannot act.' });
        return;
      }
      if (!existingRoom.state) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Game not started.' });
        return;
      }
      if (existingRoom.state.gameOver) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Game is over.' });
        return;
      }
      assertRoomDurabilityOperationAllowed(existingRoom, 'gameplay_action');
      // Resolves `true` once this move is durable in `room_live_sessions`. Passed
      // to the idempotency wrapper so the `room_command_receipts` row is only
      // written after the snapshot lands — the receipt table must never lead the
      // snapshot (see MP-JIT-1 in docs/mp-live-move-persist-latency.md).
      let persistDurableGate: Promise<boolean> = Promise.resolve(false);
      const ack = await withGameActionIdempotency(
        roomCode,
        playerSeatId,
        requestId,
        async () => {
          const roomBefore = getRoom(roomCode);
          const snapshot = captureRoomGameplaySnapshot(roomBefore);
          if (!snapshot) {
            return { ok: false, error: 'Game not started.' };
          }

          const result = await act(roomCode, playerSeatId, action, io, (code) =>
            broadcastStateUpdate(code),
          );
          const room = result.room;
          room.pendingForcedDrawBroadcast = result.forcedDrawAnimation
            ? {
                playerId: result.forcedDrawAnimation.playerId,
                count: result.forcedDrawAnimation.steps.length,
              }
            : undefined;

          // Terminal / hand-boundary moves and the graceful-shutdown window keep
          // the strong mutate-then-persist-then-broadcast contract: persist
          // synchronously and roll back if it cannot be proven durable. These are
          // low-frequency, latency-insensitive (a mandatory hand-over pause / the
          // game being over / a deploy in progress), and the highest-stakes to
          // lose to a restart.
          const stateAfter = room.state;
          const persistSynchronously =
            isLiveRoomPersistenceShuttingDown() ||
            Boolean(stateAfter?.gameOver) ||
            Boolean(stateAfter?.handOver);

          if (persistSynchronously) {
            const flushResult = await flushScheduledLiveRoomPersistence(room.code);
            const durability = getLiveRoomDurabilityState(room);
            const committed = isLiveRoomDurablyRecoverable(room);
            if (!committed) {
              rollbackRoomGameplayCommit(room, snapshot);
              return {
                ok: false,
                error: GAME_ACTION_PERSIST_RETRY_MESSAGE,
                uncertain: true,
                sequence: room.state?.sequence ?? null,
              };
            }
            persistDurableGate = Promise.resolve(true);
            // Authoritative state before draw animations so clients never render
            // against stale hands/board.
            broadcastStateUpdate(room.code);
            emitDebugTimingLog(room, socket, action, flushResult.flushedRoomCodes, durability.status);
          } else {
            // Mid-hand move: broadcast immediately from authoritative in-memory
            // state, persist the room snapshot off the critical path. A persist
            // that never lands leaves in-memory state ahead of the DB for this
            // room until the next successful write (or a restart — MP-JIT-1's
            // accepted risk). The room self-heals: the snapshot is a full upsert,
            // so any later successful persist catches it fully up.
            persistDurableGate = flushScheduledLiveRoomPersistence(room.code)
              .then(() => {
                const durable = isLiveRoomDurablyRecoverable(room);
                if (!durable) {
                  recordOperationalFailure(
                    'live_room_move_persist_uncommitted',
                    getLiveRoomDurabilityState(room).lastError ??
                      'room not durably recoverable after mid-move flush',
                    {
                      roomCode: room.code,
                      sequence: room.state?.sequence ?? null,
                      requestId,
                      durabilityStatus: getLiveRoomDurabilityState(room).status,
                      consecutiveFailures:
                        getLiveRoomDurabilityState(room).consecutiveFailures,
                    },
                  );
                }
                return durable;
              })
              .catch((err) => {
                recordOperationalFailure('live_room_move_persist_failed', err, {
                  roomCode: room.code,
                  sequence: room.state?.sequence ?? null,
                  requestId,
                });
                return false;
              });
            broadcastStateUpdate(room.code);
            emitDebugTimingLog(room, socket, action, [], getLiveRoomDurabilityState(room).status);
          }

          if (result.forcedDrawAnimation) {
            emitForcedDrawAnimationPayload(room.code, result.forcedDrawAnimation);
          }
          setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(room));
          const forcedMeta = result.forcedDrawAnimation
            ? {
                drewCount: result.forcedDrawAnimation.steps.length,
                stoppedReason: result.forcedDrawAnimation.stoppedReason,
                drawChainId: room.state?.sequence ?? null,
              }
            : undefined;
          return { ok: true, sequence: room.state?.sequence ?? null, forcedDraw: forcedMeta };
        },
        { deferReceiptPersistUntilDurable: () => persistDurableGate },
      );
      if (ack.uncertain) {
        emitMpAuthorityFunnel('private_action_uncertain', {
          roomCode,
          seatId: playerSeatId,
          requestId,
          sequence: ack.sequence ?? null,
          failureCode: 'room_persistence_failed',
        });
      } else if (ack.duplicate) {
        emitMpAuthorityFunnel('private_action_duplicate', {
          roomCode,
          seatId: playerSeatId,
          requestId,
          sequence: ack.sequence ?? null,
        });
      } else if (ack.ok) {
        emitMpAuthorityFunnel('private_action_committed', {
          roomCode,
          seatId: playerSeatId,
          requestId,
          sequence: ack.sequence ?? null,
        });
      }
      if (typeof cb === 'function') {
        cb(ack);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      log.warn({ err, roomCode, actionType: action?.type }, 'game:action error');
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });

  socket.on('hand:ready', async (code, arg2?: unknown, arg3?: unknown) => {
    const roomCode = String(code).trim().toUpperCase();
    const { handNumber, requestId, cb } = parseHandReadyArgs(arg2, arg3);
    try {
      const room = getRoom(roomCode);
      assertRoomDurabilityOperationAllowed(room, 'new_hand');
      const playerSeatId = resolveActorSeatId(roomCode, socket);

      const execute = async () => {
        try {
          const result = await readyForNextHand(roomCode, playerSeatId, io, handNumber, (code) => {
            broadcastStateUpdate(code);
          });
          if (result.started) {
            broadcastStateUpdate(result.room.code);
            setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(result.room));
          }
          return {
            ok: !result.ignored,
            started: result.started,
            ignored: Boolean(result.ignored),
            handNumber: result.room.state?.handNumber ?? null,
            waitMs: result.waitMs ?? 0,
            error: result.ignored ? 'stale_or_duplicate_hand_ready' : undefined,
            sequence: result.room.state?.sequence ?? null,
          };
        } catch (err: unknown) {
          if (isRoomLifecyclePersistUncertainError(err)) {
            const current = getRoom(roomCode);
            return {
              ok: false,
              error: HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE,
              uncertain: true,
              started: false,
              handNumber: current.state?.handNumber ?? null,
              sequence: current.state?.sequence ?? null,
            };
          }
          throw err;
        }
      };

      const ack = requestId
        ? await withGameActionIdempotency(roomCode, playerSeatId, requestId, execute)
        : await execute();

      if (requestId && ack.uncertain) {
        emitMpAuthorityFunnel('private_action_uncertain', {
          roomCode,
          seatId: playerSeatId,
          requestId,
          sequence: ack.sequence ?? null,
          failureCode: 'room_persistence_failed',
        });
      }

      cb?.(ack);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      cb?.({ ok: false, error: message });
    }
  });
}
