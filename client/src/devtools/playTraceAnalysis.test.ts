import { describe, expect, it } from 'vitest';
import { analyzePlayTrace, formatPlayTraceReport, percentile, stat, type TraceEvent } from './playTraceAnalysis.ts';

// A hand-built trace with known answers. Times are ms.
const LOG: TraceEvent[] = [
  [0, 'board', 0],
  [0, 'hand', 7],
  [100, 'turn', 'YOUR MOVE'],
  [100, 'playable', 3],
  // I play: tap tile -> 1 zone after 10 ms; tap zone -> tile on board after 15 ms.
  [200, 'MARK:tap-tile', null],
  [210, 'zones', 1],
  [300, 'MARK:tap-zone', null],
  [315, 'board', 1],
  [315, 'hand', 6],
  [315, 'zones', 0],
  [315, 'playable', 0],
  [315, 'turn', 'FRITZ IS THINKING…'],
  // Fritz replies 1500 ms after my tile landed.
  [1815, 'board', 2],
  [1815, 'playable', 2],
  [1815, 'turn', 'YOUR MOVE'],
  // Second play with two zones.
  [2000, 'MARK:tap-tile', null],
  [2012, 'zones', 2],
  [2100, 'MARK:tap-zone', null],
  [2110, 'board', 3],
  [2110, 'hand', 5],
  [2110, 'zones', 0],
  [2110, 'playable', 0],
  [2110, 'turn', 'FRITZ IS THINKING…'],
  [2900, 'flying', 1],
  [3760, 'flying', 0],
  [3700, 'board', 4],
  // A draw: tap, hand grows by one 440 ms later.
  [4000, 'MARK:tap-draw', null],
  [4440, 'hand', 6],
];

describe('analyzePlayTrace', () => {
  const r = analyzePlayTrace(LOG);

  it('measures tap-to-response latencies', () => {
    // Two taps: 10 ms and 12 ms (nearest-rank p50 of two values is the upper one).
    expect(r.tapTileToZonesMs).toEqual({ n: 2, p50: 12, p95: 12, max: 12 });
  });

  it('measures the player-side latencies exactly', () => {
    expect(r.tapZoneToBoardMs).toMatchObject({ n: 2, max: 15 });
  });

  it('measures how long the opponent makes the player wait', () => {
    // My tiles land at 315 and 2110; the next tile lands 1500 and 1590 ms later.
    expect(r.opponentReplyMs).toEqual({ n: 2, p50: 1590, p95: 1590, max: 1590 });
  });

  it('counts the legal zones at the moment of each play and the single-zone share', () => {
    expect(r.zonesAtPlay).toEqual({ 1: 1, 2: 1 });
    expect(r.plays).toBe(2);
    expect(r.singleZoneShare).toBeCloseTo(0.5);
  });

  it('measures a draw and the flying-tile overlay', () => {
    expect(r.drawTapToHandMs).toMatchObject({ n: 1, p50: 440 });
    expect(r.flyingVisibleMs).toMatchObject({ n: 1, p50: 860 });
  });

  it('measures how long each turn label is held', () => {
    expect(r.turnLabelHeldMs['FRITZ IS THINKING…'].max).toBeGreaterThanOrEqual(1500);
  });

  it('formats a readable report', () => {
    const lines = formatPlayTraceReport(r);
    expect(lines.some((l) => l.startsWith('tap zone -> tile on board: n=2'))).toBe(true);
    expect(lines.some((l) => l.includes('single-zone plays: 50%'))).toBe(true);
  });

  it('does not credit a tap with an unrelated event seconds later', () => {
    const stale = analyzePlayTrace([
      [0, 'MARK:tap-tile', null],
      [5000, 'zones', 1],
    ]);
    expect(stale.tapTileToZonesMs.n).toBe(0);
  });

  it('copes with an empty log', () => {
    const empty = analyzePlayTrace([]);
    expect(empty.plays).toBe(0);
    expect(empty.singleZoneShare).toBe(0);
    expect(empty.opponentReplyMs.n).toBe(0);
  });
});

describe('percentile and stat', () => {
  it('computes nearest-rank percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([], 50)).toBe(0);
    expect(stat([5, 1, 3])).toEqual({ n: 3, p50: 3, p95: 5, max: 5 });
  });
});
