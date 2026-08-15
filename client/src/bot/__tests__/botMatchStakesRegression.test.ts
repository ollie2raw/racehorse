import { describe, it, expect } from 'vitest';
import { chooseBotMove } from '../botHeuristics';

function mkBoard(left: number, right: number) {
  return {
    mainLine: [
      {
        tile: { low: Math.min(left, right), high: Math.max(left, right) },
        orientation: 'horizontal-normal' as const,
      },
    ],
    leftEnd: left,
    rightEnd: right,
    leftEndIsDouble: left === right,
    rightEndIsDouble: left === right,
    hubDoubles: [],
  };
}

describe('Bot Match & Stakes Regression Audit', () => {
  it('default policy should preserve normal bot move scoring path exactly', () => {
    // Construct a dummy BotVisibleState
    const dummyState: any = {
      handNumber: 1,
      currentPlayer: 'bot',
      dealSize: 7,
      winningScore: 60,
      handOpen: true,
      handOver: false,
      gameOver: false,
      winnerId: null,
      players: {
        you: { score: 10, hand: [{ low: 1, high: 1 }] },
        bot: { score: 5, hand: [] },
      },
      board: mkBoard(1, 1),
      boneyard: [],
      deadTiles: [],
      boneyardCount: 10,
      config: {
        winningScore: 60,
      },
    };

    // Evaluate without policyProfile
    const choiceNoProfile = chooseBotMove(dummyState, 'standard');

    // Evaluate with policyProfile = undefined
    const choiceUndefined = chooseBotMove({
      ...dummyState,
      config: { ...dummyState.config, policyProfile: undefined },
    }, 'standard');

    // Evaluate with policyProfile = 'default'
    const choiceDefault = chooseBotMove({
      ...dummyState,
      config: { ...dummyState.config, policyProfile: 'default' },
    }, 'standard');

    expect(choiceNoProfile).toEqual(choiceUndefined);
    expect(choiceUndefined).toEqual(choiceDefault);
  });

  it('Stakes profile state must not leak between matches', () => {
    const stateWithStakesProfile: any = {
      handNumber: 1,
      currentPlayer: 'bot',
      dealSize: 7,
      winningScore: 60,
      handOpen: true,
      handOver: false,
      gameOver: false,
      winnerId: null,
      players: {
        you: { score: 0, hand: [{ low: 5, high: 5 }] },
        bot: { score: 0, hand: [{ low: 5, high: 5 }] },
      },
      board: mkBoard(5, 5),
      boneyard: [],
      deadTiles: [],
      boneyardCount: 10,
      config: { policyProfile: 'scoring' },
    };

    const stateNormal: any = {
      handNumber: 1,
      currentPlayer: 'bot',
      dealSize: 7,
      winningScore: 60,
      handOpen: true,
      handOver: false,
      gameOver: false,
      winnerId: null,
      players: {
        you: { score: 0, hand: [{ low: 5, high: 5 }] },
        bot: { score: 0, hand: [{ low: 5, high: 5 }] },
      },
      board: mkBoard(5, 5),
      boneyard: [],
      deadTiles: [],
      boneyardCount: 10,
      config: { policyProfile: undefined },
    };

    const choiceStakes = chooseBotMove(stateWithStakesProfile, 'standard');
    const choiceNormal = chooseBotMove(stateNormal, 'standard');

    expect(choiceStakes).not.toBeNull();
    expect(choiceNormal).not.toBeNull();
    expect(stateNormal.config.policyProfile).toBeUndefined();
    expect(stateWithStakesProfile.config.policyProfile).toBe('scoring');
  });
});
