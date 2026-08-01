import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  getDailyFritzAuthorityStateDigest,
  type GameState,
} from '../index';

function authorityState(playerIds: readonly [string, string]): GameState {
  return {
    config: DEFAULT_CONFIG,
    playerIds,
    players: {
      [playerIds[0]]: { id: playerIds[0], hand: [{ low: 2, high: 4 }, { low: 1, high: 1 }], score: 10 },
      [playerIds[1]]: { id: playerIds[1], hand: [{ low: 2, high: 2 }], score: 5 },
    },
    board: null,
    boneyard: [{ low: 0, high: 6 }],
    deadTiles: [{ low: 0, high: 0 }],
    currentPlayerIndex: 1,
    handNumber: 1,
    handOpen: false,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 23,
    handStarters: [playerIds[0]],
  };
}

describe('Daily Fritz authority state digest', () => {
  it('is independent of client/server participant IDs', () => {
    expect(getDailyFritzAuthorityStateDigest(authorityState(['you', 'bot'])))
      .toBe(getDailyFritzAuthorityStateDigest(authorityState(['player', 'fritz'])));
  });

  it('changes when policy-relevant state changes', () => {
    const initial = authorityState(['player', 'fritz']);
    expect(getDailyFritzAuthorityStateDigest(initial)).not.toBe(
      getDailyFritzAuthorityStateDigest({ ...initial, sequence: initial.sequence + 1 }),
    );
  });

  it('ignores starter-history metadata that does not affect a Fritz decision', () => {
    const initial = authorityState(['player', 'fritz']);
    expect(getDailyFritzAuthorityStateDigest(initial)).toBe(
      getDailyFritzAuthorityStateDigest({ ...initial, handStarters: ['fritz'] }),
    );
  });
});
