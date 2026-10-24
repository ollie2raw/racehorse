import { describe, expect, it } from 'vitest';
import { applyMove, getLegalMoves } from '../engine';
import type { GameState, Tile } from '../types';
import { DEFAULT_CONFIG } from '../types';

const t = (a: number, b: number): Tile => ({ low: Math.min(a, b), high: Math.max(a, b) });

/** Two players, locked boneyard, neither can play: the second pass blocks the hand. */
function blockedPassState(blockedHandRule: 'noScore' | 'lowestPips'): GameState {
  return {
    config: { ...DEFAULT_CONFIG, blockedHandRule, winningScore: 60 },
    playerIds: ['A', 'B'],
    players: { A: { id: 'A', hand: [t(1, 2)], score: 10 }, B: { id: 'B', hand: [t(0, 3)], score: 12 } },
    board: {
      mainLine: [
        { tile: t(4, 4), orientation: 'vertical-normal' },
        { tile: t(4, 5), orientation: 'horizontal-normal' },
      ],
      leftEnd: 4, rightEnd: 5, leftEndIsDouble: true, rightEndIsDouble: false,
      hubDoubles: [{ hubId: 0, laneType: 'mainline', laneRef: 'mainline', tileIndex: 0, mainlineIndex: 0, hubValue: 4, leftSideFilled: false, rightSideFilled: true, isCrossed: false, branches: [] }],
    },
    boneyard: [t(5, 6), t(6, 6)],
    deadTiles: [t(5, 6), t(6, 6)],
    currentPlayerIndex: 1,
    handNumber: 1, handOpen: true, handOver: false, gameOver: false, winnerId: null,
    consecutivePasses: 1, sequence: 40, handStarters: ['A'],
  };
}

describe('engine regressions found by the property suite', () => {
  it('E1: a blocked hand under blockedHandRule=noScore advances the sequence (it used to leave it unchanged)', () => {
    for (const rule of ['noScore', 'lowestPips'] as const) {
      const before = blockedPassState(rule);
      expect(getLegalMoves(before, 'B')).toEqual([{ type: 'pass' }]);
      const after = applyMove(before, 'B', { type: 'pass' }).state;
      expect(after.handOver).toBe(true);
      expect(after.sequence).toBe(before.sequence + 1); // exactly one increment, same contract for both rules
    }
  });

  it('the rule constants the oracle suite relies on are pinned to literals (the oracle must not inherit a wrong default)', () => {
    expect(DEFAULT_CONFIG).toMatchObject({
      maxPips: 6, tilesPerPlayer: 7, deadTileCount: 2, scoringMultiple: 5,
      blockedHandRule: 'lowestPips', endHandBonus: 'sumOpponentPenalties', winningScore: 60,
    });
  });
});
