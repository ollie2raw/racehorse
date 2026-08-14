// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { countAuthoringV2PlayerPlays } from './authoringV2Metrics.ts';

describe('countAuthoringV2PlayerPlays', () => {
  it('counts only player play events', () => {
    expect(
      countAuthoringV2PlayerPlays([
        { actor: 'player', action: 'play' },
        { actor: 'fritz', action: 'play' },
        { actor: 'player', action: 'draw' },
        { actor: 'player', action: 'play' },
      ] as never),
    ).toBe(2);
  });

  it('returns zero for an empty event list', () => {
    expect(countAuthoringV2PlayerPlays([])).toBe(0);
  });
});