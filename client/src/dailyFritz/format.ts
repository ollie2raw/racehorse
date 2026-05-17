export function secondsUntilNextPacificMidnight(now: Date): number {
  const pacific = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const part = (type: string) => Number(pacific.find((p) => p.type === type)?.value ?? 0);
  const hour = part('hour');
  const minute = part('minute');
  const second = part('second');
  const elapsed = hour * 3600 + minute * 60 + second;
  return Math.max(0, 86400 - elapsed);
}

export function formatCountdownHms(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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
