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
import { processRealtimeMultiplayerGame } from '../ranking/periodService';
import { insertRankedGameIdempotent } from '../ranking/insertRankedGameIdempotent';
import { supabaseFetch } from '../supabaseUtils';

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
  forfeitReason: 'manual' | 'disconnect_timeout' = 'manual',
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

  // Calculate forfeit scores and run Glicko-2 updates for ranked multiplayer games
  let ratingResult: any = null;
  const isPrivate = !room.scheduledTournamentMatchId && !room.scheduledTournamentId;
  const aId = room.players[0];
  const bId = room.players[1];
  const a = roster.find((p) => p.id === aId) ?? { id: aId, socketId: '', username: 'Guest', userId: null };
  const b = roster.find((p) => p.id === bId) ?? { id: bId, socketId: '', username: 'Guest', userId: null };

  const loserActualScore = room.state?.players[abandoningPlayer.id]?.score ?? 0;
  const winnerActualScore = opponentSeatId ? (room.state?.players[opponentSeatId]?.score ?? 0) : 0;

  const winnerScore = Math.max(60, winnerActualScore);
  const loserScore = Math.min(loserActualScore, winnerScore - 5);

  const scoreA = abandoningPlayer.id === aId ? loserScore : winnerScore;
  const scoreB = abandoningPlayer.id === aId ? winnerScore : loserScore;

  if (
    isPrivate &&
    a.userId &&
    b.userId &&
    Math.max(loserActualScore, winnerActualScore) >= 10
  ) {
    try {
      const [profilesA, profilesB] = await Promise.all([
        supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${a.userId}`),
        supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${b.userId}`),
      ]);
      const profileA = profilesA?.[0];
      const profileB = profilesB?.[0];

      if (profileA && profileB) {
        const sourceMatchId = room.matchId ?? `forfeit-${room.code}-${Date.now()}`;

        const [insertA, insertB] = await Promise.all([
          insertRankedGameIdempotent({
            playerId: a.userId,
            opponentId: b.userId,
            playerScore: scoreA,
            opponentScore: scoreB,
            gameType: 'multiplayer',
            ratingBefore: profileA.glicko_rating,
            rdBefore: profileA.glicko_rd,
            playedAt: nowIso,
            source: { sourceType: 'live_room', sourceMatchId },
          }),
          insertRankedGameIdempotent({
            playerId: b.userId,
            opponentId: a.userId,
            playerScore: scoreB,
            opponentScore: scoreA,
            gameType: 'multiplayer',
            ratingBefore: profileB.glicko_rating,
            rdBefore: profileB.glicko_rd,
            playedAt: nowIso,
            source: { sourceType: 'live_room', sourceMatchId },
          }),
        ]);

        if (insertA.isNew && insertB.isNew && insertA.game && insertB.game) {
          const ratingScale = forfeitReason === 'disconnect_timeout' ? 0.5 : 1.0;
          ratingResult = await processRealtimeMultiplayerGame({
            playerAProfile: profileA,
            playerBProfile: profileB,
            playerAGame: insertA.game,
            playerBGame: insertB.game,
            ratingScale,
          });

          console.log('[Ranking] Forfeit rating update complete', {
            roomCode: room.code,
            loserId: abandoningPlayer.userId,
            winnerId: winnerUserId,
            forfeitReason,
            ratingScale,
            deltaA: ratingResult.playerA.delta,
            deltaB: ratingResult.playerB.delta,
          });
        }
      }
    } catch (err) {
      console.error('[Ranking] Forfeit rating update failed:', err);
    }
  }

  if (room.matchmakingMatchId) {
    await recordMatchEnd({
      matchId: room.matchmakingMatchId,
      status: 'forfeit',
      winnerId: winnerUserId,
      playerARatingChange: ratingResult?.playerA?.delta ?? null,
      playerBRatingChange: ratingResult?.playerB?.delta ?? null,
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