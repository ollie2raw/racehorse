import { describe, expect, it } from 'vitest';
import { compactSingleRowLimit } from './compactLandscape';
import {
  RACK_TILE_CHROME,
  rackFitHalfWidth,
  rackTileCap,
  resolveLandscapeRackHalfWidth,
  type RackSizingInput,
} from './rackTileSizing';

/** Tray width the live layout gives at a viewport width (876 deck -> 820 tray at 932; 647 -> 591 at 667): innerWidth - 112. */
const tray = (w: number) => w - 112;
/** Web gap is 1.3vw; the native shell pins 8-10px. */
const webGap = (w: number) => w * 0.013;
const BOT = { few: 60, many: 46 } as const;

function webInput(w: number, h: number, tileCount: number): RackSizingInput {
  const short = h <= 430;
  return {
    tileCount, rowLimit: compactSingleRowLimit(w, short) ?? (short ? 8 : 9), innerWidth: w, isNative: false,
    availableWidth: tray(w), gap: webGap(w), zoom: w < 844 && short ? 0.82 : 1, caps: BOT,
  };
}

const rowWidth = (i: RackSizingInput, half: number) => {
  const perRow = i.tileCount > i.rowLimit ? Math.ceil(i.tileCount / 2) : i.tileCount;
  return perRow * (2 * half + RACK_TILE_CHROME) * i.zoom + (perRow - 1) * i.gap;
};

describe('landscape rack tile sizing', () => {
  const WIDTHS = [840, 880, 900, 920, 932, 944, 960, 980, 1024];

  it('keeps every hand size fully inside the tray across the 840-1024px web sweep', () => {
    for (const h of [430, 500]) for (const tileCount of [7, 8, 10, 14]) for (const w of WIDTHS) {
      const input = webInput(w, h, tileCount);
      const half = resolveLandscapeRackHalfWidth(input);
      expect(rowWidth(input, half), `${tileCount} tiles at ${w}x${h}: half=${half}`).toBeLessThanOrEqual(input.availableWidth);
    }
  });

  it('has no size jump as the width changes (the old rule stepped 90 -> 126px at 900/901)', () => {
    for (const tileCount of [7, 8, 10, 14]) {
      let previous = resolveLandscapeRackHalfWidth(webInput(850, 430, tileCount)); // 844 is where CSS zoom .82 and the row limit change (not this rule)
      for (let w = 851; w <= 1100; w += 1) {
        const half = resolveLandscapeRackHalfWidth(webInput(w, 430, tileCount));
        // the cap ramps 18px of pip-half over 100px of width (<= 0.18/px); a fit-limited size follows the tray at ~0.07/px
        expect(Math.abs(half - previous), `${tileCount} tiles: ${w - 1}px -> ${w}px (${previous} -> ${half})`).toBeLessThanOrEqual(1);
        previous = half;
      }
    }
  });

  it('is continuous across 900/901 for the normal 7-tile hand (was 42 -> 60)', () => {
    expect(resolveLandscapeRackHalfWidth(webInput(900, 430, 7))).toBe(42);
    expect(resolveLandscapeRackHalfWidth(webInput(901, 430, 7))).toBeLessThanOrEqual(43);
    expect(resolveLandscapeRackHalfWidth(webInput(932, 430, 7)) * 2 + RACK_TILE_CHROME).toBeLessThan(126);
  });

  it('never shrinks the desktop rack where it already fit (1100px+ keeps the full 60)', () => {
    for (const w of [1100, 1280, 1440]) expect(resolveLandscapeRackHalfWidth(webInput(w, 720, 7))).toBe(60);
  });

  it('caps a ten-tile (two row) hand at its smaller desktop size', () => {
    expect(resolveLandscapeRackHalfWidth(webInput(1280, 720, 10))).toBe(46);
  });

  describe('native shell: tile sizes are unchanged where they already fit', () => {
    const native = (w: number, _h: number, tileCount: number, tr: number, gap: number): RackSizingInput => ({
      tileCount, rowLimit: compactSingleRowLimit(w, true) ?? 8, innerWidth: w, isNative: true,
      availableWidth: tr, gap, zoom: 0.82, caps: BOT,
    });
    // measured in the real simulator / emulation: tray-center width and row gap per width
    const SIZES: Array<[number, number, number, number]> = [[667, 375, 591, 10.1], [740, 360, 664, 9.6], [812, 375, 736, 10.6], [844, 390, 750, 11], [874, 402, 762, 11.4]];
    it('7 and 14 tiles keep the 42 phone size up to 900px', () => {
      for (const [w, h, tr, gap] of SIZES) {
        expect(resolveLandscapeRackHalfWidth(native(w, h, 7, tr, gap)), `7 tiles at ${w}`).toBe(42);
        expect(resolveLandscapeRackHalfWidth(native(w, h, 14, tr, gap)), `14 tiles at ${w}`).toBe(42);
      }
    });
    it('932x430: 7 tiles keep 60 and 14 tiles keep 46 (the compact work shipped these)', () => {
      expect(resolveLandscapeRackHalfWidth(native(932, 430, 7, 820, 12.1))).toBe(60);
      expect(resolveLandscapeRackHalfWidth(native(932, 430, 14, 820, 12.1))).toBe(46);
    });
    it('932x430: an 8-tile single row used to run 900px into an 820px tray; it now fits', () => {
      const input = native(932, 430, 8, 820, 12.1);
      const half = resolveLandscapeRackHalfWidth(input);
      expect(half).toBeLessThan(60);
      expect(rowWidth(input, half)).toBeLessThanOrEqual(820);
    });
  });

  it('rackTileCap steps in the native shell and ramps on web', () => {
    const caps = BOT;
    expect(rackTileCap({ tileCount: 7, innerWidth: 900, isNative: false, caps })).toBe(42);
    expect(rackTileCap({ tileCount: 7, innerWidth: 950, isNative: false, caps })).toBe(51);
    expect(rackTileCap({ tileCount: 7, innerWidth: 1000, isNative: false, caps })).toBe(60);
    expect(rackTileCap({ tileCount: 7, innerWidth: 932, isNative: true, caps })).toBe(60);
    expect(rackTileCap({ tileCount: 12, innerWidth: 932, isNative: true, caps })).toBe(46);
  });

  it('rackFitHalfWidth solves the row inequality', () => {
    // 7 tiles, 820px tray, 12px gap, no zoom: (820 - 72) / 7 = 106.86 outer -> half 50
    expect(rackFitHalfWidth(7, 820, 12, 1)).toBe(50);
    expect(rackFitHalfWidth(7, 820, 12, 0.82)).toBe(62);
  });
});
