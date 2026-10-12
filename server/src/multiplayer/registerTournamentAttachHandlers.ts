import { childLogger } from '../logger';
import { getTournamentClockState } from './tournamentTurnClock';
import { ackWithServerNow } from '../scheduledTournament/serverNow';
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
import { isTournamentsEnabled, TOURNAMENTS_DISABLED } from '../scheduledTournament/tournamentsFeature';

const log = childLogger('multiplayer:tournament-attach');

/** The longest an attach waits for the socket's identify still in flight. */
const IDENTIFY_WAIT_MS = 5_000;

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

  socket.on('tournament:attach_assigned_match', async (payload: unknown, rawCb?: AckFn) => {
    const cb = ackWithServerNow(rawCb);
    if (!isTournamentsEnabled()) {
      cb?.(TOURNAMENTS_DISABLED);
      return;
    }
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
      // A reconnected socket's identify may still be in flight (Phase 4A dev
      // finding: the re-attach after a server restart was refused as
      // not_authenticated a few milliseconds before the identify completed).
      const identifyPending = socket.data?.identifyPending as Promise<void> | undefined;
      if (!handlerDeps.normalizeUserId(socket.data?.userId) && identifyPending) {
        let waitTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          identifyPending,
          new Promise<void>((resolve) => { waitTimer = setTimeout(resolve, IDENTIFY_WAIT_MS); }),
        ]);
        if (waitTimer) clearTimeout(waitTimer);
      }
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
      if (peekRoom(match.room_code)?.scheduledTournamentMatchId === match.id) {
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
        tournamentMatchId: match.id,
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
        }
      }

      const refreshed = await fetchMatchById(match.id);
      // The position as it is now, not before the awaits above: when Fritz starts,
      // its first move (0.8-1.5 s after the deal) can land while the match row is
      // written and read back, and an older position in the ack would be applied
      // after that move's update (Phase 4A dev finding: "Fritz is thinking" on the
      // player's own turn until missed turns forfeited the match).
      if (room.state && attached.joinedPlayerSeatId) {
        const recipientId = attached.joinedPlayerSeatId;
        const m = maskStateForRecipient(room.state, recipientId);
        stateWithCounts = { ...m, handCounts: getHandCounts(room.state) };
        rejoinLegalMoves = getRoomLegalMoves(room.code, recipientId);
        rejoinCanDraw = getRoomCanDraw(room.code, recipientId);
      }
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
        // The clock already running for this state (attach after it armed); serverNow is on every ack.
        tournamentClock: getTournamentClockState(room.code),
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