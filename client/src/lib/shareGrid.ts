/**
 * The share grid.
 *
 * Wordle's growth came from a result you could paste anywhere that was
 * recognisable without reading the caption. This is the same device for a
 * dominoes daily: one row per game, filled by how much of that game's points
 * you took, so the block's shape differs per player and per day.
 *
 * It is spoiler-free by construction — it conveys performance, never the
 * tiles or the line played.
 */

/** Cells per row. Ten reads as a bar without wrapping on a phone. */
export const SHARE_GRID_WIDTH = 10;

export type ShareGridTone =
  /** A game or slot taken. */
  | 'win'
  /** Taken exceptionally — a skunk, or a perfect puzzle. */
  | 'skunk'
  /** Played and lost. */
  | 'loss'
  /** Never played: the decider that was not needed, a slot not reached. */
  | 'none';

const FILL: Record<Exclude<ShareGridTone, 'none'>, string> = {
  win: '🟩',
  skunk: '🟨',
  loss: '🟥',
};

const EMPTY = '⬛';
const UNPLAYED = '⬜';

/**
 * One row. `ratio` is the player's share of that row's available points, 0–1;
 * pass null for a row that was never played.
 *
 * A row with any score keeps at least one filled cell, so a narrow result
 * still reads as played rather than blank.
 */
export function buildShareGridRow(ratio: number | null, tone: ShareGridTone): string {
  if (tone === 'none' || ratio === null || !Number.isFinite(ratio)) {
    return UNPLAYED.repeat(SHARE_GRID_WIDTH);
  }

  const clamped = Math.min(1, Math.max(0, ratio));
  const raw = Math.round(clamped * SHARE_GRID_WIDTH);
  const filled = clamped > 0 ? Math.min(SHARE_GRID_WIDTH, Math.max(1, raw)) : 0;

  return FILL[tone].repeat(filled) + EMPTY.repeat(SHARE_GRID_WIDTH - filled);
}

/** The share of points a side took, for the row's fill. */
export function pointsShare(playerScore: number, opponentScore: number): number {
  const player = Math.max(0, playerScore);
  const total = player + Math.max(0, opponentScore);
  return total === 0 ? 0 : player / total;
}
