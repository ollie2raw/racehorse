import { describe, expect, it } from 'vitest';
import { resolveGhostAgreementFeedback } from './playerGhostSync.ts';

describe('resolveGhostAgreementFeedback', () => {
  it('reports agreement when the played move matches the ghost suggestion', () => {
    const tile = { low: 3, high: 5 };
    const feedback = resolveGhostAgreementFeedback(
      { type: 'play', tile, position: 'left' },
      'left',
      { tile, position: 'left', source: 'composite' },
    );
    expect(feedback).toEqual({ kind: 'agreement', type: 'agrees' });
  });

  it('reports disagreement when the played move differs', () => {
    const feedback = resolveGhostAgreementFeedback(
      { type: 'play', tile: { low: 1, high: 2 }, position: 'right' },
      'right',
      { tile: { low: 3, high: 4 }, position: 'left', source: 'composite' },
    );
    expect(feedback).toEqual({ kind: 'disagreement' });
  });
});