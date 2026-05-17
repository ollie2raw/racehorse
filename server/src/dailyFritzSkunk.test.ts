import { describe, expect, it } from 'vitest';
import {
  appendDailyFritzGameToSet,
  getDailyFritzSkunkLossRank,
  getDailyFritzSkunkWinRank,
  isDailyFritzSkunk,
} from './dailyFritzSkunk';
import type { DailyFritzSetResult } from './dailyFritz';

function emptySet(): DailyFritzSetResult {
  return {
    version: 2,
    format: 'best_of_3',
    playerGamesWon: 0,
    fritzGamesWon: 0,
    totalPointDiff: 0,
    games: [],
  };
}

function recordGame(
  set: DailyFritzSetResult,
  gameNumber: 1 | 2 | 3,
  playerScore: number,
  fritzScore: number,
): DailyFritzSetResult {
  return appendDailyFritzGameToSet(set, {
    gameNumber,
    seed: `seed-${gameNumber}`,
    playerWon: playerScore > fritzScore,
    playerScore,
    fritzScore,
    pointDiff: playerScore - fritzScore,
    completedAt: new Date().toISOString(),
  });
}

describe('isDailyFritzSkunk', () => {
  it('treats 29 or below as skunk and 30+ as not skunk', () => {
    expect(isDailyFritzSkunk(29)).toBe(true);
    expect(isDailyFritzSkunk(30)).toBe(false);
    expect(isDailyFritzSkunk(0)).toBe(true);
  });
});

describe('Game 1 instant skunk', () => {
  it('ends the set 2-0 when the player skunks Fritz in game 1', () => {
    const result = recordGame(emptySet(), 1, 60, 24);
    expect(result.setWinner).toBe('player');
    expect(result.playerGamesWon).toBe(2);
    expect(result.fritzGamesWon).toBe(0);
    expect(result.instantSkunk).toBe(true);
    expect(result.games).toHaveLength(1);
    expect(result.games[0]?.skunk).toBe(true);
  });

  it('ends the set 0-2 when Fritz skunks the player in game 1', () => {
    const result = recordGame(emptySet(), 1, 24, 60);
    expect(result.setWinner).toBe('fritz');
    expect(result.playerGamesWon).toBe(0);
    expect(result.fritzGamesWon).toBe(2);
    expect(result.instantSkunk).toBe(true);
    expect(result.skunkBy).toBe('fritz');
  });
});

describe('Game 2 and 3 skunk', () => {
  it('does not inflate set score when game 2 is a skunk finish', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    expect(set.setWinner).toBeUndefined();
    set = recordGame(set, 2, 60, 18);
    expect(set.setWinner).toBe('player');
    expect(set.playerGamesWon).toBe(2);
    expect(set.fritzGamesWon).toBe(0);
    expect(set.instantSkunk).toBe(false);
    expect(set.skunkGameNumber).toBe(2);
    expect(set.games).toHaveLength(2);
  });

  it('keeps the set alive at 1-1 when game 2 is a skunk after losing game 1', () => {
    let set = recordGame(emptySet(), 1, 40, 60);
    set = recordGame(set, 2, 60, 20);
    expect(set.setWinner).toBeUndefined();
    expect(set.playerGamesWon).toBe(1);
    expect(set.fritzGamesWon).toBe(1);
    expect(set.skunkGameNumber).toBe(2);
  });

  it('does not inflate set score on a game 3 decider skunk', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    set = recordGame(set, 2, 40, 60);
    set = recordGame(set, 3, 60, 22);
    expect(set.setWinner).toBe('player');
    expect(set.playerGamesWon).toBe(2);
    expect(set.fritzGamesWon).toBe(1);
    expect(set.skunkGameNumber).toBe(3);
  });
});

describe('skunk leaderboard ranks', () => {
  it('ranks game 1 player skunk above a normal 2-0 win', () => {
    const g1Skunk = recordGame(emptySet(), 1, 60, 20);
    let normal = recordGame(emptySet(), 1, 60, 45);
    normal = recordGame(normal, 2, 60, 40);
    expect(getDailyFritzSkunkWinRank(g1Skunk)).toBeGreaterThan(getDailyFritzSkunkWinRank(normal));
  });

  it('ranks normal 2-0 above a 2-1 decider skunk', () => {
    let normal = recordGame(emptySet(), 1, 60, 45);
    normal = recordGame(normal, 2, 60, 40);
    let deciderSkunk = recordGame(emptySet(), 1, 60, 45);
    deciderSkunk = recordGame(deciderSkunk, 2, 40, 60);
    deciderSkunk = recordGame(deciderSkunk, 3, 60, 22);
    expect(getDailyFritzSkunkWinRank(normal)).toBeGreaterThan(getDailyFritzSkunkWinRank(deciderSkunk));
  });

  it('ranks a normal 0-2 loss above a game 1 skunk loss', () => {
    const skunked = recordGame(emptySet(), 1, 20, 60);
    let normal = recordGame(emptySet(), 1, 40, 60);
    normal = recordGame(normal, 2, 35, 60);
    expect(getDailyFritzSkunkLossRank(normal)).toBeGreaterThan(getDailyFritzSkunkLossRank(skunked));
  });
});
