import { describe, it, expect } from 'vitest';
import { evaluateContract, evaluateContractWithOffer } from './stakesEconomy';
import type { TableOffer } from './stakesEconomy';

describe('Stakes Contracts Evaluator', () => {
  const dummyResult = {
    won: true,
    scoreMargin: 10,
    youGoOut: true,
    botPassCount: 1,
    youScoreFirst: true,
    youScore: 25,
    botScore: 15,
  };

  describe('FIRST BLOOD', () => {
    it('should complete when player scores first', () => {
      const res = { ...dummyResult, youScoreFirst: true };
      expect(evaluateContract('firstBlood', res)).toBe(true);
    });

    it('should fail when bot scores first', () => {
      const res = { ...dummyResult, youScoreFirst: false };
      expect(evaluateContract('firstBlood', res)).toBe(false);
    });

    it('should fail if no one scores during the play and player loses the hand', () => {
      const res = { ...dummyResult, won: false, youScoreFirst: false };
      expect(evaluateContract('firstBlood', res)).toBe(false);
    });
  });

  describe('FORCE THE PASS', () => {
    it('should require 1 pass for Stage 1', () => {
      const offer: TableOffer = {
        id: 's1_risky',
        rival: 'grinder',
        rivalLabel: 'The Grinder',
        difficulty: 'standard',
        policyProfile: 'blocking',
        entry: 100,
        baseReturn: 220,
        contract: 'forcePass',
        contractLabel: 'Force 1 Pass',
        contractBonus: 50,
        riskLabel: 'Medium',
        description: '',
      };
      
      const resPass1 = { ...dummyResult, botPassCount: 1 };
      const resPass0 = { ...dummyResult, botPassCount: 0 };

      expect(evaluateContractWithOffer(offer, resPass1)).toBe(true);
      expect(evaluateContractWithOffer(offer, resPass0)).toBe(false);
    });

    it('should require 2 passes for Stage 2', () => {
      const offer: TableOffer = {
        id: 's2_safe',
        rival: 'grinder',
        rivalLabel: 'The Grinder',
        difficulty: 'elite',
        policyProfile: 'blocking',
        entry: 130,
        baseReturn: 280,
        contract: 'forcePass',
        contractLabel: 'Force 2 Passes',
        contractBonus: 70,
        riskLabel: 'Medium',
        description: '',
      };

      const resPass1 = { ...dummyResult, botPassCount: 1 };
      const resPass2 = { ...dummyResult, botPassCount: 2 };

      expect(evaluateContractWithOffer(offer, resPass1)).toBe(false);
      expect(evaluateContractWithOffer(offer, resPass2)).toBe(true);
    });
  });

  describe('CLOSE THE HAND', () => {
    it('should succeed when player goes out', () => {
      const res = { ...dummyResult, youGoOut: true };
      expect(evaluateContract('closeHand', res)).toBe(true);
    });

    it('should fail when match ends by blocked hand', () => {
      const res = { ...dummyResult, youGoOut: false };
      expect(evaluateContract('closeHand', res)).toBe(false);
    });
  });

  describe('MARGIN CALL (+15)', () => {
    it('should succeed when player margin is >= 15', () => {
      expect(evaluateContract('marginCall', { ...dummyResult, scoreMargin: 14 })).toBe(false);
      expect(evaluateContract('marginCall', { ...dummyResult, scoreMargin: 15 })).toBe(true);
      expect(evaluateContract('marginCall', { ...dummyResult, scoreMargin: 20 })).toBe(true);
    });

    it('should fail when player loses match (negative margin)', () => {
      expect(evaluateContract('marginCall', { ...dummyResult, won: false, scoreMargin: -5 })).toBe(false);
    });
  });
});
