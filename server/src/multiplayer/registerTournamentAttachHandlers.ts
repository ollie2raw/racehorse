import type { Server, Socket } from 'socket.io';
import {
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  getRoomMatchEventMeta,
  peekRoom,
} from '../rooms';
import { fetchMatchById, updateMatch } from '../scheduledTournament/persistence';
import {
  dispatchTournamentMatch,
  humanJoinedAt,
  promoteScheduledMatchToInProgress,
} from '../scheduledTournament/matchDispatch';
import { defaultEnginePersistence } from '../scheduledTournament/persistenceInterface';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import {
  buildMatchStartDeps,
  getHandCounts,
  maskStateForRecipient,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';
import type { AttachSocketToTrackedRoomFn } from './roomSocketAttach';

export type RegisterTournamentAttachHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  attachSocketToTrackedRoom: AttachSocketToTrackedRoomFn;
};

export function registerTournamentAttachHandlers(
  io: Server,
  socket: Socket,
  params: RegisterTournamentAttachHandlersParams,
): void {
  const { handlerDeps, attachSocketToTrackedRoom } = params;

  socket.on('tournament:attach_assigned_match', async (payload: unknown, cb?: AckFn) => {
    let acked = false;
    const ackOnce: AckFn = (response) => {
      if (acked) return;
      acked = true;
      cb?.(response);
    };

    const matchIdFromPayload =
      payload && typeof payload === 'object' && !Array.isArray(payload) &&
      typeof (payload as { matchId?: unknown }).matchId === 'string'
        ? (payload as { matchId: string }).matchId
        : null;

    console.log('[tournament:attach-server] received', {
      socketId: socket.id,
      userId: handlerDeps.normalizeUserId(socket.data?.userId),
      matchId: matchIdFromPayload,
    });
    console.log('[tournament:attach] request', {
      socketId: socket.id,
      userId: handlerDeps.normalizeUserId(socket.data?.userId),
      matchId: matchIdFromPayload,
    });

    try {
      const authenticatedUserId = handlerDeps.normalizeUserId(socket.data?.userId);
      if (!authenticatedUserId) {
        console.log('[tournament:attach-server] rejected/no-user', { socketId: socket.id });
        ackOnce({ ok: false, error: 'not_authenticated' });
        return;
      }
      const matchId = matchIdFromPayload;
      if (!matchId) {
        ackOnce({ ok: false, error: 'missing_matchId' });
        return;
      }
      let match = await fetchMatchById(matchId);
      if (!match) {
        console.log('[tournament:attach-server] rejected/no-match', { matchId, userId: authenticatedUserId });
        ackOnce({ ok: false, error: 'match_not_found' });
        return;
      }
      if (match.status === 'completed' || match.status === 'bye' || match.completed_at || match.winner_id) {
        ackOnce({ ok: false, error: 'match_completed' });
        return;
      }
      if (match.room_code) {
        const existingRoom = peekRoom(match.room_code);
        if (existingRoom?.state?.gameOver) {
          console.log('[room:join] rejected completed room', { roomCode: match.room_code });
          ackOnce({ ok: false, error: 'match_completed' });
          return;
        }
      }
      if (match.player1_id !== authenticatedUserId && match.player2_id !== authenticatedUserId) {
        console.log('[tournament:attach-server] rejected/not-participant', {
          matchId,
          userId: authenticatedUserId,
        });
        ackOnce({ ok: false, error: 'tournament_not_assigned' });
        return;
      }
      if (match.status !== 'ready' && match.status !== 'in_progress') {
        ackOnce({ ok: false, error: 'match_not_ready' });
        return;
      }
      if (!match.room_code) {
        await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true });
        match = await fetchMatchById(matchId);
      }
      if (!match?.room_code) {
        ackOnce({ ok: false, error: 'room_unavailable' });
        return;
      }
      if (peekRoom(match.room_code)) {
        console.log('[tournament:attach-server] room-found', {
          matchId: match.id,
          roomCode: match.room_code,
        });
      } else {
        console.log('[tournament:attach-server] room-missing', {
          matchId: match.id,
          roomCode: match.room_code,
        });
        await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true });
        match = await fetchMatchById(matchId);
        if (!match?.room_code || !peekRoom(match.room_code)) {
          ackOnce({ ok: false, error: 'room_unavailable' });
          return;
        }
        console.log('[tournament:attach-server] rehydrated', {
          matchId: match.id,
          roomCode: match.room_code,
        });
      }

      const seat =
        match.player1_id === authenticatedUserId
          ? 'player1'
          : match.player2_id === authenticatedUserId
            ? 'player2'
            : null;
      console.log('[tournament:attach-server] joining-room', {
        matchId: match.id,
        roomCode: match.room_code,
        userId: authenticatedUserId,
        seat,
      });

      const attached = await attachSocketToTrackedRoom({
        roomCode: match.room_code,
        username: typeof socket.data?.username === 'string' ? socket.data.username : 'Player',
        userId: authenticatedUserId,
        via: 'tournament:attach_assigned_match',
        hydrateMatchmakingRoom: false,
      });
      const nowIso = new Date().toISOString();
      if (!humanJoinedAt(match, authenticatedUserId)) {
        const patch =
          match.player1_id === authenticatedUserId
            ? { player1_joined_at: nowIso }
            : { player2_joined_at: nowIso };
        await updateMatch(match.id, patch);
      }

      let room = attached.room;
      let stateWithCounts = attached.stateWithCounts;
      let rejoinLegalMoves = attached.rejoinLegalMoves;
      let rejoinCanDraw = attached.rejoinCanDraw;

      if (room.scheduledTournamentMatchId && attached.joinedPlayerSeatId && !room.state) {
        markMatchStartReady(room.code, attached.joinedPlayerSeatId);
        const startResult = await tryStartMatchIfReady(room.code, io, buildMatchStartDeps(io));
        if (startResult.started) {
          room = getRoom(room.code);
          await promoteScheduledMatchToInProgress(
            room.scheduledTournamentMatchId!,
            defaultEnginePersistence,
            nowIso,
            authenticatedUserId,
          );
          handlerDeps.notifyRoomPlayersInGame(room.code);
          await handlerDeps.onAfterMatchStarted(room);
          const recipientId = attached.joinedPlayerSeatId;
          stateWithCounts = room.state
            ? (() => {
                const m = maskStateForRecipient(room.state!, recipientId);
                return { ...m, handCounts: getHandCounts(room.state!) };
              })()
            : null;
          rejoinLegalMoves = [];
          rejoinCanDraw = false;
        }
      } else if (room.state && attached.joinedPlayerSeatId) {
        const recipientId = attached.joinedPlayerSeatId;
        stateWithCounts = (() => {
          const m = maskStateForRecipient(room.state!, recipientId);
          return { ...m, handCounts: getHandCounts(room.state!) };
        })();
        rejoinLegalMoves = getRoomLegalMoves(room.code, attached.joinedPlayerSeatId);
        rejoinCanDraw = getRoomCanDraw(room.code, attached.joinedPlayerSeatId);
      }

      const refreshed = await fetchMatchById(match.id);
      const humanAttached = Boolean(humanJoinedAt(refreshed ?? match, authenticatedUserId));
      const matchStatus =
        refreshed?.status === 'in_progress' && humanAttached
          ? 'in_progress'
          : 'ready';
      const youSeat = attached.joinedPlayerSeatId;
      const handCount =
        youSeat && stateWithCounts?.players?.[youSeat]?.hand
          ? stateWithCounts.players[youSeat].hand.length
          : 0;
      console.log('[tournament:attach-server] ack/success', {
        matchId: match.id,
        roomCode: room.code,
        userId: authenticatedUserId,
        seat,
        handCount,
        matchStatus,
      });
      console.log('[tournament:attach-server] accepted', {
        matchId: match.id,
        roomCode: room.code,
        userId: authenticatedUserId,
        seat,
      });
      console.log('[tournament:attach] accepted', {
        matchId: match.id,
        roomCode: room.code,
        userId: authenticatedUserId,
        seat,
      });
      ackOnce({
        ok: true,
        tournamentId: match.tournament_id,
        matchId: match.id,
        matchStatus,
        roomCode: room.code,
        you: attached.joinedPlayerSeatId,
        players: attached.roster,
        state: stateWithCounts,
        legalMoves: rejoinLegalMoves,
        canDraw: rejoinCanDraw,
        eventMeta: getRoomMatchEventMeta(room.code),
        tournamentMatch: attached.tournamentMatchMeta,
        matchStarted: Boolean(room.state),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'attach_failed';
      console.log('[tournament:attach-server] ack/error', {
        matchId: matchIdFromPayload,
        error: message,
      });
      ackOnce({
        ok: false,
        error: message,
      });
    } finally {
      if (!acked) {
        console.log('[tournament:attach-server] ack/error', {
          matchId: matchIdFromPayload,
          error: 'attach_ack_missing',
        });
        ackOnce({ ok: false, error: 'attach_ack_missing' });
      }
    }
  });
}