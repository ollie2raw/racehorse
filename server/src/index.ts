import express from "express";
import cors from "cors";
import http from "http";
import { Server, Socket } from "socket.io";

import {
  createRoom,
  joinRoom,
  startGame,
  act,
  nextHand,
  getRoom,
  getRoomLegalMoves,
  getRoomCanDraw,
} from "./rooms";

const app = express();
app.use(cors());

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

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

  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      const legalMoves = getRoomLegalMoves(roomCode, socketId);
      const canDraw = getRoomCanDraw(roomCode, socketId);

      // DEBUG: Log legal moves info
      const branchMoves = legalMoves.filter(
        (m: any) => m.type === "play" && m.position?.startsWith("branch-")
      );
      console.log(
        `[DEBUG broadcastStateUpdate] socket=${socketId}, legalMoves=${legalMoves.length}, branchMoves=${branchMoves.length}`,
        branchMoves.length > 0 ? branchMoves.map((m: any) => m.position) : ""
      );

      const handCounts = Object.fromEntries(
        room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.hand.length ?? 0])
      );

      socket.emit("state:update", {
        state: {
          ...room.state,
          handCounts,
        },
        legalMoves,
        canDraw,
      });
    }
  }
}

io.on("connection", (socket: Socket) => {
  console.log("Client connected:", socket.id);

  socket.on("room:create", (config, cb) => {
    console.log(`[room:create] socket=${socket.id}`);
    try {
      const room = createRoom(socket.id, config ?? {});
      socket.join(room.code);
      console.log(`[room:create] created room=${room.code}, players=${room.players.length}`);
      cb({ ok: true, roomCode: room.code, you: socket.id, players: room.players });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.log(`[room:create] ERROR: ${message}`);
      cb({ ok: false, error: message });
    }
  });

  socket.on("room:join", (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[room:join] socket=${socket.id}, code=${roomCode}`);
    try {
      const room = joinRoom(roomCode, socket.id);
      socket.join(room.code);
      io.to(room.code).emit("room:update", { players: room.players });
      console.log(`[room:join] joined room=${room.code}, players=${room.players.length}`);
      const stateWithCounts = room.state
        ? {
            ...room.state,
            handCounts: Object.fromEntries(
              room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.hand.length ?? 0])
            ),
          }
        : null;
      cb({ ok: true, roomCode: room.code, you: socket.id, players: room.players, state: stateWithCounts });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.log(`[room:join] ERROR: ${message}`);
      cb({ ok: false, error: message });
    }
  });

  socket.on("game:start", (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:start] socket=${socket.id}, code=${roomCode}`);
    try {
      const room = startGame(roomCode);
      console.log(`[game:start] game started, handNumber=${room.state?.handNumber}, handOver=${room.state?.handOver}`);
      broadcastStateUpdate(room.code);
      cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.log(`[game:start] ERROR: ${message}`);
      cb({ ok: false, error: message });
    }
  });

  socket.on("game:action", (code, action, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:action] socket=${socket.id}, code=${roomCode}, action=${action?.type}`);
    try {
      const room = act(roomCode, socket.id, action);
      broadcastStateUpdate(room.code);
      cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.log(`[game:action] ERROR: ${message}`);
      cb({ ok: false, error: message });
    }
  });

  socket.on("hand:next", (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[hand:next] socket=${socket.id}, code=${roomCode}`);
    try {
      const room = nextHand(roomCode);
      console.log(`[hand:next] new hand started, handNumber=${room.state?.handNumber}`);
      broadcastStateUpdate(room.code);
      cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.log(`[hand:next] ERROR: ${message}`);
      cb({ ok: false, error: message });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = 3001;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
