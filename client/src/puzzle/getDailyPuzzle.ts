import { DAILY_PUZZLES, type DailyPuzzle } from './puzzles';

function dateSeed(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function puzzleFromSeed(seed: string): DailyPuzzle {
  const idx = hashSeed(seed) % DAILY_PUZZLES.length;
  const base = DAILY_PUZZLES[idx];
  return {
    ...base,
    id: `${seed}:${base.id}`,
    dateSeed: seed,
  };
}

export function getPuzzleForDate(date: Date): DailyPuzzle {
  return puzzleFromSeed(dateSeed(date));
}

export function getPuzzleForSeed(seed: string): DailyPuzzle {
  return puzzleFromSeed(seed);
}
