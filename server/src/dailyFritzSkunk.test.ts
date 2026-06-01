import { describe, expect, it } from 'vitest';
/**
 * Daily Fritz skunk tests — canonical scenarios in docs/daily-fritz-skunk-source-of-truth.md
 */
import {
  appendDailyFritzGameToSet,
  getDailyFritzSkunkLossRank,
  getDailyFritzSkunkWinRank,
  isDailyFritzSkunk,
  resolveDailyFritzSetWinnerFromGames,
  resolveGame2SkunkSetWinner,
  type DailyFritzSetWinner,
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

function expectSetWinner(
  setWinner: DailyFritzSetResult['setWinner'],
  expected: DailyFritzSetWinner,
): void {
  expect(setWinner).toBe(expected);
  if (setWinner !== undefined) {
    expect(['player', 'fritz'] as const).toContain(setWinner);
  }
}

describe('isDailyFritzSkunk', () => {
  it('treats 29 or below as skunk and 30+ as not skunk', () => {
    expect(isDailyFritzSkunk(29)).toBe(true);
    expect(isDailyFritzSkunk(30)).toBe(false);
    expect(isDailyFritzSkunk(0)).toBe(true);
  });
});

describe('source of truth — mechanical skunk (games 1–2)', () => {
  it('game 1 player skunk ends the set 2–0 immediately', () => {
    const result = recordGame(emptySet(), 1, 60, 24);
    expectSetWinner(result.setWinner, 'player');
    expect(result.playerGamesWon).toBe(2);
    expect(result.fritzGamesWon).toBe(0);
    expect(result.instantSkunk).toBe(true);
    expect(result.games[0]?.skunk).toBe(true);
  });

  it('game 1 Fritz skunk ends the set 0–2 immediately', () => {
    const result = recordGame(emptySet(), 1, 24, 60);
    expectSetWinner(result.setWinner, 'fritz');
    expect(result.playerGamesWon).toBe(0);
    expect(result.fritzGamesWon).toBe(2);
    expect(result.instantSkunk).toBe(true);
    expect(result.skunkBy).toBe('fritz');
  });

  it('player wins game 1, then skunks Fritz in game 2 → player wins set 2–0', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    set = recordGame(set, 2, 60, 18);
    expectSetWinner(set.setWinner, 'player');
    expect(set.playerGamesWon).toBe(2);
    expect(set.fritzGamesWon).toBe(0);
    expect(set.skunkGameNumber).toBe(2);
    expect(set.skunkBy).toBe('player');
    expect(set.instantSkunk).toBe(false);
  });

  it('player loses game 1, then skunks Fritz in game 2 → player wins full set at 1–1', () => {
    let set = recordGame(emptySet(), 1, 40, 60);
    set = recordGame(set, 2, 60, 20);
    expectSetWinner(set.setWinner, 'player');
    expect(set.playerGamesWon).toBe(1);
    expect(set.fritzGamesWon).toBe(1);
    expect(set.skunkGameNumber).toBe(2);
    expect(set.skunkBy).toBe('player');
  });

  it('player wins game 1, then Fritz skunks player in game 2 → Fritz wins full set immediately', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    set = recordGame(set, 2, 20, 60);
    expectSetWinner(set.setWinner, 'fritz');
    expect(set.playerGamesWon).toBe(1);
    expect(set.fritzGamesWon).toBe(1);
    expect(set.skunkGameNumber).toBe(2);
    expect(set.skunkBy).toBe('fritz');
    expect(set.games[1]?.skunk).toBe(true);
    expect(set.instantSkunk).toBe(false);
  });

  it('Fritz wins game 1, then skunks player in game 2 → Fritz wins set 0–2', () => {
    let set = recordGame(emptySet(), 1, 40, 60);
    set = recordGame(set, 2, 18, 60);
    expectSetWinner(set.setWinner, 'fritz');
    expect(set.playerGamesWon).toBe(0);
    expect(set.fritzGamesWon).toBe(2);
    expect(set.skunkGameNumber).toBe(2);
    expect(set.skunkBy).toBe('fritz');
  });

  it('does not skunk when the loser reaches 30 (game 1 or game 2)', () => {
    const g1 = recordGame(emptySet(), 1, 60, 30);
    expect(g1.games[0]?.skunk).toBe(false);
    expect(g1.hasSkunk).toBe(false);

    let g2 = recordGame(emptySet(), 1, 60, 45);
    g2 = recordGame(g2, 2, 60, 30);
    expect(g2.games[1]?.skunk).toBe(false);
    expect(g2.hasSkunk).toBe(false);
    expectSetWinner(g2.setWinner, 'player');
  });
});

describe('source of truth — game 3 skunk is metadata only', () => {
  it('records skunk on game 3 but does not instant-win or inflate game counts', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    set = recordGame(set, 2, 40, 60);
    expect(set.setWinner).toBeUndefined();
    set = recordGame(set, 3, 60, 22);
    expectSetWinner(set.setWinner, 'player');
    expect(set.playerGamesWon).toBe(2);
    expect(set.fritzGamesWon).toBe(1);
    expect(set.instantSkunk).toBe(false);
    expect(set.skunkGameNumber).toBe(3);
    expect(set.games[2]?.skunk).toBe(true);
    expect(set.games[2]?.skunkBy).toBe('player');
  });

  it('still detects game 3 skunk when Fritz wins the decider under 30', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    set = recordGame(set, 2, 40, 60);
    set = recordGame(set, 3, 22, 60);
    expectSetWinner(set.setWinner, 'fritz');
    expect(set.games[2]?.skunk).toBe(true);
    expect(set.games[2]?.skunkBy).toBe('fritz');
    expect(set.instantSkunk).toBe(false);
  });
});

describe('Game 1 instant skunk', () => {
  it('ends the set 2-0 when the player skunks Fritz in game 1', () => {
    const result = recordGame(emptySet(), 1, 60, 24);
    expectSetWinner(result.setWinner, 'player');
    expect(result.playerGamesWon).toBe(2);
    expect(result.fritzGamesWon).toBe(0);
    expect(result.instantSkunk).toBe(true);
    expect(result.games).toHaveLength(1);
    expect(result.games[0]?.skunk).toBe(true);
    expect(result.skunkBy).toBe('player');
  });

  it('ends the set 0-2 when Fritz skunks the player in game 1', () => {
    const result = recordGame(emptySet(), 1, 24, 60);
    expectSetWinner(result.setWinner, 'fritz');
    expect(result.playerGamesWon).toBe(0);
    expect(result.fritzGamesWon).toBe(2);
    expect(result.instantSkunk).toBe(true);
    expect(result.skunkBy).toBe('fritz');
  });

  it('does not skunk when the loser reaches 30', () => {
    const result = recordGame(emptySet(), 1, 60, 30);
    expect(result.setWinner).toBeUndefined();
    expect(result.playerGamesWon).toBe(1);
    expect(result.fritzGamesWon).toBe(0);
    expect(result.instantSkunk).toBe(false);
    expect(result.games[0]?.skunk).toBe(false);
    expect(result.hasSkunk).toBe(false);
  });
});

describe('Game 2 and 3 skunk', () => {
  it('ends the set when the player skunks Fritz in game 2 after winning game 1', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    expect(set.setWinner).toBeUndefined();
    set = recordGame(set, 2, 60, 18);
    expectSetWinner(set.setWinner, 'player');
    expect(set.playerGamesWon).toBe(2);
    expect(set.fritzGamesWon).toBe(0);
    expect(set.instantSkunk).toBe(false);
    expect(set.skunkGameNumber).toBe(2);
    expect(set.skunkBy).toBe('player');
    expect(set.games).toHaveLength(2);
  });

  it('ends the set when the player skunks Fritz in game 2 after losing game 1', () => {
    let set = recordGame(emptySet(), 1, 40, 60);
    set = recordGame(set, 2, 60, 20);
    expectSetWinner(set.setWinner, 'player');
    expect(set.playerGamesWon).toBe(1);
    expect(set.fritzGamesWon).toBe(1);
    expect(set.skunkGameNumber).toBe(2);
    expect(set.skunkBy).toBe('player');
    expect(set.games).toHaveLength(2);
  });

  it('ends the set when Fritz skunks the player in game 2 after the player won game 1', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    set = recordGame(set, 2, 20, 60);
    expectSetWinner(set.setWinner, 'fritz');
    expect(set.playerGamesWon).toBe(1);
    expect(set.fritzGamesWon).toBe(1);
    expect(set.skunkGameNumber).toBe(2);
    expect(set.skunkBy).toBe('fritz');
    expect(set.games).toHaveLength(2);
  });

  it('does not skunk in game 2 when the loser reaches 30', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    set = recordGame(set, 2, 60, 30);
    expectSetWinner(set.setWinner, 'player');
    expect(set.playerGamesWon).toBe(2);
    expect(set.games[1]?.skunk).toBe(false);
    expect(set.hasSkunk).toBe(false);
    expect(set.instantSkunk).toBe(false);
  });

  it('still goes to game 3 when game 2 is not a skunk at 1-1', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    set = recordGame(set, 2, 40, 60);
    expect(set.setWinner).toBeUndefined();
    expect(set.playerGamesWon).toBe(1);
    expect(set.fritzGamesWon).toBe(1);
    expect(set.games).toHaveLength(2);
  });

  it('does not instant-win the set on a game 3 decider skunk', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    set = recordGame(set, 2, 40, 60);
    set = recordGame(set, 3, 60, 22);
    expectSetWinner(set.setWinner, 'player');
    expect(set.playerGamesWon).toBe(2);
    expect(set.fritzGamesWon).toBe(1);
    expect(set.instantSkunk).toBe(false);
    expect(set.skunkGameNumber).toBe(3);
    expect(set.games[2]?.skunk).toBe(true);
  });
});

describe('non-skunk game flow', () => {
  it('counts a normal game 1 win as one game only', () => {
    const result = recordGame(emptySet(), 1, 60, 45);
    expect(result.setWinner).toBeUndefined();
    expect(result.playerGamesWon).toBe(1);
    expect(result.fritzGamesWon).toBe(0);
    expect(result.games[0]?.skunk).toBe(false);
  });

  it('resolves a normal 2-0 set without skunk metadata', () => {
    let set = recordGame(emptySet(), 1, 60, 45);
    set = recordGame(set, 2, 55, 40);
    expectSetWinner(set.setWinner, 'player');
    expect(set.playerGamesWon).toBe(2);
    expect(set.hasSkunk).toBe(false);
    expect(set.instantSkunk).toBe(false);
  });
});

describe('set winner helpers', () => {
  it('resolveDailyFritzSetWinnerFromGames returns the correct union', () => {
    expect(resolveDailyFritzSetWinnerFromGames(2, 0)).toBe('player');
    expect(resolveDailyFritzSetWinnerFromGames(0, 2)).toBe('fritz');
    expect(resolveDailyFritzSetWinnerFromGames(1, 1)).toBeUndefined();
  });

  it('resolveGame2SkunkSetWinner only applies on a 1-1 game 2 skunk', () => {
    expect(
      resolveGame2SkunkSetWinner(2, true, 2, 1, 1, true),
    ).toBe('player');
    expect(
      resolveGame2SkunkSetWinner(2, true, 2, 1, 1, false),
    ).toBe('fritz');
    expect(
      resolveGame2SkunkSetWinner(3, true, 3, 2, 1, true),
    ).toBeUndefined();
    expect(
      resolveGame2SkunkSetWinner(2, false, 2, 1, 1, true),
    ).toBeUndefined();
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
