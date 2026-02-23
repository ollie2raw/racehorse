import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server, Socket } from 'socket.io';
import {
  makeCode,
  makeId,
  initStandings,
  buildRoundRobinMatches,
  sortedStandings,
  applyResult,
  type Tournament,
  type TournamentPlayer,
} from './tournament/tournament';

import {
  createRoom,
  joinRoom,
  startGame,
  act,
  nextHand,
  readyForNextHand,
  getRoom,
  getRoomLegalMoves,
  getRoomCanDraw,
} from './rooms';

const app = express();
app.use(cors());

app.get('/health', (_, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
});

type RoomPlayer = { id: string; username: string; userId: string | null };
type RoomJoinConfig = { username?: string; userId?: string | null };
type AckFn = (payload: any) => void;

const roomPlayersByCode = new Map<string, RoomPlayer[]>();

function normalizeUsername(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || 'Guest';
}

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  return raw || null;
}

function getRoomPlayersWithFallback(roomCode: string, socketIds: string[]): RoomPlayer[] {
  const existing = roomPlayersByCode.get(roomCode) ?? [];
  const byId = new Map(existing.map((p) => [p.id, p]));
  const next = socketIds.map((id) => byId.get(id) ?? { id, username: 'Guest', userId: null });
  roomPlayersByCode.set(roomCode, next);
  return next;
}

/**
 * Send state update to all players in a room.
 * Each player receives:
 * - The game state
 * - Their legal moves (if it's their turn)
 * - Whether they can draw
 */
function broadcastStateUpdate(roomCode: string) {
  const room = getRoom(roomCode);
  if (!room.state) return;

  const sockets = io.sockets.adapter.rooms.get(roomCode);
  if (!sockets) return;

  const currentScores = Object.fromEntries(
    room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.score ?? 0]),
  );
  const previousScores = room.lastBroadcastScores;

  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      const legalMoves = getRoomLegalMoves(roomCode, socketId);
      const canDraw = getRoomCanDraw(roomCode, socketId);

      // DEBUG: Log legal moves info
      const branchMoves = legalMoves.filter(
        (m: any) => m.type === 'play' && m.position?.startsWith('branch-'),
      );
      console.log(
        `[DEBUG broadcastStateUpdate] socket=${socketId}, legalMoves=${legalMoves.length}, branchMoves=${branchMoves.length}`,
        branchMoves.length > 0 ? branchMoves.map((m: any) => m.position) : '',
      );

      const handCounts = Object.fromEntries(
        room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.hand.length ?? 0]),
      );

      const maskedPlayers = Object.fromEntries(
        room.state.playerIds.map((pid) => {
          const playerState = room.state!.players[pid];
          const canReveal = room.state!.handOver || room.state!.gameOver || pid === socketId;
          return [
            pid,
            {
              ...playerState,
              hand: canReveal ? playerState.hand : [],
            },
          ];
        }),
      );

      socket.emit('state:update', {
        state: {
          ...room.state,
          players: maskedPlayers,
          handCounts,
        },
        legalMoves,
        canDraw,
      });

      if (
        room.state.handOver &&
        !room.state.gameOver &&
        room.lastHandEndedNotifiedHand !== room.state.handNumber
      ) {
        const opponentId = room.state.playerIds.find((pid) => pid !== socketId) ?? null;
        const youScoreDelta =
          (currentScores[socketId] ?? 0) -
          (previousScores[socketId] ?? currentScores[socketId] ?? 0);
        const opponentScoreDelta = opponentId
          ? (currentScores[opponentId] ?? 0) -
            (previousScores[opponentId] ?? currentScores[opponentId] ?? 0)
          : 0;

        socket.emit('hand:ended', {
          handNumber: room.state.handNumber,
          opponentRemainingTiles: opponentId ? (room.state.players[opponentId]?.hand ?? []) : [],
          pointsAwarded: {
            you: youScoreDelta,
            opponent: opponentScoreDelta,
          },
        });
      }
    }
  }

  if (room.state.handOver && !room.state.gameOver) {
    room.lastHandEndedNotifiedHand = room.state.handNumber;
  } else if (!room.state.handOver) {
    room.lastHandEndedNotifiedHand = null;
  }
  room.lastBroadcastScores = currentScores;

  // TOURNAMENT_SPECTATE_BROADCAST
  // Spectator-safe broadcast to anyone in the Socket.IO room (hands hidden)
  if (room.state) {
    const stateForSpectators = {
      ...room.state,
      players: Object.fromEntries(
        room.state.playerIds.map((pid) => {
          const ps = room.state!.players[pid];
          return [pid, { ...ps, hand: [] }];
        }),
      ),
      handCounts: Object.fromEntries(
        room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.hand.length ?? 0]),
      ),
    };
    io.to(room.code).emit('state:spectate', { state: stateForSpectators });
  }
}

io.on('connection', (socket: Socket) => {
/* ROOM_REACTIONS_CHAT_EMOTE */
  const nowMs = () => Date.now();
  const clampString = (s: string, max: number) => {
    const t = (s ?? '').trim();
    return t.length > max ? t.slice(0, max) : t;
  };

  const makeRateLimiter = (burst: number, perMs: number) => {
    let tokens = burst;
    let last = nowMs();
    return () => {
      const t = nowMs();
      const refill = ((t - last) / perMs) * burst;
      tokens = Math.min(burst, tokens + refill);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };
  };

  const canSendChat = makeRateLimiter(6, 10_000);
  const canSendEmote = makeRateLimiter(10, 10_000);

  socket.on('room:chat:send', (payload: { text: string }) => {
    try {
      if (!canSendChat()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const text = clampString(String(payload?.text ?? ''), 200);
      if (!text) return;

      const msg = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        text,
      };

      socket.to(roomId).emit('room:chat', msg);
    } catch (e) {
      console.warn('room:chat:send failed', e);
    }
  });

  socket.on('room:emote:send', (payload: { emote: string }) => {
    try {
      if (!canSendEmote()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const emote = clampString(String(payload?.emote ?? ''), 16);
      if (!emote) return;

      const evt = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        emote,
      };

      socket.to(roomId).emit('room:emote', evt);
    } catch (e) {
      console.warn('room:emote:send failed', e);
    }
  });

  console.log('Client connected:', socket.id);

  // TOURNAMENT_HELPERS
  // Global in-memory tournament storage (per server process).
  const tournamentsById = ((globalThis as any).__tournamentsById ??= new Map<string, Tournament>()) as Map<
    string,
    Tournament
  >;
  const tournamentsByCode = ((globalThis as any).__tournamentsByCode ??= new Map<string, string>()) as Map<
    string,
    string
  >;

  const emitTournament = (t: Tournament) => {
    const standings = sortedStandings(t.standings);
    io.to(`tourn:${t.id}`).emit('tournament:state', {
      id: t.id,
      lobbyCode: t.lobbyCode,
      status: t.status,
      players: t.players,
      matches: t.matches,
      currentMatchIndex: t.currentMatchIndex,
      activeMatchId: t.activeMatchId ?? null,
      activeRoomCode: t.activeRoomCode ?? null,
      standings,
    });
  };

  const getTournamentForSocket = (): Tournament | null => {
    const tid = (socket.data?.tournamentId as string | undefined) ?? undefined;
    if (!tid) return null;
    return tournamentsById.get(tid) ?? null;
  };

  const startNextMatch = (t: Tournament) => {
    // advance to next pending match
    while (t.currentMatchIndex < t.matches.length && t.matches[t.currentMatchIndex].status === 'done') {
      t.currentMatchIndex += 1;
    }
    if (t.currentMatchIndex >= t.matches.length) {
      t.status = 'complete';
      t.activeMatchId = null;
      t.activeRoomCode = null;
      emitTournament(t);
      return;
    }

    const m = t.matches[t.currentMatchIndex];
    m.status = 'active';
    t.activeMatchId = m.id;

    // Create a normal 2-player room for this match with a 30-point winning score.
    // Attach tournament metadata so we can record results later on gameOver.
    const room = createRoom(m.a, {
      winningScore: 30,
      tournamentId: t.id,
      tournamentMatchId: m.id,
      tournamentMode: 'round_robin',
    } as any);

    // Defensive: ensure config is accessible later even if createRoom doesn't persist arbitrary config
    (room as any).config = { ...(room as any).config, winningScore: 30, tournamentId: t.id, tournamentMatchId: m.id };

    m.roomCode = room.code;
    t.activeRoomCode = room.code;

    // Join the second player in the engine + socket room
    joinRoom(room.code, m.b);
    io.sockets.sockets.get(m.a)?.join(room.code);
    io.sockets.sockets.get(m.b)?.join(room.code);

    // Spectators: everyone in tournament lobby joins the socket room (read-only)
    io.in(`tourn:${t.id}`).socketsJoin(room.code);

    // Room roster for UI
    const pa = t.players.find((p) => p.socketId === m.a);
    const pb = t.players.find((p) => p.socketId === m.b);
    const roomPlayers = [
      { id: m.a, username: pa?.username ?? 'Player', userId: pa?.userId ?? null },
      { id: m.b, username: pb?.username ?? 'Player', userId: pb?.userId ?? null },
    ];
    roomPlayersByCode.set(room.code, roomPlayers);
    io.to(room.code).emit('room:update', { players: roomPlayers });

    // Announce active match (players + spectators)
    io.to(`tourn:${t.id}`).emit('tournament:match:assigned', {
      matchId: m.id,
      roomCode: room.code,
      a: m.a,
      b: m.b,
      aName: roomPlayers[0].username,
      bName: roomPlayers[1].username,
    });

    // Start match now
    startGame(room.code);
    broadcastStateUpdate(room.code);

    emitTournament(t);
  };

  const maybeFinalizeTournamentMatch = (room: any) => {
    if (!room?.state?.gameOver) return;

    const cfg = (room as any).config ?? {};
    const tid = cfg.tournamentId as string | undefined;
    const mid = cfg.tournamentMatchId as string | undefined;
    if (!tid || !mid) return;

    const t = tournamentsById.get(tid);
    if (!t) return;

    const match = t.matches.find((mm) => mm.id === mid);
    if (!match || match.status === 'done') return;

    const a = match.a;
    const b = match.b;
    const scoreA = room.state.players[a]?.score ?? 0;
    const scoreB = room.state.players[b]?.score ?? 0;
    const winner = scoreA >= scoreB ? a : b;

    applyResult(t, mid, winner, scoreA, scoreB);

    // advance (one match at a time)
    t.currentMatchIndex += 1;
    t.activeMatchId = null;
    t.activeRoomCode = null;

    emitTournament(t);
    startNextMatch(t);
  };

// TOURNAMENT_HANDLERS
  socket.on('tournament:create', (arg1?: unknown, cb?: any) => {
    try {
      const username = (socket.data?.username as string | undefined) ?? 'Player';
      const userId = (socket.data?.userId as string | undefined) ?? null;

      const id = makeId('t');
      const lobbyCode = makeCode(4);

      const players: TournamentPlayer[] = [{
        socketId: socket.id,
        username,
        userId,
      }];

      const t: Tournament = {
        id,
        lobbyCode,
        hostSocketId: socket.id,
        status: 'lobby',
        players,
        matches: [],
        currentMatchIndex: 0,
        standings: initStandings(players),
        activeMatchId: null,
        activeRoomCode: null,
      };

      (globalThis as any).__tournamentsById.set(id, t);
      (globalThis as any).__tournamentsByCode.set(lobbyCode, id);

      socket.data.tournamentId = id;
      socket.join(`tourn:${id}`);

      cb?.({ ok: true, id, lobbyCode });
      // broadcast lobby state
      io.to(`tourn:${id}`).emit('tournament:lobby:update', { players: t.players, lobbyCode });
    } catch (e) {
      cb?.({ ok: false, error: 'create_failed' });
    }
  });

  socket.on('tournament:join', (lobbyCode: string, cb?: any) => {
    try {
      const code = String(lobbyCode ?? '').trim().toUpperCase();
      const tid = (globalThis as any).__tournamentsByCode.get(code) as string | undefined;
      if (!tid) return cb?.({ ok: false, error: 'not_found' });

      const t = (globalThis as any).__tournamentsById.get(tid) as Tournament | undefined;
      if (!t) return cb?.({ ok: false, error: 'not_found' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });

      if (!t.players.some((p) => p.socketId === socket.id)) {
        const username = (socket.data?.username as string | undefined) ?? 'Player';
        const userId = (socket.data?.userId as string | undefined) ?? null;
        t.players.push({ socketId: socket.id, username, userId });
        t.standings[socket.id] = {
          socketId: socket.id,
          username,
          played: 0,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
      }

      socket.data.tournamentId = tid;
      socket.join(`tourn:${tid}`);

      cb?.({ ok: true, id: tid, lobbyCode: t.lobbyCode });
      io.to(`tourn:${tid}`).emit('tournament:lobby:update', { players: t.players, lobbyCode: t.lobbyCode });
    } catch (e) {
      cb?.({ ok: false, error: 'join_failed' });
    }
  });

  socket.on('tournament:start', (cb?: any) => {
    try {
      const t = getTournamentForSocket();
      if (!t) return cb?.({ ok: false, error: 'no_tournament' });
      if (socket.id != t.hostSocketId) return cb?.({ ok: false, error: 'not_host' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });
      if (t.players.length < 4) return cb?.({ ok: false, error: 'need_4' });

      t.status = 'running';
      t.matches = buildRoundRobinMatches(t.players);
      t.currentMatchIndex = 0;
      t.activeMatchId = null;
      t.activeRoomCode = null;

      emitTournament(t);
      startNextMatch(t);

      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: 'start_failed' });
    }
  });


  socket.on('room:create', (arg1?: unknown, arg2?: unknown) => {
    const config = (
      arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
    ) as RoomJoinConfig;
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as AckFn | undefined;
    const username = normalizeUsername(config.username);
    const userId = normalizeUserId(config.userId);
    const {
      username: _ignoredUsername,
      userId: _ignoredUserId,
      ...roomConfig
    } = config as Record<string, unknown>;
    console.log(`[room:create] socket=${socket.id}`);
    try {
      const room = createRoom(socket.id, roomConfig as Record<string, unknown>);
      socket.join(room.code);
      socket.data.roomId = room.code;
      socket.data.username = username;
      socket.data.userId = userId;
      const roomPlayers: RoomPlayer[] = [{ id: socket.id, username, userId }];
      roomPlayersByCode.set(room.code, roomPlayers);
      console.log(`[room:create] created room=${room.code}, players=${room.players.length}`);
      cb?.({ ok: true, roomCode: room.code, you: socket.id, players: roomPlayers });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[room:create] ERROR: ${message}`);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('room:join', (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const cb = (
      typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
    ) as AckFn | undefined;
    const explicitConfig =
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : null;
    const codeFromObject =
      argCode && typeof argCode === 'object' && !Array.isArray(argCode)
        ? (argCode as { roomCode?: unknown; username?: unknown; userId?: unknown })
        : null;
    const configFromCodeObject: RoomJoinConfig | null = codeFromObject
      ? {
          username:
            typeof codeFromObject.username === 'string' ? codeFromObject.username : undefined,
          userId: typeof codeFromObject.userId === 'string' ? codeFromObject.userId : null,
        }
      : null;
    const config = explicitConfig ?? configFromCodeObject ?? {};
    const username = normalizeUsername(config.username);
    const userId = normalizeUserId(config.userId);
    const rawCode = codeFromObject?.roomCode ?? argCode;
    const roomCode = String(rawCode ?? '')
      .trim()
      .toUpperCase();
    console.log(`[room:join] socket=${socket.id}, code=${roomCode}`);
    try {
      const room = joinRoom(roomCode, socket.id);
      socket.join(room.code);
      socket.data.roomId = room.code;
      socket.data.username = username;
      socket.data.userId = userId;
      const roomPlayers = getRoomPlayersWithFallback(room.code, room.players);
      const existingIdx = roomPlayers.findIndex((p) => p.id === socket.id);
      if (existingIdx >= 0) {
        roomPlayers[existingIdx] = { id: socket.id, username, userId };
      } else {
        roomPlayers.push({ id: socket.id, username, userId });
      }
      roomPlayersByCode.set(room.code, roomPlayers);
      io.to(room.code).emit('room:update', { players: roomPlayers });
      console.log(`[room:join] joined room=${room.code}, players=${room.players.length}`);
      const stateWithCounts = room.state
        ? {
            ...room.state,
            players: Object.fromEntries(
              room.state.playerIds.map((pid) => {
                const playerState = room.state!.players[pid];
                const canReveal = room.state!.handOver || room.state!.gameOver || pid === socket.id;
                return [
                  pid,
                  {
                    ...playerState,
                    hand: canReveal ? playerState.hand : [],
                  },
                ];
              }),
            ),
            handCounts: Object.fromEntries(
              room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.hand.length ?? 0]),
            ),
          }
        : null;
      cb?.({
        ok: true,
        roomCode: room.code,
        you: socket.id,
        players: roomPlayers,
        state: stateWithCounts,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[room:join] ERROR: ${message}`);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('game:start', (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:start] socket=${socket.id}, code=${roomCode}`);
    try {
      const room = startGame(roomCode);
      console.log(
        `[game:start] game started, handNumber=${room.state?.handNumber}, handOver=${room.state?.handOver}`,
      );
      broadcastStateUpdate(room.code);
      cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[game:start] ERROR: ${message}`);
      cb({ ok: false, error: message });
    }
  });

  socket.on('game:action', (code, action, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:action] socket=${socket.id}, code=${roomCode}, action=${action?.type}`);
    try {
      const room = act(roomCode, socket.id, action);
      broadcastStateUpdate(room.code);
      maybeFinalizeTournamentMatch(room);
      maybeFinalizeTournamentMatch(room);
      maybeFinalizeTournamentMatch(room);
      maybeFinalizeTournamentMatch(room);
      cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[game:action] ERROR: ${message}`);
      cb({ ok: false, error: message });
    }
  });

  socket.on('hand:next', (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[hand:next] socket=${socket.id}, code=${roomCode}`);
    try {
      const room = nextHand(roomCode);
      console.log(`[hand:next] new hand started, handNumber=${room.state?.handNumber}`);
      broadcastStateUpdate(room.code);
      maybeFinalizeTournamentMatch(room);
      maybeFinalizeTournamentMatch(room);
      maybeFinalizeTournamentMatch(room);
      maybeFinalizeTournamentMatch(room);
      cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[hand:next] ERROR: ${message}`);
      cb({ ok: false, error: message });
    }
  });

  socket.on('hand:ready', (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    try {
      const result = readyForNextHand(roomCode, socket.id);
      if (result.started) {
        broadcastStateUpdate(result.room.code);
        maybeFinalizeTournamentMatch(result.room);
        maybeFinalizeTournamentMatch(result.room);
        maybeFinalizeTournamentMatch(result.room);
        maybeFinalizeTournamentMatch(result.room);
      }
      cb?.({ ok: true, started: result.started });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = 3001;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
