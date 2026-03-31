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
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const localDate = new Date(year, monthIndex, day);
  if (Number.isNaN(localDate.getTime())) return getLocalDateKey();
  return getLocalDateKey(localDate);
}
