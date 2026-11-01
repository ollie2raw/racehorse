import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs script, no type declarations
import { countCss, findRegressions, measureAll } from './checkCssRatchet.mjs';

describe('countCss', () => {
  it('counts !important in any spacing and case', () => {
    expect(countCss('a { color: red !important; b: 1 ! IMPORTANT; }').important).toBe(2);
  });

  it('counts hex colours in values but not in selectors or comments', () => {
    const css = `
      /* #123456 in a comment */
      #hero-3d { color: #FFF; background: #1a2b3c; border-color: #1a2b3c80; }
      .x:hover { box-shadow: 0 0 0 1px #abcd; }
    `;
    expect(countCss(css).hex).toBe(4);
  });

  it('does not count var() tokens or url fragments as hex', () => {
    expect(countCss('a { color: var(--tier-elite); background: url(a.svg#icon); }').hex).toBe(0);
  });

  it('skips hex entirely for the tokens file', () => {
    expect(countCss(':root { --bg-obsidian: #04070c; }', { countHex: false }).hex).toBe(0);
  });

  it('counts every gradient function', () => {
    const css = 'a { background: linear-gradient(red, blue); b: radial-gradient(red, blue); c: repeating-linear-gradient(red, blue); d: conic-gradient(red, blue); }';
    expect(countCss(css).gradient).toBe(4);
  });
});

describe('findRegressions', () => {
  const baseline = { 'src/a.css': { important: 2, hex: 1, gradient: 0 } };

  it('passes when counts are equal or lower', () => {
    expect(findRegressions({ 'src/a.css': { important: 2, hex: 0, gradient: 0 } }, baseline)).toEqual([]);
  });

  it('flags an increase in any metric', () => {
    expect(findRegressions({ 'src/a.css': { important: 3, hex: 1, gradient: 1 } }, baseline)).toEqual([
      { file: 'src/a.css', metric: 'important', allowed: 2, found: 3 },
      { file: 'src/a.css', metric: 'gradient', allowed: 0, found: 1 },
    ]);
  });

  it('holds a new file to zero', () => {
    expect(findRegressions({ 'src/new.css': { important: 0, hex: 1, gradient: 0 } }, baseline)).toEqual([
      { file: 'src/new.css', metric: 'hex', allowed: 0, found: 1 },
    ]);
  });
});

describe('the committed baseline', () => {
  it('is not exceeded by the stylesheets in the tree', () => {
    // vitest runs from client/ (see the project's CI commands).
    const baseline = JSON.parse(readFileSync(join(process.cwd(), 'css-ratchet-baseline.json'), 'utf8'));
    expect(findRegressions(measureAll(), baseline)).toEqual([]);
  });
});
