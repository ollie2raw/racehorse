"use strict";
// server/src/game/engine.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOpenEnds = exports.computePlayScore = exports.computeOpenEndsSum = void 0;
exports.createInitialState = createInitialState;
exports.startNewHand = startNewHand;
exports.getLegalMoves = getLegalMoves;
exports.canDraw = canDraw;
exports.drawUntilPlayableOrEmpty = drawUntilPlayableOrEmpty;
exports.applyMove = applyMove;
const types_1 = require("./types");
const scoring_1 = require("./scoring");
// ─── Internal helpers ─────────────────────────────────────
function generateFullSet(maxPips) {
    const tiles = [];
    for (let high = 0; high <= maxPips; high++) {
        for (let low = 0; low <= high; low++) {
            tiles.push({ high, low });
        }
    }
    return tiles;
}
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function removeTileFromArray(tiles, tile) {
    const idx = tiles.findIndex(t => (0, types_1.tileEquals)(t, tile));
    if (idx === -1)
        return [...tiles];
    return [...tiles.slice(0, idx), ...tiles.slice(idx + 1)];
}
function playerHasTile(state, playerId, tile) {
    return state.players[playerId].hand.some(t => (0, types_1.tileEquals)(t, tile));
}
function assertCurrentPlayer(state, playerId) {
    const currentId = state.playerIds[state.currentPlayerIndex];
    if (currentId !== playerId) {
        throw new Error(`It is not ${playerId}'s turn. Current player: ${currentId}.`);
    }
}
/**
 * Check if any player has reached the winning score.
 */
function checkForGameWinner(state) {
    for (const id of state.playerIds) {
        if (state.players[id].score >= state.config.winningScore) {
            return id;
        }
    }
    return null;
}
/**
 * A player cannot go out (play their last tile) if that tile is a double
 * OR if that final play would score.
 */
function isGoingOutIllegal(state, playerId, tile, position) {
    const hand = state.players[playerId].hand;
    if (hand.length !== 1 || !(0, types_1.tileEquals)(hand[0], tile))
        return false;
    // Doubles can never be the going-out tile
    if ((0, types_1.isDouble)(tile))
        return true;
    // Check if this position is valid (tile matches the end)
    const openEnds = (0, scoring_1.getOpenEnds)(state.board);
    const targetEnd = openEnds.find(e => e.position === position);
    if (!targetEnd)
        return false;
    // For opening move
    if (targetEnd.matchValue === -1) {
        const simBoard = (0, scoring_1.simulatePlacement)(null, tile, position);
        return (0, scoring_1.computePlayScore)(simBoard, state.config) > 0;
    }
    // Check if tile matches
    if (!(0, types_1.tileMatchesEnd)(tile, targetEnd.matchValue)) {
        return false;
    }
    const simBoard = (0, scoring_1.simulatePlacement)(state.board, tile, position);
    return (0, scoring_1.computePlayScore)(simBoard, state.config) > 0;
}
function validateConfig(playerCount, cfg) {
    const total = (0, types_1.totalTilesInSet)(cfg.maxPips);
    const needed = playerCount * cfg.tilesPerPlayer + cfg.deadTileCount;
    if (needed > total) {
        throw new Error(`Config impossible: ${playerCount} players × ${cfg.tilesPerPlayer} tiles + ` +
            `${cfg.deadTileCount} dead tiles = ${needed}, but a double-${cfg.maxPips} ` +
            `set only has ${total} tiles.`);
    }
}
// ─── Blocked hand resolution ──────────────────────────────
function resolveBlockedHand(state) {
    const cfg = state.config;
    if (cfg.blockedHandRule === 'noScore') {
        const winnerId = checkForGameWinner(state);
        return {
            ...state,
            handOver: true,
            gameOver: winnerId !== null,
            winnerId,
        };
    }
    // 'lowestPips': player with fewest pips wins
    let lowestPips = Infinity;
    let handWinnerId = state.playerIds[0];
    for (const id of state.playerIds) {
        const pips = state.players[id].hand.reduce((sum, t) => sum + t.high + t.low, 0);
        if (pips < lowestPips) {
            lowestPips = pips;
            handWinnerId = id;
        }
    }
    const bonus = cfg.endHandBonus === 'sumOpponentPenalties'
        ? state.playerIds
            .filter(id => id !== handWinnerId)
            .reduce((sum, id) => sum + (0, scoring_1.computeHandPenalty)(state.players[id].hand, cfg), 0)
        : 0;
    const updatedPlayers = { ...state.players };
    updatedPlayers[handWinnerId] = {
        ...updatedPlayers[handWinnerId],
        score: updatedPlayers[handWinnerId].score + bonus,
    };
    const newState = {
        ...state,
        players: updatedPlayers,
        handOver: true,
    };
    const gameWinnerId = checkForGameWinner(newState);
    return {
        ...newState,
        gameOver: gameWinnerId !== null,
        winnerId: gameWinnerId,
    };
}
/**
 * Award end-of-hand bonus when a player goes out.
 */
function resolveGoOut(state, goOutPlayerId) {
    const cfg = state.config;
    const bonus = cfg.endHandBonus === 'sumOpponentPenalties'
        ? state.playerIds
            .filter(id => id !== goOutPlayerId)
            .reduce((sum, id) => sum + (0, scoring_1.computeHandPenalty)(state.players[id].hand, cfg), 0)
        : 0;
    const updatedPlayers = { ...state.players };
    updatedPlayers[goOutPlayerId] = {
        ...updatedPlayers[goOutPlayerId],
        score: updatedPlayers[goOutPlayerId].score + bonus,
    };
    const newState = {
        ...state,
        players: updatedPlayers,
        handOver: true,
    };
    const gameWinnerId = checkForGameWinner(newState);
    return {
        ...newState,
        gameOver: gameWinnerId !== null,
        winnerId: gameWinnerId,
    };
}
// ─── Core exported functions ──────────────────────────────
function createInitialState(players, config) {
    if (players.length < 2 || players.length > 4) {
        throw new Error('Dominoes requires 2–4 players.');
    }
    const cfg = { ...types_1.DEFAULT_CONFIG, ...config };
    validateConfig(players.length, cfg);
    const playerStates = {};
    for (const id of players) {
        playerStates[id] = { id, hand: [], score: 0 };
    }
    return {
        config: cfg,
        playerIds: [...players],
        players: playerStates,
        board: null,
        boneyard: [],
        deadTiles: [],
        currentPlayerIndex: 0,
        handNumber: 0,
        handOpen: false,
        handOver: false,
        gameOver: false,
        winnerId: null,
        consecutivePasses: 0,
    };
}
function startNewHand(state) {
    if (state.gameOver) {
        throw new Error('Game is over. Cannot start a new hand.');
    }
    const cfg = state.config;
    const handNumber = state.handNumber + 1;
    const allTiles = shuffle(generateFullSet(cfg.maxPips));
    // Deal hands
    const players = {};
    let cursor = 0;
    for (const id of state.playerIds) {
        const hand = allTiles.slice(cursor, cursor + cfg.tilesPerPlayer);
        cursor += cfg.tilesPerPlayer;
        players[id] = { ...state.players[id], hand };
    }
    // Remaining tiles: drawable boneyard is everything except the last deadTileCount
    const remaining = allTiles.slice(cursor);
    const boneyard = remaining.slice(0, remaining.length - cfg.deadTileCount);
    const deadTiles = remaining.slice(remaining.length - cfg.deadTileCount);
    // Starting player rotates by hand number (1-indexed → 0-indexed)
    const startingIndex = (handNumber - 1) % state.playerIds.length;
    return {
        ...state,
        players,
        board: null,
        boneyard,
        deadTiles,
        currentPlayerIndex: startingIndex,
        handNumber,
        handOpen: false,
        handOver: false,
        consecutivePasses: 0,
    };
}
function getLegalMoves(state, playerId) {
    assertCurrentPlayer(state, playerId);
    if (state.handOver || state.gameOver)
        return [];
    const hand = state.players[playerId].hand;
    const moves = [];
    if (!state.handOpen) {
        // ── Hand is closed: must open with a double OR a scoring play ──
        for (const tile of hand) {
            const simBoard = (0, scoring_1.simulatePlacement)(null, tile, 'left');
            const scores = (0, scoring_1.computePlayScore)(simBoard, state.config) > 0;
            const double = (0, types_1.isDouble)(tile);
            if (double || scores) {
                if (!isGoingOutIllegal(state, playerId, tile, 'left')) {
                    moves.push({ type: 'play', tile, position: 'left' });
                }
            }
        }
    }
    else {
        // ── Hand is open: must match an open end ──
        const openEnds = (0, scoring_1.getOpenEnds)(state.board);
        for (const tile of hand) {
            const matchingPositions = [];
            for (const end of openEnds) {
                if ((0, types_1.tileMatchesEnd)(tile, end.matchValue)) {
                    matchingPositions.push(end.position);
                }
            }
            // Deduplicate positions if main left and right have same value
            const uniquePositions = [...new Set(matchingPositions)];
            for (const position of uniquePositions) {
                if (!isGoingOutIllegal(state, playerId, tile, position)) {
                    moves.push({ type: 'play', tile, position });
                }
            }
        }
    }
    // Pass is only legal when no play moves exist AND drawable boneyard is empty
    if (moves.length === 0 && state.boneyard.length === 0) {
        moves.push({ type: 'pass' });
    }
    return moves;
}
/**
 * Check if drawing is allowed for the current player.
 * Draw is only allowed if:
 * - It is the player's turn
 * - They have no legal play moves
 * - The boneyard has tiles
 */
function canDraw(state, playerId) {
    if (state.handOver || state.gameOver)
        return false;
    const currentId = state.playerIds[state.currentPlayerIndex];
    if (currentId !== playerId)
        return false;
    if (state.boneyard.length === 0)
        return false;
    const moves = getLegalMoves(state, playerId);
    const hasPlay = moves.some(m => m.type === 'play');
    return !hasPlay;
}
function drawUntilPlayableOrEmpty(state, playerId) {
    assertCurrentPlayer(state, playerId);
    // If player already has a legal play, no need to draw
    const moves = getLegalMoves(state, playerId);
    const hasPlay = moves.some(m => m.type === 'play');
    if (hasPlay) {
        return { state, drew: 0 };
    }
    let current = state;
    let drew = 0;
    while (current.boneyard.length > 0) {
        const [drawnTile, ...remainingBoneyard] = current.boneyard;
        const playerState = current.players[playerId];
        const newHand = [...playerState.hand, drawnTile];
        current = {
            ...current,
            players: {
                ...current.players,
                [playerId]: { ...playerState, hand: newHand },
            },
            boneyard: remainingBoneyard,
        };
        drew++;
        // Check if the player now has any play move
        const newMoves = getLegalMoves(current, playerId);
        if (newMoves.some(m => m.type === 'play'))
            break;
    }
    return { state: current, drew };
}
function applyMove(state, playerId, move) {
    assertCurrentPlayer(state, playerId);
    if (state.handOver) {
        throw new Error('Hand is already over. Call startNewHand().');
    }
    if (state.gameOver) {
        throw new Error('Game is over.');
    }
    // ── Pass ──
    if (move.type === 'pass') {
        if (state.boneyard.length > 0) {
            throw new Error('Cannot pass while there are drawable tiles in the boneyard. ' +
                'Call drawUntilPlayableOrEmpty() first.');
        }
        const playMoves = getLegalMoves(state, playerId).filter(m => m.type === 'play');
        if (playMoves.length > 0) {
            throw new Error('Cannot pass when you have a legal play available.');
        }
        const nextIndex = (state.currentPlayerIndex + 1) % state.playerIds.length;
        const newConsecutivePasses = state.consecutivePasses + 1;
        // If all players have passed consecutively, the hand is blocked
        if (newConsecutivePasses >= state.playerIds.length) {
            return resolveBlockedHand({
                ...state,
                consecutivePasses: newConsecutivePasses,
            });
        }
        return {
            ...state,
            currentPlayerIndex: nextIndex,
            consecutivePasses: newConsecutivePasses,
        };
    }
    // ── Play ──
    const { tile, position } = move;
    if (!playerHasTile(state, playerId, tile)) {
        throw new Error(`Player ${playerId} does not have tile ${(0, types_1.tileId)(tile)} in hand.`);
    }
    // Validate against legal moves
    const legalMoves = getLegalMoves(state, playerId);
    const isLegal = legalMoves.some(m => m.type === 'play' && (0, types_1.tileEquals)(m.tile, tile) && m.position === position);
    if (!isLegal) {
        if (!state.handOpen) {
            throw new Error(`Illegal opening move: ${(0, types_1.tileId)(tile)} cannot open the hand. ` +
                `You must play a double or a tile whose placement scores ` +
                `(open-ends sum divisible by ${state.config.scoringMultiple}).`);
        }
        if (isGoingOutIllegal(state, playerId, tile, position)) {
            throw new Error(`Illegal move: cannot go out with ${(0, types_1.tileId)(tile)} because ` +
                `${(0, types_1.isDouble)(tile) ? 'it is a double' : 'the play scores'}. ` +
                `You must keep at least one tile in hand.`);
        }
        const branchPos = (0, types_1.parseBranchPosition)(position);
        if (branchPos) {
            throw new Error(`Illegal move: ${(0, types_1.tileId)(tile)} cannot be placed on branch ${position}.`);
        }
        const boardLeft = state.board?.leftEnd ?? '?';
        const boardRight = state.board?.rightEnd ?? '?';
        throw new Error(`Illegal move: ${(0, types_1.tileId)(tile)} on ${position} does not match ` +
            `the board (left=${boardLeft}, right=${boardRight}).`);
    }
    // Place the tile
    const newBoard = (0, scoring_1.simulatePlacement)(state.board, tile, position);
    const newHand = removeTileFromArray(state.players[playerId].hand, tile);
    const scored = (0, scoring_1.computePlayScore)(newBoard, state.config);
    const playedDouble = (0, types_1.isDouble)(tile);
    const newPlayerState = {
        ...state.players[playerId],
        hand: newHand,
        score: state.players[playerId].score + scored,
    };
    let newState = {
        ...state,
        board: newBoard,
        handOpen: true,
        players: {
            ...state.players,
            [playerId]: newPlayerState,
        },
        consecutivePasses: 0,
    };
    // Check if player went out (hand is empty)
    if (newHand.length === 0) {
        return resolveGoOut(newState, playerId);
    }
    // Check if player reached winning score (game ends immediately)
    const gameWinnerId = checkForGameWinner(newState);
    if (gameWinnerId !== null) {
        return {
            ...newState,
            gameOver: true,
            winnerId: gameWinnerId,
        };
    }
    // Extra turn: doubles or scoring plays grant another turn (can chain)
    if (playedDouble || scored > 0) {
        return newState;
    }
    // Normal: advance to next player
    const nextIndex = (state.currentPlayerIndex + 1) % state.playerIds.length;
    return { ...newState, currentPlayerIndex: nextIndex };
}
// ─── Exports for scoring module ────────────────────────────
var scoring_2 = require("./scoring");
Object.defineProperty(exports, "computeOpenEndsSum", { enumerable: true, get: function () { return scoring_2.computeOpenEndsSum; } });
Object.defineProperty(exports, "computePlayScore", { enumerable: true, get: function () { return scoring_2.computePlayScore; } });
Object.defineProperty(exports, "getOpenEnds", { enumerable: true, get: function () { return scoring_2.getOpenEnds; } });
//# sourceMappingURL=engine.js.map