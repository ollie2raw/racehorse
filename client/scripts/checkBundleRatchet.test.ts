import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script with no type declarations
import { chunkStem, findGrowth, findSlack, summarise, TOLERANCE_BYTES, TRACKED_MIN_BYTES } from './checkBundleRatchet.mjs';

type Summary = { total: number; chunks: Record<string, number> };

describe('chunkStem', () => {
  it('drops the content hash, including hashes that contain a dash or underscore', () => {
    expect(chunkStem('index-BWsEKhTp.js')).toBe('index');
    expect(chunkStem('DailyFritzScreen-D3mcVt-r.js')).toBe('DailyFritzScreen');
    expect(chunkStem('lesson-v2-Cx1ab_cd.js')).toBe('lesson-v2');
  });
});

describe('summarise', () => {
  it('lists only chunks worth tracking, but counts everything in the total', () => {
    const s: Summary = summarise([
      { file: 'index-aaaaaaaa.js', size: 500_000 },
      { file: 'tiny-bbbbbbbb.js', size: TRACKED_MIN_BYTES - 1 },
    ]);
    expect(s.total).toBe(500_000 + TRACKED_MIN_BYTES - 1);
    expect(s.chunks).toEqual({ index: 500_000 });
  });
});

describe('findGrowth', () => {
  const baseline: Summary = { total: 1_000_000, chunks: { index: 600_000 } };

  it('passes an unchanged build and one inside the tolerance', () => {
    expect(findGrowth(baseline, baseline)).toEqual([]);
    expect(findGrowth({ total: 1_000_000 + TOLERANCE_BYTES, chunks: { index: 600_000 + TOLERANCE_BYTES } }, baseline)).toEqual([]);
  });

  it('fails a chunk that grew past the tolerance, and the total', () => {
    const grown: Summary = { total: 1_100_000, chunks: { index: 700_000 } };
    expect(findGrowth(grown, baseline).map((p: { name: string }) => p.name)).toEqual(['total JS', 'index']);
  });

  it('fails a large chunk the baseline has never seen', () => {
    const found = findGrowth({ total: 1_000_000, chunks: { index: 600_000, extra: 50_000 } }, baseline);
    expect(found).toEqual([{ name: 'extra', allowed: null, found: 50_000 }]);
  });

  it('never fails because something got smaller', () => {
    expect(findGrowth({ total: 900_000, chunks: { index: 500_000 } }, baseline)).toEqual([]);
  });
});

describe('findSlack', () => {
  it('reports entries that shrank by more than the tolerance so the PR lowers them', () => {
    const baseline: Summary = { total: 1_000_000, chunks: { index: 600_000, gone: 20_000 } };
    const slack = findSlack({ total: 900_000, chunks: { index: 600_000 } }, baseline);
    expect(slack.map((s: { name: string }) => s.name)).toEqual(['total JS', 'gone']);
  });
});
