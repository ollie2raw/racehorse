import { describe, expect, it } from 'vitest';
import { passTurn, type BotMatchState } from '../match/runtime/botEngine.ts';
import {
  isDailyFritzLockedBoneyardNoMove,
  resolveDailyFritzBlockedHandPass,
} from './dailyFritzBlockedHand.ts';

const t = (low: number, high: number) => ({ low, high });

/** Player 1-1 vs Fritz 2-2 on 6-6 ends: both stuck, locked boneyard. */
function makeLockedStuckMatch(overrides: Partial<BotMatchState> = {}): BotMatchState {
  return {
    players: {
      you: { hand: [t(1, 1)], score: 10 },
      bot: { hand: [t(2, 2)], score: 12 },
    },
    board: {
      mainLine: [{ tile: t(6, 6), orientation: 'horizontal-normal' }],
      leftEnd: 6,
      rightEnd: 6,
      leftEndIsDouble: true,
      rightEndIsDouble: true,
      hubDoubles: [],
    },
    boneyard: [t(4, 5), t(5, 5)],
    deadTiles: [t(4, 5), t(5, 5)],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 2,
    turnIndex: 4,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 61,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
    ...overrides,
  };
}

describe('isDailyFritzLockedBoneyardNoMove', () => {
  it('is false when the boneyard still has live tiles', () => {
    const match = makeLockedStuckMatch({
      boneyard: [t(0, 3), t(4, 5), t(5, 5)],
      deadTiles: [t(4, 5), t(5, 5)],
    });
    expect(isDailyFritzLockedBoneyardNoMove(match)).toBe(false);
  });

  it('is true when boneyard is locked and both players have no legal moves', () => {
    expect(isDailyFritzLockedBoneyardNoMove(makeLockedStuckMatch())).toBe(true);
  });
});

describe('resolveDailyFritzBlockedHandPass', () => {
  it('does not invent a prior Fritz pass when consecutivePasses is 0', () => {
    const match = makeLockedStuckMatch({ consecutivePasses: 0 });
    const playerOnly = passTurn(match, 'you');
    expect(playerOnly.state.handOver).toBe(false);

    const resolution = resolveDailyFritzBlockedHandPass(match);
    expect(resolution.passes.map((pass) => pass.player)).toEqual(['you', 'bot']);
    expect(resolution.result.state.handOver).toBe(true);
    expect(resolution.result.handEnded?.reason).toBe('blocked');

    const honest = passTurn(playerOnly.state, 'bot');
    expect(honest.state.handOver).toBe(true);
    expect(resolution.result.state.players.you.score).toBe(honest.state.players.you.score);
    expect(resolution.result.state.players.bot.score).toBe(honest.state.players.bot.score);
  });

  it('only records the player pass when Fritz already passed', () => {
    const match = makeLockedStuckMatch({ consecutivePasses: 1 });
    const resolution = resolveDailyFritzBlockedHandPass(match);
    expect(resolution.passes.map((pass) => pass.player)).toEqual(['you']);
    expect(resolution.result.state.handOver).toBe(true);
    expect(resolution.result.handEnded?.reason).toBe('blocked');
  });
});
