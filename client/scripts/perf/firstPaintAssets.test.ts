import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without types
import { firstPaintScripts } from './firstPaintAssets.mjs';
// @ts-expect-error plain .mjs without types
import { describeBudget, withinBudget } from './budgetCheck.mjs';

const AS_BUILT = `<head>
<script type="module" crossorigin src="/assets/index-AAA.js"></script>
<link rel="modulepreload" crossorigin href="/assets/react-BBB.js">
<link rel="modulepreload" crossorigin href="/assets/game-CCC.js">
<link rel="stylesheet" crossorigin href="/assets/index-DDD.css">
<link rel="preload" as="image" href="/hero.webp">
</head>`;

describe('firstPaintScripts', () => {
  it('finds the entry script and every modulepreload', () => {
    expect(firstPaintScripts(AS_BUILT)).toEqual(['/assets/index-AAA.js', '/assets/react-BBB.js', '/assets/game-CCC.js']);
  });

  it('does not depend on attribute order (the audit repro: src before type, href before rel found 0 files)', () => {
    const swapped = `<script src="/a.js" crossorigin type="module"></script><link href="/b.js" rel="modulepreload" crossorigin>`;
    expect(firstPaintScripts(swapped)).toEqual(['/a.js', '/b.js']);
  });

  it('does not depend on quote style (the audit repro: rel=\'modulepreload\' found 1 file)', () => {
    const single = `<script type='module' src='/a.js'></script><link rel='modulepreload' href='/b.js'><link rel=modulepreload href=/c.js>`;
    expect(firstPaintScripts(single)).toEqual(['/a.js', '/b.js', '/c.js']);
  });

  it('ignores classic scripts, stylesheets, other preloads and a modulepreload without an href', () => {
    const html = `<script src="/classic.js"></script><link rel="stylesheet" href="/x.css"><link rel="preload" as="script" href="/y.js"><link rel="modulepreload">`;
    expect(firstPaintScripts(html)).toEqual([]);
  });

  it('finds the same count on the real built index.html when one exists', () => {
    const built = path.resolve(__dirname, '../../dist/index.html');
    if (!fs.existsSync(built)) return;
    expect(firstPaintScripts(fs.readFileSync(built, 'utf8')).length).toBeGreaterThanOrEqual(12);
  });
});

describe('withinBudget (two-sided)', () => {
  it('fails over max, as before', () => {
    expect(withinBudget(460001, { max: 460000, min: 330000 })).toBe(false);
  });
  it('fails under min: a collapsed measure of 0 no longer passes', () => {
    expect(withinBudget(0, { max: 460000, min: 330000 })).toBe(false);
    expect(withinBudget(0, { max: 16, min: 12 })).toBe(false);
  });
  it('fails on NaN either side', () => {
    expect(withinBudget(Number.NaN, { max: 10 })).toBe(false);
    expect(withinBudget(Number.NaN, { max: 10, min: 1 })).toBe(false);
  });
  it('passes inside the range and at both edges; a budget with no min stays one-sided', () => {
    expect(withinBudget(14, { max: 16, min: 12 })).toBe(true);
    expect(withinBudget(12, { max: 16, min: 12 })).toBe(true);
    expect(withinBudget(16, { max: 16, min: 12 })).toBe(true);
    expect(withinBudget(0, { max: 5 })).toBe(true);
  });
  it('describes the range', () => {
    expect(describeBudget({ min: 12, max: 16 })).toBe('12 <= 16');
    expect(describeBudget({ max: 5 })).toBe('5');
  });
});

describe('perf-budgets.json', () => {
  const budgets = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'perf-budgets.json'), 'utf8')).tier1;
  it('pins the first-paint file count and bounds the first-paint bytes from below', () => {
    expect(budgets.jsBeforeFirstPaintFiles.min).toBeGreaterThan(0);
    expect(budgets.jsBeforeFirstPaintBrotliBytes.min).toBeGreaterThan(0);
  });
  it('every Tier 1 budget has a numeric max and, where it has a min, min <= max', () => {
    for (const [id, b] of Object.entries<{ min?: number; max: number }>(budgets)) {
      expect(typeof b.max, id).toBe('number');
      if (b.min !== undefined) expect(b.min, id).toBeLessThanOrEqual(b.max);
    }
  });
});
