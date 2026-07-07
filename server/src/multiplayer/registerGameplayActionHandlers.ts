import type { Server, Socket } from 'socket.io';
import { act, getRoom, readyForNextHand } from '../rooms';
import { withGameActionIdempotency } from './gameActionIdempotency';
import {
  broadcastStateUpdate,
  emitForcedDrawAnimationPayload,
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
      const ack = await withGameActionIdempotency(
        roomCode,
        playerSeatId,
        (action as { requestId?: string }).requestId,
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
      if (typeof cb === 'function') {
        cb(ack);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[game:action] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });

  socket.on('hand:ready', async (code, arg2?: unknown, arg3?: unknown) => {
    const roomCode = String(code).trim().toUpperCase();
    const handNumber = typeof arg2 === 'number' && Number.isFinite(arg2) ? arg2 : undefined;
    const cb = (typeof arg2 === 'function' ? arg2 : arg3) as AckFn | undefined;
    try {
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