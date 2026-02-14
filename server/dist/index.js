"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const rooms_1 = require("./rooms");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.get("/health", (_, res) => {
    res.json({ ok: true });
});
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: { origin: "*" },
});
/**
 * Send state update to all players in a room.
 * Each player receives:
 * - The game state
 * - Their legal moves (if it's their turn)
 * - Whether they can draw
 */
function broadcastStateUpdate(roomCode) {
    const room = (0, rooms_1.getRoom)(roomCode);
    if (!room.state)
        return;
    const sockets = io.sockets.adapter.rooms.get(roomCode);
    if (!sockets)
        return;
    for (const socketId of sockets) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            const legalMoves = (0, rooms_1.getRoomLegalMoves)(roomCode, socketId);
            const canDraw = (0, rooms_1.getRoomCanDraw)(roomCode, socketId);
            // DEBUG: Log legal moves info
            const branchMoves = legalMoves.filter((m) => m.type === "play" && m.position?.startsWith("branch-"));
            console.log(`[DEBUG broadcastStateUpdate] socket=${socketId}, legalMoves=${legalMoves.length}, branchMoves=${branchMoves.length}`, branchMoves.length > 0 ? branchMoves.map((m) => m.position) : "");
            socket.emit("state:update", {
                state: room.state,
                legalMoves,
                canDraw,
            });
        }
    }
}
io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    socket.on("room:create", (config, cb) => {
        console.log(`[room:create] socket=${socket.id}`);
        try {
            const room = (0, rooms_1.createRoom)(socket.id, config ?? {});
            socket.join(room.code);
            console.log(`[room:create] created room=${room.code}, players=${room.players.length}`);
            cb({ ok: true, roomCode: room.code, you: socket.id, players: room.players });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "unknown error";
            console.log(`[room:create] ERROR: ${message}`);
            cb({ ok: false, error: message });
        }
    });
    socket.on("room:join", (code, cb) => {
        const roomCode = String(code).trim().toUpperCase();
        console.log(`[room:join] socket=${socket.id}, code=${roomCode}`);
        try {
            const room = (0, rooms_1.joinRoom)(roomCode, socket.id);
            socket.join(room.code);
            io.to(room.code).emit("room:update", { players: room.players });
            console.log(`[room:join] joined room=${room.code}, players=${room.players.length}`);
            cb({ ok: true, roomCode: room.code, you: socket.id, players: room.players, state: room.state });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "unknown error";
            console.log(`[room:join] ERROR: ${message}`);
            cb({ ok: false, error: message });
        }
    });
    socket.on("game:start", (code, cb) => {
        const roomCode = String(code).trim().toUpperCase();
        console.log(`[game:start] socket=${socket.id}, code=${roomCode}`);
        try {
            const room = (0, rooms_1.startGame)(roomCode);
            console.log(`[game:start] game started, handNumber=${room.state?.handNumber}, handOver=${room.state?.handOver}`);
            broadcastStateUpdate(room.code);
            cb({ ok: true });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "unknown error";
            console.log(`[game:start] ERROR: ${message}`);
            cb({ ok: false, error: message });
        }
    });
    socket.on("game:action", (code, action, cb) => {
        const roomCode = String(code).trim().toUpperCase();
        console.log(`[game:action] socket=${socket.id}, code=${roomCode}, action=${action?.type}`);
        try {
            const room = (0, rooms_1.act)(roomCode, socket.id, action);
            broadcastStateUpdate(room.code);
            cb({ ok: true });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "unknown error";
            console.log(`[game:action] ERROR: ${message}`);
            cb({ ok: false, error: message });
        }
    });
    socket.on("hand:next", (code, cb) => {
        const roomCode = String(code).trim().toUpperCase();
        console.log(`[hand:next] socket=${socket.id}, code=${roomCode}`);
        try {
            const room = (0, rooms_1.nextHand)(roomCode);
            console.log(`[hand:next] new hand started, handNumber=${room.state?.handNumber}`);
            broadcastStateUpdate(room.code);
            cb({ ok: true });
        }
        catch (err) {
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
//# sourceMappingURL=index.js.map