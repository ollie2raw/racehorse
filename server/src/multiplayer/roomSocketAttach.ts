import { childLogger } from '../logger';
import type { Server, Socket } from 'socket.io';
import { appendRoomEvent } from '../roomEvents';
import {
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  joinRoom,
  peekRoom,
  type Room,
} from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { ensureRoomHydrated } from './roomLivePersistence';
import {
  isTerminalHydrationError,
  MatchTerminalJoinError,
  resolveArchivedTerminalJoin,
  throwArchivedTerminalJoinOrError,
} from './matchTerminalJoin';
import { normalizeMatchmakingRoomShellHydrationResult } from '../matchmaking/roomShellHydration';
import { onPlayerSocketRejoined } from './disconnectGrace';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import { assertRoomDurabilityOperationAllowed } from './roomDurabilityPolicy';
import { applyActiveMatchForfeit } from './roomForfeit';
import {
  allocatePlayerSeatId,
  buildHandEndedPayload,
  buildMatchStartDeps,
  clearReconnectSeatsForSocket,
  clearRoomMetadata,
  clearSocketRematchReady,
  cancelRoomCleanup,
  deleteRoomRoster,
  ensureSocketDataSeat,
  evaluateRoomLifecycle,
  getEngineSeatSocketIds,
  getHandCounts,
  getRoomPlayersWithFallback,
  getRoomRoster,
  getSeatIdForSocket,
  identityMatchesReconnectSeat,
  maskStateForRecipient,
  migrateRoomSeat,
  pruneReconnectSeats,
  releaseReconnectSeat,
  resolveActorSeatId,
  setRoomRoster,
  type RoomPlayer,
  type RoomSessionHandlerDeps,
} from './roomSession';
import type { LeaveTrackedRoomFn } from './registerRoomLifecycleHandlers';

const log = childLogger('multiplayer:socket-attach');

export type AttachSocketToTrackedRoomFn = (params: {
  roomCode: string;
  username: string;
  userId: string | null;
  via: 'room:join' | 'tournament:attach_assigned_match';
  hydrateMatchmakingRoom: boolean;
}) => Promise<{
  room: Room;
  joinedPlayerSeatId: string;
  roster: RoomPlayer[];
  stateWithCounts: ReturnType<typeof maskStateForRecipient> & { handCounts?: Record<string, number> } | null;
  rejoinLegalMoves: ReturnType<typeof getRoomLegalMoves>;
  rejoinCanDraw: boolean;
  hydrationOutcome: 'already_in_memory' | 'hydrated' | 'shell_only';
  tournamentMatchMeta: {
    tournamentId: string;
    matchId: string;
    round: 1 | 2 | 3;
    matchNumber: number;
    roomCode: string | null;
    opponentUserId: string | null;
    opponentUsername: string | null;
    opponentRating: number | null;
  } | null;
}>;

export type RoomSocketAttachContext = {
  io: Server;
  socket: Socket;
  handlerDeps: RoomSessionHandlerDeps;
};

export type RoomSocketAttachFns = {
  leaveTrackedRoom: LeaveTrackedRoomFn;
  leaveExistingSocketRooms: () => void;
  attachSocketToTrackedRoom: AttachSocketToTrackedRoomFn;
};

export function createRoomSocketAttach(ctx: RoomSocketAttachContext): RoomSocketAttachFns {
  const { io, socket, handlerDeps } = ctx;

  const leaveTrackedRoom: LeaveTrackedRoomFn = async (
    roomCode: string | undefined,
    options: { preserveSeat?: boolean } = {},
  ): Promise<void> => {
    if (!roomCode) return;
    const code = roomCode.trim().toUpperCase();
    if (!code) return;

    const preserveSeat = Boolean(options.preserveSeat);

    let room: Room | null = null;
    try {
      room = getRoom(code);
    } catch {
      clearRoomMetadata(code);
      cancelRoomCleanup(code);
      socket.leave(code);
      if (socket.data.roomId === code) {
        socket.data.roomId = undefined;
      }
      return;
    }

    const playerSeatId = getSeatIdForSocket(code, socket.id);
    const wasPlayer = playerSeatId ? room.players.includes(playerSeatId) : false;
    clearSocketRematchReady(code, socket.id);

    const shouldForfeit =
      !preserveSeat &&
      wasPlayer &&
      playerSeatId &&
      room.state != null &&
      !room.state.gameOver &&
      !room.abandonedAt;

    if (shouldForfeit) {
      const rosterCached = getRoomRoster(code);
      const roster =
        rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(code, room.players);
      const abandoningPlayer =
        roster.find((player) => player.id === playerSeatId)
        ?? {
          id: playerSeatId,
          socketId: socket.id,
          username: handlerDeps.normalizeUsername(socket.data?.username),
          userId: handlerDeps.normalizeUserId(socket.data?.userId),
        };

      try {
        await applyActiveMatchForfeit(io, socket, code, abandoningPlayer, 'manual');
      } catch (err) {
        log.error({
          roomCode: code,
          playerSeatId,
          error: err instanceof Error ? err.message : err,
        }, 'forfeit failed');
      }
      room = getRoom(code);
    }

    socket.leave(code);
    if (socket.data.roomId === code) {
      socket.data.roomId = undefined;
    }

    if (!preserveSeat && wasPlayer && playerSeatId) {
      if (!room.abandonedAt) {
        appendRoomEvent(room, {
          type: 'player_left',
          actorSocketId: socket.id,
          actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
          payload: {
            preserveSeat,
            playerSeatId,
          },
        });
      }
      room.players = room.players.filter((pid) => pid !== playerSeatId);
      const nextRoster = getRoomRoster(code).filter((player) => player.id !== playerSeatId);
      if (nextRoster.length > 0) {
        setRoomRoster(code, nextRoster);
      } else {
        deleteRoomRoster(code);
      }

      clearReconnectSeatsForSocket(code, socket.id);

      io.to(code).emit('room:update', { players: nextRoster });
    }

    evaluateRoomLifecycle(code);
  };

  (socket as Socket & { __leaveTrackedRoom: typeof leaveTrackedRoom }).__leaveTrackedRoom = leaveTrackedRoom;

  const leaveExistingSocketRooms = () => {
    const previousRooms = [...socket.rooms].filter((roomId) => roomId !== socket.id);
    previousRooms.forEach((roomId) => {
      void leaveTrackedRoom(roomId);
    });
    socket.data.roomId = undefined;
  };

  const attachSocketToTrackedRoom: AttachSocketToTrackedRoomFn = async (params) => {
    const { roomCode, username, userId, via, hydrateMatchmakingRoom } = params;
    clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
    leaveExistingSocketRooms();

    const hydrated = await ensureRoomHydrated(roomCode);
    if (hydrated.kind === 'hydrated' && hydrated.restoredRoster.length > 0) {
      setRoomRoster(
        roomCode,
        hydrated.restoredRoster.map((entry) => ({
          id: entry.seatId,
          socketId: '',
          username: entry.username,
          userId: entry.userId,
        })),
      );
      log.info({ roomCode, seats: hydrated.restoredRoster.length, via }, 'live-session roster restored');
    }
    if (hydrated.kind === 'persistence_unavailable') {
      throw new Error('room_persistence_unavailable');
    }
    if (hydrated.kind === 'snapshot_freshness_unknown') {
      throw new Error('room_snapshot_uncommitted');
    }
    if (hydrated.kind === 'snapshot_invalid' || hydrated.kind === 'snapshot_stale') {
      if (isTerminalHydrationError(hydrated.error)) {
        await throwArchivedTerminalJoinOrError(roomCode, hydrated.error);
      }
      throw new Error(hydrated.error);
    }

    const shellHydrationResult =
      (hydrated.kind === 'not_found' || hydrated.kind === 'shell_only') &&
      hydrateMatchmakingRoom &&
      !peekRoom(roomCode)
        ? normalizeMatchmakingRoomShellHydrationResult(
            await handlerDeps.tryHydrateMatchmakingRoomShell(roomCode),
            roomCode,
          )
        : { kind: 'skipped' as const };
    if (shellHydrationResult.kind === 'persistence_unavailable') {
      throw new Error('room_persistence_unavailable');
    }
    if (hydrated.kind === 'shell_only' && shellHydrationResult.kind !== 'shell_only') {
      throw new Error('room_shell_only');
    }

    let existingRoom = peekRoom(roomCode);
    if (!existingRoom) {
      const archivedTerminal = await resolveArchivedTerminalJoin(roomCode);
      if (archivedTerminal) {
        log.info(
          { roomCode, matchId: archivedTerminal.terminal.matchId, via },
          'join rejected: archived terminal match',
        );
        throw archivedTerminal;
      }
      const message = 'Room not found.';
      log.info(
        `[${via}] ERROR: ${message} live=${hydrated.kind} shell=${shellHydrationResult.kind}`,
      );
      throw new Error(message);
    }
    if (existingRoom.abandonedAt) {
      const archivedTerminal = await resolveArchivedTerminalJoin(roomCode);
      if (archivedTerminal) throw archivedTerminal;
      throw new Error('match_abandoned');
    }
    if (existingRoom.state?.gameOver) {
      const archivedTerminal = await resolveArchivedTerminalJoin(roomCode);
      if (archivedTerminal) {
        log.info(
          { roomCode, matchId: archivedTerminal.terminal.matchId, via },
          'join rejected: archived terminal match',
        );
        throw archivedTerminal;
      }
      log.info({ roomCode }, 'rejected completed room');
      throw new Error('match_completed');
    }
    let room: Room | null = null;
    let roster: RoomPlayer[] = [];
    let migratedByUserId = false;
    roster = (
      getRoomRoster(roomCode).length > 0 ? getRoomRoster(roomCode) :
      getRoomPlayersWithFallback(roomCode, existingRoom.players)
    ).slice();
    if (existingRoom && userId) {
      const existingPlayer = roster.find((player) => player.userId === userId);
      if (existingPlayer) {
        assertRoomDurabilityOperationAllowed(existingRoom, 'reconnect_existing_player', {
          attachSource: hydrated.kind === 'hydrated' ? 'hydrated' : 'already_in_memory',
        });
        const oldSocket = existingPlayer.socketId
          ? io.sockets.sockets.get(existingPlayer.socketId)
          : undefined;
        const oldSocketId = oldSocket && oldSocket.id !== socket.id ? oldSocket.id : null;

        // Migrate seat authority to the new socket BEFORE disconnecting the old
        // one. Seat ownership (roomSession's roster.socketId + socket.data.playerId)
        // is what resolveActorSeatId trusts to authorize gameplay/recovery actions.
        // If we disconnected the old socket first and migrated afterward, any
        // action the old socket sends while its transport is still tearing down
        // (disconnect(true) is not instantaneous) would still resolve to this
        // seat and be accepted as authoritative — a duplicate-tab race. Doing the
        // migration first closes that window: the moment we hand off, the old
        // socket can no longer resolve to this seat by any path.
        log.info(`[${via}] RECONNECT: migrating seat ${existingPlayer.id} socket -> ${socket.id} for userId=${userId}`);
        migrateRoomSeat(roomCode, existingPlayer.id, socket.id);
        roster = roster.map((player) =>
          player.id === existingPlayer.id
            ? { ...player, socketId: socket.id, username, userId }
            : player,
        );
        setRoomRoster(roomCode, roster);
        socket.data.roomId = roomCode;
        ensureSocketDataSeat(socket, existingPlayer.id);
        room = existingRoom;
        migratedByUserId = true;
        appendRoomEvent(room, {
          type: 'player_reconnected',
          actorSocketId: socket.id,
          actorUserId: userId,
          payload: {
            previousSocketId: existingPlayer.socketId,
            playerSeatId: existingPlayer.id,
            username,
          },
        });

        if (oldSocket && oldSocketId && oldSocket.connected) {
          log.info(`[${via}] SUPERSEDE: old socket ${oldSocket.id} for userId=${userId}, new socket ${socket.id} taking over`);
          // Order matters: invalidate cached seat identity and leave the
          // room's channel BEFORE disconnecting, so resolveActorSeatId
          // already rejects this socket even in the brief window before the
          // transport actually tears down (a resend racing the disconnect
          // gets an explicit ack rejection, not just a dropped connection).
          if (oldSocket.data?.playerId === existingPlayer.id) {
            oldSocket.data.playerId = undefined;
          }
          if (oldSocket.data?.roomId === roomCode) {
            oldSocket.data.roomId = undefined;
          }
          oldSocket.leave(roomCode);
          oldSocket.emit('room:session:superseded', { reason: 'new_session', newSocketId: socket.id });
          // Leaving a superseded socket connected is a real resource leak:
          // socket.io's ping/pong keepalive (pingTimeout/pingInterval in
          // index.ts) only reaps genuinely dead connections — a merely-open
          // stale tab keeps answering pings forever with zero application
          // code involved, so an unclosed old tab (or repeated
          // refreshes/second-tabs) would accumulate live connections
          // indefinitely. Force-disconnect once the seat is safely
          // reassigned; correctness no longer depends on this (that's
          // resolveActorSeatId's job now), this is purely resource cleanup.
          // A brief delay before the actual teardown gives an in-flight
          // client reaction to the supersede notice (e.g. its own stale
          // action attempt) a real round trip to land and be rejected by an
          // explicit ack, rather than the transport already being gone by
          // the time it arrives — disconnect(true) alone closes immediately
          // with no such window.
          await new Promise((resolve) => setTimeout(resolve, 150));
          oldSocket.disconnect(true);
        }
      }
    }
    let joinedPlayerSeatId: string | null = migratedByUserId
      ? roster.find((player) => player.userId === userId)?.id ?? null
      : null;
    if (!migratedByUserId) {
      try {
        const reconnectCandidate = pruneReconnectSeats(roomCode).find((seat) =>
          identityMatchesReconnectSeat(seat, {
            username,
            userId,
          }),
        );
        assertRoomDurabilityOperationAllowed(
          existingRoom,
          reconnectCandidate ? 'reconnect_existing_player' : 'join_new_player',
          {
            attachSource: hydrated.kind === 'hydrated' ? 'hydrated' : 'already_in_memory',
          },
        );
        joinedPlayerSeatId = allocatePlayerSeatId();
        room = joinRoom(roomCode, joinedPlayerSeatId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        if (!message.toLowerCase().includes('room is full')) {
          throw err;
        }
        const seats = pruneReconnectSeats(roomCode);
        const match = seats.find((seat) =>
          identityMatchesReconnectSeat(seat, {
            username,
            userId,
          }),
        );
        if (!match) throw err;
        assertRoomDurabilityOperationAllowed(existingRoom, 'reconnect_existing_player', {
          attachSource: hydrated.kind === 'hydrated' ? 'hydrated' : 'already_in_memory',
        });
        joinedPlayerSeatId = match.seatId;
        migrateRoomSeat(roomCode, match.seatId, socket.id);
        releaseReconnectSeat(roomCode, match.seatId);
        const rosterIdx = roster.findIndex((player) => player.id === match.seatId);
        if (rosterIdx >= 0) {
          roster[rosterIdx] = { ...roster[rosterIdx], socketId: socket.id, username, userId };
        } else {
          roster.push({
            id: match.seatId,
            socketId: socket.id,
            username,
            userId,
          });
        }
        room = getRoom(roomCode);
      }
    }
    if (!room) throw new Error('Room not found.');
    if (!joinedPlayerSeatId) {
      joinedPlayerSeatId = resolveActorSeatId(room.code, socket);
    }
    socket.join(room.code);
    socket.data.roomId = room.code;
    socket.data.username = username;
    socket.data.userId = userId;
    ensureSocketDataSeat(socket, joinedPlayerSeatId);
    const existingIdx = roster.findIndex((p) => p.id === joinedPlayerSeatId);
    if (existingIdx >= 0) {
      roster[existingIdx] = {
        id: joinedPlayerSeatId,
        socketId: socket.id,
        username,
        userId,
      };
    } else {
      roster.push({ id: joinedPlayerSeatId, socketId: socket.id, username, userId });
      appendRoomEvent(room, {
        type: 'player_joined',
        actorSocketId: socket.id,
        actorUserId: userId,
        payload: {
          username,
          via,
        },
      });
    }
    setRoomRoster(room.code, roster);
    io.to(room.code).emit('room:update', { players: roster });
    log.info(`[${via}] joined room=${room.code}, players=${room.players.length}`);

    if (room.matchmakingMatchId && !room.state) {
      markMatchStartReady(room.code, joinedPlayerSeatId);

      const mmSeatSockets = getEngineSeatSocketIds(room.code, [...room.players]);
      if (mmSeatSockets.length >= 2) {
        try {
          await handlerDeps.waitUntilMatchmakingRoomSocketsReady(io, room.code, mmSeatSockets);
          const startResult = await tryStartMatchIfReady(room.code, io, buildMatchStartDeps(io));
          if (startResult.started) {
            room = getRoom(room.code);
            log.info({ roomCode: room.code, socketId: socket.id, via }, 'matchmaking auto-started');
          }
        } catch (startErr) {
          log.warn({ err: startErr, via }, 'matchmaking auto-start failed');
        }
      }
    }

    const recipientId = joinedPlayerSeatId;
    const stateWithCounts = room.state
      ? (() => {
          const m = maskStateForRecipient(room.state!, recipientId);
          return { ...m, handCounts: getHandCounts(room.state!) };
        })()
      : null;

    const rejoinLegalMoves = room.state ? getRoomLegalMoves(room.code, joinedPlayerSeatId) : [];
    const rejoinCanDraw = room.state ? getRoomCanDraw(room.code, joinedPlayerSeatId) : false;

    let tournamentMatchMeta:
      | {
          tournamentId: string;
          matchId: string;
          round: 1 | 2 | 3;
          matchNumber: number;
          roomCode: string | null;
          opponentUserId: string | null;
          opponentUsername: string | null;
          opponentRating: number | null;
        }
      | null = null;
    if (room.scheduledTournamentMatchId && room.scheduledTournamentId) {
      try {
        const matchRows = await supabaseFetch<Array<{
          id: string;
          tournament_id: string;
          round: 1 | 2 | 3;
          match_number: number;
          room_code: string | null;
          player1_id: string | null;
          player2_id: string | null;
        }>>(
          `/rest/v1/scheduled_tournament_matches` +
            `?select=id,tournament_id,round,match_number,room_code,player1_id,player2_id` +
            `&id=eq.${encodeURIComponent(room.scheduledTournamentMatchId)}&limit=1`,
        );
        const match = matchRows[0];
        if (match) {
          const opponentUserId =
            userId && match.player1_id === userId
              ? match.player2_id
              : userId && match.player2_id === userId
                ? match.player1_id
                : null;
          let opponentUsername: string | null = null;
          let opponentRating: number | null = null;
          if (opponentUserId) {
            try {
              const profiles = await supabaseFetch<Array<{
                username: string | null;
                glicko_rating: number | null;
              }>>(
                `/rest/v1/profiles?select=username,glicko_rating&id=eq.${encodeURIComponent(opponentUserId)}&limit=1`,
              );
              opponentUsername = profiles[0]?.username ?? null;
              opponentRating = profiles[0]?.glicko_rating ?? null;
            } catch {
              /* profile lookup is best-effort */
            }
          }
          tournamentMatchMeta = {
            tournamentId: match.tournament_id,
            matchId: match.id,
            round: match.round,
            matchNumber: match.match_number,
            roomCode: match.room_code,
            opponentUserId,
            opponentUsername,
            opponentRating,
          };
        }
      } catch {
        /* tournament metadata is best-effort — never block attach on this */
      }
    }

    if (room.state && !room.preGameDraw) {
      if (room.state.handOver && !room.state.gameOver) {
        const payload = buildHandEndedPayload(room, joinedPlayerSeatId);
        if (payload) {
          socket.emit('hand:ended', payload);
        }
      }
    }

    onPlayerSocketRejoined(room.code, io, joinedPlayerSeatId);
    evaluateRoomLifecycle(room.code);

    const hydrationOutcome =
      shellHydrationResult.kind === 'shell_only'
        ? 'shell_only'
        : hydrated.kind === 'hydrated'
          ? 'hydrated'
          : 'already_in_memory';

    return {
      room,
      joinedPlayerSeatId,
      roster,
      stateWithCounts,
      rejoinLegalMoves,
      rejoinCanDraw,
      hydrationOutcome,
      tournamentMatchMeta,
    };
  };

  return { leaveTrackedRoom, leaveExistingSocketRooms, attachSocketToTrackedRoom };
}
