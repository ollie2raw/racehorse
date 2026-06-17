import { createHash } from 'crypto';
import type { Tile } from './game/types';

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

export type DailyFritzSetGameNumber = 1 | 2 | 3;
export type DailyFritzDrawWinner = 'you' | 'bot';

export interface DailyFritzSetGameResult {
  gameNumber: DailyFritzSetGameNumber;
  seed: string;
  playerWon: boolean;
  playerScore: number;
  fritzScore: number;
  pointDiff: number;
  movesUsed?: number;
  handsPlayed?: number;
  completedAt: string;
  skunk?: boolean;
  skunkBy?: 'player' | 'fritz';
}

export interface DailyFritzSetResult {
  version: 2;
  format: 'best_of_3';
  playerGamesWon: number;
  fritzGamesWon: number;
  totalPointDiff: number;
  games: DailyFritzSetGameResult[];
  setWinner?: 'player' | 'fritz';
  hasSkunk?: boolean;
  instantSkunk?: boolean;
  skunkGameNumber?: DailyFritzSetGameNumber | null;
  skunkBy?: 'player' | 'fritz' | null;
}

function hashSeedToUint32(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededPrng(seed: string): () => number {
  let state = hashSeedToUint32(seed) || 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function cloneTile(tile: Tile): Tile {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return { low, high };
}

function buildDoubleSixSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= 6; high += 1) {
    for (let low = 0; low <= high; low += 1) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

function shuffleWithPrng<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function getDailyFritzSeed(runDate: string): string {
  return `daily-fritz-${runDate}`;
}

export function getDailyFritzGameSeed(runDate: string, gameNumber: DailyFritzSetGameNumber): string {
  return `${getDailyFritzSeed(runDate)}:game:${gameNumber}`;
}

export function getDailyFritzDrawWinnerFromGameSeed(gameSeed: string): DailyFritzDrawWinner {
  const prng = createSeededPrng(`${gameSeed}:draw-winner`);
  return prng() < 0.5 ? 'you' : 'bot';
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

export function getDailyFritzDrawTilesFromGameSeed(gameSeed: string): DailyFritzDrawTiles {
  const prng = createSeededPrng(`${gameSeed}:draw-tiles`);
  const shuffled = shuffleWithPrng(buildDoubleSixSet(), prng).map(cloneTile);
  const playerTile = shuffled[0]!;
  const fritzTile = shuffled[1]!;
  return {
    playerTile,
    fritzTile,
  };
}

export function getDailyFritzDrawTiles(
  runDate: string,
  gameNumber: DailyFritzSetGameNumber,
): DailyFritzDrawTiles {
  return getDailyFritzDrawTilesFromGameSeed(getDailyFritzGameSeed(runDate, gameNumber));
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
}): DailyFritzDrawTiles {
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
        return {
          playerTile: cloneTile(p),
          fritzTile: cloneTile(f),
        };
      }
    }
  }
  return getDailyFritzDrawTiles(params.runDate, params.gameNumber);
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
  const prng = createSeededPrng(`${seed}:hand:${handIndex}`);
  const shuffled = shuffleWithPrng(buildDoubleSixSet(), prng).map(cloneTile);
  const playerTiles = shuffled.slice(0, dealSize);
  const fritzTiles  = shuffled.slice(dealSize, dealSize * 2);
  const remaining   = shuffled.slice(dealSize * 2);
  const locked      = remaining.slice(Math.max(0, remaining.length - 2)).map(cloneTile);
  const boneyard    = remaining.map(cloneTile);
  return { player_tiles: playerTiles, fritz_tiles: fritzTiles, boneyard, locked };
}

export function generateSingleDailyFritzGameHand(
  runDate: string,
  gameNumber: DailyFritzSetGameNumber,
  handIndex: number,
  dealSize: 7 | 14,
): DailyFritzHandDeal {
  return generateSingleDailyFritzHand(getDailyFritzGameSeed(runDate, gameNumber), handIndex, dealSize);
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
    const prng = createSeededPrng(`${gameOneSeed}:hand:${handIndex}`);
    const shuffled = shuffleWithPrng(buildDoubleSixSet(), prng).map(cloneTile);
    const playerTiles = shuffled.slice(0, dealSize);
    const fritzTiles = shuffled.slice(dealSize, dealSize * 2);
    const remaining = shuffled.slice(dealSize * 2);
    const locked = remaining.slice(Math.max(0, remaining.length - 2)).map(cloneTile);
    const boneyard = remaining.map(cloneTile);
    handDeals.push({
      player_tiles: playerTiles,
      fritz_tiles: fritzTiles,
      boneyard,
      locked,
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
    1: getDailyFritzDrawTiles(runDate, 1),
    2: getDailyFritzDrawTiles(runDate, 2),
    3: getDailyFritzDrawTiles(runDate, 3),
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
    if (a.finalScore !== b.finalScore) return b.finalScore - a.finalScore;
    if (a.opponentScore !== b.opponentScore) return a.opponentScore - b.opponentScore;
    if (a.won) {
      const skunkA = a.skunkWinRank ?? 0;
      const skunkB = b.skunkWinRank ?? 0;
      if (skunkA !== skunkB) return skunkB - skunkA;
    } else {
      const skunkA = a.skunkLossRank ?? 0;
      const skunkB = b.skunkLossRank ?? 0;
      if (skunkA !== skunkB) return skunkB - skunkA;
    }
    if (a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
    return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
  });
}
