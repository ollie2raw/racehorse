import type { Server, Socket } from 'socket.io';
import { act, getRoom, readyForNextHand } from '../rooms';
import { normalizeGameActionRequestId, withGameActionIdempotency } from './gameActionIdempotency';
import { childLogger } from '../logger';

const log = childLogger('game-action');
import {
  flushScheduledLiveRoomPersistence,
  getLiveRoomDurabilityState,
  isLiveRoomDurablyRecoverable,
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

export type RegisterGameplayActionHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
};

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
      const ack = await withGameActionIdempotency(
        roomCode,
        playerSeatId,
        requestId,
        async () => {
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
          const flushResult = await flushScheduledLiveRoomPersistence(room.code);
          const durability = getLiveRoomDurabilityState(room);
          const committed = isLiveRoomDurablyRecoverable(room);
          if (!committed) {
            return {
              ok: false,
              error:
                durability.status === 'failed' || durability.status === 'degraded'
                  ? 'room_persistence_failed'
                  : 'room_snapshot_uncommitted',
              uncertain: true,
              sequence: room.state?.sequence ?? null,
            };
          }

          // Authoritative state before draw animations so clients never render against stale hands/board.
          broadcastStateUpdate(room.code);
          if (result.forcedDrawAnimation) {
            emitForcedDrawAnimationPayload(room.code, result.forcedDrawAnimation);
          }
          setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(room));
          if (
            process.env.NODE_ENV !== 'production' ||
            process.env.MP_DEBUG === '1' ||
            process.env.DEBUG_MP === '1'
          ) {
            console.log('[mp-action-ack]', {
              roomCode: room.code,
              playerId: socket.id,
              action: action?.type,
              sequence: room.state?.sequence ?? null,
              flushedRoomCodes: flushResult.flushedRoomCodes,
            });
          }
          const forcedMeta = result.forcedDrawAnimation
            ? {
                drewCount: result.forcedDrawAnimation.steps.length,
                stoppedReason: result.forcedDrawAnimation.stoppedReason,
                drawChainId: room.state?.sequence ?? null,
              }
            : undefined;
          return { ok: true, sequence: room.state?.sequence ?? null, forcedDraw: forcedMeta };
        },
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
    const handNumber = typeof arg2 === 'number' && Number.isFinite(arg2) ? arg2 : undefined;
    const cb = (typeof arg2 === 'function' ? arg2 : arg3) as AckFn | undefined;
    try {
      const room = getRoom(roomCode);
      assertRoomDurabilityOperationAllowed(room, 'new_hand');
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      const result = await readyForNextHand(roomCode, playerSeatId, io, handNumber, (code) => {
        broadcastStateUpdate(code);
      });
      if (result.started) {
        broadcastStateUpdate(result.room.code);
        setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(result.room));
      }
      cb?.({
        ok: !result.ignored,
        started: result.started,
        ignored: Boolean(result.ignored),
        handNumber: result.room.state?.handNumber ?? null,
        waitMs: result.waitMs ?? 0,
        error: result.ignored ? 'stale_or_duplicate_hand_ready' : undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      cb?.({ ok: false, error: message });
    }
  });
}
