import { generateFullSet, type Tile } from './types';

export interface DeterministicRandom {
  next(): number;
  nextInt(maxExclusive: number): number;
}

export function hashSeedToUint32(seed: string | number): number {
  const value = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createDeterministicRandom(seed: string | number): DeterministicRandom {
  let state = hashSeedToUint32(seed) || 0x9e3779b9;
  return {
    next(): number {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    },
    nextInt(maxExclusive: number): number {
      if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error('maxExclusive must be a positive safe integer.');
      }
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor((state / 0x100000000) * maxExclusive);
    },
  };
}

export function shuffleDeterministically<T>(
  items: readonly T[],
  random: DeterministicRandom,
): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = random.nextInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export type DeterministicHandDeal = {
  playerTiles: Tile[];
  opponentTiles: Tile[];
  boneyard: Tile[];
  deadTiles: Tile[];
};

export function createDeterministicDoubleSixDeal(input: {
  seed: string | number;
  tilesPerPlayer: 7 | 14;
  deadTileCount?: number;
}): DeterministicHandDeal {
  const fullSet = generateFullSet(6);
  const shuffled = shuffleDeterministically(fullSet, createDeterministicRandom(input.seed));
  const cursor = input.tilesPerPlayer * 2;
  const boneyard = shuffled.slice(cursor);
  const deadTileCount = input.tilesPerPlayer === 14 ? 0 : Math.max(0, input.deadTileCount ?? 2);
  return {
    playerTiles: shuffled.slice(0, input.tilesPerPlayer),
    opponentTiles: shuffled.slice(input.tilesPerPlayer, cursor),
    boneyard,
    deadTiles: boneyard.slice(Math.max(0, boneyard.length - deadTileCount)),
  };
}
