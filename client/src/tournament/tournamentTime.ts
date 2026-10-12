/**
 * Event times for players, in THEIR time zone (Phase 3C). Live Events are
 * scheduled in America/Los_Angeles on the server; that is an implementation
 * detail — the hub shows the device's local time with no zone label.
 * `timeZone` is injectable for tests only.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function localDateKey(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

/** "8:00 PM" (locale-formatted, local zone). */
export function formatEventTime(iso: string, opts: { timeZone?: string; locale?: string } = {}): string {
  return new Intl.DateTimeFormat(opts.locale, { timeZone: opts.timeZone, hour: 'numeric', minute: '2-digit' }).format(Date.parse(iso));
}

/** "Today" / "Tomorrow" / "Saturday" (within a week) / "Oct 18". Relative to `nowMs` in the local zone. */
export function formatEventDay(iso: string, nowMs: number, opts: { timeZone?: string; locale?: string } = {}): string {
  const ms = Date.parse(iso);
  const day = localDateKey(ms, opts.timeZone);
  if (day === localDateKey(nowMs, opts.timeZone)) return 'Today';
  if (day === localDateKey(nowMs + DAY_MS, opts.timeZone)) return 'Tomorrow';
  if (ms > nowMs && ms - nowMs < 6 * DAY_MS) {
    return new Intl.DateTimeFormat(opts.locale, { timeZone: opts.timeZone, weekday: 'long' }).format(ms);
  }
  return new Intl.DateTimeFormat(opts.locale, { timeZone: opts.timeZone, month: 'short', day: 'numeric' }).format(ms);
}

/** "Today · 8:00 PM". */
export function formatEventWhen(iso: string, nowMs: number, opts: { timeZone?: string; locale?: string } = {}): string {
  return `${formatEventDay(iso, nowMs, opts)} · ${formatEventTime(iso, opts)}`;
}

/** "2h 14m" / "14m 05s" / "45s" (never negative). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
