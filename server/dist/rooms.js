"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRoom = createRoom;
exports.joinRoom = joinRoom;
exports.getRoom = getRoom;
exports.startGame = startGame;
exports.nextHand = nextHand;
exports.readyForNextHand = readyForNextHand;
exports.act = act;
exports.getRoomLegalMoves = getRoomLegalMoves;
exports.getRoomCanDraw = getRoomCanDraw;
exports.getRoomOpenEnds = getRoomOpenEnds;
const engine_1 = require("./game/engine");
const rooms = new Map();
function makeCode(len = 5) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < len; i++) {
        s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
}
function createRoom(hostSocketId, config = {}) {
    let code = makeCode();
    while (rooms.has(code))
        code = makeCode();
    const room = {
        code,
        players: [hostSocketId],
        state: null,
        config,
        nextHandReady: new Set(),
        lastHandEndedNotifiedHand: null,
        lastBroadcastScores: {},
    };
    rooms.set(code, room);
    return room;
}
function joinRoom(code, socketId) {
    const room = rooms.get(code);
    if (!room)
        throw new Error("Room not found.");
    if (!room.players.includes(socketId)) {
        if (room.players.length >= 2) {
            throw new Error("Room is full (v1 supports 2 players).");
        }
        room.players.push(socketId);
    }
    return room;
}
function getRoom(code) {
    const room = rooms.get(code);
    if (!room)
        throw new Error("Room not found.");
    return room;
}
function startGame(code) {
    const room = getRoom(code);
    if (room.players.length !== 2) {
        throw new Error("Need exactly 2 players to start.");
    }
    // Defensive: If game is in a stale state (handOver but not gameOver), allow restart
    // This handles edge cases where the room got stuck
    if (room.state && !room.state.gameOver && !room.state.handOver) {
        // Game is actively in progress - don't allow restart
        throw new Error("Game is already in progress.");
    }
    // Create fresh game state (either first start or restart after stale state)
    const state0 = (0, engine_1.createInitialState)(room.players, room.config);
    const state1 = (0, engine_1.startNewHand)(state0);
    // Auto-draw for starting player until they can open
    const currentPlayerId = state1.playerIds[state1.currentPlayerIndex];
    const { state: state2 } = (0, engine_1.drawUntilPlayableOrEmpty)(state1, currentPlayerId);
    room.state = state2;
    room.nextHandReady.clear();
    room.lastHandEndedNotifiedHand = null;
    room.lastBroadcastScores = Object.fromEntries(room.state.playerIds.map((pid) => [pid, room.state.players[pid]?.score ?? 0]));
    return room;
}
function nextHand(code) {
    const room = getRoom(code);
    if (!room.state)
        throw new Error("Game not started.");
    if (!room.state.handOver) {
        throw new Error("Hand is not over yet.");
    }
    if (room.state.gameOver) {
        throw new Error("Game is over. Cannot start a new hand.");
    }
    // Start new hand
    const state1 = (0, engine_1.startNewHand)(room.state);
    // Auto-draw for starting player until they can open
    const currentPlayerId = state1.playerIds[state1.currentPlayerIndex];
    const { state: state2 } = (0, engine_1.drawUntilPlayableOrEmpty)(state1, currentPlayerId);
    room.state = state2;
    room.nextHandReady.clear();
    room.lastHandEndedNotifiedHand = null;
    room.lastBroadcastScores = Object.fromEntries(room.state.playerIds.map((pid) => [pid, room.state.players[pid]?.score ?? 0]));
    return room;
}
function readyForNextHand(code, socketId) {
    const room = getRoom(code);
    if (!room.state)
        throw new Error("Game not started.");
    if (room.state.gameOver)
        return { started: false, room };
    if (!room.state.handOver)
        return { started: false, room };
    if (!room.players.includes(socketId))
        throw new Error("Player not in room.");
    room.nextHandReady.add(socketId);
    if (room.nextHandReady.size >= room.players.length) {
        room.nextHandReady.clear();
        const startedRoom = nextHand(code);
        return { started: true, room: startedRoom };
    }
    return { started: false, room };
}
function act(code, socketId, action) {
    const room = getRoom(code);
    if (!room.state)
        throw new Error("Game not started.");
    let state = room.state;
    const { type } = action;
    // ─────────────────────────────
    // DRAW
    // ─────────────────────────────
    if (type === "DRAW") {
        if (!(0, engine_1.canDraw)(state, socketId)) {
            const currentId = state.playerIds[state.currentPlayerIndex];
            if (currentId !== socketId) {
                throw new Error("It's not your turn.");
            }
            if (state.boneyard.length === 0) {
                throw new Error("Boneyard is empty.");
            }
            throw new Error("You have a legal play — you may not draw.");
        }
        const res = (0, engine_1.drawUntilPlayableOrEmpty)(state, socketId);
        room.state = res.state;
        return room;
    }
    // ─────────────────────────────
    // MOVE
    // ─────────────────────────────
    if (type === "MOVE") {
        if (!action.move)
            throw new Error("Move payload missing.");
        const { tile } = action.move;
        const position = action.move.position ?? action.move.end ?? "left";
        const move = {
            type: "play",
            tile: { high: tile.high, low: tile.low },
            position,
        };
        room.state = (0, engine_1.applyMove)(state, socketId, move);
        return room;
    }
    // ─────────────────────────────
    // PASS
    // ─────────────────────────────
    if (type === "PASS") {
        room.state = (0, engine_1.applyMove)(state, socketId, { type: "pass" });
        return room;
    }
    throw new Error("Unknown action type.");
}
// Get legal moves for a player
function getRoomLegalMoves(code, playerId) {
    const room = getRoom(code);
    if (!room.state)
        return [];
    const currentId = room.state.playerIds[room.state.currentPlayerIndex];
    if (currentId !== playerId)
        return [];
    return (0, engine_1.getLegalMoves)(room.state, playerId);
}
// Check if player can draw
function getRoomCanDraw(code, playerId) {
    const room = getRoom(code);
    if (!room.state)
        return false;
    return (0, engine_1.canDraw)(room.state, playerId);
}
// Expose getOpenEnds for client to know valid placements
function getRoomOpenEnds(code) {
    const room = getRoom(code);
    if (!room.state)
        return [];
    return (0, engine_1.getOpenEnds)(room.state.board);
}
//# sourceMappingURL=rooms.js.map