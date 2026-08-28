import { describe, it, expect } from 'vitest';
import { buildDossierGameRows } from './dossierGameRows';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';

type Game = DailyFritzSetOverlayViewModel['games'][number];
const g = (n: number, ps: number, fz: number, skunk = false) =>
  ({ gameNumber: n, value: `${ps}–${fz}`, tone: ps > fz ? 'win' : 'loss',
     playerScore: ps, fritzScore: fz, skunk } as Game);

describe('buildDossierGameRows', () => {
  it('always returns three rows, marking an unplayed decider', () => {
    const rows = buildDossierGameRows([g(1, 65, 33), g(2, 60, 12)]);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual({ gameNumber: 3, played: false });
  });

  it('fills the bar with the winner’s share of the points', () => {
    const [row] = buildDossierGameRows([g(1, 65, 33)]);
    // 65 of 98 points.
    expect(row).toMatchObject({ sharePercent: 66, side: 'player' });
  });

  it('anchors a lost game to Fritz’s side', () => {
    const [row] = buildDossierGameRows([g(1, 49, 60)]);
    expect(row).toMatchObject({ side: 'fritz', tone: 'loss', sharePercent: 55 });
  });

  it('tones a won skunk gold, but never a lost one', () => {
    expect(buildDossierGameRows([g(1, 60, 12, true)])[0]).toMatchObject({ tone: 'skunk' });
    expect(buildDossierGameRows([g(1, 12, 60, true)])[0]).toMatchObject({ tone: 'loss' });
  });

  it('halves a scoreless game rather than dividing by zero', () => {
    expect(buildDossierGameRows([g(1, 0, 0)])[0]).toMatchObject({ sharePercent: 50 });
  });
});
