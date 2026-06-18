import type { Server, Socket } from 'socket.io';
import { appendRoomEvent, resetRoomEventLog } from '../roomEvents';
import {
  act,
  createRoom,
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  getRoomMatchEventMeta,
  joinRoom,
  peekRoom,
  readyForNextHand,
  startGame,
  type Room,
} from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { fetchMatchById, updateMatch } from '../scheduledTournament/persistence';
import {
  dispatchTournamentMatch,
  humanJoinedAt,
  promoteScheduledMatchToInProgress,
} from '../scheduledTournament/matchDispatch';
import { applyMatchResult } from '../scheduledTournament/engine';
import { defaultEnginePersistence } from '../scheduledTournament/persistenceInterface';
import { recordMatchEnd } from '../matchmaking/persistence';
import { ensureRoomHydrated, schedulePersistLiveRoomSessionForRoom } from './roomLivePersistence';
import {
  onActivePlayerSocketDisconnect,
  onPlayerSocketRejoined,
} from './disconnectGrace';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import { withRoomGameplayLock } from './roomGameplayLock';
import { sanitizePrivateRoomConfig } from './privateRoomConfig';
import {
  allocatePlayerSeatId,
  broadcastStateUpdate,
  buildHandEndedPayload,
  buildMatchStartDeps,
  clearReconnectSeatsForRoom,
  clearReconnectSeatsForSocket,
  clearRoomMetadata,
  clearSocketRematchReady,
  cancelRoomCleanup,
  deleteRoomRoster,
  emitForcedDrawAnimationPayload,
  emitRematchStatus,
  ensureSocketDataSeat,
  evaluateRoomLifecycle,
  getEngineSeatSocketIds,
  getHandCounts,
  getRoomPlayersWithFallback,
  getRoomRoster,
  getSeatIdForSocket,
  getSocketForSeat,
  identityMatchesReconnectSeat,
  maskStateForRecipient,
  migrateRoomSeat,
  pruneReconnectSeats,
  releaseReconnectSeat,
  reserveReconnectSeat,
  resolveActorSeatId,
  requireRoomSessionHandlerDeps,
  setRoomRoster,
  waitForActiveGameOverPersist,
  type AckFn,
  type RoomJoinConfig,
  type RoomPlayer,
} from './roomSession';

type ForfeitLeavingPlayer = {
  id: string;
  username: string;
  userId: string | null;
};

/**
 * Marks a match as forfeited. No-op when already abandoned or game over.
 * Does not remove the seat — leaveTrackedRoom does that after forfeit.
 */
async function applyActiveMatchForfeit(
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

export function registerRoomSessionHandlers(io: Server, socket: Socket): void {
  const handlerDeps = requireRoomSessionHandlerDeps();

    const leaveTrackedRoom = async (
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
          await applyActiveMatchForfeit(io, socket, code, abandoningPlayer);
        } catch (err) {
          console.error('[room:leave] forfeit failed', {
            roomCode: code,
            playerSeatId,
            error: err instanceof Error ? err.message : err,
          });
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

    (socket as any).__leaveTrackedRoom = leaveTrackedRoom;

    const leaveExistingSocketRooms = () => {
      const previousRooms = [...socket.rooms].filter((roomId) => roomId !== socket.id);
      previousRooms.forEach((roomId) => {
        void leaveTrackedRoom(roomId);
      });
      socket.data.roomId = undefined;
    };

    const attachSocketToTrackedRoom = async (params: {
      roomCode: string;
      username: string;
      userId: string | null;
      via: 'room:join' | 'tournament:attach_assigned_match';
      hydrateMatchmakingRoom: boolean;
    }) => {
      const { roomCode, username, userId, via, hydrateMatchmakingRoom } = params;
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();

      const hydrated = await ensureRoomHydrated(roomCode);
      if (hydrated?.source === 'database' && hydrated.restoredRoster.length > 0) {
        setRoomRoster(
          roomCode,
          hydrated.restoredRoster.map((entry) => ({
            id: entry.seatId,
            socketId: '',
            username: entry.username,
            userId: entry.userId,
          })),
        );
        console.log(`[${via}] live-session roster restored`, {
          roomCode,
          seats: hydrated.restoredRoster.length,
        });
      }

      const hydrateResult = hydrateMatchmakingRoom
        ? !peekRoom(roomCode)
          ? await handlerDeps.tryHydrateMatchmakingRoomShell(roomCode)
          : ('skipped' as const)
        : 'skipped';
      let existingRoom = peekRoom(roomCode);
      if (!existingRoom) {
        const message = 'Room not found.';
        console.log(`[${via}] ERROR: ${message} hydrate=${hydrateResult}`);
        throw new Error(message);
      }
      if (existingRoom.abandonedAt) {
        throw new Error('match_abandoned');
      }
      if (existingRoom.state?.gameOver) {
        console.log('[room:join] rejected completed room', { roomCode });
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
          const oldSocket = existingPlayer.socketId
            ? io.sockets.sockets.get(existingPlayer.socketId)
            : undefined;
          if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
            console.log(`[${via}] FORCE-DISCONNECT: old socket ${oldSocket.id} for userId=${userId}, new socket ${socket.id} taking over`);
            oldSocket.emit('room:session:superseded', { reason: 'new_session', newSocketId: socket.id });
            oldSocket.disconnect(true);
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          console.log(`[${via}] RECONNECT: migrating seat ${existingPlayer.id} socket -> ${socket.id} for userId=${userId}`);
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
        }
      }
      let joinedPlayerSeatId: string | null = migratedByUserId
        ? roster.find((player) => player.userId === userId)?.id ?? null
        : null;
      if (!migratedByUserId) {
        try {
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
      console.log(`[${via}] joined room=${room.code}, players=${room.players.length}`);

      if (room.matchmakingMatchId && !room.state) {
        markMatchStartReady(room.code, joinedPlayerSeatId);

        const mmSeatSockets = getEngineSeatSocketIds(room.code, [...room.players]);
        if (mmSeatSockets.length >= 2) {
          try {
            await handlerDeps.waitUntilMatchmakingRoomSocketsReady(io, room.code, mmSeatSockets);
            const startResult = await tryStartMatchIfReady(room.code, io, buildMatchStartDeps(io));
            if (startResult.started) {
              room = getRoom(room.code);
              console.log(`[${via}] matchmaking auto-started`, {
                roomCode: room.code,
                socketId: socket.id,
              });
            }
          } catch (startErr) {
            console.warn(
              `[${via}] matchmaking auto-start failed`,
              startErr instanceof Error ? startErr.message : startErr,
            );
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

      if (room.state) {
        if (room.state.handOver && !room.state.gameOver) {
          const payload = buildHandEndedPayload(room, joinedPlayerSeatId);
          if (payload) {
            socket.emit('hand:ended', payload);
          }
        }
      }

      onPlayerSocketRejoined(room.code, io, joinedPlayerSeatId);
      evaluateRoomLifecycle(room.code);

      return {
        room,
        joinedPlayerSeatId,
        roster,
        stateWithCounts,
        rejoinLegalMoves,
        rejoinCanDraw,
        tournamentMatchMeta,
      };
    };

    socket.on('room:create', async (arg1?: unknown, arg2?: unknown) => {
      const config = (
        arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
      ) as RoomJoinConfig;
      const cb = (typeof arg1 === 'function' ? arg1 : arg2) as AckFn | undefined;
      const {
        username: _ignoredUsername,
        userId: _ignoredUserId,
        authToken: _ignoredAuthToken,
        ...roomConfig
      } = config as Record<string, unknown>;
      console.log(`[room:create] socket=${socket.id}`);
      try {
        const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
        clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
        leaveExistingSocketRooms();
        const playerSeatId = allocatePlayerSeatId();
        const room = createRoom(playerSeatId, sanitizePrivateRoomConfig(roomConfig));
        socket.join(room.code);
        socket.data.roomId = room.code;
        socket.data.username = username;
        socket.data.userId = userId;
        ensureSocketDataSeat(socket, playerSeatId);
        const roomPlayers: RoomPlayer[] = [{ id: playerSeatId, socketId: socket.id, username, userId }];
        setRoomRoster(room.code, roomPlayers);
        schedulePersistLiveRoomSessionForRoom(room);
        appendRoomEvent(room, {
          type: 'player_joined',
          actorSocketId: socket.id,
          actorUserId: userId,
          payload: {
            username,
            via: 'room:create',
          },
        });
        console.log(`[room:create] created room=${room.code}, players=${room.players.length}`);
        cb?.({
          ok: true,
          roomCode: room.code,
          you: playerSeatId,
          players: roomPlayers,
          eventMeta: getRoomMatchEventMeta(room.code),
          matchStarted: false,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.log(`[room:create] ERROR: ${message}`);
        cb?.({ ok: false, error: message });
      }
    });


  socket.on('room:spectate', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
      const cb = (
        typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
      ) as AckFn | undefined;
      const config =
        arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : {};
      const code = String(argCode ?? '').trim().toUpperCase();
      try {
        const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
        if (!code) return cb?.({ ok: false, error: 'missing_code' });
        clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
        leaveExistingSocketRooms();

        let room: Room | null = null;
        try {
          room = getRoom(code);
        } catch {
          return cb?.({ ok: false, error: 'not_found' });
        }
        if (room.abandonedAt) {
          return cb?.({ ok: false, error: 'match_abandoned' });
        }

        // Socket room only — DO NOT join the game engine.
        socket.join(code);
        socket.data.roomId = code;
        socket.data.username = username;
        socket.data.userId = userId;
        socket.data.playerId = socket.id;

        // Send roster snapshot
        const roster = getRoomRoster(code);
        socket.emit('room:update', { players: roster });

        // Send a spectator-safe snapshot to just this socket.
        if (room.state) {
          const specMasked = maskStateForRecipient(room.state, null);
          socket.emit('state:update', {
            state: { ...specMasked, handCounts: getHandCounts(room.state) },
            legalMoves: [],
            canDraw: false,
            eventMeta: getRoomMatchEventMeta(code),
            matchStarted: true,
          });
        }

        appendRoomEvent(room, {
          type: 'spectator_joined',
          actorSocketId: socket.id,
          actorUserId: userId,
          payload: {
            username,
          },
        });

        cb?.({
          ok: true,
          roomCode: code,
          players: roster,
          eventMeta: getRoomMatchEventMeta(code),
          matchStarted: Boolean(room.state),
        });
      } catch (e) {
        cb?.({ ok: false, error: 'spectate_failed' });
      }
    });

    socket.on('room:join', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
      const cb = (
        typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
      ) as AckFn | undefined;
      const explicitConfig =
        arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : null;
      const codeFromObject =
        argCode && typeof argCode === 'object' && !Array.isArray(argCode)
          ? (argCode as { roomCode?: unknown; username?: unknown; userId?: unknown; authToken?: unknown })
          : null;
      const configFromCodeObject: RoomJoinConfig | null = codeFromObject
        ? {
            username:
              typeof codeFromObject.username === 'string' ? codeFromObject.username : undefined,
            userId: typeof codeFromObject.userId === 'string' ? codeFromObject.userId : null,
            authToken: typeof codeFromObject.authToken === 'string' ? codeFromObject.authToken : null,
          }
        : null;
      const config = explicitConfig ?? configFromCodeObject ?? {};
      const rawCode = codeFromObject?.roomCode ?? argCode;
      const roomCode = String(rawCode ?? '')
        .trim()
        .toUpperCase();
      console.log(`[room:join] socket=${socket.id}, code=${roomCode}`);
      try {
        const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
        console.log(`[room:join] identity user=${username} (${userId})`);
        const attached = await attachSocketToTrackedRoom({
          roomCode,
          username,
          userId,
          via: 'room:join',
          hydrateMatchmakingRoom: true,
        });
        cb?.({
          ok: true,
          roomCode: attached.room.code,
          you: attached.joinedPlayerSeatId,
          players: attached.roster,
          state: attached.stateWithCounts,
          legalMoves: attached.rejoinLegalMoves,
          canDraw: attached.rejoinCanDraw,
          eventMeta: getRoomMatchEventMeta(attached.room.code),
          tournamentMatch: attached.tournamentMatchMeta,
          matchStarted: Boolean(attached.room.state),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.log(`[room:join] ERROR: ${message}`);
        cb?.({ ok: false, error: message });
      }
    });

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

    socket.on('room:leave', async (roomCode: unknown, cb?: AckFn) => {
      const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
      if (!code) {
        cb?.({ ok: false, error: 'missing_code' });
        return;
      }

      try {
        await leaveTrackedRoom(code);
        cb?.({ ok: true, roomCode: code });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'leave_failed';
        cb?.({ ok: false, error: message });
      }
    });

    socket.on('room:abandon_match', async (payload: unknown, cb?: AckFn) => {
      const roomCode =
        payload && typeof payload === 'object' && !Array.isArray(payload) &&
        typeof (payload as { roomCode?: unknown }).roomCode === 'string'
          ? String((payload as { roomCode: string }).roomCode).trim().toUpperCase()
          : '';
      const authenticatedUserId = handlerDeps.normalizeUserId(socket.data?.userId);
      console.log('[room:abandon] request', {
        roomCode,
        userId: authenticatedUserId,
      });
      if (!authenticatedUserId) {
        console.log('[room:abandon] rejected', {
          roomCode,
          userId: null,
          reason: 'not_authenticated',
        });
        cb?.({ ok: false, error: 'not_authenticated' });
        return;
      }
      if (!roomCode) {
        console.log('[room:abandon] rejected', {
          roomCode,
          userId: authenticatedUserId,
          reason: 'missing_code',
        });
        cb?.({ ok: false, error: 'missing_code' });
        return;
      }

      try {
        const room = getRoom(roomCode);
        if (room.abandonedAt || room.state?.gameOver) {
          const error = room.abandonedAt ? 'match_abandoned' : 'match_completed';
          console.log('[room:abandon] rejected', {
            roomCode,
            userId: authenticatedUserId,
            reason: error,
          });
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
          console.log('[room:abandon] rejected', {
            roomCode,
            userId: authenticatedUserId,
            reason: 'not_player',
          });
          cb?.({ ok: false, error: 'not_player' });
          return;
        }

        const result = await applyActiveMatchForfeit(io, socket, roomCode, abandoningPlayer);
        if (!result) {
          const error = room.abandonedAt ? 'match_abandoned' : 'match_completed';
          console.log('[room:abandon] rejected', {
            roomCode,
            userId: authenticatedUserId,
            reason: error,
          });
          cb?.({ ok: false, error });
          return;
        }

        await leaveTrackedRoom(roomCode);
        console.log('[room:abandon] completed', {
          roomCode,
          abandonedUserId: authenticatedUserId,
          winnerId: result.winnerUserId,
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
        console.log('[room:abandon] rejected', {
          roomCode,
          userId: authenticatedUserId,
          reason: message,
        });
        cb?.({ ok: false, error: message });
      }
    });

    socket.on('player:ready', async (code: unknown, cb?: AckFn) => {
      const roomCode = String(code ?? '').trim().toUpperCase();
      try {
        const room = getRoom(roomCode);
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

    socket.on('mp:ping', (_sentAt: unknown, cb?: (serverAt: number) => void) => {
      if (typeof cb === 'function') cb(Date.now());
    });

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
        const result = await act(roomCode, playerSeatId, action, io, (code) => broadcastStateUpdate(code));
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
        if (process.env.NODE_ENV !== 'production' || process.env.MP_DEBUG === '1' || process.env.DEBUG_MP === '1') {
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
        if (typeof cb === 'function') {
          cb({ ok: true, sequence: room.state?.sequence ?? null, forcedDraw: forcedMeta });
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

    socket.on('game:rematch', async (code: unknown, cb?: AckFn) => {
      const roomCode = String(code ?? '').trim().toUpperCase();
      try {
        const room = getRoom(roomCode);
        const cfg = (room as any).config ?? {};

        if (cfg.tournamentId) {
          return cb?.({ ok: false, error: 'Rematch is unavailable in tournament rooms.' });
        }
        const playerSeatId = resolveActorSeatId(roomCode, socket);
        if (!room.players.includes(playerSeatId)) {
          return cb?.({ ok: false, error: 'Only room players can request rematch.' });
        }
        if (!room.state) {
          return cb?.({ ok: false, error: 'Game not started.' });
        }
        if (!room.state.gameOver) {
          return cb?.({ ok: false, error: 'Rematch is only available after game over.' });
        }

        room.rematchReady.add(playerSeatId);
        appendRoomEvent(room, {
          type: 'rematch_requested',
          actorSocketId: socket.id,
          actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
          payload: {
            readyCount: room.rematchReady.size,
            requiredCount: room.players.length,
          },
        });
        emitRematchStatus(room.code);

        const bothReady =
          room.players.length === 2 && room.players.every((playerId) => room.rematchReady.has(playerId));
        if (!bothReady) {
          return cb?.({ ok: true, started: false });
        }

        room.rematchReady.clear();
        await waitForActiveGameOverPersist(room.code);

        await withRoomGameplayLock(roomCode, async () => {
          const lockedRoom = getRoom(roomCode);
          lockedRoom.matchLogged = false;
          lockedRoom.leadTracker = {
            aId: lockedRoom.players[0],
            bId: lockedRoom.players[1],
            maxLeadA: 0,
            maxLeadB: 0,
          };
          try {
            await handlerDeps.persistRoomMatchLog(
              lockedRoom,
              lockedRoom.state?.gameOver ? 'completed' : 'abandoned',
            );
          } catch (error) {
            console.error('[room-match-logs] failed to archive room before rematch reset:', error);
          }
          resetRoomEventLog(lockedRoom);
          appendRoomEvent(lockedRoom, {
            type: 'rematch_started',
            actorSocketId: socket.id,
            actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
            payload: {
              players: [...lockedRoom.players],
            },
          });
          await startGame(lockedRoom.code, io, { allowRestart: true });
        });

        const roomAfterRematch = getRoom(roomCode);
        // game:rematch:started MUST be emitted before broadcastStateUpdate so the
        // client resets its sequence watermark before the first state:update of
        // the new game arrives. If the order is reversed, a client whose watermark
        // is still at the old game's final sequence number will silently discard
        // the new game state as stale, leaving the board frozen.
        io.to(roomAfterRematch.code).emit('game:rematch:started', { roomCode: roomAfterRematch.code });
        broadcastStateUpdate(roomAfterRematch.code);
        emitRematchStatus(roomAfterRematch.code);
        cb?.({ ok: true, started: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        cb?.({ ok: false, error: message });
      }
    });

    socket.on('player:dragging', (code: unknown, payload?: { dragging?: boolean }) => {
      const roomCode = String(code ?? '').trim().toUpperCase();
      if (!roomCode) return;
      try {
        const room = getRoom(roomCode);
        const playerSeatId = resolveActorSeatId(roomCode, socket);
        if (!room.players.includes(playerSeatId)) return;
        socket.to(roomCode).emit('player:dragging', {
          playerId: playerSeatId,
          dragging: Boolean(payload?.dragging),
        });
      } catch {
        // ignore invalid room
      }
    });

}

export function handleRoomPlayerDisconnect(
  io: Server,
  socket: Socket,
): { wasActiveRoomPlayer: boolean; roomCode?: string } {
  const roomCode = (socket.data?.roomId as string | undefined) ?? undefined;
  let wasActiveRoomPlayer = false;
  if (roomCode) {
    try {
      const room = getRoom(roomCode);
      if (room.abandonedAt) {
        wasActiveRoomPlayer = false;
      } else {
      const playerSeatId = getSeatIdForSocket(roomCode, socket.id);
      if (playerSeatId && room.players.includes(playerSeatId)) {
        wasActiveRoomPlayer = true;
        const handlerDeps = requireRoomSessionHandlerDeps();
        reserveReconnectSeat(roomCode, {
          seatId: playerSeatId,
          oldSocketId: socket.id,
          username: handlerDeps.normalizeUsername(socket.data?.username),
          userId: handlerDeps.normalizeUserId(socket.data?.userId),
        });
        onActivePlayerSocketDisconnect(roomCode, playerSeatId, io, (code) =>
          broadcastStateUpdate(code),
        );
      }
      }
    } catch {
      // room no longer exists
    }
  }

  const leaveTrackedRoom = (socket as any).__leaveTrackedRoom as
    | ((roomCode: string | undefined, options?: { preserveSeat?: boolean }) => void | Promise<void>)
    | undefined;
  void leaveTrackedRoom?.(roomCode, { preserveSeat: wasActiveRoomPlayer });

  return { wasActiveRoomPlayer, roomCode };
}
