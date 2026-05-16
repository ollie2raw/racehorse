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
import {
  onActivePlayerSocketDisconnect,
  onPlayerSocketRejoined,
} from './disconnectGrace';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import {
  allocatePlayerSeatId,
  broadcastStateUpdate,
  buildHandEndedPayload,
  buildMatchStartDeps,
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
  type AckFn,
  type RoomJoinConfig,
  type RoomPlayer,
} from './roomSession';

export function registerRoomSessionHandlers(io: Server, socket: Socket): void {
  const handlerDeps = requireRoomSessionHandlerDeps();

    const leaveTrackedRoom = (
      roomCode: string | undefined,
      options: { preserveSeat?: boolean } = {},
    ) => {
      if (!roomCode) return;
      const code = roomCode.trim().toUpperCase();
      if (!code) return;

      const preserveSeat = Boolean(options.preserveSeat);
      socket.leave(code);
      if (socket.data.roomId === code) {
        socket.data.roomId = undefined;
      }

      let room: Room | null = null;
      try {
        room = getRoom(code);
      } catch {
        clearRoomMetadata(code);
        cancelRoomCleanup(code);
        return;
      }

      const playerSeatId = getSeatIdForSocket(code, socket.id);
      const wasPlayer = playerSeatId ? room.players.includes(playerSeatId) : false;
      clearSocketRematchReady(code, socket.id);

      if (!preserveSeat && wasPlayer && playerSeatId) {
        appendRoomEvent(room, {
          type: 'player_left',
          actorSocketId: socket.id,
          actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
          payload: {
            preserveSeat,
            playerSeatId,
          },
        });
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
      previousRooms.forEach((roomId) => leaveTrackedRoom(roomId));
      socket.data.roomId = undefined;
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
        const room = createRoom(playerSeatId, roomConfig as Record<string, unknown>);
        socket.join(room.code);
        socket.data.roomId = room.code;
        socket.data.username = username;
        socket.data.userId = userId;
        ensureSocketDataSeat(socket, playerSeatId);
        const roomPlayers: RoomPlayer[] = [{ id: playerSeatId, socketId: socket.id, username, userId }];
        setRoomRoster(room.code, roomPlayers);
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
        clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
        leaveExistingSocketRooms();
        const hydrateResult = await handlerDeps.tryHydrateMatchmakingRoomShell(roomCode);
        let existingRoom = peekRoom(roomCode);
        if (!existingRoom) {
          const message = 'Room not found.';
          console.log(`[room:join] ERROR: ${message} hydrate=${hydrateResult}`);
          cb?.({ ok: false, error: message });
          return;
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
              console.log(`[room:join] FORCE-DISCONNECT: old socket ${oldSocket.id} for userId=${userId}, new socket ${socket.id} taking over`);
              oldSocket.emit('room:session:superseded', { reason: 'new_session', newSocketId: socket.id });
              oldSocket.disconnect(true);
              await new Promise(resolve => setTimeout(resolve, 50));
            }

            console.log(`[room:join] RECONNECT: migrating seat ${existingPlayer.id} socket -> ${socket.id} for userId=${userId}`);
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
              via: migratedByUserId ? 'reconnect' : 'room:join',
            },
          });
        }
        setRoomRoster(room.code, roster);
        io.to(room.code).emit('room:update', { players: roster });
        console.log(`[room:join] joined room=${room.code}, players=${room.players.length}`);

        // Matchmaking: seat sim before start checks; auto-ready the joining socket so
        // the deal is not blocked on a client player:ready race or countdown timing.
        if (room.matchmakingMatchId && !room.state) {
          markMatchStartReady(room.code, joinedPlayerSeatId);

          console.log('[matchmaking] players in room:', room.players.length);

          const mmSeatSockets = getEngineSeatSocketIds(room.code, [...room.players]);
          if (mmSeatSockets.length >= 2) {
            try {
              await handlerDeps.waitUntilMatchmakingRoomSocketsReady(io, room.code, mmSeatSockets);
              const startResult = await tryStartMatchIfReady(room.code, io, buildMatchStartDeps(io));
              if (startResult.started) {
                room = getRoom(room.code);
                console.log('[room:join] matchmaking auto-started', {
                  roomCode: room.code,
                  socketId: socket.id,
                });
              }
            } catch (startErr) {
              console.warn(
                '[room:join] matchmaking auto-start failed',
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

        // ── Scheduled-tournament metadata ──────────────────────────────────
        // When the room belongs to a scheduled tournament, attach the match
        // info + opponent profile so the client can render the in-game banner
        // and bracket context without a fragile room-code regex.
        let tournamentMatchMeta:
          | {
              tournamentId: string;
              matchId: string;
              round: 1 | 2 | 3;
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
              player1_id: string | null;
              player2_id: string | null;
            }>>(
              `/rest/v1/scheduled_tournament_matches` +
                `?select=id,tournament_id,round,player1_id,player2_id` +
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
                opponentUserId,
                opponentUsername,
                opponentRating,
              };
            }
          } catch {
            /* tournament metadata is best-effort — never block room:join on this */
          }
        }

        cb?.({
          ok: true,
          roomCode: room.code,
          you: joinedPlayerSeatId,
          players: roster,
          state: stateWithCounts,
          legalMoves: rejoinLegalMoves,
          canDraw: rejoinCanDraw,
          eventMeta: getRoomMatchEventMeta(room.code),
          tournamentMatch: tournamentMatchMeta,
          matchStarted: Boolean(room.state),
        });

        if (room.state) {
          // REPLAY hand:ended if rejoining into a handOver state
          if (room.state.handOver && !room.state.gameOver) {
            const payload = buildHandEndedPayload(room, joinedPlayerSeatId);
            if (payload) {
              socket.emit('hand:ended', payload);
            }
          }
        }

        onPlayerSocketRejoined(room.code, io, joinedPlayerSeatId);

        evaluateRoomLifecycle(room.code);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.log(`[room:join] ERROR: ${message}`);
        cb?.({ ok: false, error: message });
      }
    });

    socket.on('room:leave', (roomCode: unknown, cb?: AckFn) => {
      const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
      if (!code) {
        cb?.({ ok: false, error: 'missing_code' });
        return;
      }

      leaveTrackedRoom(code);
      cb?.({ ok: true, roomCode: code });
    });

    socket.on('player:ready', async (code: unknown, cb?: AckFn) => {
      const roomCode = String(code ?? '').trim().toUpperCase();
      try {
        const room = getRoom(roomCode);
        const playerSeatId = resolveActorSeatId(roomCode, socket);
        if (!room.players.includes(playerSeatId)) {
          cb?.({ ok: false, error: 'Only room players can ready up.' });
          return;
        }
        markMatchStartReady(roomCode, playerSeatId);
        const startResult = await tryStartMatchIfReady(roomCode, io, buildMatchStartDeps(io));
        if (startResult.started) {
          const started = getRoom(roomCode);
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
        if (!startResult.started) {
          if (typeof cb === 'function') {
            cb({ ok: false, error: 'waiting_for_ready', waitingFor: startResult.waitingFor ?? [] });
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
        if (typeof cb === 'function') cb({ ok: true, sequence: room.state?.sequence ?? null });
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
        room.matchLogged = false;
        room.leadTracker = {
          aId: room.players[0],
          bId: room.players[1],
          maxLeadA: 0,
          maxLeadB: 0,
        };
        try {
          await handlerDeps.persistRoomMatchLog(room, room.state?.gameOver ? 'completed' : 'abandoned');
        } catch (error) {
          console.error('[room-match-logs] failed to archive room before rematch reset:', error);
        }
        resetRoomEventLog(room);
        appendRoomEvent(room, {
          type: 'rematch_started',
          actorSocketId: socket.id,
          actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
          payload: {
            players: [...room.players],
          },
        });
        await startGame(room.code, io, { allowRestart: true });
        // game:rematch:started MUST be emitted before broadcastStateUpdate so the
        // client resets its sequence watermark before the first state:update of
        // the new game arrives. If the order is reversed, a client whose watermark
        // is still at the old game's final sequence number will silently discard
        // the new game state as stale, leaving the board frozen.
        io.to(room.code).emit('game:rematch:started', { roomCode: room.code });
        broadcastStateUpdate(room.code);
        emitRematchStatus(room.code);
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
    } catch {
      // room no longer exists
    }
  }

  const leaveTrackedRoom = (socket as any).__leaveTrackedRoom as
    | ((roomCode: string | undefined, options?: { preserveSeat?: boolean }) => void)
    | undefined;
  leaveTrackedRoom?.(roomCode, { preserveSeat: wasActiveRoomPlayer });

  return { wasActiveRoomPlayer, roomCode };
}
