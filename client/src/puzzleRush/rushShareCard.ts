import { SITE_DOMAIN } from '../lib/siteUrl';
/**
 * Share text for a finished Puzzle Rush run.
 *
 * Mirrors Daily Fritz's share card (see dailyFritz/shareCard.ts): the headline
 * facts, then the per-stage breakdown, then the site. Only what the run
 * actually earned goes in — a line is dropped rather than padded with a dash.
 */

export interface RushShareStage {
  label: string;
  done: number;
  total: number;
}

export interface RushShareInput {
  /** The server's replayed total. The only score worth sharing. */
  score: number;
  /** Null when the server did not report a solve count for the run. */
  solved: number | null;
  stages: RushShareStage[];
  secondsBanked: number;
  /** ISO timestamp the run ended, for the date line. */
  playedAt?: string | null;
}

function formatShareDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function buildRushShareText(input: RushShareInput): string {
  const date = formatShareDate(input.playedAt);
  const stageLines = input.stages
    .filter((stage) => stage.total > 0)
    .map((stage) => `${stage.label} ${stage.done}/${stage.total}`)
    .join('\n');

  const lines = [
    date ? `Puzzle Rush · ${date}` : 'Puzzle Rush',
    input.solved === null
      ? `${input.score} pts`
      : `${input.score} pts · ${input.solved} solved`,
    stageLines,
    input.secondsBanked > 0 ? `+${input.secondsBanked}s banked` : '',
    SITE_DOMAIN,
  ].filter(Boolean);

  return lines.join('\n');
}
