import { childLogger } from '../logger';
import type { Server, Socket } from 'socket.io';
import { getRoom } from '../rooms';
import { applyActiveMatchForfeit } from './roomForfeit';
import {
  getRoomPlayersWithFallback,
  getRoomRoster,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';
import type { LeaveTrackedRoomFn } from './registerRoomLifecycleHandlers';
import { emitMpAuthorityFunnel } from './mpAuthorityTelemetry';

const log = childLogger('multiplayer:abandon');

export type RegisterRoomAbandonHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  leaveTrackedRoom: LeaveTrackedRoomFn;
};

export function registerRoomAbandonHandlers(
  io: Server,
  socket: Socket,
  params: RegisterRoomAbandonHandlersParams,
): void {
  const { handlerDeps, leaveTrackedRoom } = params;

  socket.on('room:abandon_match', async (payload: unknown, cb?: AckFn) => {
    const roomCode =
      payload && typeof payload === 'object' && !Array.isArray(payload) &&
      typeof (payload as { roomCode?: unknown }).roomCode === 'string'
        ? String((payload as { roomCode: string }).roomCode).trim().toUpperCase()
        : '';
    const authenticatedUserId = handlerDeps.normalizeUserId(socket.data?.userId);
    log.info({
      roomCode,
      userId: authenticatedUserId,
    }, 'request');
    if (!authenticatedUserId) {
      log.info({
        roomCode,
        userId: null,
        reason: 'not_authenticated',
      }, 'rejected');
      cb?.({ ok: false, error: 'not_authenticated' });
      return;
    }
    if (!roomCode) {
      log.info({
        roomCode,
        userId: authenticatedUserId,
        reason: 'missing_code',
      }, 'rejected');
      cb?.({ ok: false, error: 'missing_code' });
      return;
    }

    try {
      const room = getRoom(roomCode);
      if (
        room.abandonedAt ||
        room.state?.gameOver ||
        room.tournamentForfeitApplyStatus === 'pending' ||
        room.tournamentForfeitApplyStatus === 'failed'
      ) {
        const error = room.abandonedAt
          ? 'match_abandoned'
          : room.tournamentForfeitApplyStatus === 'pending'
            ? 'tournament_forfeit_pending'
            : room.tournamentForfeitApplyStatus === 'failed'
              ? 'tournament_forfeit_failed'
              : 'match_completed';
        log.info({
          roomCode,
          userId: authenticatedUserId,
          reason: error,
        }, 'rejected');
        cb?.({ ok: false, error });
        return;
      }

      const rosterCached = getRoomRoster(roomCode);
      const roster =
        rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(roomCode, room.players);
      const abandoningPlayer =
        roster.find((player) => player.userId === authenticatedUserId)
        ?? roster.find((player) => player.socketId === socket.id)
        ?? null;
      if (!abandoningPlayer || !room.players.includes(abandoningPlayer.id)) {
        log.info({
          roomCode,
          userId: authenticatedUserId,
          reason: 'not_player',
        }, 'rejected');
        cb?.({ ok: false, error: 'not_player' });
        return;
      }

      const result = await applyActiveMatchForfeit(io, socket, roomCode, abandoningPlayer, 'manual');
      if (!result) {
        // Re-read after the await: `applyActiveMatchForfeit` is exactly what
        // latches abandonedAt / tournamentForfeitApplyStatus, so the narrowing
        // from the pre-await guard above no longer describes the room.
        const afterApply = getRoom(roomCode);
        const error = afterApply.abandonedAt
          ? 'match_abandoned'
          : afterApply.tournamentForfeitApplyStatus === 'failed'
            ? 'tournament_forfeit_failed'
            : afterApply.tournamentForfeitApplyStatus === 'pending'
              ? 'tournament_forfeit_pending'
              : 'match_completed';
        log.info({
          roomCode,
          userId: authenticatedUserId,
          reason: error,
        }, 'rejected');
        cb?.({ ok: false, error });
        return;
      }

      await leaveTrackedRoom(roomCode);
      log.info({
        roomCode,
        abandonedUserId: authenticatedUserId,
        winnerId: result.winnerUserId,
      }, 'completed');
      emitMpAuthorityFunnel('private_match_abandoned', {
        roomCode,
        extra: {
          abandonedUserId: authenticatedUserId,
          winnerId: result.winnerUserId,
        },
      });
      cb?.({
        ok: true,
        roomCode,
        winnerId: result.winnerUserId,
        isTournament: Boolean(room.scheduledTournamentMatchId),
        tournamentId: room.scheduledTournamentId ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'abandon_failed';
      log.info({
        roomCode,
        userId: authenticatedUserId,
        reason: message,
      }, 'rejected');
      cb?.({ ok: false, error: message });
    }
  });
}