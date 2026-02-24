// server/src/game/engine.ts

import {
  Tile,
  BoardState,
  Config,
  DEFAULT_CONFIG,
  GameState,
  PlayerState,
  Move,
  PlayMove,
  PlacementPosition,
  tileEquals,
  isDouble,
  tileId,
  tileMatchesEnd,
  totalTilesInSet,
  parseBranchPosition,
} from './types';
import {
  simulatePlacement,
  computePlayScore,
  computeHandPenalty,
  computeGoOutBonusPoints,
  getOpenEnds,
} from './scoring';

// ─── Internal helpers ─────────────────────────────────────

function generateFullSet(maxPips: number): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= maxPips; high++) {
    for (let low = 0; low <= high; low++) {
      tiles.push({ high, low });
    }
  }
  return tiles;
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function removeTileFromArray(tiles: readonly Tile[], tile: Tile): Tile[] {
  const idx = tiles.findIndex((t) => tileEquals(t, tile));
  if (idx === -1) return [...tiles];
  return [...tiles.slice(0, idx), ...tiles.slice(idx + 1)];
}

function playerHasTile(state: GameState, playerId: string, tile: Tile): boolean {
  return state.players[playerId].hand.some((t) => tileEquals(t, tile));
}

function assertCurrentPlayer(state: GameState, playerId: string): void {
  const currentId = state.playerIds[state.currentPlayerIndex];
  if (currentId !== playerId) {
    throw new Error(`It is not ${playerId}'s turn. Current player: ${currentId}.`);
  }
}

/**
 * Check if any player has reached the winning score.
 */
function checkForGameWinner(state: GameState): string | null {
  const target = state.config.winningScore;
  const qualified = state.playerIds.filter((id) => state.players[id].score >= target);
  if (qualified.length === 0) return null;
  return qualified.reduce((best, id) =>
    state.players[id].score > state.players[best].score ? id : best,
  );
}

/**
 * A player cannot go out (play their last tile) if that tile is a double
 * OR if that final play would score.
 */
function isGoingOutIllegal(
  state: GameState,
  playerId: string,
  tile: Tile,
  position: PlacementPosition,
): boolean {
  void state;
  void playerId;
  void tile;
  void position;
  // Last-tile constraints are enforced after applyMove (forced draw), not in legal generation.
  return false;
}

function validateConfig(playerCount: number, cfg: Config): void {
  const total = totalTilesInSet(cfg.maxPips);
  const needed = playerCount * cfg.tilesPerPlayer + cfg.deadTileCount;
  if (needed > total) {
    throw new Error(
      `Config impossible: ${playerCount} players × ${cfg.tilesPerPlayer} tiles + ` +
        `${cfg.deadTileCount} dead tiles = ${needed}, but a double-${cfg.maxPips} ` +
        `set only has ${total} tiles.`,
    );
  }
}

function canonicalTileId(tile: Tile): string {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return `${low}|${high}`;
}

function positionSortKey(position: PlacementPosition): [number, number, number] {
  if (position === 'left') return [0, 0, 0];
  if (position === 'right') return [1, 0, 0];
  const parsed = parseBranchPosition(position);
  if (!parsed) return [9, 0, 0];
  return [2, parsed.hubIndex, parsed.armIndex];
}

function sortLegalMoves(moves: Move[]): Move[] {
  const plays = moves.filter((m): m is PlayMove => m.type === 'play');
  const passes = moves.filter((m) => m.type === 'pass');
  plays.sort((a, b) => {
    const aId = canonicalTileId(a.tile);
    const bId = canonicalTileId(b.tile);
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    const aPos = positionSortKey(a.position);
    const bPos = positionSortKey(b.position);
    if (aPos[0] !== bPos[0]) return aPos[0] - bPos[0];
    if (aPos[1] !== bPos[1]) return aPos[1] - bPos[1];
    return aPos[2] - bPos[2];
  });
  return [...plays, ...passes];
}

function endpointMatchFromOrientation(board: BoardState, side: 'left' | 'right'): number {
  const placed = side === 'left' ? board.mainLine[0] : board.mainLine[board.mainLine.length - 1];
  if (!placed) return side === 'left' ? board.leftEnd : board.rightEnd;
  const tile = placed.tile;
  if (isDouble(tile)) return tile.high;
  if (placed.orientation === 'horizontal-normal') {
    return side === 'left' ? tile.low : tile.high;
  }
  if (placed.orientation === 'horizontal-flipped') {
    return side === 'left' ? tile.high : tile.low;
  }
  return side === 'left' ? board.leftEnd : board.rightEnd;
}

// ─── Blocked hand resolution ──────────────────────────────

function resolveBlockedHand(state: GameState): GameState {
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

  const bonus =
    cfg.endHandBonus === 'sumOpponentPenalties'
      ? state.playerIds
          .filter((id) => id !== handWinnerId)
          .reduce((sum, id) => sum + computeHandPenalty(state.players[id].hand, cfg), 0)
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
function resolveGoOut(state: GameState, goOutPlayerId: string): GameState {
  const cfg = state.config;
  const bonusBreakdown =
    cfg.endHandBonus === 'sumOpponentPenalties'
      ? state.playerIds
          .filter((id) => id !== goOutPlayerId)
          .map((id) => {
            const hand = state.players[id].hand;
            const awarded = computeGoOutBonusPoints(hand, cfg);
            return { awarded };
          })
      : [];
  const bonus = bonusBreakdown.reduce((sum, item) => sum + item.awarded, 0);

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

export function createInitialState(players: string[], config?: Partial<Config>): GameState {
  if (players.length < 2 || players.length > 4) {
    throw new Error('Dominoes requires 2–4 players.');
  }

  const cfg: Config = { ...DEFAULT_CONFIG, ...config };
  validateConfig(players.length, cfg);

  const playerStates: Record<string, PlayerState> = {};
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

export function startNewHand(state: GameState): GameState {
  if (state.gameOver) {
    throw new Error('Game is over. Cannot start a new hand.');
  }

  const cfg = state.config;
  const handNumber = state.handNumber + 1;
  const allTiles = shuffle(generateFullSet(cfg.maxPips));

  // Deal hands
  const players: Record<string, PlayerState> = {};
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

export function getLegalMoves(state: GameState, playerId: string): Move[] {
  assertCurrentPlayer(state, playerId);
  if (state.handOver || state.gameOver) return [];

  const hand = state.players[playerId].hand;
  const moves: Move[] = [];

  if (!state.handOpen) {
    // ── Hand is closed: must open with a double OR a scoring play ──
    for (const tile of hand) {
      const simBoard = simulatePlacement(null, tile, 'left');
      const scores = computePlayScore(simBoard, state.config) > 0;
      const double = isDouble(tile);

      if (double || scores) {
        if (!isGoingOutIllegal(state, playerId, tile, 'left')) {
          moves.push({ type: 'play', tile, position: 'left' });
        }
      }
    }
  } else {
    // ── Hand is open: must match an open end ──
    const openEndsRaw = getOpenEnds(state.board);
    const openEnds = state.board
      ? openEndsRaw.map((end) => {
          if (end.position === 'left') {
            return { ...end, matchValue: endpointMatchFromOrientation(state.board!, 'left') };
          }
          if (end.position === 'right') {
            return { ...end, matchValue: endpointMatchFromOrientation(state.board!, 'right') };
          }
          return end;
        })
      : openEndsRaw;

    for (const tile of hand) {
      const matchingPositions: PlacementPosition[] = [];

      for (const end of openEnds) {
        if (tileMatchesEnd(tile, end.matchValue)) {
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

    // Pending doubles do not restrict legal move generation.
  }

  // Pass is only legal when no play moves exist AND drawable boneyard is empty
  if (moves.length === 0 && state.boneyard.length === 0) {
    moves.push({ type: 'pass' });
  }

  return sortLegalMoves(moves);
}

/**
 * Check if drawing is allowed for the current player.
 * Draw is only allowed if:
 * - It is the player's turn
 * - They have no legal play moves
 * - The boneyard has tiles
 */
export function canDraw(state: GameState, playerId: string): boolean {
  if (state.handOver || state.gameOver) return false;

  const currentId = state.playerIds[state.currentPlayerIndex];
  if (currentId !== playerId) return false;

  if (state.boneyard.length === 0) return false;

  const moves = getLegalMoves(state, playerId);
  const hasPlay = moves.some((m) => m.type === 'play');

  return !hasPlay;
}

export function drawUntilPlayableOrEmpty(
  state: GameState,
  playerId: string,
): { state: GameState; drew: number } {
  assertCurrentPlayer(state, playerId);

  // If player already has a legal play, no need to draw
  const moves = getLegalMoves(state, playerId);
  const hasPlay = moves.some((m) => m.type === 'play');
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
    if (newMoves.some((m) => m.type === 'play')) break;
  }

  return { state: current, drew };
}

export function applyMove(state: GameState, playerId: string, move: Move): GameState {
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
      throw new Error(
        'Cannot pass while there are drawable tiles in the boneyard. ' +
          'Call drawUntilPlayableOrEmpty() first.',
      );
    }
    const playMoves = getLegalMoves(state, playerId).filter((m) => m.type === 'play');
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
  const { tile, position } = move as PlayMove;

  if (!playerHasTile(state, playerId, tile)) {
    throw new Error(`Player ${playerId} does not have tile ${tileId(tile)} in hand.`);
  }

  // Validate against legal moves
  const legalMoves = getLegalMoves(state, playerId);
  const isLegal = legalMoves.some(
    (m) => m.type === 'play' && tileEquals(m.tile, tile) && m.position === position,
  );

  if (!isLegal) {
    if (!state.handOpen) {
      throw new Error(
        `Illegal opening move: ${tileId(tile)} cannot open the hand. ` +
          `You must play a double or a tile whose placement scores ` +
          `(open-ends sum divisible by ${state.config.scoringMultiple}).`,
      );
    }
    if (isGoingOutIllegal(state, playerId, tile, position)) {
      throw new Error(
        `Illegal move: cannot go out with ${tileId(tile)} because ` +
          `${isDouble(tile) ? 'it is a double' : 'the play scores'}. ` +
          `You must keep at least one tile in hand.`,
      );
    }

    const branchPos = parseBranchPosition(position);
    if (branchPos) {
      throw new Error(`Illegal move: ${tileId(tile)} cannot be placed on branch ${position}.`);
    }

    const boardLeft = state.board?.leftEnd ?? '?';
    const boardRight = state.board?.rightEnd ?? '?';
    throw new Error(
      `Illegal move: ${tileId(tile)} on ${position} does not match ` +
        `the board (left=${boardLeft}, right=${boardRight}).`,
    );
  }

  // Place the tile
  const newBoard = simulatePlacement(state.board, tile, position);
  const newHand = removeTileFromArray(state.players[playerId].hand, tile);
  const scored = computePlayScore(newBoard, state.config);
  const playedDouble = isDouble(tile);

  const newPlayerState: PlayerState = {
    ...state.players[playerId],
    hand: newHand,
    score: state.players[playerId].score + scored,
  };

  let newState: GameState = {
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
    // House rule: scoring or double last tile must draw 1 and continue (if boneyard has tiles).
    if ((playedDouble || scored > 0) && newState.boneyard.length > 0) {
      const [drawnTile, ...remainingBoneyard] = newState.boneyard;
      return {
        ...newState,
        players: {
          ...newState.players,
          [playerId]: {
            ...newState.players[playerId],
            hand: [drawnTile],
          },
        },
        boneyard: remainingBoneyard,
      };
    }
    return resolveGoOut(newState, playerId);
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

export { computeOpenEndsSum, computePlayScore, getOpenEnds } from './scoring';
