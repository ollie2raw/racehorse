import type { SavedGameSummary } from './savedGames.ts';

export type ResultFilter = 'all' | 'wins' | 'losses';
export type TierFilter = 'all' | string;
export type ArchiveFilters = { result: ResultFilter; tier: TierFilter };

export const NO_FILTERS: ArchiveFilters = { result: 'all', tier: 'all' };

export type ArchiveStats = {
  games: number;
  wins: number;
  losses: number;
  /** Percent of decided games won (0-100, whole number), or null when none were decided. */
  winRate: number | null;
  /** Games whose review is saved and can be reopened. */
  reviewed: number;
  /** Mean accuracy over reviewed games that have one, one decimal; null when there is none to average. */
  averageAccuracy: number | null;
};

export function gameResult(game: SavedGameSummary): 'win' | 'loss' | 'none' {
  return game.result.winner === 'you' ? 'win' : game.result.winner === 'opponent' ? 'loss' : 'none';
}

export function computeArchiveStats(games: readonly SavedGameSummary[]): ArchiveStats {
  let wins = 0;
  let losses = 0;
  let reviewed = 0;
  let accuracySum = 0;
  let accuracyCount = 0;
  for (const game of games) {
    const result = gameResult(game);
    if (result === 'win') wins += 1;
    else if (result === 'loss') losses += 1;
    if (game.review) {
      reviewed += 1;
      if (game.review.accuracy !== null && Number.isFinite(game.review.accuracy)) {
        accuracySum += game.review.accuracy;
        accuracyCount += 1;
      }
    }
  }
  const decided = wins + losses;
  return {
    games: games.length,
    wins,
    losses,
    winRate: decided > 0 ? Math.round((wins / decided) * 100) : null,
    reviewed,
    averageAccuracy: accuracyCount > 0 ? Math.round((accuracySum / accuracyCount) * 10) / 10 : null,
  };
}

export function filterGames(games: readonly SavedGameSummary[], filters: ArchiveFilters): SavedGameSummary[] {
  return games.filter((game) => {
    if (filters.result === 'wins' && gameResult(game) !== 'win') return false;
    if (filters.result === 'losses' && gameResult(game) !== 'loss') return false;
    if (filters.tier !== 'all' && game.fritzTier !== filters.tier) return false;
    return true;
  });
}

const TIER_ORDER = ['rookie', 'standard', 'elite', 'master'];

/** The Fritz tiers that appear in these games, weakest first, so the filter only offers choices that match something. */
export function tiersPresent(games: readonly SavedGameSummary[]): string[] {
  const present = new Set<string>();
  for (const game of games) if (game.fritzTier) present.add(game.fritzTier);
  return [...present].sort((a, b) => {
    const ai = TIER_ORDER.indexOf(a);
    const bi = TIER_ORDER.indexOf(b);
    return (ai === -1 ? TIER_ORDER.length : ai) - (bi === -1 ? TIER_ORDER.length : bi) || a.localeCompare(b);
  });
}

export const titleCase = (value: string | null): string => (value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Fritz');

export function formatAccuracy(accuracy: number | null): string | null {
  return accuracy === null || !Number.isFinite(accuracy) ? null : `${Math.round(accuracy * 10) / 10}%`;
}

export const TREND_MAX_POINTS = 20;
/** A trend needs a before and an after: this many reviewed games compared against the same number just before them. */
export const TREND_WINDOW = 5;

export type AccuracyPoint = { id: string; accuracy: number; when: string };

/** An unparseable date sorts as the oldest instead of poisoning the comparison with NaN. */
const timeOf = (when: string): number => {
  const time = Date.parse(when);
  return Number.isNaN(time) ? 0 : time;
};

export type AccuracyTrend = {
  /** Oldest first, newest last: the order a chart reads. At most TREND_MAX_POINTS. */
  points: AccuracyPoint[];
  /** Mean accuracy of the most recent TREND_WINDOW games, or null when there are not enough games to compare. */
  recentAverage: number | null;
  /** How much that mean moved against the TREND_WINDOW games before it (percentage points), or null. */
  change: number | null;
};

/**
 * Accuracy over your reviewed games. Only games with a numeric accuracy count; unreviewed games are simply absent (never
 * plotted as zero). `change` needs two full windows, so a short history shows the chart without claiming a trend.
 */
export function computeAccuracyTrend(games: readonly SavedGameSummary[]): AccuracyTrend {
  const reviewed = games
    .flatMap((game) => (game.review && game.review.accuracy !== null && Number.isFinite(game.review.accuracy)
      ? [{ id: game.sourceMatchId, accuracy: game.review.accuracy, when: game.playedAt ?? game.savedAt }]
      : []))
    .sort((a, b) => timeOf(a.when) - timeOf(b.when))
    .slice(-TREND_MAX_POINTS);
  const mean = (rows: readonly AccuracyPoint[]) => rows.reduce((sum, row) => sum + row.accuracy, 0) / rows.length;
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const recent = reviewed.slice(-TREND_WINDOW);
  const before = reviewed.slice(-TREND_WINDOW * 2, -TREND_WINDOW);
  const enough = recent.length === TREND_WINDOW && before.length === TREND_WINDOW;
  return {
    points: reviewed,
    recentAverage: recent.length === TREND_WINDOW ? round1(mean(recent)) : null,
    change: enough ? round1(mean(recent) - mean(before)) : null,
  };
}
