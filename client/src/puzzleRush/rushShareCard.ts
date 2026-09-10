import { SITE_DOMAIN } from '../lib/siteUrl';

const PUZZLE_RUSH_LAUNCH_DATE = new Date('2026-04-10');

/** Mirrors `PUZZLE_RUSH_CONFIG.run.puzzlesPerRun` (server/src/puzzleRush/config.ts). */
export const PUZZLE_RUSH_PUZZLES_PER_RUN = 15;

/**
 * Share text for a finished Puzzle Rush run.
 *
 * Emitted **identically** by two surfaces — `RushResultsView` (right after the
 * run) and `PuzzleRushLeaderboardScreen` (later, from the persisted leaderboard
 * row). They're built from only the two facts both surfaces reliably have: the
 * run date and the server's authoritative solve count. A fixed 15-cell grid,
 * 🟩 = solved / 🟥 = not — so every player's share is the same shape and reads
 * at a glance without the caption.
 *
 * Not included: banked seconds and a per-puzzle pass/fail breakdown. Neither is
 * persisted with the run, so the leaderboard row cannot reproduce them and the
 * two surfaces would diverge.
 */
export interface RushShareInput {
  /** The server's replayed solve count for the run. */
  solved: number;
  /** YYYY-MM-DD run date, for puzzle numbering. */
  runDate?: string;
}

export function calculatePuzzleNumber(runDate: string | undefined): number {
  if (!runDate) return 1;
  const date = new Date(`${runDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 1;
  const daysSinceLaunch = Math.floor(
    (date.getTime() - PUZZLE_RUSH_LAUNCH_DATE.getTime()) / (1000 * 60 * 60 * 24)
  );
  return Math.max(1, daysSinceLaunch + 1);
}

export function buildRushShareText(input: RushShareInput): string {
  const puzzleNumber = calculatePuzzleNumber(input.runDate);
  const solved = Math.max(
    0,
    Math.min(PUZZLE_RUSH_PUZZLES_PER_RUN, Math.round(input.solved || 0)),
  );
  const grid = '🟩'.repeat(solved) + '🟥'.repeat(PUZZLE_RUSH_PUZZLES_PER_RUN - solved);

  return [
    `Racehorse Puzzle Rush #${puzzleNumber}`,
    grid,
    '',
    `${solved} solved`,
    SITE_DOMAIN,
  ].join('\n');
}
