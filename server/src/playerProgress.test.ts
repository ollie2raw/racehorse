import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('./supabaseUtils', () => ({ supabaseFetch: fetchMock }));

import {
  EMPTY_JOURNEY_PROGRESS,
  isMissingTableError,
  loadJourneyProgress,
  mergeJourneyProgress,
  mergeStoredJourneyProgress,
  parseJourneyProgress,
  progressSyncEnabled,
  type SyncedJourneyChapter,
  type SyncedJourneyProgress,
} from './playerProgress';

const USER = '11111111-1111-4111-8111-111111111111';

const chapter = (ids: string[], extra: Partial<SyncedJourneyChapter> = {}): SyncedJourneyChapter => ({
  completedNodeIds: [...ids].sort(),
  completedAt: null,
  completionCelebrated: false,
  ...extra,
});
const progress = (chapters: Record<string, SyncedJourneyChapter>): SyncedJourneyProgress => ({ chapters });

describe('progressSyncEnabled', () => {
  it('is on only for exactly "true"', () => {
    expect(progressSyncEnabled('true')).toBe(true);
    for (const off of [undefined, '', '1', 'TRUE', 'yes', 'false']) expect(progressSyncEnabled(off)).toBe(false);
  });
});

describe('parseJourneyProgress', () => {
  it('accepts a well-formed payload, sorts and de-duplicates ids, and drops unknown keys', () => {
    const parsed = parseJourneyProgress({
      chapters: { chapter_1: { completedNodeIds: ['n2', 'n1', 'n2'], completedAt: '2026-11-02T10:00:00.000Z', completionCelebrated: true, lastVisitedNodeId: 'n2', junk: 1 } },
      activeChapterId: 'chapter_1',
    });
    expect(parsed).toEqual({ chapters: { chapter_1: { completedNodeIds: ['n1', 'n2'], completedAt: '2026-11-02T10:00:00.000Z', completionCelebrated: true } } });
  });

  it('defaults the optional fields', () => {
    expect(parseJourneyProgress({ chapters: { c: { completedNodeIds: [] } } })).toEqual({ chapters: { c: { completedNodeIds: [], completedAt: null, completionCelebrated: false } } });
  });

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['no chapters', {}],
    ['chapters an array', { chapters: [] }],
    ['a bad chapter id', { chapters: { 'bad id!': { completedNodeIds: [] } } }],
    ['ids not an array', { chapters: { c: { completedNodeIds: 'n1' } } }],
    ['a bad node id', { chapters: { c: { completedNodeIds: ['has space'] } } }],
    ['a non-string node id', { chapters: { c: { completedNodeIds: [1] } } }],
    ['too many node ids', { chapters: { c: { completedNodeIds: Array.from({ length: 201 }, (_, i) => `n${i}`) } } }],
    ['too many chapters', { chapters: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`c${i}`, { completedNodeIds: [] }])) }],
    ['a layout version of zero', { chapters: { c: { completedNodeIds: [], layoutVersion: 0 } } }],
    ['a fractional layout version', { chapters: { c: { completedNodeIds: [], layoutVersion: 1.5 } } }],
    ['a bad timestamp', { chapters: { c: { completedNodeIds: [], completedAt: 'tomorrow' } } }],
    ['a non-boolean celebrated flag', { chapters: { c: { completedNodeIds: [], completionCelebrated: 'yes' } } }],
  ])('rejects %s', (_label, value) => {
    expect(parseJourneyProgress(value)).toBeNull();
  });
});

describe('mergeJourneyProgress', () => {
  const a = progress({ c1: chapter(['n1', 'n2'], { completedAt: '2026-11-02T12:00:00.000Z' }), c2: chapter(['x1']) });
  const b = progress({ c1: chapter(['n2', 'n3'], { completedAt: '2026-11-01T09:00:00.000Z', completionCelebrated: true }), c3: chapter(['y1']) });
  const c = progress({ c1: chapter(['n4']), c2: chapter(['x2']) });

  it('unions completed stages, keeps the earliest completion time and ORs the celebrated flag', () => {
    expect(mergeJourneyProgress(a, b).chapters.c1).toEqual({
      completedNodeIds: ['n1', 'n2', 'n3'],
      completedAt: '2026-11-01T09:00:00.000Z',
      completionCelebrated: true,
    });
  });

  it('keeps chapters only one side has', () => {
    const merged = mergeJourneyProgress(a, b);
    expect(Object.keys(merged.chapters).sort()).toEqual(['c1', 'c2', 'c3']);
    expect(merged.chapters.c2).toEqual(a.chapters.c2);
    expect(merged.chapters.c3).toEqual(b.chapters.c3);
  });

  it('is commutative, associative and idempotent, so devices converge in any order', () => {
    expect(mergeJourneyProgress(a, b)).toEqual(mergeJourneyProgress(b, a));
    expect(mergeJourneyProgress(mergeJourneyProgress(a, b), c)).toEqual(mergeJourneyProgress(a, mergeJourneyProgress(b, c)));
    expect(mergeJourneyProgress(a, a)).toEqual(a);
    expect(mergeJourneyProgress(a, EMPTY_JOURNEY_PROGRESS)).toEqual(a);
  });

  it('never loses a completed stage that either side had', () => {
    const merged = mergeJourneyProgress(a, b);
    for (const side of [a, b]) {
      for (const [id, ch] of Object.entries(side.chapters)) {
        for (const node of ch.completedNodeIds) expect(merged.chapters[id]!.completedNodeIds).toContain(node);
      }
    }
  });

  describe('layout versions (stage ids are reused across layouts)', () => {
    const old = progress({ c1: chapter(['n1', 'n2', 'n3']) }); // no layoutVersion = layout 1
    const current = progress({ c1: chapter(['n1'], { layoutVersion: 2 }) });

    it('a higher layout replaces a lower one wholesale, whichever side it is on', () => {
      expect(mergeJourneyProgress(old, current).chapters.c1).toEqual(current.chapters.c1);
      expect(mergeJourneyProgress(current, old).chapters.c1).toEqual(current.chapters.c1);
    });

    it('equal layouts union', () => {
      const other = progress({ c1: chapter(['n5'], { layoutVersion: 2 }) });
      expect(mergeJourneyProgress(current, other).chapters.c1.completedNodeIds).toEqual(['n1', 'n5']);
    });

    it('a missing layout counts as 1', () => {
      const explicit = progress({ c1: chapter(['n9'], { layoutVersion: 1 }) });
      expect(mergeJourneyProgress(old, explicit).chapters.c1.completedNodeIds).toEqual(['n1', 'n2', 'n3', 'n9']);
      expect(mergeJourneyProgress(old, explicit)).toEqual(mergeJourneyProgress(explicit, old));
    });
  });
});

/** The same vectors as client/src/journey/journeyProgressSync.test.ts: the merge rule exists once on each side, and identical vectors keep them from drifting apart. */
const SHARED_VECTORS: Array<{ name: string; a: SyncedJourneyProgress; b: SyncedJourneyProgress; expected: SyncedJourneyProgress }> = [
  {
    name: 'union, earliest completion, celebrated OR',
    a: progress({ c1: chapter(['n1', 'n2'], { completedAt: '2026-11-02T12:00:00.000Z' }) }),
    b: progress({ c1: chapter(['n2', 'n3'], { completedAt: '2026-11-01T09:00:00.000Z', completionCelebrated: true }) }),
    expected: progress({ c1: chapter(['n1', 'n2', 'n3'], { completedAt: '2026-11-01T09:00:00.000Z', completionCelebrated: true }) }),
  },
  {
    name: 'chapters only one side has are kept',
    a: progress({ c1: chapter(['n1']) }),
    b: progress({ c2: chapter(['x1']) }),
    expected: progress({ c1: chapter(['n1']), c2: chapter(['x1']) }),
  },
  {
    name: 'a higher layout replaces a lower one wholesale',
    a: progress({ c1: chapter(['n1', 'n2', 'n3']) }),
    b: progress({ c1: chapter(['n1'], { layoutVersion: 2 }) }),
    expected: progress({ c1: chapter(['n1'], { layoutVersion: 2 }) }),
  },
  {
    name: 'a missing layout counts as 1',
    a: progress({ c1: chapter(['n1']) }),
    b: progress({ c1: chapter(['n2'], { layoutVersion: 1 }) }),
    expected: progress({ c1: chapter(['n1', 'n2'], { layoutVersion: 1 }) }),
  },
  {
    name: 'identical copies merge to themselves',
    a: progress({ c1: chapter(['n1', 'n2'], { layoutVersion: 2 }) }),
    b: progress({ c1: chapter(['n1', 'n2'], { layoutVersion: 2 }) }),
    expected: progress({ c1: chapter(['n1', 'n2'], { layoutVersion: 2 }) }),
  },
];

describe('merge vectors shared with the client', () => {
  it.each(SHARED_VECTORS)('$name', ({ a, b, expected }) => {
    expect(mergeJourneyProgress(a, b)).toEqual(expected);
    expect(mergeJourneyProgress(b, a)).toEqual(expected);
  });
});

describe('isMissingTableError', () => {
  it('recognises PostgREST and Postgres missing-table errors, and nothing else', () => {
    expect(isMissingTableError(new Error('Supabase request failed: 404 {"code":"PGRST205","message":"Could not find the table \'public.player_progress\' in the schema cache"}'))).toBe(true);
    expect(isMissingTableError(new Error('Supabase request failed: 400 {"code":"42P01","message":"relation \\"player_progress\\" does not exist"}'))).toBe(true);
    expect(isMissingTableError(new Error('Supabase request failed: 500 boom'))).toBe(false);
    expect(isMissingTableError(new Error('timed out'))).toBe(false);
  });
});

/** An in-memory stand-in for the table, speaking just the PostgREST calls playerProgress.ts makes. */
function fakeTable(initial?: { data: unknown; revision: number }) {
  let row = initial ? { ...initial } : null;
  const calls: Array<{ method: string; path: string }> = [];
  let beforePatch: (() => void) | null = null;
  fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path });
    if (method === 'GET') return row ? [{ data: row.data, revision: row.revision }] : [];
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method === 'POST') {
      if (row) return [];
      row = { data: body[0].data, revision: 1 };
      return [body[0]];
    }
    if (method === 'PATCH') {
      beforePatch?.();
      beforePatch = null;
      const wanted = Number(/revision=eq\.(\d+)/.exec(path)?.[1]);
      if (!row || row.revision !== wanted) return [];
      row = { data: body.data, revision: body.revision };
      return [body];
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  return {
    calls,
    get row() { return row; },
    /** Run something (another device's write) just before the next PATCH, so that PATCH loses the race. */
    interleaveBeforeNextPatch(fn: () => void) { beforePatch = fn; },
    set(next: { data: unknown; revision: number }) { row = next; },
  };
}

describe('mergeStoredJourneyProgress', () => {
  beforeEach(() => fetchMock.mockReset());

  it('creates the row the first time', async () => {
    const table = fakeTable();
    const incoming = progress({ c1: chapter(['n1']) });
    expect(await mergeStoredJourneyProgress(USER, incoming)).toEqual(incoming);
    expect(table.row).toEqual({ data: incoming, revision: 1 });
  });

  it('unions into an existing row and bumps its revision', async () => {
    const table = fakeTable({ data: progress({ c1: chapter(['n1', 'n2']) }), revision: 3 });
    const merged = await mergeStoredJourneyProgress(USER, progress({ c1: chapter(['n2', 'n3']) }));
    expect(merged.chapters.c1!.completedNodeIds).toEqual(['n1', 'n2', 'n3']);
    expect(table.row!.revision).toBe(4);
  });

  it('a stale device can never take a stage away', async () => {
    const table = fakeTable({ data: progress({ c1: chapter(['n1', 'n2', 'n3']) }), revision: 5 });
    const merged = await mergeStoredJourneyProgress(USER, progress({ c1: chapter(['n1']) }));
    expect(merged.chapters.c1!.completedNodeIds).toEqual(['n1', 'n2', 'n3']);
    // nothing new, so nothing written
    expect(table.calls.some((call) => call.method === 'PATCH')).toBe(false);
    expect(table.row!.revision).toBe(5);
  });

  it('when another device writes first, re-reads and merges again so neither write is lost', async () => {
    const table = fakeTable({ data: progress({ c1: chapter(['n1']) }), revision: 1 });
    table.interleaveBeforeNextPatch(() => table.set({ data: progress({ c1: chapter(['n1', 'n9']) }), revision: 2 }));
    const merged = await mergeStoredJourneyProgress(USER, progress({ c1: chapter(['n1', 'n2']) }));
    expect(merged.chapters.c1!.completedNodeIds).toEqual(['n1', 'n2', 'n9']);
    expect(table.row).toEqual({ data: merged, revision: 3 });
  });

  it('when another device creates the row first, merges into it', async () => {
    const table = fakeTable();
    const realFetch = fetchMock.getMockImplementation()!;
    let first = true;
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (first && (init?.method ?? 'GET') === 'POST') {
        first = false;
        table.set({ data: progress({ c1: chapter(['n7']) }), revision: 1 });
        return []; // ignore-duplicates: it was created in between
      }
      return realFetch(path, init);
    });
    const merged = await mergeStoredJourneyProgress(USER, progress({ c1: chapter(['n1']) }));
    expect(merged.chapters.c1!.completedNodeIds).toEqual(['n1', 'n7']);
  });

  it('gives up after repeated lost races instead of looping', async () => {
    const table = fakeTable({ data: progress({ c1: chapter(['n1']) }), revision: 1 });
    let revision = 1;
    fetchMock.mockImplementation(async (_path: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        revision += 1; // every read is already out of date by the time we write
        return [{ data: table.row!.data, revision }];
      }
      return [];
    });
    await expect(mergeStoredJourneyProgress(USER, progress({ c1: chapter(['n2']) }))).rejects.toThrow('progress_write_conflict');
  });

  it('a stored row that no longer parses is treated as empty, not as a failure', async () => {
    const table = fakeTable({ data: { garbage: true }, revision: 1 });
    const merged = await mergeStoredJourneyProgress(USER, progress({ c1: chapter(['n1']) }));
    expect(merged.chapters.c1!.completedNodeIds).toEqual(['n1']);
    expect(table.row!.revision).toBe(2);
  });
});

describe('loadJourneyProgress', () => {
  beforeEach(() => fetchMock.mockReset());

  it('is null when there is no row, and the stored progress when there is', async () => {
    fakeTable();
    expect(await loadJourneyProgress(USER)).toBeNull();
    fakeTable({ data: progress({ c1: chapter(['n1']) }), revision: 2 });
    expect((await loadJourneyProgress(USER))!.chapters.c1!.completedNodeIds).toEqual(['n1']);
  });

  it('reads another user\'s id as part of the query only', async () => {
    const table = fakeTable();
    await loadJourneyProgress(USER);
    expect(table.calls[0]!.path).toContain(`user_id=eq.${USER}`);
    expect(table.calls[0]!.path).toContain('scope=eq.journey');
  });
});
