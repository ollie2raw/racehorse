import { describe, expect, it } from 'vitest';
import { formatCountdown, formatEventDay, formatEventTime, formatEventWhen } from './tournamentTime';

// The two daily Live Events on 2026-10-30 (PDT): 17:00 and 20:00 Pacific.
const FIVE_PM_PT = '2026-10-31T00:00:00.000Z';
const EIGHT_PM_PT = '2026-10-31T03:00:00.000Z';

describe('Live Event times in the player\'s own time zone', () => {
  it('Philadelphia sees 8:00 PM and 11:00 PM', () => {
    expect(formatEventTime(FIVE_PM_PT, { timeZone: 'America/New_York', locale: 'en-US' })).toBe('8:00 PM');
    expect(formatEventTime(EIGHT_PM_PT, { timeZone: 'America/New_York', locale: 'en-US' })).toBe('11:00 PM');
  });

  it('California sees 5:00 PM and 8:00 PM', () => {
    expect(formatEventTime(FIVE_PM_PT, { timeZone: 'America/Los_Angeles', locale: 'en-US' })).toBe('5:00 PM');
    expect(formatEventTime(EIGHT_PM_PT, { timeZone: 'America/Los_Angeles', locale: 'en-US' })).toBe('8:00 PM');
  });

  it('Tokyo sees the next morning, labelled by its own day', () => {
    const now = Date.parse('2026-10-30T22:00:00.000Z'); // Oct 31 07:00 JST, Oct 30 15:00 PDT
    expect(formatEventWhen(FIVE_PM_PT, now, { timeZone: 'Asia/Tokyo', locale: 'en-US' })).toBe('Today · 9:00 AM');
    expect(formatEventWhen(FIVE_PM_PT, now, { timeZone: 'America/Los_Angeles', locale: 'en-US' })).toBe('Today · 5:00 PM');
    expect(formatEventWhen(FIVE_PM_PT, now, { timeZone: 'America/New_York', locale: 'en-US' })).toBe('Today · 8:00 PM');
  });

  it('Today / Tomorrow / weekday / date, by the local calendar day', () => {
    const now = Date.parse('2026-10-30T16:00:00.000Z'); // Oct 30, 09:00 PDT / 12:00 EDT
    const opts = { timeZone: 'America/Los_Angeles', locale: 'en-US' };
    expect(formatEventDay(FIVE_PM_PT, now, opts)).toBe('Today');
    expect(formatEventDay('2026-11-01T00:00:00.000Z', now, opts)).toBe('Tomorrow');
    expect(formatEventDay('2026-11-03T01:00:00.000Z', now, opts)).toBe('Monday');
    expect(formatEventDay('2026-11-20T01:00:00.000Z', now, opts)).toBe('Nov 19');
    // In New York the 20:00 PT event is still "Today" (23:00 EDT)…
    expect(formatEventDay(EIGHT_PM_PT, now, { timeZone: 'America/New_York', locale: 'en-US' })).toBe('Today');
    // …and in Tokyo (already Oct 31, 01:00) it is noon "Today".
    expect(formatEventWhen(EIGHT_PM_PT, now, { timeZone: 'Asia/Tokyo', locale: 'en-US' })).toBe('Today · 12:00 PM');
    // A Tokyo player late on Oct 30 (23:00 JST) sees it as "Tomorrow".
    expect(formatEventDay(EIGHT_PM_PT, Date.parse('2026-10-30T14:00:00.000Z'), { timeZone: 'Asia/Tokyo', locale: 'en-US' })).toBe('Tomorrow');
  });

  it('countdowns read naturally and never go negative', () => {
    expect(formatCountdown(2 * 3_600_000 + 14 * 60_000 + 30_000)).toBe('2h 14m');
    expect(formatCountdown(14 * 60_000 + 5_000)).toBe('14m 05s');
    expect(formatCountdown(45_000)).toBe('45s');
    expect(formatCountdown(-5_000)).toBe('0s');
  });
});
