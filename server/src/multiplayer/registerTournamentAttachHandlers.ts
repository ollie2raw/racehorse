import { childLogger } from '../logger';
import type { Server, Socket } from 'socket.io';
import {
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  getRoomMatchEventMeta,
  peekRoom,
} from '../rooms';
import { fetchMatchById, updateMatch } from '../scheduledTournament/persistence';
import { authorizeMatchParticipant, matchAuthzAck } from '../scheduledTournament/tournamentAuth';
import type { MatchRow } from '../scheduledTournament/types';
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

const log = childLogger('multiplayer:tournament-attach');

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

    log.info({
      socketId: socket.id,
      userId: handlerDeps.normalizeUserId(socket.data?.userId),
      matchId: matchIdFromPayload,
    }, 'received');
    log.info({
      socketId: socket.id,
      userId: handlerDeps.normalizeUserId(socket.data?.userId),
      matchId: matchIdFromPayload,
    }, 'request');

    try {
      const authenticatedUserId = handlerDeps.normalizeUserId(socket.data?.userId);
      const matchId = matchIdFromPayload;
      if (!matchId) {
        ackOnce({ ok: false, error: 'missing_matchId' });
        return;
      }

      const authz = await authorizeMatchParticipant(authenticatedUserId, { matchId });
      if (!authz.ok) {
        log.info({ matchId, userId: authenticatedUserId, code: authz.code }, 'rejected/authz');
        ackOnce(matchAuthzAck(authz.code));
        return;
      }
      // authz.ok ⇒ a verified, non-null participant of this fresh match row.
      const participantUserId: string = authenticatedUserId as string;
      const authorizedMatch = authz.match;

      if (authorizedMatch.room_code) {
        const existingRoom = peekRoom(authorizedMatch.room_code);
        if (existingRoom?.state?.gameOver) {
          log.info({ roomCode: authorizedMatch.room_code }, 'rejected completed room');
          ackOnce({ ok: false, error: 'match_completed' });
          return;
        }
      }
      if (authorizedMatch.status !== 'ready' && authorizedMatch.status !== 'in_progress') {
        ackOnce({ ok: false, error: 'match_not_ready' });
        return;
      }

      let match: MatchRow | null = authorizedMatch;
      if (!match.room_code) {
        await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true });
        match = await fetchMatchById(matchId);
      }
      if (!match?.room_code) {
        ackOnce({ ok: false, error: 'room_unavailable' });
        return;
      }
      if (peekRoom(match.room_code)) {
        log.info({
          matchId: match.id,
          roomCode: match.room_code,
        }, 'room-found');
      } else {
        log.info({
          matchId: match.id,
          roomCode: match.room_code,
        }, 'room-missing');
        await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true });
        match = await fetchMatchById(matchId);
        if (!match?.room_code || !peekRoom(match.room_code)) {
          ackOnce({ ok: false, error: 'room_unavailable' });
          return;
        }
        log.info({
          matchId: match.id,
          roomCode: match.room_code,
        }, 'rehydrated');
      }

      const seat =
        match.player1_id === participantUserId
          ? 'player1'
          : match.player2_id === participantUserId
            ? 'player2'
            : null;
      log.info({
        matchId: match.id,
        roomCode: match.room_code,
        userId: participantUserId,
        seat,
      }, 'joining-room');

      const attached = await attachSocketToTrackedRoom({
        roomCode: match.room_code,
        username: typeof socket.data?.username === 'string' ? socket.data.username : 'Player',
        userId: participantUserId,
        via: 'tournament:attach_assigned_match',
        hydrateMatchmakingRoom: false,
      });
      const nowIso = new Date().toISOString();
      if (!humanJoinedAt(match, participantUserId)) {
        const patch =
          match.player1_id === participantUserId
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
            participantUserId,
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
      const humanAttached = Boolean(humanJoinedAt(refreshed ?? match, participantUserId));
      const matchStatus =
        refreshed?.status === 'in_progress' && humanAttached
          ? 'in_progress'
          : 'ready';
      const youSeat = attached.joinedPlayerSeatId;
      const handCount =
        youSeat && stateWithCounts?.players?.[youSeat]?.hand
          ? stateWithCounts.players[youSeat].hand.length
          : 0;
      log.info({
        matchId: match.id,
        roomCode: room.code,
        userId: participantUserId,
        seat,
        handCount,
        matchStatus,
      }, 'ack/success');
      log.info({
        matchId: match.id,
        roomCode: room.code,
        userId: participantUserId,
        seat,
      }, 'accepted');
      log.info({
        matchId: match.id,
        roomCode: room.code,
        userId: participantUserId,
        seat,
      }, 'accepted');
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
      log.info({
        matchId: matchIdFromPayload,
        error: message,
      }, 'ack/error');
      ackOnce({
        ok: false,
        error: message,
      });
    } finally {
      if (!acked) {
        log.info({
          matchId: matchIdFromPayload,
          error: 'attach_ack_missing',
        }, 'ack/error');
        ackOnce({ ok: false, error: 'attach_ack_missing' });
      }
    }
  });
}