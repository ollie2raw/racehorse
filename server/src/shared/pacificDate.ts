export function getPacificDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getPacificDateTimeParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const getNumber = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: getNumber('year'),
    month: getNumber('month'),
    day: getNumber('day'),
    hour: getNumber('hour'),
    minute: getNumber('minute'),
    second: getNumber('second'),
  };
}

export function getPacificOffsetMinutes(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-8';
  const match = raw.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return -8 * 60;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

export function getPacificDateKeyDaysFromNow(daysFromNow: number): string {
  return getPacificDateKey(new Date(Date.now() + daysFromNow * 86400000));
}

export function getNextPacificWarmupAt(hour = 0, minute = 2): Date {
  const now = new Date();
  const pacific = getPacificDateTimeParts(now);
  const nextUtcGuess = new Date(Date.UTC(pacific.year, pacific.month - 1, pacific.day + 1, hour, minute, 0, 0));
  const offsetMinutes = getPacificOffsetMinutes(nextUtcGuess);
  return new Date(nextUtcGuess.getTime() - offsetMinutes * 60000);
}
