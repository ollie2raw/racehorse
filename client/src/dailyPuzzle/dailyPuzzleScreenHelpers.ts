import type { Tile } from '../types';
import type { CuratedDailyPuzzle } from './types';
import type { DailyProgress } from './dailyPuzzleScreenTypes';

export function puzzleInstanceKey(dateSeed: string, puzzleType: CuratedDailyPuzzle['puzzleType']): string {
  return `${dateSeed}:${puzzleType}`;
}

export function puzzleCacheKey(dateSeed: string, puzzleType: CuratedDailyPuzzle['puzzleType']): string {
  return `dailyPuzzle:cached:v3:${puzzleInstanceKey(dateSeed, puzzleType)}`;
}

export function tileKey(tile: Tile): string {
  return `${tile.low}-${tile.high}`;
}

export function progressKey(dateSeed: string, puzzleType: CuratedDailyPuzzle['puzzleType']): string {
  return `dailyPuzzle:${puzzleInstanceKey(dateSeed, puzzleType)}`;
}

export function readProgress(dateSeed: string, puzzleType: CuratedDailyPuzzle['puzzleType']): DailyProgress {
  if (typeof window === 'undefined') {
    return { attempts: 0, bestMoves: null, lastResult: null };
  }
  try {
    const raw = window.localStorage.getItem(progressKey(dateSeed, puzzleType));
    if (!raw) return { attempts: 0, bestMoves: null, lastResult: null };
    const parsed = JSON.parse(raw) as DailyProgress;
    return {
      attempts: Number.isFinite(parsed.attempts) ? parsed.attempts : 0,
      bestMoves: typeof parsed.bestMoves === 'number' ? parsed.bestMoves : null,
      lastResult: parsed.lastResult ?? null,
    };
  } catch {
    return { attempts: 0, bestMoves: null, lastResult: null };
  }
}

export function writeProgress(
  dateSeed: string,
  puzzleType: CuratedDailyPuzzle['puzzleType'],
  progress: DailyProgress,
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(progressKey(dateSeed, puzzleType), JSON.stringify(progress));
}

export function readCachedPuzzle(
  dateSeed: string,
  puzzleType: CuratedDailyPuzzle['puzzleType'],
): CuratedDailyPuzzle | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(puzzleCacheKey(dateSeed, puzzleType));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CuratedDailyPuzzle;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.puzzleDate !== 'string' ||
      !Array.isArray(parsed.startingHand)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedPuzzle(puzzle: CuratedDailyPuzzle): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      puzzleCacheKey(puzzle.puzzleDate, puzzle.puzzleType),
      JSON.stringify(puzzle),
    );
  } catch {
    // no-op
  }
}

export function getDisplayName(username: string | null | undefined): string {
  const value = (username ?? '').trim();
  if (!value) return 'Player';
  if (/^user_[a-f0-9]{8}$/i.test(value)) return 'Player';
  return value;
}

export function formatPuzzleDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatPuzzleLeaderboardDate(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function formatPuzzleElapsed(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
}
