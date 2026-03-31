const K_FACTOR = 32;

const DIVISION_THRESHOLDS: Array<{ division: string; threshold: number }> = [
  { division: 'Diamond', threshold: 1800 },
  { division: 'Platinum', threshold: 1600 },
  { division: 'Gold', threshold: 1400 },
  { division: 'Silver', threshold: 1200 },
  { division: 'Bronze', threshold: 0 },
];

export function computeEloChange(playerRating: number, percentile: number): number {
  const clippedPercentile = Math.max(0, Math.min(1, percentile));
  const expectedScore =
    1 / (1 + Math.pow(10, (getFieldRating(clippedPercentile) - playerRating) / 400));
  const actualScore = clippedPercentile;
  return Math.round(K_FACTOR * (actualScore - expectedScore));
}

function getFieldRating(percentile: number): number {
  return 1000 + (percentile - 0.5) * 400;
}

export function getDivision(rating: number): string {
  const found = DIVISION_THRESHOLDS.find((entry) => rating >= entry.threshold);
  return found?.division ?? 'Bronze';
}
