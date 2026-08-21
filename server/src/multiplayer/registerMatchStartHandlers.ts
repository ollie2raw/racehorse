import { childLogger } from '../logger';
import type { Server, Socket } from 'socket.io';
import {
  getRoom,
  HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE,
  isRoomLifecyclePersistUncertainError,
} from '../rooms';
import { defaultEnginePersistence } from '../scheduledTournament/persistenceInterface';
import { promoteScheduledMatchToInProgress } from '../scheduledTournament/matchDispatch';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import { normalizeGameActionRequestId, withGameActionIdempotency } from './gameActionIdempotency';
import { assertRoomDurabilityOperationAllowed } from './roomDurabilityPolicy';
import {
  buildMatchStartDeps,
  getRoomPlayersWithFallback,
  getRoomRoster,
  resolveActorSeatId,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';
import { emitMpAuthorityFunnel } from './mpAuthorityTelemetry';

const log = childLogger('multiplayer:match-start');

export type RegisterMatchStartHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
};

function parseGameStartArgs(arg2: unknown, arg3: unknown): {
  requestId: string | null;
  cb: AckFn | undefined;
} {
  if (typeof arg2 === 'function') {
    return { requestId: null, cb: arg2 as AckFn };
  }
  if (arg2 && typeof arg2 === 'object' && !Array.isArray(arg2)) {
    const payload = arg2 as { requestId?: unknown };
    return {
      requestId: normalizeGameActionRequestId(payload.requestId),
      cb: typeof arg3 === 'function' ? (arg3 as AckFn) : undefined,
    };
  }
  return {
    requestId: null,
    cb: typeof arg3 === 'function' ? (arg3 as AckFn) : undefined,
  };
}

export function registerMatchStartHandlers(
  io: Server,
  socket: Socket,
  params: RegisterMatchStartHandlersParams,
): void {
  const { handlerDeps } = params;

  socket.on('player:ready', async (code: unknown, cb?: AckFn) => {
    const roomCode = String(code ?? '').trim().toUpperCase();
    try {
      const room = getRoom(roomCode);
      assertRoomDurabilityOperationAllowed(room, 'match_start');
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      if (!room.players.includes(playerSeatId)) {
        log.info({
          roomCode,
          playerSeatId,
          socketId: socket.id,
          roomPlayers: [...room.players],
          matchStartReady: [...room.matchStartReady],
        }, 'rejected — seat not in room.players');
        cb?.({ ok: false, error: 'Only room players can ready up.' });
        return;
      }
      log.info({
        roomCode,
        playerSeatId,
        socketId: socket.id,
        roomPlayers: [...room.players],
        matchStartReadyBefore: [...room.matchStartReady],
      }, 'marking seat ready');
      markMatchStartReady(roomCode, playerSeatId);
      const roomAfterReady = getRoom(roomCode);
      log.info({
        roomCode,
        playerSeatId,
        matchStartReady: [...roomAfterReady.matchStartReady],
      }, 'matchStartReady after mark');
      const isPrivate = !roomAfterReady.matchmakingMatchId && !roomAfterReady.scheduledTournamentMatchId;
      if (!isPrivate) {
        const startResult = await tryStartMatchIfReady(roomCode, io, buildMatchStartDeps(io));
        if (startResult.started) {
          const started = getRoom(roomCode);
          if (started.scheduledTournamentMatchId) {
            const readyUserId = handlerDeps.normalizeUserId(socket.data?.userId);
            await promoteScheduledMatchToInProgress(
              started.scheduledTournamentMatchId,
              defaultEnginePersistence,
              new Date().toISOString(),
              readyUserId,
            );
          }
          handlerDeps.notifyRoomPlayersInGame(roomCode);
          await handlerDeps.onAfterMatchStarted(started);
        }
        cb?.({
          ok: true,
          started: startResult.started,
          waitingFor: startResult.waitingFor ?? [],
        });
      } else {
        const roster = getRoomRoster(roomCode).length > 0
          ? getRoomRoster(roomCode)
          : getRoomPlayersWithFallback(roomCode, roomAfterReady.players);
        io.to(roomCode).emit('room:update', {
          players: roster,
        });
        cb?.({
          ok: true,
          started: false,
          waitingFor: roomAfterReady.players.filter((id) => !roomAfterReady.matchStartReady.has(id)),
        });
      }
    } catch (err: unknown) {
      if (isRoomLifecyclePersistUncertainError(err)) {
        cb?.({
          ok: false,
          error: HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE,
          uncertain: true,
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'unknown error';
      log.info({ roomCode, socketId: socket.id, error: message }, 'ERROR');
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('game:start', async (code, arg2?: unknown, arg3?: unknown) => {
    const roomCode = String(code).trim().toUpperCase();
    const { requestId, cb } = parseGameStartArgs(arg2, arg3);
    log.info(`[game:start] socket=${socket.id}, code=${roomCode}`);
    try {
      const existingRoom = getRoom(roomCode);
      assertRoomDurabilityOperationAllowed(existingRoom, 'match_start');
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      if (!existingRoom.players.includes(playerSeatId)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Only room players can start the game.' });
        return;
      }
      if (existingRoom.players[0] !== playerSeatId) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Only the room host can start the game.' });
        return;
      }
      const liveCount = io.sockets.adapter.rooms.get(roomCode)?.size ?? 0;
      const rosterCount = (
        getRoomRoster(roomCode).length > 0 ? getRoomRoster(roomCode) :
        getRoomPlayersWithFallback(roomCode, existingRoom.players)
      ).length;
      if (liveCount < 2 || rosterCount < 2) {
        if (typeof cb === 'function') cb({ ok: false, error: 'waiting_for_players' });
        return;
      }

      const execute = async () => {
        try {
          markMatchStartReady(roomCode, playerSeatId);
          const startResult = await tryStartMatchIfReady(roomCode, io, buildMatchStartDeps(io));
          const roomForAudit = getRoom(roomCode);
          const auditPlayers = [...roomForAudit.players];
          const auditReady = [...roomForAudit.matchStartReady];
          const auditMissing = auditPlayers.filter((id) => !roomForAudit.matchStartReady.has(id));
          log.info({
            roomCode,
            hostSeatId: playerSeatId,
            socketId: socket.id,
            roomPlayers: auditPlayers,
            matchStartReady: auditReady,
            missing: auditMissing,
            waitingFor: startResult.waitingFor ?? [],
            started: startResult.started,
          }, 'matchStartReady audit');
          if (!startResult.started) {
            const waitingFor = startResult.waitingFor ?? auditMissing;
            io.to(roomCode).emit('room:request_ready', {
              roomCode,
              waitingFor,
            });
            return { ok: false, error: 'waiting_for_ready', waitingFor, started: false };
          }
          const room = getRoom(roomCode);
          log.info(
            `[game:start] game started, handNumber=${room.state?.handNumber}, handOver=${room.state?.handOver}`,
          );
          handlerDeps.notifyRoomPlayersInGame(roomCode);
          await handlerDeps.onAfterMatchStarted(room);
          return {
            ok: true,
            started: true,
            handNumber: room.state?.handNumber ?? null,
            sequence: room.state?.sequence ?? null,
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

      if (typeof cb === 'function') cb(ack);
    } catch (err: unknown) {
      if (isRoomLifecyclePersistUncertainError(err)) {
        if (typeof cb === 'function') {
          cb({
            ok: false,
            error: HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE,
            uncertain: true,
          });
        }
        return;
      }
      const message = err instanceof Error ? err.message : 'unknown error';
      log.info(`[game:start] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });
}
