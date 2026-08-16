import { createHash } from 'crypto';
import type { Tile } from './game/types';
import {
  createDeterministicDoubleSixDeal,
  createDeterministicRandom,
  generateFullSet,
  shuffleDeterministically,
  type DailyFritzDrawWinner,
  type DailyFritzSetGameNumber,
  type DailyFritzSetGameResult,
  type DailyFritzSetResult,
} from '@racehorse/game-core';

// DailyFritzSetGameNumber / DailyFritzDrawWinner / DailyFritzSetGameResult /
// DailyFritzSetResult are single-sourced from @racehorse/game-core's
// dtoContracts module and re-exported here so both this file and the client
// (client/src/dailyFritz/api.ts) share one declaration instead of each
// hand-maintaining a copy.
export type { DailyFritzDrawWinner, DailyFritzSetGameNumber, DailyFritzSetGameResult, DailyFritzSetResult };

export type DailyFritzTier = 'rookie' | 'standard' | 'elite' | 'master';
export type DailyFritzRunStatus = 'live' | 'archived' | 'invalidated';
export type DailyFritzAttemptStatus = 'started' | 'completed' | 'abandoned';

export interface DailyFritzHandDeal {
  player_tiles: Tile[];
  fritz_tiles: Tile[];
  boneyard: Tile[];
  locked: Tile[];
}

export interface GeneratedDailyFritzRun {
  runDate: string;
  seed: string;
  fritzTier: DailyFritzTier;
  dealSize: 7 | 14;
  winningScore: number;
  status: DailyFritzRunStatus;
  handDeals: DailyFritzHandDeal[];
  generatedAt: string;
  invalidatedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface DailyFritzLeaderboardEntry {
  userId: string;
  username: string;
  won: boolean;
  finalScore: number;
  opponentScore: number;
  pointDiff: number;
  movesUsed: number;
  completedAt: string;
  skunkWinRank?: number;
  skunkLossRank?: number;
  games?: Array<{
    gameNumber: DailyFritzSetGameNumber;
    playerScore: number;
    fritzScore: number;
    playerWon: boolean;
    pointDiff: number;
    skunk?: boolean;
    skunkBy?: 'player' | 'fritz';
  }>;
  rank?: number;
}

function cloneTile(tile: Tile): Tile {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return { low, high };
}


export function getDailyFritzSeed(runDate: string): string {
  return `daily-fritz-${runDate}`;
}

export function getDailyFritzGameSeed(runDate: string, gameNumber: DailyFritzSetGameNumber): string {
  return `${getDailyFritzSeed(runDate)}:game:${gameNumber}`;
}

export function getDailyFritzDrawWinnerFromGameSeed(gameSeed: string): DailyFritzDrawWinner {
  return createDeterministicRandom(`${gameSeed}:draw-winner`).next() < 0.5 ? 'you' : 'bot';
}

export function getDailyFritzDrawWinner(
  runDate: string,
  gameNumber: DailyFritzSetGameNumber,
): DailyFritzDrawWinner {
  return getDailyFritzDrawWinnerFromGameSeed(getDailyFritzGameSeed(runDate, gameNumber));
}

export interface DailyFritzDrawTiles {
  playerTile: Tile;
  fritzTile: Tile;
}

export function dailyFritzTilePipSum(tile: Tile): number {
  return tile.low + tile.high;
}

/** True when visible pip totals match who opens (higher pip wins the draw). */
export function dailyFritzDrawTilesMatchWinner(
  tiles: DailyFritzDrawTiles,
  drawWinner: DailyFritzDrawWinner,
): boolean {
  const playerPips = dailyFritzTilePipSum(tiles.playerTile);
  const fritzPips = dailyFritzTilePipSum(tiles.fritzTile);
  if (playerPips === fritzPips) return false;
  return drawWinner === 'you' ? playerPips > fritzPips : fritzPips > playerPips;
}

/**
 * Deterministic draw pair for a game seed, aligned with the predetermined draw winner.
 * Higher pip sum wins the draw — tiles are chosen so the reveal matches `drawWinner`.
 */
export function getDailyFritzDrawTilesFromGameSeed(
  gameSeed: string,
  drawWinner: DailyFritzDrawWinner,
): DailyFritzDrawTiles {
  const shuffled = shuffleDeterministically(
    generateFullSet(6),
    createDeterministicRandom(`${gameSeed}:draw-tiles`),
  ).map(cloneTile);

  for (let i = 0; i < shuffled.length; i += 1) {
    for (let j = i + 1; j < shuffled.length; j += 1) {
      const tileA = shuffled[i]!;
      const tileB = shuffled[j]!;
      const sumA = dailyFritzTilePipSum(tileA);
      const sumB = dailyFritzTilePipSum(tileB);
      if (sumA === sumB) continue;

      const higherIsA = sumA > sumB;
      if (drawWinner === 'you') {
        return higherIsA
          ? { playerTile: cloneTile(tileA), fritzTile: cloneTile(tileB) }
          : { playerTile: cloneTile(tileB), fritzTile: cloneTile(tileA) };
      }
      return higherIsA
        ? { playerTile: cloneTile(tileB), fritzTile: cloneTile(tileA) }
        : { playerTile: cloneTile(tileA), fritzTile: cloneTile(tileB) };
    }
  }

  const playerTile = shuffled[0]!;
  const fritzTile = shuffled[1]!;
  return { playerTile, fritzTile };
}

export function getDailyFritzDrawTiles(
  runDate: string,
  gameNumber: DailyFritzSetGameNumber,
): DailyFritzDrawTiles {
  const drawWinner = getDailyFritzDrawWinner(runDate, gameNumber);
  return getDailyFritzDrawTilesFromGameSeed(getDailyFritzGameSeed(runDate, gameNumber), drawWinner);
}

export function resolveDailyFritzDrawWinner(params: {
  runDate: string;
  gameNumber: DailyFritzSetGameNumber;
  metadata?: Record<string, unknown> | null;
}): DailyFritzDrawWinner {
  const byGame = params.metadata?.draw_winners_by_game;
  if (byGame && typeof byGame === 'object') {
    const raw =
      (byGame as Record<string, unknown>)[String(params.gameNumber)] ??
      (byGame as Record<number, unknown>)[params.gameNumber];
    if (raw === 'you' || raw === 'bot') return raw;
  }
  return getDailyFritzDrawWinner(params.runDate, params.gameNumber);
}

export function resolveDailyFritzDrawTiles(params: {
  runDate: string;
  gameNumber: DailyFritzSetGameNumber;
  metadata?: Record<string, unknown> | null;
  drawWinner?: DailyFritzDrawWinner | null;
}): DailyFritzDrawTiles {
  const drawWinner =
    params.drawWinner ??
    resolveDailyFritzDrawWinner({
      runDate: params.runDate,
      gameNumber: params.gameNumber,
      metadata: params.metadata,
    });

  const alignedFromSeed = (): DailyFritzDrawTiles =>
    getDailyFritzDrawTilesFromGameSeed(
      getDailyFritzGameSeed(params.runDate, params.gameNumber),
      drawWinner,
    );

  const byGame = params.metadata?.draw_tiles_by_game;
  if (byGame && typeof byGame === 'object') {
    const raw =
      (byGame as Record<string, unknown>)[String(params.gameNumber)] ??
      (byGame as Record<number, unknown>)[params.gameNumber];
    if (
      raw &&
      typeof raw === 'object' &&
      'playerTile' in raw &&
      'fritzTile' in raw &&
      raw.playerTile &&
      raw.fritzTile
    ) {
      const p = (raw as { playerTile: Tile }).playerTile;
      const f = (raw as { fritzTile: Tile }).fritzTile;
      if (
        typeof p.low === 'number' &&
        typeof p.high === 'number' &&
        typeof f.low === 'number' &&
        typeof f.high === 'number'
      ) {
        const fromMeta = {
          playerTile: cloneTile(p),
          fritzTile: cloneTile(f),
        };
        if (dailyFritzDrawTilesMatchWinner(fromMeta, drawWinner)) {
          return fromMeta;
        }
      }
    }
  }
  return alignedFromSeed();
}

/**
 * Generate a single hand for a given seed + hand index.
 * Uses the same deterministic formula as generateDailyFritzRun so that any
 * hand at any index can be reproduced on-demand without a pre-stored list.
 * All players requesting hand N on a given day get identical tiles.
 */
export function generateSingleDailyFritzHand(
  seed: string,
  handIndex: number,
  dealSize: 7 | 14,
): DailyFritzHandDeal {
  const deal = createDeterministicDoubleSixDeal({
    seed: `${seed}:hand:${handIndex}`,
    tilesPerPlayer: dealSize,
  });
  return {
    player_tiles: deal.playerTiles,
    fritz_tiles: deal.opponentTiles,
    boneyard: deal.boneyard,
    locked: deal.deadTiles,
  };
}

export function generateSingleDailyFritzGameHand(
  runDate: string,
  gameNumber: DailyFritzSetGameNumber,
  handIndex: number,
  dealSize: 7 | 14,
): DailyFritzHandDeal {
  const deal = createDeterministicDoubleSixDeal({
    seed: `${getDailyFritzGameSeed(runDate, gameNumber)}:hand:${handIndex}`,
    tilesPerPlayer: dealSize,
  });
  return {
    player_tiles: deal.playerTiles,
    fritz_tiles: deal.opponentTiles,
    boneyard: deal.boneyard,
    locked: deal.deadTiles,
  };
}

export function generateDailyFritzRun(
  runDate: string,
  fritzTier: DailyFritzTier,
  dealSize: 7 | 14,
  winningScore: number,
): GeneratedDailyFritzRun {
  const seed = getDailyFritzSeed(runDate);
  const handDeals: DailyFritzHandDeal[] = [];
  const gameOneSeed = getDailyFritzGameSeed(runDate, 1);

  for (let handIndex = 0; handIndex < 12; handIndex += 1) {
    const deal = createDeterministicDoubleSixDeal({
      seed: `${gameOneSeed}:hand:${handIndex}`,
      tilesPerPlayer: dealSize,
    });
    handDeals.push({
      player_tiles: deal.playerTiles,
      fritz_tiles: deal.opponentTiles,
      boneyard: deal.boneyard,
      locked: deal.deadTiles,
    });
  }

  const drawWinnersByGame: Record<DailyFritzSetGameNumber, DailyFritzDrawWinner> = {
    1: getDailyFritzDrawWinner(runDate, 1),
    2: getDailyFritzDrawWinner(runDate, 2),
    3: getDailyFritzDrawWinner(runDate, 3),
  };

  const drawTilesByGame: Record<
    DailyFritzSetGameNumber,
    { playerTile: Tile; fritzTile: Tile }
  > = {
    1: getDailyFritzDrawTilesFromGameSeed(
      getDailyFritzGameSeed(runDate, 1),
      drawWinnersByGame[1],
    ),
    2: getDailyFritzDrawTilesFromGameSeed(
      getDailyFritzGameSeed(runDate, 2),
      drawWinnersByGame[2],
    ),
    3: getDailyFritzDrawTilesFromGameSeed(
      getDailyFritzGameSeed(runDate, 3),
      drawWinnersByGame[3],
    ),
  };

  return {
    runDate,
    seed,
    fritzTier,
    dealSize,
    winningScore,
    status: 'live',
    handDeals,
    generatedAt: new Date().toISOString(),
    invalidatedAt: null,
    metadata: {
      version: 2,
      format: 'best_of_3',
      game_seeds: [1, 2, 3].map((gameNumber) =>
        getDailyFritzGameSeed(runDate, gameNumber as DailyFritzSetGameNumber),
      ),
      draw_winners_by_game: drawWinnersByGame,
      draw_tiles_by_game: drawTilesByGame,
    },
  };
}

export function buildDailyFritzCompletionHash(params: {
  runDate: string;
  attemptId: string;
  verifiedMatchId: string;
  currentHandIndex: number;
  finalScore: number;
  opponentScore: number;
  won: boolean;
  movesUsed: number;
  handsPlayed: number;
  moveLog: unknown;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        runDate: params.runDate,
        attemptId: params.attemptId,
        verifiedMatchId: params.verifiedMatchId,
        currentHandIndex: params.currentHandIndex,
        finalScore: params.finalScore,
        opponentScore: params.opponentScore,
        won: params.won,
        movesUsed: params.movesUsed,
        handsPlayed: params.handsPlayed,
        moveLog: params.moveLog,
      }),
    )
    .digest('hex');
}

export function sortDailyFritzLeaderboard<T extends DailyFritzLeaderboardEntry>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.won !== b.won) return a.won ? -1 : 1;
    if (a.won) {
      const skunkA = a.skunkWinRank ?? 0;
      const skunkB = b.skunkWinRank ?? 0;
      if (skunkA !== skunkB) return skunkB - skunkA;
      if (skunkA > 0 && a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
    }
    if (a.finalScore !== b.finalScore) return b.finalScore - a.finalScore;
    if (a.opponentScore !== b.opponentScore) return a.opponentScore - b.opponentScore;
    if (a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
    return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
  });
}
