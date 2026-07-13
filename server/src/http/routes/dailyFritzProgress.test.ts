import { describe, expect, it } from 'vitest';
import { readActiveGameProgress, writeActiveGameProgress } from './dailyFritz';

describe('Daily Fritz active-game score persistence', () => {
  it('round-trips cumulative scores without disturbing set result fields', () => {
    const stored=writeActiveGameProgress({version:2,games:[]},{gameNumber:1,you:35,fritz:20});
    expect(readActiveGameProgress(stored,1)).toEqual({gameNumber:1,you:35,fritz:20});
    expect(stored.games).toEqual([]);
  });
  it('does not transfer scores into another game', () => {
    const stored=writeActiveGameProgress(null,{gameNumber:1,you:35,fritz:20});
    expect(readActiveGameProgress(stored,2)).toEqual({gameNumber:2,you:0,fritz:0});
  });
  it('fails closed on malformed score metadata', () => {
    expect(readActiveGameProgress({active_game:{game_number:1,you:-1,fritz:'bad'}},1)).toEqual({gameNumber:1,you:0,fritz:0});
  });
});
