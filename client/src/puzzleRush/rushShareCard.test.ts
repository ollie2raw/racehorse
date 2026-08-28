import { describe, it, expect } from 'vitest';
import { buildRushShareText } from './rushShareCard';
import { SITE_DOMAIN } from '../lib/siteUrl';
import { buildShareGridRow } from '../lib/shareGrid';

const STAGES = [
  { label: 'Warm-Up', done: 2, total: 3 },
  { label: 'Building', done: 0, total: 5 },
  { label: 'Master', done: 0, total: 7 },
];

describe('buildRushShareText', () => {
  it('leads with the score and solved count, then every stage', () => {
    const text = buildRushShareText({
      score: 250,
      solved: 2,
      stages: STAGES,
      secondsBanked: 2,
      playedAt: '2026-08-27T22:12:00.000Z',
    });
    expect(text).toContain('250 pts · 2 solved');
    // Warm-Up is 2 of 3, so a partly-filled row; the two untouched stages read
    // as unplayed rather than as failures.
    expect(text).toContain(buildShareGridRow(2 / 3, 'win'));
    expect(text.split('\n').filter((line) => line.startsWith('⬜'))).toHaveLength(2);
    expect(text).toContain('+2s banked');
    expect(text.endsWith(SITE_DOMAIN)).toBe(true);
  });

  it('marks a fully cleared stage as exceptional', () => {
    const text = buildRushShareText({
      score: 900, solved: 15, secondsBanked: 0,
      stages: [{ label: 'Warm-Up', done: 3, total: 3 }],
    });
    expect(text).toContain(buildShareGridRow(1, 'skunk'));
  });

  it('omits the solve count when the server did not report one', () => {
    const text = buildRushShareText({ score: 250, solved: null, stages: STAGES, secondsBanked: 0 });
    expect(text).toContain('250 pts');
    expect(text).not.toContain('solved');
  });

  it('drops the banked line when nothing was banked', () => {
    const text = buildRushShareText({ score: 250, solved: 2, stages: STAGES, secondsBanked: 0 });
    expect(text).not.toContain('banked');
  });

  it('falls back to a bare title when the run has no usable timestamp', () => {
    for (const playedAt of [null, undefined, 'not-a-date']) {
      const text = buildRushShareText({ score: 10, solved: 1, stages: [], secondsBanked: 0, playedAt });
      expect(text.split('\n')[0]).toBe('Puzzle Rush');
    }
  });

  it('omits stages that served no puzzles in this run', () => {
    const text = buildRushShareText({
      score: 250,
      solved: 2,
      stages: [...STAGES, { label: 'Unused', done: 0, total: 0 }],
      secondsBanked: 0,
    });
    expect(text).not.toContain('Unused');
  });
});
