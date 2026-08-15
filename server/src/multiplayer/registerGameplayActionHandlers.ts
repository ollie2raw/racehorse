import type { Server, Socket } from 'socket.io';
import { act, getRoom, readyForNextHand } from '../rooms';
import {
  digestGameActionRequest,
  normalizeGameActionRequestId,
  withGameActionIdempotency,
} from './gameActionIdempotency';
import {
  flushScheduledLiveRoomPersistence,
  getLiveRoomDurabilityState,
  isLiveRoomDurablyRecoverable,
} from './roomLivePersistence';
import {
  commitLiveRoomGameplayCommand,
  isTransactionalMultiplayerCommandsEnabled,
  prepareLiveRoomGameplayCommand,
} from './liveRoomCommandStore';
import { markRoomDurabilityPersistFailure } from './roomDurability';
import { recordMultiplayerOperationalEventBestEffort } from './multiplayerOperationalEventStore';
import { assertRoomDurabilityOperationAllowed } from './roomDurabilityPolicy';
import {
  broadcastStateUpdate,
  emitForcedDrawAnimationPayload,
  getRoomRoster,
  resolveActorSeatId,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';

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
    const actionStartedAt = Date.now();
    console.log(`[game:action] socket=${socket.id}, code=${roomCode}, action=${action?.type}`);
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
      const expectedSequence = Number((action as { expectedSequence?: unknown }).expectedSequence);
      if (!Number.isInteger(expectedSequence) || expectedSequence < 0) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Missing action expectedSequence.' });
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
      const requestDigest = digestGameActionRequest({
        type: action.type,
        expectedSequence,
        move: action.type === 'MOVE' ? action.move ?? null : null,
      });
      const ack = await withGameActionIdempotency(
        roomCode,
        playerSeatId,
        requestId,
        requestDigest,
        async () => {
          // Check inside idempotency so a retry of an already-committed action
          // replays its ack even though the authoritative sequence advanced.
          if (existingRoom.state?.sequence !== expectedSequence) {
            return {
              ok: false,
              error: 'stale_state',
              sequence: existingRoom.state?.sequence ?? null,
            };
          }
          const transactionalCommands = isTransactionalMultiplayerCommandsEnabled();
          let expectedAuthorityRevision = existingRoom.authorityRevision;
          if (transactionalCommands) {
            const preflight = await prepareLiveRoomGameplayCommand({
              room: existingRoom,
              actorSeatId: playerSeatId,
              requestId,
              requestDigest,
            });
            if (preflight.kind === 'replay') {
              existingRoom.authorityRevision = preflight.authorityRevision;
              return preflight.ack;
            }
            if (preflight.kind === 'rejected') {
              markRoomDurabilityPersistFailure(existingRoom, {
                status: 'degraded',
                error: preflight.ack.error ?? 'room_command_preflight_rejected',
              });
              return preflight.ack;
            }
            expectedAuthorityRevision = preflight.authorityRevision;
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
          const forcedMeta = result.forcedDrawAnimation
            ? {
                drewCount: result.forcedDrawAnimation.steps.length,
                stoppedReason: result.forcedDrawAnimation.stoppedReason,
                drawChainId: room.state?.sequence ?? null,
              }
            : undefined;
          const candidateAck = {
            ok: true,
            sequence: room.state?.sequence ?? null,
            forcedDraw: forcedMeta,
          };
          let flushedRoomCodes: string[] = [];
          if (transactionalCommands) {
            const roster = getRoomRoster(room.code).map((player) => ({
              seatId: player.id,
              userId: player.userId,
              username: player.username,
            }));
            const commit = await commitLiveRoomGameplayCommand({
              room,
              roster,
              actorSeatId: playerSeatId,
              requestId,
              requestDigest,
              expectedAuthorityRevision,
              ack: candidateAck,
            });
            if (commit.kind !== 'committed') {
              return {
                ...commit.ack,
                ok: false,
                uncertain: true,
                sequence: room.state?.sequence ?? null,
              };
            }
          } else {
            const flushResult = await flushScheduledLiveRoomPersistence(room.code);
            flushedRoomCodes = flushResult.flushedRoomCodes;
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
              flushedRoomCodes,
              transactionalCommands,
            });
          }
          return candidateAck;
        },
      );
      const ackError = typeof ack.error === 'string' ? ack.error : null;
      const eventType = ack.ok
        ? 'action_accepted'
        : ackError === 'stale_state'
          ? 'stale_command'
          : ackError === 'request_id_conflict'
            ? 'request_id_conflict'
            : 'action_rejected';
      recordMultiplayerOperationalEventBestEffort({
        eventType,
        roomCode,
        requestId,
        actionType: action.type,
        errorCode: ackError,
        durationMs: Date.now() - actionStartedAt,
        idempotencyKey: `game-action:${roomCode}:${playerSeatId}:${requestId}:${eventType}`,
        payload: { sequence: 'sequence' in ack ? ack.sequence ?? null : null },
      });
      if (typeof cb === 'function') {
        cb(ack);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      const requestId = normalizeGameActionRequestId((action as { requestId?: unknown } | null)?.requestId);
      recordMultiplayerOperationalEventBestEffort({
        eventType: 'action_rejected',
        roomCode,
        requestId,
        actionType: typeof action?.type === 'string' ? action.type : null,
        errorCode: message,
        durationMs: Date.now() - actionStartedAt,
        idempotencyKey: `game-action-error:${roomCode}:${requestId ?? socket.id}:${actionStartedAt}`,
      });
      console.log(`[game:action] ERROR: ${message}`);
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
