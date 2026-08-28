import { describe, it, expect } from 'vitest';
import { describeSetStory } from './setStory';
import type { DailyFritzLeaderboardRow } from './api';

type Game = NonNullable<DailyFritzLeaderboardRow['games']>[number];

function game(over: Partial<Game> & Pick<Game, 'gameNumber' | 'playerWon'>): Game {
  return {
    playerScore: over.playerWon ? 60 : 40,
    fritzScore: over.playerWon ? 40 : 60,
    pointDiff: over.playerWon ? 20 : -20,
    ...over,
  } as Game;
}

describe('describeSetStory', () => {
  it('calls a 2-0 win a clean sweep', () => {
    expect(
      describeSetStory({
        won: true,
        finalScore: 2,
        opponentScore: 0,
        games: [game({ gameNumber: 1, playerWon: true }), game({ gameNumber: 2, playerWon: true })],
      }),
    ).toEqual({ label: 'Clean sweep', tone: 'neutral' });
  });

  it('calls a 2-1 win the decider', () => {
    expect(
      describeSetStory({ won: true, finalScore: 2, opponentScore: 1, games: [] }).label,
    ).toBe('Won the decider');
  });

  it('calls a 1-2 loss going the distance', () => {
    expect(
      describeSetStory({ won: false, finalScore: 1, opponentScore: 2, games: [] }).label,
    ).toBe('Went the distance');
  });

  it('calls a 0-2 loss a sweep by Fritz', () => {
    expect(
      describeSetStory({ won: false, finalScore: 0, opponentScore: 2, games: [] }).label,
    ).toBe('Swept by Fritz');
  });

  it('promotes a winning skunk over the sweep wording', () => {
    expect(
      describeSetStory({
        won: true,
        finalScore: 2,
        opponentScore: 0,
        games: [
          game({ gameNumber: 1, playerWon: true }),
          game({ gameNumber: 2, playerWon: true, fritzScore: 12, skunk: true, skunkBy: 'player' }),
        ],
      }),
    ).toEqual({ label: 'Skunk finish', tone: 'skunk' });
  });

  it('promotes a losing skunk over the sweep wording', () => {
    expect(
      describeSetStory({
        won: false,
        finalScore: 0,
        opponentScore: 2,
        games: [
          game({ gameNumber: 1, playerWon: false, playerScore: 0, skunk: true, skunkBy: 'fritz' }),
        ],
      }),
    ).toEqual({ label: 'Skunked by Fritz', tone: 'skunked' });
  });

  it('ignores a skunk that runs against the set result', () => {
    // Skunked in game 1, then won the set: the skunk is not this racer's story.
    expect(
      describeSetStory({
        won: true,
        finalScore: 2,
        opponentScore: 1,
        games: [
          game({ gameNumber: 1, playerWon: false, playerScore: 8, skunk: true, skunkBy: 'fritz' }),
          game({ gameNumber: 2, playerWon: true }),
          game({ gameNumber: 3, playerWon: true }),
        ],
      }).label,
    ).toBe('Won the decider');
  });

  it('infers the skunk side from the game winner when skunkBy is absent', () => {
    expect(
      describeSetStory({
        won: true,
        finalScore: 2,
        opponentScore: 0,
        games: [game({ gameNumber: 1, playerWon: true, fritzScore: 4, skunk: true })],
      }).tone,
    ).toBe('skunk');
  });
});
