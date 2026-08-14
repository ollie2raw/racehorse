// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tileEquals, buildDoubleSixTiles, sumTilePips } from './tileUtils';

describe('tileEquals', () => {
  it('returns true for identical tiles', () => {
    expect(tileEquals({ low: 3, high: 5 }, { low: 3, high: 5 })).toBe(true);
  });
  it('returns true for flipped tiles', () => {
    expect(tileEquals({ low: 3, high: 5 }, { low: 5, high: 3 })).toBe(true);
  });
  it('returns false for different tiles', () => {
    expect(tileEquals({ low: 3, high: 5 }, { low: 2, high: 5 })).toBe(false);
  });
  it('handles doubles', () => {
    expect(tileEquals({ low: 6, high: 6 }, { low: 6, high: 6 })).toBe(true);
  });
});

describe('buildDoubleSixTiles', () => {
  it('returns 28 tiles for a standard double-six set', () => {
    expect(buildDoubleSixTiles()).toHaveLength(28);
  });

  it('contains the double-six tile', () => {
    const tiles = buildDoubleSixTiles();
    expect(tiles.some(t => t.low === 6 && t.high === 6)).toBe(true);
  });

  it('contains the double-blank tile', () => {
    const tiles = buildDoubleSixTiles();
    expect(tiles.some(t => t.low === 0 && t.high === 0)).toBe(true);
  });
});

describe('sumTilePips', () => {
  it('sums low and high pips', () => {
    expect(sumTilePips([{ low: 3, high: 4 }])).toBe(7);
  });
  it('handles doubles', () => {
    expect(sumTilePips([{ low: 6, high: 6 }])).toBe(12);
  });
  it('handles blank', () => {
    expect(sumTilePips([{ low: 0, high: 0 }])).toBe(0);
  });
});
