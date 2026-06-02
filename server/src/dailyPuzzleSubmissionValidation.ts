import { applyMove, getLegalMoves } from './game/engine';
import {
  DEFAULT_CONFIG,
  tileEquals,
  tileId,
  type BoardState,
  type GameState,
  type Move,
  type PlacementPosition,
  type Tile,
} from './game/types';
import type { DailyPuzzleSlot } from './dailyPuzzle';

const DAILY_PUZZLE_PLAYER_ID = 'you';
const DAILY_PUZZLE_BOT_ID = 'bot';
const MAX_DAILY_PUZZLE_ELAPSED_SECONDS = 24 * 60 * 60;

export interface DailyPuzzleSubmissionValidationInput {
  slot: DailyPuzzleSlot;
  submittedLine: Array<Record<string, unknown>>;
  elapsedSeconds: number;
  clientRawScore?: number;
}

export interface DailyPuzzleSubmissionValidationResult {
  rawScore: number;
  movesUsed: number;
  elapsedSeconds: number;
  solved: boolean;
  perfect: boolean;
  submittedLine: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
}

function isTile(value: unknown): value is Tile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { low?: unknown; high?: unknown };
  return (
    Number.isInteger(candidate.low) &&
    Number.isInteger(candidate.high) &&
    Number(candidate.low) >= 0 &&
    Number(candidate.low) <= DEFAULT_CONFIG.maxPips &&
    Number(candidate.high) >= 0 &&
    Number(candidate.high) <= DEFAULT_CONFIG.maxPips
  );
}

function normalizeTile(tile: Tile): Tile {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return { low, high };
}

function isPlacementPosition(value: unknown): value is PlacementPosition {
  if (value === 'left' || value === 'right') return true;
  return typeof value === 'string' && /^branch-\d+-\d+$/.test(value);
}

function normalizeBoard(board: unknown): BoardState | null {
  if (!board || typeof board !== 'object') return null;
  const candidate = board as Partial<BoardState>;
  if (
    !Array.isArray(candidate.mainLine) ||
    !Number.isInteger(candidate.leftEnd) ||
    !Number.isInteger(candidate.rightEnd) ||
    typeof candidate.leftEndIsDouble !== 'boolean' ||
    typeof candidate.rightEndIsDouble !== 'boolean' ||
    !Array.isArray(candidate.hubDoubles)
  ) {
    return null;
  }
  return candidate as BoardState;
}

function normalizeHand(hand: unknown): Tile[] {
  if (!Array.isArray(hand)) return [];
  return hand.filter(isTile).map(normalizeTile);
}

function countTiles(tiles: readonly Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const id = tileId(normalizeTile(tile));
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function buildInitialPuzzleState(slot: DailyPuzzleSlot, startingHand: Tile[], startingBoard: BoardState | null): GameState {
  return {
    config: {
      ...DEFAULT_CONFIG,
      tilesPerPlayer: Math.max(1, startingHand.length),
      deadTileCount: 0,
      winningScore: 999,
    },
    playerIds: [DAILY_PUZZLE_PLAYER_ID, DAILY_PUZZLE_BOT_ID],
    players: {
      [DAILY_PUZZLE_PLAYER_ID]: {
        id: DAILY_PUZZLE_PLAYER_ID,
        hand: startingHand,
        score: 0,
      },
      [DAILY_PUZZLE_BOT_ID]: {
        id: DAILY_PUZZLE_BOT_ID,
        hand: [],
        score: 0,
      },
    },
    board: startingBoard,
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: Boolean(startingBoard),
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
}

function findMatchingLegalMove(legalMoves: Move[], tile: Tile, position: PlacementPosition): Move | null {
  return (
    legalMoves.find((move) => move.type === 'play' && move.tile && tileEquals(move.tile, tile) && move.position === position) ??
    null
  );
}

export function validateDailyPuzzleSubmission(
  input: DailyPuzzleSubmissionValidationInput,
): DailyPuzzleSubmissionValidationResult {
  const startingBoard = normalizeBoard(input.slot.startingBoard);
  const startingHand = normalizeHand(input.slot.startingHand);

  if (!startingBoard) {
    throw new Error('Daily Puzzle slot has invalid starting board data.');
  }
  if (startingHand.length === 0) {
    throw new Error('Daily Puzzle slot has invalid starting hand data.');
  }
  if (!Array.isArray(input.submittedLine) || input.submittedLine.length === 0) {
    throw new Error('Daily Puzzle submission must include at least one played tile.');
  }

  const availableCounts = countTiles(startingHand);
  const usedCounts = new Map<string, number>();
  let state = buildInitialPuzzleState(input.slot, startingHand, startingBoard);
  const canonicalLine: Array<Record<string, unknown>> = [];

  for (const [index, entry] of input.submittedLine.entries()) {
    const rawTile = entry?.tile;
    const rawPosition = entry?.position;
    if (!isTile(rawTile) || !isPlacementPosition(rawPosition)) {
      throw new Error(`Daily Puzzle submitted move ${index + 1} is malformed.`);
    }

    const tile = normalizeTile(rawTile);
    const tileKey = tileId(tile);
    const nextCount = (usedCounts.get(tileKey) ?? 0) + 1;
    usedCounts.set(tileKey, nextCount);
    if (nextCount > (availableCounts.get(tileKey) ?? 0)) {
      throw new Error(`Daily Puzzle submitted tile ${tileKey} is not available in the starting hand.`);
    }
    if (state.playerIds[state.currentPlayerIndex] !== DAILY_PUZZLE_PLAYER_ID) {
      throw new Error('Daily Puzzle submitted line continues after the player turn ended.');
    }

    const legalMove = findMatchingLegalMove(getLegalMoves(state, DAILY_PUZZLE_PLAYER_ID), tile, rawPosition);
    if (!legalMove) {
      throw new Error(`Daily Puzzle submitted move ${index + 1} is illegal.`);
    }

    const beforeScore = state.players[DAILY_PUZZLE_PLAYER_ID].score;
    const applied = applyMove(state, DAILY_PUZZLE_PLAYER_ID, legalMove);
    const afterScore = applied.state.players[DAILY_PUZZLE_PLAYER_ID].score;
    state = applied.state;
    canonicalLine.push({
      tile,
      position: rawPosition,
      pointsAwarded: Math.max(0, afterScore - beforeScore),
      totalScore: afterScore,
    });
  }

  const rawScore = Math.max(0, Math.round(state.players[DAILY_PUZZLE_PLAYER_ID].score));
  const movesUsed = canonicalLine.length;
  const bestPossibleScore = input.slot.bestPossibleScore ?? 0;
  const elapsedSeconds = Number.isFinite(input.elapsedSeconds)
    ? Math.max(0, Math.min(MAX_DAILY_PUZZLE_ELAPSED_SECONDS, Math.round(input.elapsedSeconds)))
    : 0;

  return {
    rawScore,
    movesUsed,
    elapsedSeconds,
    solved: rawScore > 0,
    perfect: bestPossibleScore > 0 && rawScore >= bestPossibleScore,
    submittedLine: canonicalLine,
    result: {
      serverValidated: true,
      serverRawScore: rawScore,
      clientRawScore: Number.isFinite(input.clientRawScore) ? Math.round(input.clientRawScore ?? 0) : null,
      serverMovesUsed: movesUsed,
      elapsedSeconds,
    },
  };
}
