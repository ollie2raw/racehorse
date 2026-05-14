/** Ordinal label for leaderboard-style rank (e.g. "12th Place"). */
export function formatOrdinalPlace(value: number | null): string | null {
  if (!value || value <= 0) return null;
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th Place`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st Place`;
  if (mod10 === 2) return `${value}nd Place`;
  if (mod10 === 3) return `${value}rd Place`;
  return `${value}th Place`;
}
