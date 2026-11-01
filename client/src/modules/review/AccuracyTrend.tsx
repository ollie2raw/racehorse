import { TREND_WINDOW, computeAccuracyTrend, formatAccuracy } from './gamesArchiveModel';
import type { SavedGameSummary } from './savedGames';

/** Plain-language read of the trend. A short history says so instead of claiming a direction. */
export function trendSummary(change: number | null, recentAverage: number | null): string {
  if (recentAverage === null) return `Review ${TREND_WINDOW} games to see your recent average.`;
  const average = formatAccuracy(recentAverage);
  if (change === null) return `Your last ${TREND_WINDOW} reviewed games average ${average}.`;
  if (Math.abs(change) < 0.5) return `Your last ${TREND_WINDOW} reviewed games average ${average}, steady against the ${TREND_WINDOW} before.`;
  return `Your last ${TREND_WINDOW} reviewed games average ${average}, ${change > 0 ? 'up' : 'down'} ${Math.abs(change)} points on the ${TREND_WINDOW} before.`;
}

/**
 * Accuracy across your reviewed games, oldest to newest. The line is an SVG stretched to the card (so it fills any width);
 * the dots are round HTML markers placed by percentage, so stretching can never turn them into ovals. The chart has a text
 * alternative, and unreviewed games are absent rather than plotted as zero. Hidden until there are two points.
 */
export function AccuracyTrend({ games }: { games: readonly SavedGameSummary[] }) {
  const { points, recentAverage, change } = computeAccuracyTrend(games);
  if (points.length < 2) return null;

  const values = points.map((point) => point.accuracy);
  const low = Math.max(0, Math.min(...values) - 5);
  const high = Math.min(100, Math.max(...values) + 5);
  const span = Math.max(high - low, 1);
  // Percent of the plot area: x from the first to the last game, y with a better game higher up.
  const x = (index: number) => (index * 100) / (points.length - 1);
  const y = (accuracy: number) => (1 - (accuracy - low) / span) * 100;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)} ${y(point.accuracy).toFixed(2)}`).join(' ');
  const first = formatAccuracy(points[0]!.accuracy);
  const last = formatAccuracy(points[points.length - 1]!.accuracy);

  return (
    <section className="rh-accuracy-trend" aria-label="Accuracy over time">
      <p className="rh-accuracy-trend__eyebrow">Accuracy over time</p>
      <div className="rh-accuracy-trend__plot">
        <svg
          className="rh-accuracy-trend__chart"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Accuracy across your last ${points.length} reviewed games, from ${first} to ${last}`}
        >
          <path className="rh-accuracy-trend__line" d={path} fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((point, index) => (
          <span
            key={point.id}
            aria-hidden="true"
            className={index === points.length - 1 ? 'rh-accuracy-trend__dot rh-accuracy-trend__dot--latest' : 'rh-accuracy-trend__dot'}
            style={{ left: `${x(index)}%`, top: `${y(point.accuracy)}%` }}
          />
        ))}
      </div>
      <p className="rh-accuracy-trend__summary">{trendSummary(change, recentAverage)}</p>
    </section>
  );
}
