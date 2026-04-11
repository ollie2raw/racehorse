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
  rank?: number;
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
  return { low: tile.low, high: tile.high };
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

export function generateDailyFritzRun(
  runDate: string,
  fritzTier: DailyFritzTier,
  dealSize: 7 | 14,
  winningScore: number,
): GeneratedDailyFritzRun {
  const seed = getDailyFritzSeed(runDate);
  const handDeals: DailyFritzHandDeal[] = [];

  for (let handIndex = 0; handIndex < 12; handIndex += 1) {
    const prng = createSeededPrng(`${seed}:hand:${handIndex}`);
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
    metadata: null,
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
    if (a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
    if (a.finalScore !== b.finalScore) return b.finalScore - a.finalScore;
    if (a.movesUsed !== b.movesUsed) return a.movesUsed - b.movesUsed;
    return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
  });
}

