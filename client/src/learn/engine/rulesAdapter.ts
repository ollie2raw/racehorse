import { normalizeBoardState } from '../../dailyPuzzle/api';
import {
  getDisplayOpenEnds,
  getPlacementTargetsForTile,
  type BotMatchState,
} from '../../bot/botEngine';
import type { BoardState, PlacedTile, Tile } from '../../types';
import type { LearnBoardState, LearnTile } from './types';

export function toTile(tile: LearnTile): Tile {
  return {
    low: Math.min(tile.low, tile.high),
    high: Math.max(tile.low, tile.high),
  };
}

function adaptLearnBoard(board: LearnBoardState): unknown {
  const record = board as Record<string, unknown>;
  const mainLine = Array.isArray(record.mainLine) ? record.mainLine : [];
  const hubDoubles = Array.isArray(record.hubDoubles) ? record.hubDoubles : [];

  return {
    ...record,
    mainLine: mainLine.map((placement) => {
      const rec = placement as { orientation?: unknown; tile?: unknown };
      const tile = Array.isArray(rec.tile)
        ? {
            low: Math.min(Number(rec.tile[0]), Number(rec.tile[1])),
            high: Math.max(Number(rec.tile[0]), Number(rec.tile[1])),
          }
        : rec.tile;
      return {
        orientation: rec.orientation,
        tile,
      };
    }),
    hubDoubles,
  };
}

export function toBoardState(board: LearnBoardState): BoardState | null {
  const normalized = normalizeBoardState(adaptLearnBoard(board));
  if (!normalized) return null;

  const orientedMainLine = normalized.mainLine.map((placement: PlacedTile) => ({
    ...placement,
  }));
  let expectedLeftValue = normalized.leftEnd;

  for (let index = 0; index < orientedMainLine.length; index += 1) {
    const placement = orientedMainLine[index];
    const { tile } = placement;

    if (tile.low === tile.high) {
      placement.orientation = 'vertical-normal';
      expectedLeftValue = tile.high;
      continue;
    }

    if (tile.low === expectedLeftValue) {
      placement.orientation = 'horizontal-normal';
      expectedLeftValue = tile.high;
      continue;
    }

    if (tile.high === expectedLeftValue) {
      placement.orientation = 'horizontal-flipped';
      expectedLeftValue = tile.low;
      continue;
    }

    expectedLeftValue = placement.orientation.endsWith('flipped') ? tile.low : tile.high;
  }

  const orientedBoard: BoardState = {
    ...normalized,
    mainLine: orientedMainLine,
  };

  if (
    import.meta.env.DEV &&
    orientedBoard.mainLine.length === 2 &&
    orientedBoard.leftEnd === 3 &&
    orientedBoard.rightEnd === 2 &&
    orientedBoard.mainLine[0]?.tile.low === 3 &&
    orientedBoard.mainLine[0]?.tile.high === 3
  ) {
    const leftTile = orientedBoard.mainLine[0];
    const rightTile = orientedBoard.mainLine[orientedBoard.mainLine.length - 1];
    const displayedEnds = [
      leftTile.tile.low === leftTile.tile.high
        ? leftTile.tile.high
        : leftTile.orientation.endsWith('flipped')
          ? leftTile.tile.high
          : leftTile.tile.low,
      rightTile.tile.low === rightTile.tile.high
        ? rightTile.tile.high
        : rightTile.orientation.endsWith('flipped')
          ? rightTile.tile.low
          : rightTile.tile.high,
    ];
    const gameplayEnds = getMatchableOpenEnds(orientedBoard);
    console.assert(
      JSON.stringify(displayedEnds) === JSON.stringify(gameplayEnds),
      '[Learn] Displayed ends do not match gameplay ends',
      { displayedEnds, gameplayEnds, board: orientedBoard },
    );
  }

  return orientedBoard;
}

export function getMatchableOpenEnds(board: BoardState | null): number[] {
  if (!board) return [];
  const state: BotMatchState = {
    players: {
      you: { hand: [], score: 0 },
      bot: { hand: [], score: 0 },
    },
    board,
    boneyard: [],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 60,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
  };
  return getDisplayOpenEnds(state);
}

export function isTilePlayable(tile: Tile, board: BoardState | null): boolean {
  if (!board || board.mainLine.length === 0) return true;
  return getPlacementTargetsForTile(board, tile).length > 0;
}
