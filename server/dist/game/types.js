"use strict";
// ─── Tile ───────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.tileEquals = tileEquals;
exports.isDouble = isDouble;
exports.tileId = tileId;
exports.tileMatchesEnd = tileMatchesEnd;
exports.totalTilesInSet = totalTilesInSet;
exports.tilePips = tilePips;
exports.parseBranchPosition = parseBranchPosition;
exports.makeBranchPosition = makeBranchPosition;
exports.isMainLinePosition = isMainLinePosition;
function tileEquals(a, b) {
    return a.high === b.high && a.low === b.low;
}
function isDouble(tile) {
    return tile.high === tile.low;
}
function tileId(tile) {
    return `[${tile.low}|${tile.high}]`;
}
function tileMatchesEnd(tile, endValue) {
    return tile.high === endValue || tile.low === endValue;
}
function totalTilesInSet(maxPips) {
    return ((maxPips + 1) * (maxPips + 2)) / 2;
}
function tilePips(tile) {
    return tile.high + tile.low;
}
exports.DEFAULT_CONFIG = {
    maxPips: 6,
    tilesPerPlayer: 7,
    deadTileCount: 2,
    scoringMultiple: 5,
    blockedHandRule: 'lowestPips',
    endHandBonus: 'sumOpponentPenalties',
    winningScore: 60,
};
// ─── Position Utilities ──────────────────────────────────────
function parseBranchPosition(pos) {
    if (pos === 'left' || pos === 'right')
        return null;
    const match = pos.match(/^branch-(\d+)-(\d+)$/);
    if (!match)
        return null;
    return { hubIndex: parseInt(match[1], 10), armIndex: parseInt(match[2], 10) };
}
function makeBranchPosition(hubIndex, armIndex) {
    return `branch-${hubIndex}-${armIndex}`;
}
// Check if position is a main line position
function isMainLinePosition(pos) {
    return pos === 'left' || pos === 'right';
}
//# sourceMappingURL=types.js.map