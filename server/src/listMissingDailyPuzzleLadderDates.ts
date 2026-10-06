/* eslint-disable no-console -- a CLI: stdout is its output, stderr its warnings */
import './loadEnv';
import { findDatesWithoutReadyLadder, listPublishedLadderSlotRowsInRange } from './dailyPuzzleLadderPublish';

/**
 * Prints, one per line, the dates in [--from, --from + --days) that do not
 * have a ready Daily Puzzle ladder (E1). `scripts/gen-puzzles.sh` seeds only
 * those, instead of starting the seed script for every date in the window.
 *
 * Fails open: if the range read fails it prints every date (and warns on
 * stderr), so the job falls back to checking each date as before.
 */
export function datesInWindow(from: string, days: number): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, offset) => {
    const d = new Date(start.getTime() + offset * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}

function parseArgs(argv: string[]): { from: string; days: number } {
  let from = '';
  let days = 30;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') from = argv[i + 1] ?? '';
    if (argv[i] === '--days') days = Number(argv[i + 1]);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('--from YYYY-MM-DD is required');
  if (!Number.isInteger(days) || days <= 0) throw new Error('--days must be a positive integer');
  return { from, days };
}

export async function listMissingDates(from: string, days: number): Promise<{ dates: string[]; fellBack: boolean }> {
  const window = datesInWindow(from, days);
  try {
    const rows = await listPublishedLadderSlotRowsInRange(window[0]!, window[window.length - 1]!);
    return { dates: findDatesWithoutReadyLadder(window, rows), fellBack: false };
  } catch (error) {
    console.warn(
      `[daily-puzzle-ladder] range read failed; checking every date instead: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { dates: window, fellBack: true };
  }
}

async function main(): Promise<void> {
  const { from, days } = parseArgs(process.argv.slice(2));
  const { dates } = await listMissingDates(from, days);
  for (const date of dates) console.log(date);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
