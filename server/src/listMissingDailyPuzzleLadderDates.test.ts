import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findDatesWithoutReadyLadder,
  LADDER_RANGE_PAGE_SIZE,
  listPublishedLadderSlotRowsInRange,
} from './dailyPuzzleLadderPublish';
import { datesInWindow, listMissingDates } from './listMissingDailyPuzzleLadderDates';

/** E1: one paged range read replaces ~730 per-date reads per scheduled run. */
const row = (date: string, slot: number) => ({ id: `${date}-${slot}`, puzzle_date: date, slot_index: slot }) as never;

describe('datesInWindow', () => {
  it('is calendar arithmetic, across month and year ends', () => {
    expect(datesInWindow('2026-12-30', 4)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});

describe('findDatesWithoutReadyLadder', () => {
  it('judges each date only on its own rows, and a date with no rows is missing', () => {
    const rows = [row('2026-10-05', 1), row('2026-10-05', 2), row('2026-10-06', 1)];
    const isReady = (forDate: Array<{ puzzle_date: string }>) => forDate.length >= 2;
    expect(findDatesWithoutReadyLadder(['2026-10-05', '2026-10-06', '2026-10-07'], rows, isReady as never)).toEqual([
      '2026-10-06',
      '2026-10-07',
    ]);
  });
});

describe('listPublishedLadderSlotRowsInRange', () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    process.env.SUPABASE_URL = 'https://stub.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'stub';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('pages until a short page, with the date range and published filter', async () => {
    const pages = [Array.from({ length: LADDER_RANGE_PAGE_SIZE }, (_, i) => row('2026-10-05', i)), [row('2026-10-06', 1)]];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        calls.push(decodeURIComponent(String(url)));
        return new Response(JSON.stringify(pages[calls.length - 1] ?? []), { status: 200 });
      }),
    );

    const rows = await listPublishedLadderSlotRowsInRange('2026-10-05', '2027-10-04');

    expect(rows).toHaveLength(LADDER_RANGE_PAGE_SIZE + 1);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('published=eq.true');
    expect(calls[0]).toContain('puzzle_date=gte.2026-10-05');
    expect(calls[0]).toContain('puzzle_date=lte.2027-10-04');
    expect(calls[0]).toContain(`offset=0`);
    expect(calls[1]).toContain(`offset=${LADDER_RANGE_PAGE_SIZE}`);
  });

  it('fails open: on a failed read every date in the window is listed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await listMissingDates('2026-10-05', 3);
    expect(result).toEqual({ dates: ['2026-10-05', '2026-10-06', '2026-10-07'], fellBack: true });
    warn.mockRestore();
  });

  it('a window where every date has rows the real rule rejects lists them all; one read total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        calls.push(String(url));
        return new Response(JSON.stringify([row('2026-10-05', 1)]), { status: 200 });
      }),
    );
    const result = await listMissingDates('2026-10-05', 2);
    expect(result.fellBack).toBe(false);
    expect(result.dates).toEqual(['2026-10-05', '2026-10-06']);
    expect(calls).toHaveLength(1);
  });
});
