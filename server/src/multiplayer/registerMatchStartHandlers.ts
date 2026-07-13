import type { Server, Socket } from 'socket.io';
import { getRoom } from '../rooms';
import { defaultEnginePersistence } from '../scheduledTournament/persistenceInterface';
import { promoteScheduledMatchToInProgress } from '../scheduledTournament/matchDispatch';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import { assertRoomDurabilityOperationAllowed } from './roomDurabilityPolicy';
import {
  buildMatchStartDeps,
  getRoomPlayersWithFallback,
  getRoomRoster,
  resolveActorSeatId,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';

export type RegisterMatchStartHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
};

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
        console.log('[player:ready] rejected — seat not in room.players', {
          roomCode,
          playerSeatId,
          socketId: socket.id,
          roomPlayers: [...room.players],
          matchStartReady: [...room.matchStartReady],
        });
        cb?.({ ok: false, error: 'Only room players can ready up.' });
        return;
      }
      console.log('[player:ready] marking seat ready', {
        roomCode,
        playerSeatId,
        socketId: socket.id,
        roomPlayers: [...room.players],
        matchStartReadyBefore: [...room.matchStartReady],
      });
      markMatchStartReady(roomCode, playerSeatId);
      const roomAfterReady = getRoom(roomCode);
      console.log('[player:ready] matchStartReady after mark', {
        roomCode,
        playerSeatId,
        matchStartReady: [...roomAfterReady.matchStartReady],
      });
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
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log('[player:ready] ERROR', { roomCode, socketId: socket.id, error: message });
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('game:start', async (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:start] socket=${socket.id}, code=${roomCode}`);
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
      markMatchStartReady(roomCode, playerSeatId);
      const startResult = await tryStartMatchIfReady(roomCode, io, buildMatchStartDeps(io));
      const roomForAudit = getRoom(roomCode);
      const auditPlayers = [...roomForAudit.players];
      const auditReady = [...roomForAudit.matchStartReady];
      const auditMissing = auditPlayers.filter((id) => !roomForAudit.matchStartReady.has(id));
      console.log('[game:start] matchStartReady audit', {
        roomCode,
        hostSeatId: playerSeatId,
        socketId: socket.id,
        roomPlayers: auditPlayers,
        matchStartReady: auditReady,
        missing: auditMissing,
        waitingFor: startResult.waitingFor ?? [],
        started: startResult.started,
      });
      if (!startResult.started) {
        const waitingFor = startResult.waitingFor ?? auditMissing;
        io.to(roomCode).emit('room:request_ready', {
          roomCode,
          waitingFor,
        });
        if (typeof cb === 'function') {
          cb({ ok: false, error: 'waiting_for_ready', waitingFor });
        }
        return;
      }
      const room = getRoom(roomCode);
      console.log(
        `[game:start] game started, handNumber=${room.state?.handNumber}, handOver=${room.state?.handOver}`,
      );
      handlerDeps.notifyRoomPlayersInGame(roomCode);
      await handlerDeps.onAfterMatchStarted(room);
      if (typeof cb === 'function') cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[game:start] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });
}
