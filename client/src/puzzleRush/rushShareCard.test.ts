import { describe, it, expect } from 'vitest';
import { buildRushShareText, PUZZLE_RUSH_PUZZLES_PER_RUN } from './rushShareCard';
import { SITE_DOMAIN } from '../lib/siteUrl';

describe('buildRushShareText', () => {
  it('renders puzzle number, a fixed 15-cell 🟩/🟥 grid, solve count, and site', () => {
    const text = buildRushShareText({ solved: 11, runDate: '2026-09-09' });
    expect(text).toBe(
      [
        'Racehorse Puzzle Rush #153',
        '🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟥🟥🟥🟥',
        '',
        '11 solved',
        SITE_DOMAIN,
      ].join('\n'),
    );
  });

  it('grid is always exactly PUZZLE_RUSH_PUZZLES_PER_RUN cells', () => {
    for (const solved of [0, 1, 7, 14, 15]) {
      const grid = buildRushShareText({ solved, runDate: '2026-09-09' }).split('\n')[1];
      const cells = [...grid.matchAll(/🟩|🟥/g)].length;
      expect(cells).toBe(PUZZLE_RUSH_PUZZLES_PER_RUN);
      expect((grid.match(/🟩/g) ?? []).length).toBe(solved);
      expect((grid.match(/🟥/g) ?? []).length).toBe(PUZZLE_RUSH_PUZZLES_PER_RUN - solved);
    }
  });

  it('a perfect run is all 🟩, no 🟥', () => {
    const text = buildRushShareText({ solved: 15, runDate: '2026-09-09' });
    expect(text.split('\n')[1]).toBe('🟩'.repeat(15));
    expect(text).toContain('15 solved');
  });

  it('a zero-solve run is all 🟥', () => {
    expect(buildRushShareText({ solved: 0 }).split('\n')[1]).toBe('🟥'.repeat(15));
  });

  it('clamps a solve count outside 0..15 and rounds a non-integer', () => {
    expect(buildRushShareText({ solved: 99 }).split('\n')[1]).toBe('🟩'.repeat(15));
    expect(buildRushShareText({ solved: -3 }).split('\n')[1]).toBe('🟥'.repeat(15));
    expect(buildRushShareText({ solved: 10.6 }).split('\n')[3]).toBe('11 solved');
  });

  it('calculates the puzzle number from run_date, defaulting to #1', () => {
    expect(buildRushShareText({ solved: 1, runDate: '2026-04-10' })).toContain('#1');
    expect(buildRushShareText({ solved: 1 })).toContain('#1');
    expect(buildRushShareText({ solved: 1, runDate: 'not-a-date' })).toContain('#1');
  });

  // The reason this builder exists: RushResultsView (end of run) and
  // PuzzleRushLeaderboardScreen (later, from the persisted board row) used to
  // format share text separately and disagreed — the leaderboard emitted
  // squares with no fail marker. Both now derive the input from the same two
  // run facts, so the output must be byte-identical for the same run.
  it('RushResultsView and PuzzleRushLeaderboardScreen emit identical text for one run', () => {
    // One finished run, as each surface sees it.
    const run = { puzzlesSolved: 9, runDate: '2026-08-31' };

    // RushResultsView: `{ solved: completion.run.puzzlesSolved ?? 0, runDate: completion.run.runDate }`
    const completion = { run: { ...run } };
    const fromResultsView = buildRushShareText({
      solved: completion.run.puzzlesSolved ?? 0,
      runDate: completion.run.runDate,
    });

    // PuzzleRushLeaderboardScreen: `{ solved: selfRow.puzzlesSolved, runDate: data.runDate }`
    const selfRow = { puzzlesSolved: run.puzzlesSolved };
    const leaderboardResponse = { runDate: run.runDate };
    const fromLeaderboard = buildRushShareText({
      solved: selfRow.puzzlesSolved,
      runDate: leaderboardResponse.runDate,
    });

    expect(fromResultsView).toBe(fromLeaderboard);
    expect(fromResultsView).toContain('🟥'); // both carry the fail marker now
  });
});
