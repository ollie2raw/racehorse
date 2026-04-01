const pad = (n: number) => String(n).padStart(2, '0');

const PACIFIC_TIMEZONE = 'America/Los_Angeles';

function toPacificDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value ?? `${d.getFullYear()}`;
  const month = parts.find((p) => p.type === 'month')?.value ?? pad(d.getMonth() + 1);
  const day = parts.find((p) => p.type === 'day')?.value ?? pad(d.getDate());
  return `${year}-${month}-${day}`;
}

export function getLocalDateKey(d = new Date()): string {
  // Daily Puzzle calendar is explicitly Pacific Time (midnight PT reset).
  return toPacificDateKey(d);
}

export function normalizeDateInputToLocalKey(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return getLocalDateKey();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return getLocalDateKey();

  const roundTripYear = parsed.getUTCFullYear();
  const roundTripMonth = parsed.getUTCMonth() + 1;
  const roundTripDay = parsed.getUTCDate();
  if (roundTripYear !== year || roundTripMonth !== month || roundTripDay !== day) {
    return getLocalDateKey();
  }

  // Treat explicit YYYY-MM-DD input as a calendar key, not as a moment in the
  // viewer's local timezone. This avoids archive dates drifting by a day.
  return `${match[1]}-${match[2]}-${match[3]}`;
}
