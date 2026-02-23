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
const roomPlayersByCode = new Map();
function normalizeUsername(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    return raw || "Guest";
}
function normalizeUserId(value) {
    if (typeof value !== "string")
        return null;
    const raw = value.trim();
    return raw || null;
}
function getRoomPlayersWithFallback(roomCode, socketIds) {
    const existing = roomPlayersByCode.get(roomCode) ?? [];
    const byId = new Map(existing.map((p) => [p.id, p]));
    const next = socketIds.map((id) => byId.get(id) ?? { id, username: "Guest", userId: null });
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
function broadcastStateUpdate(roomCode) {
    const room = (0, rooms_1.getRoom)(roomCode);
    if (!room.state)
        return;
    const sockets = io.sockets.adapter.rooms.get(roomCode);
    if (!sockets)
        return;
    const currentScores = Object.fromEntries(room.state.playerIds.map((pid) => [pid, room.state.players[pid]?.score ?? 0]));
    const previousScores = room.lastBroadcastScores;
    for (const socketId of sockets) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            const legalMoves = (0, rooms_1.getRoomLegalMoves)(roomCode, socketId);
            const canDraw = (0, rooms_1.getRoomCanDraw)(roomCode, socketId);
            // DEBUG: Log legal moves info
            const branchMoves = legalMoves.filter((m) => m.type === "play" && m.position?.startsWith("branch-"));
            console.log(`[DEBUG broadcastStateUpdate] socket=${socketId}, legalMoves=${legalMoves.length}, branchMoves=${branchMoves.length}`, branchMoves.length > 0 ? branchMoves.map((m) => m.position) : "");
            const handCounts = Object.fromEntries(room.state.playerIds.map((pid) => [pid, room.state.players[pid]?.hand.length ?? 0]));
            const maskedPlayers = Object.fromEntries(room.state.playerIds.map((pid) => {
                const playerState = room.state.players[pid];
                const canReveal = room.state.handOver || room.state.gameOver || pid === socketId;
                return [
                    pid,
                    {
                        ...playerState,
                        hand: canReveal ? playerState.hand : [],
                    },
                ];
            }));
            socket.emit("state:update", {
                state: {
                    ...room.state,
                    players: maskedPlayers,
                    handCounts,
                },
                legalMoves,
                canDraw,
            });
            if (room.state.handOver &&
                !room.state.gameOver &&
                room.lastHandEndedNotifiedHand !== room.state.handNumber) {
                const opponentId = room.state.playerIds.find((pid) => pid !== socketId) ?? null;
                const youScoreDelta = (currentScores[socketId] ?? 0) - (previousScores[socketId] ?? currentScores[socketId] ?? 0);
                const opponentScoreDelta = opponentId
                    ? (currentScores[opponentId] ?? 0) - (previousScores[opponentId] ?? currentScores[opponentId] ?? 0)
                    : 0;
                socket.emit("hand:ended", {
                    handNumber: room.state.handNumber,
                    opponentRemainingTiles: opponentId ? room.state.players[opponentId]?.hand ?? [] : [],
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
    }
    else if (!room.state.handOver) {
        room.lastHandEndedNotifiedHand = null;
    }
    room.lastBroadcastScores = currentScores;
}
io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    socket.on("room:create", (arg1, arg2) => {
        const config = (arg1 && typeof arg1 === "object" && !Array.isArray(arg1) ? arg1 : {});
        const cb = (typeof arg1 === "function" ? arg1 : arg2);
        const username = normalizeUsername(config.username);
        const userId = normalizeUserId(config.userId);
        const { username: _ignoredUsername, userId: _ignoredUserId, ...roomConfig } = config;
        console.log(`[room:create] socket=${socket.id}`);
        try {
            const room = (0, rooms_1.createRoom)(socket.id, roomConfig);
            socket.join(room.code);
            const roomPlayers = [{ id: socket.id, username, userId }];
            roomPlayersByCode.set(room.code, roomPlayers);
            console.log(`[room:create] created room=${room.code}, players=${room.players.length}`);
            cb?.({ ok: true, roomCode: room.code, you: socket.id, players: roomPlayers });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "unknown error";
            console.log(`[room:create] ERROR: ${message}`);
            cb?.({ ok: false, error: message });
        }
    });
    socket.on("room:join", (argCode, arg2, arg3) => {
        const cb = (typeof arg3 === "function"
            ? arg3
            : typeof arg2 === "function"
                ? arg2
                : undefined);
        const explicitConfig = (arg2 && typeof arg2 === "object" && !Array.isArray(arg2)) ? arg2 : null;
        const codeFromObject = (argCode && typeof argCode === "object" && !Array.isArray(argCode))
            ? argCode
            : null;
        const configFromCodeObject = codeFromObject
            ? {
                username: typeof codeFromObject.username === "string" ? codeFromObject.username : undefined,
                userId: typeof codeFromObject.userId === "string" ? codeFromObject.userId : null,
            }
            : null;
        const config = explicitConfig ?? configFromCodeObject ?? {};
        const username = normalizeUsername(config.username);
        const userId = normalizeUserId(config.userId);
        const rawCode = codeFromObject?.roomCode ?? argCode;
        const roomCode = String(rawCode ?? "").trim().toUpperCase();
        console.log(`[room:join] socket=${socket.id}, code=${roomCode}`);
        try {
            const room = (0, rooms_1.joinRoom)(roomCode, socket.id);
            socket.join(room.code);
            const roomPlayers = getRoomPlayersWithFallback(room.code, room.players);
            const existingIdx = roomPlayers.findIndex((p) => p.id === socket.id);
            if (existingIdx >= 0) {
                roomPlayers[existingIdx] = { id: socket.id, username, userId };
            }
            else {
                roomPlayers.push({ id: socket.id, username, userId });
            }
            roomPlayersByCode.set(room.code, roomPlayers);
            io.to(room.code).emit("room:update", { players: roomPlayers });
            console.log(`[room:join] joined room=${room.code}, players=${room.players.length}`);
            const stateWithCounts = room.state
                ? {
                    ...room.state,
                    players: Object.fromEntries(room.state.playerIds.map((pid) => {
                        const playerState = room.state.players[pid];
                        const canReveal = room.state.handOver || room.state.gameOver || pid === socket.id;
                        return [
                            pid,
                            {
                                ...playerState,
                                hand: canReveal ? playerState.hand : [],
                            },
                        ];
                    })),
                    handCounts: Object.fromEntries(room.state.playerIds.map((pid) => [pid, room.state.players[pid]?.hand.length ?? 0])),
                }
                : null;
            cb?.({ ok: true, roomCode: room.code, you: socket.id, players: roomPlayers, state: stateWithCounts });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "unknown error";
            console.log(`[room:join] ERROR: ${message}`);
            cb?.({ ok: false, error: message });
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
    socket.on("hand:ready", (code, cb) => {
        const roomCode = String(code).trim().toUpperCase();
        try {
            const result = (0, rooms_1.readyForNextHand)(roomCode, socket.id);
            if (result.started) {
                broadcastStateUpdate(result.room.code);
            }
            cb?.({ ok: true, started: result.started });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "unknown error";
            cb?.({ ok: false, error: message });
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