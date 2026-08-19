import { describe, expect, it } from 'vitest';
import { resolveDailyFritzClientNextAction } from './dailyFritzClientPhase';

describe('resolveDailyFritzClientNextAction', () => {
  it('returns start_set for a fresh attempt', () => {
    expect(resolveDailyFritzClientNextAction({
      attemptStatus: 'started',
      setResult: null,
      currentHandIndex: 0,
      hasResumeCheckpoint: false,
    })).toBe('start_set');
  });

  it('returns resume_hand when a checkpoint exists mid-hand', () => {
    expect(resolveDailyFritzClientNextAction({
      attemptStatus: 'started',
      setResult: { version: 2, format: 'best_of_3', playerGamesWon: 0, fritzGamesWon: 0, totalPointDiff: 0, games: [] },
      currentHandIndex: 2,
      hasResumeCheckpoint: true,
    })).toBe('resume_hand');
  });

  it('returns between_games after a game is recorded but the set continues', () => {
    expect(resolveDailyFritzClientNextAction({
      attemptStatus: 'started',
      setResult: {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 1,
        fritzGamesWon: 0,
        totalPointDiff: 10,
        games: [{
          gameNumber: 1,
          seed: 'seed',
          playerWon: true,
          playerScore: 60,
          fritzScore: 40,
          pointDiff: 20,
          movesUsed: 10,
          handsPlayed: 3,
          completedAt: '2026-08-18T00:00:00.000Z',
        }],
      },
      currentHandIndex: 0,
      hasResumeCheckpoint: false,
    })).toBe('between_games');
  });

  it('returns finalize_set when the set winner is decided', () => {
    expect(resolveDailyFritzClientNextAction({
      attemptStatus: 'started',
      setResult: {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 2,
        fritzGamesWon: 0,
        totalPointDiff: 20,
        setWinner: 'player',
        games: [],
      },
      needsCompletion: true,
      currentHandIndex: 0,
      hasResumeCheckpoint: false,
    })).toBe('finalize_set');
  });

  it('returns view_results for completed attempts', () => {
    expect(resolveDailyFritzClientNextAction({
      attemptStatus: 'completed',
      setResult: null,
      currentHandIndex: 0,
      hasResumeCheckpoint: false,
    })).toBe('view_results');
  });
});
