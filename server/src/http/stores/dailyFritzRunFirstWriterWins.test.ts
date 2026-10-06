import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseFetch: vi.fn() }));

vi.mock('../../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => mocks.supabaseFetch(...args),
}));

// Real generation, but each call gets its own generatedAt, as concurrent
// requests do in production.
let generation = 0;
vi.mock('../../dailyFritz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../dailyFritz')>();
  return {
    ...actual,
    generateDailyFritzRun: (...args: Parameters<typeof actual.generateDailyFritzRun>) => {
      generation += 1;
      return { ...actual.generateDailyFritzRun(...args), generatedAt: new Date(Date.UTC(2026, 9, 6, 2, 2, 8, generation)).toISOString() };
    },
  };
});

import {
  buildDailyFritzRunFingerprint,
  dailyFritzRunCache,
  ensureDailyFritzRunForDate,
  toDailyFritzRunRow,
} from './dailyFritzStore';
import { generateDailyFritzRun } from '../../dailyFritz';

const RUN_DATE = '2026-10-06';

/**
 * A minimal daily_fritz_runs table: insert-if-absent honours
 * `resolution=ignore-duplicates` (returns [] on conflict), merge-duplicates
 * overwrites. Each call yields first so concurrent callers interleave.
 */
function fakeRunsTable() {
  const rows = new Map<string, Record<string, unknown>>();
  const prefers: string[] = [];
  mocks.supabaseFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!path.startsWith('/rest/v1/daily_fritz_runs')) throw new Error(`unexpected ${path}`);
    if (init?.method === 'POST') {
      const prefer = String((init.headers as Record<string, string>).Prefer);
      prefers.push(prefer);
      const [row] = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
      const key = String(row.run_date);
      if (rows.has(key) && prefer.includes('ignore-duplicates')) return [];
      rows.set(key, row);
      return [row];
    }
    const date = /run_date=eq\.([0-9-]+)/.exec(path)?.[1] ?? '';
    return rows.has(date) ? [rows.get(date)] : [];
  });
  return { rows, prefers };
}

describe('Daily Fritz run creation: first saved run wins', () => {
  beforeEach(() => {
    mocks.supabaseFetch.mockReset();
    dailyFritzRunCache.clear();
    delete process.env.DAILY_FRITZ_MEMORY_STORE;
  });

  it('concurrent first-of-day callers all get the one stored run, so their fingerprints agree', async () => {
    const table = fakeRunsTable();
      const runs = await Promise.all([1, 2, 3, 4].map(() => {
        dailyFritzRunCache.clear();
        return ensureDailyFritzRunForDate(RUN_DATE);
      }));
      const stored = table.rows.get(RUN_DATE)!;
      for (const run of runs) {
        expect(run?.generatedAt).toBe(stored.generated_at);
      }
      expect(new Set(runs.map((run) => buildDailyFritzRunFingerprint(run!))).size).toBe(1);
      expect(table.prefers).toHaveLength(4);
      expect(table.prefers.every((prefer) => prefer.includes('resolution=ignore-duplicates'))).toBe(true);
  });

  it('an existing run is never overwritten by the automatic path', async () => {
    const table = fakeRunsTable();
    const first = generateDailyFritzRun(RUN_DATE, 'elite', 7, 60);
    table.rows.set(RUN_DATE, { ...toDailyFritzRunRow(first), generated_at: '2026-10-06T00:00:00.000Z' });
    const run = await ensureDailyFritzRunForDate(RUN_DATE);
    expect(run?.generatedAt).toBe('2026-10-06T00:00:00.000Z');
    expect(table.prefers).toEqual([]);
  });
});
