import { describe, expect, it } from 'vitest';
import { countDistinctLegalActions, isForcedDecision } from '../reviewCandidateDedupe';
import type { ReviewAction } from '../reviewContracts';

const play = (low: number, high: number, position: string): ReviewAction =>
  ({ kind: 'play', tile: { low, high }, position }) as ReviewAction;

describe('isForcedDecision / countDistinctLegalActions', () => {
  it('one tile one placement → forced', () => {
    expect(isForcedDecision([{ action: play(3, 4, 'left') }])).toBe(true);
    expect(countDistinctLegalActions([{ action: play(3, 4, 'left') }])).toBe(1);
  });

  it('one tile two placements → not forced', () => {
    expect(
      isForcedDecision([{ action: play(3, 4, 'left') }, { action: play(3, 4, 'right') }]),
    ).toBe(false);
    expect(
      countDistinctLegalActions([{ action: play(3, 4, 'left') }, { action: play(3, 4, 'right') }]),
    ).toBe(2);
  });

  it('branch A vs branch B → not forced', () => {
    expect(
      isForcedDecision([
        { action: play(2, 6, 'branch-1-0') },
        { action: play(2, 6, 'branch-1-1') },
      ]),
    ).toBe(false);
  });

  it('pass alone → forced', () => {
    expect(isForcedDecision([{ action: { kind: 'pass' } }])).toBe(true);
  });
});
