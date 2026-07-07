import { describe, expect, it } from 'vitest';
import { resolveNextMoveCounter } from './moveCounterSync.ts';

describe('resolveNextMoveCounter', () => {
  it('starts at 1 for an empty move log', () => {
    expect(resolveNextMoveCounter([])).toBe(1);
  });

  it('returns one greater than the highest move number', () => {
    expect(
      resolveNextMoveCounter([
        { moveNumber: 2, handNumber: 1, player: 'you', action: 'place' },
        { moveNumber: 5, handNumber: 1, player: 'opponent', action: 'draw' },
      ] as never),
    ).toBe(6);
  });

  it('treats missing move numbers as zero', () => {
    expect(
      resolveNextMoveCounter([
        { handNumber: 1, player: 'you', action: 'pass' },
      ] as never),
    ).toBe(1);
  });
});