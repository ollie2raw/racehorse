// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { verifyJourneyPuzzleAgainstEngine } from './journeyPuzzleEngineVerification';
import { JOURNEY_PUZZLES, type JourneyPuzzle } from './journeyPuzzles';

function makePuzzle(overrides: Partial<JourneyPuzzle> = {}): JourneyPuzzle {
  return {
    nodeId: 'test-puzzle',
    eyebrow: 'Test',
    title: 'Test puzzle',
    scenario: '',
    prompt: '',
    choices: [],
    correctChoiceId: '',
    explanation: '',
    rewardLabel: '',
    boardState: { ends: [3, 5], placedTiles: [{ high: 5, low: 3 }] },
    playerHand: [{ high: 3, low: 4 }, { high: 6, low: 6 }],
    correctTile: { high: 3, low: 4 },
    ...overrides,
  };
}

describe('verifyJourneyPuzzleAgainstEngine', () => {
  it('reports no issues for a puzzle whose correct tile is a legal play', () => {
    expect(verifyJourneyPuzzleAgainstEngine(makePuzzle())).toEqual([]);
  });

  it('flags a puzzle with no board/hand/correctTile as not interactive', () => {
    const issues = verifyJourneyPuzzleAgainstEngine(
      makePuzzle({ boardState: undefined, playerHand: undefined, correctTile: undefined }),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'missing_interactive_fields' }));
  });

  it('flags a correctTile that is not actually in the player hand', () => {
    const issues = verifyJourneyPuzzleAgainstEngine(
      makePuzzle({ correctTile: { high: 9, low: 9 } }),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'correct_tile_not_in_hand' }));
  });

  it('flags a correctTile that is in hand but not a legal move against the board', () => {
    // Board open ends are 3 and 5; a 6-6 tile matches neither.
    const issues = verifyJourneyPuzzleAgainstEngine(
      makePuzzle({
        playerHand: [{ high: 6, low: 6 }, { high: 1, low: 2 }],
        correctTile: { high: 6, low: 6 },
      }),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'correct_tile_illegal' }));
  });

  it('accepts a correctTile matching either open end, not just the first one checked', () => {
    // Board open ends are 3 and 5; 5-2 only matches the 5 end.
    const issues = verifyJourneyPuzzleAgainstEngine(
      makePuzzle({
        playerHand: [{ high: 5, low: 2 }, { high: 6, low: 6 }],
        correctTile: { high: 5, low: 2 },
      }),
    );
    expect(issues).toEqual([]);
  });

  it('confirms ch1-n03 is now engine-legal after the content fix', () => {
    // ch1-n03 is the one production puzzle with boardState populated today.
    // Its chain is [6,6]-[6,3]-[5,3]-[5,5]: both end tiles are doubles, so the
    // chain's genuine open ends are 6 and 5. It used to claim "3 and 5" and a
    // correctTile (3-4) that was not actually a legal move against this
    // board — this tool caught that. The content has since been corrected
    // (see the ch1-n03 content-fix PR) so this now asserts a clean bill of
    // health, guarding against the same class of bug recurring.
    const puzzle = JOURNEY_PUZZLES['ch1-n03'];
    expect(puzzle).toBeDefined();
    expect(puzzle.boardState).toBeDefined();
    expect(verifyJourneyPuzzleAgainstEngine(puzzle)).toEqual([]);
  });
});
