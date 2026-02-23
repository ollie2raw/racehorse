import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server, Socket } from 'socket.io';

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
