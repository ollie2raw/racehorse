import type { Server, Socket } from 'socket.io';
import { appendRoomEvent } from '../roomEvents';
import { getRoom } from '../rooms';
import { fetchMatchById } from '../scheduledTournament/persistence';
import { applyMatchResult } from '../scheduledTournament/engine';
import { recordMatchEnd } from '../matchmaking/persistence';
import {
  clearReconnectSeatsForRoom,
  getRoomPlayersWithFallback,
  getRoomRoster,
  requireRoomSessionHandlerDeps,
} from './roomSession';

export type ForfeitLeavingPlayer = {
  id: string;
  username: string;
  userId: string | null;
};

/**
 * Marks a match as forfeited. No-op when already abandoned or game over.
 * Does not remove the seat — leaveTrackedRoom does that after forfeit.
 */
export async function applyActiveMatchForfeit(
  io: Server,
  socket: Socket,
  roomCode: string,
  abandoningPlayer: ForfeitLeavingPlayer,
): Promise<{ winnerUserId: string | null } | null> {
  const handlerDeps = requireRoomSessionHandlerDeps();
  const room = getRoom(roomCode);

  if (room.abandonedAt || room.state?.gameOver) {
    return null;
  }

  const authenticatedUserId =
    handlerDeps.normalizeUserId(abandoningPlayer.userId ?? socket.data?.userId);
  const rosterCached = getRoomRoster(roomCode);
  const roster =
    rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(roomCode, room.players);

  const opponentSeatId = room.players.find((seatId) => seatId !== abandoningPlayer.id) ?? null;
  const opponentPlayer =
    opponentSeatId
      ? roster.find((player) => player.id === opponentSeatId)
        ?? { id: opponentSeatId, socketId: '', username: 'Opponent', userId: null }
      : null;

  const nowIso = new Date().toISOString();
  room.abandonedAt = nowIso;
  room.abandonedByUserId = authenticatedUserId;
  room.abandonedReason = 'forfeit';

  let winnerUserId = opponentPlayer?.userId ?? null;
  if (room.scheduledTournamentMatchId) {
    const match = await fetchMatchById(room.scheduledTournamentMatchId);
    if (!match || !match.player1_id || !match.player2_id) {
      throw new Error('match_not_found');
    }
    winnerUserId =
      match.player1_id === authenticatedUserId ? match.player2_id : match.player1_id;
    const winTarget =
      typeof room.config.winningScore === 'number' && Number.isFinite(room.config.winningScore)
        ? room.config.winningScore
        : 30;
    const statusReason =
      match.player1_id === authenticatedUserId ? 'player1_forfeit' : 'player2_forfeit';
    await applyMatchResult(io, {
      matchId: match.id,
      winnerId: winnerUserId,
      player1Score: match.player1_id === winnerUserId ? winTarget : 0,
      player2Score: match.player2_id === winnerUserId ? winTarget : 0,
      winnerSource: 'forfeit',
      statusReason,
      forfeitUserId: authenticatedUserId,
    });
    console.log('[tournament:forfeit] applied', {
      matchId: match.id,
      tournamentId: match.tournament_id,
      loserId: authenticatedUserId,
      winnerId: winnerUserId,
    });
  }

  if (room.matchmakingMatchId) {
    await recordMatchEnd({
      matchId: room.matchmakingMatchId,
      status: 'forfeit',
      winnerId: winnerUserId,
      playerARatingChange: null,
      playerBRatingChange: null,
      isSim: false,
    });
  }

  room.abandonedWinnerUserId = winnerUserId;
  clearReconnectSeatsForRoom(roomCode);
  appendRoomEvent(room, {
    type: 'player_left',
    actorSocketId: socket.id,
    actorUserId: authenticatedUserId,
    payload: {
      preserveSeat: false,
      playerSeatId: abandoningPlayer.id,
      abandoned: true,
    },
  });
  await handlerDeps.persistRoomMatchLog(room, 'abandoned');
  io.to(roomCode).emit('room:match_abandoned', {
    roomCode,
    abandonedUserId: authenticatedUserId,
    abandonedUsername: abandoningPlayer.username,
    winnerId: winnerUserId,
    message: `${abandoningPlayer.username} left the game`,
    tournamentId: room.scheduledTournamentId ?? null,
    scheduledTournamentMatchId: room.scheduledTournamentMatchId ?? null,
    isTournament: Boolean(room.scheduledTournamentMatchId),
  });

  return { winnerUserId };
}