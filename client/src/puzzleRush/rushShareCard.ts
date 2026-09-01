import { SITE_DOMAIN } from '../lib/siteUrl';

const PUZZLE_RUSH_LAUNCH_DATE = new Date('2026-04-10');

/**
 * Share text for a finished Puzzle Rush run.
 *
 * Puzzle number, one emoji per puzzle attempted (🟩 = solved, 🟥 = missed/skipped),
 * solve count, and site URL.
 */

export interface RushSharePuzzle {
  /** Whether this puzzle was solved (true) or missed/skipped (false). */
  solved: boolean;
}

export interface RushShareInput {
  /** The server's replayed total. The only score worth sharing. */
  score: number;
  /** Server's actual solve count for the run. */
  solved: number;
  /** Per-puzzle result (ordinal order). */
  puzzles: RushSharePuzzle[];
  /** Seconds gained from time bonuses. */
  secondsBanked: number;
  /** YYYY-MM-DD run date for puzzle numbering. */
  runDate?: string;
}

function calculatePuzzleNumber(runDate: string | undefined): number {
  if (!runDate) return 1;
  const date = new Date(`${runDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 1;
  const daysSinceLaunch = Math.floor(
    (date.getTime() - PUZZLE_RUSH_LAUNCH_DATE.getTime()) / (1000 * 60 * 60 * 24)
  );
  return Math.max(1, daysSinceLaunch + 1);
}

function buildEmojiRow(puzzles: RushSharePuzzle[]): string {
  return puzzles.map((p) => (p.solved ? '🟩' : '🟥')).join('');
}

function formatTime(secondsBanked: number): string {
  if (secondsBanked <= 0) return '';
  const minutes = Math.floor(secondsBanked / 60);
  const seconds = secondsBanked % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function buildRushShareText(input: RushShareInput): string {
  const puzzleNumber = calculatePuzzleNumber(input.runDate);
  const emojiRow = buildEmojiRow(input.puzzles);
  const solveText = `${input.solved} solved`;
  const timeText = formatTime(input.secondsBanked);
  const statLine = [solveText, timeText].filter(Boolean).join(' · ');

  return [
    `Racehorse Puzzle Rush #${puzzleNumber}`,
    emojiRow,
    '',
    statLine,
    SITE_DOMAIN,
  ].filter(Boolean).join('\n');
}
