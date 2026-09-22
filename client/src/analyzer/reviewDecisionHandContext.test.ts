import { describe, expect, it } from 'vitest';
import type { AnalyzedMove } from './moveAnalyzer';
import { buildReviewDecisionHandContext } from './reviewDecisionHandContext';

function move(overrides: Partial<AnalyzedMove> = {}): AnalyzedMove {
  return {
    moveNumber: 1,
    action: 'place',
    playedTile: [3, 4],
    score: 10,
    rating: 'Inaccuracy',
    explanation: 'test',
    handBefore: [
      [0, 1],
      [3, 4],
      [5, 6],
    ],
    validMoves: [
      [3, 4],
      [5, 6],
    ],
    boardEnds: [3, 5],
    boardState: [],
    boardRenderState: null,
    boardRenderStateAfterMove: null,
    handSnapshot: [],
    engineBestMove: null,
    ...overrides,
  };
}

describe('buildReviewDecisionHandContext', () => {
  it('marks the played tile and keeps held + playable alternatives', () => {
    const ctx = buildReviewDecisionHandContext(move());
    expect(ctx.actorHand).toEqual([
      [0, 1],
      [3, 4],
      [5, 6],
    ]);
    expect(ctx.playedTile).toEqual([3, 4]);
    expect(ctx.tiles.map((t) => t.role)).toEqual(['held', 'played', 'playable']);
  });

  it('shows a multi-end tile once as playable without inventing placement', () => {
    // validMoves lists the same tile twice (different ends) — tile appears once.
    const ctx = buildReviewDecisionHandContext(
      move({
        playedTile: [2, 2],
        handBefore: [
          [2, 2],
          [0, 5],
        ],
        validMoves: [
          [2, 2],
          [2, 2],
        ],
      }),
    );
    expect(ctx.tiles).toHaveLength(2);
    expect(ctx.tiles[0]).toEqual({ tile: [2, 2], role: 'played' });
    expect(ctx.tiles.filter((t) => sameLowHigh(t.tile, [2, 2]))).toHaveLength(1);
  });

  it('does not mark Played for pass or draw', () => {
    const pass = buildReviewDecisionHandContext(
      move({
        action: 'pass',
        playedTile: undefined,
        handBefore: [
          [1, 2],
          [3, 4],
        ],
        validMoves: [],
      }),
    );
    expect(pass.playedTile).toBeNull();
    expect(pass.tiles.every((t) => t.role !== 'played')).toBe(true);
    expect(pass.tiles.every((t) => t.role === 'held')).toBe(true);

    const draw = buildReviewDecisionHandContext(
      move({
        action: 'draw',
        playedTile: undefined,
        handBefore: [[1, 2]],
        validMoves: [],
      }),
    );
    expect(draw.playedTile).toBeNull();
    expect(draw.tiles.every((t) => t.role !== 'played')).toBe(true);
  });

  it('preserves handBefore order for scrub stability', () => {
    const ordered: Array<[number, number]> = [
      [6, 6],
      [0, 0],
      [1, 3],
    ];
    const ctx = buildReviewDecisionHandContext(
      move({
        handBefore: ordered,
        playedTile: [1, 3],
        validMoves: [[1, 3]],
      }),
    );
    expect(ctx.tiles.map((t) => t.tile)).toEqual(ordered);
  });
});

function sameLowHigh(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
