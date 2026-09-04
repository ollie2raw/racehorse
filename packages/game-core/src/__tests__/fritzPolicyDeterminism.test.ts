/**
 * GC-6 (HARDENING_PLAN §7.3): the policy-v3 strategic-score tie-break is a pure
 * UTF-16 code-unit comparison, so it is identical on every JS engine and under
 * every host locale — unlike v2's `String.localeCompare`, which had no locale
 * argument and was therefore host-dependent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONFIG,
  FRITZ_POLICY_VERSION,
  FRITZ_POLICY_MIN_SUPPORTED_VERSION,
  chooseOfficialFritzDecisionForVersion,
  compareCodeUnits,
  getFritzPolicyContract,
  type BoardState,
  type GameState,
  type Tile,
} from '../index';

function state(hand: Tile[], board: BoardState | null): GameState {
  return {
    config: DEFAULT_CONFIG,
    playerIds: ['player', 'fritz'],
    players: {
      player: { id: 'player', hand: [{ low: 1, high: 1 }], score: 0 },
      fritz: { id: 'fritz', hand, score: 0 },
    },
    board,
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 1,
    handNumber: 1,
    handOpen: board != null,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
}

describe('compareCodeUnits', () => {
  it('is a total order matching the JS default `<` / `>` on strings', () => {
    const samples = ['0|5@left', '1|4@left', '3|6@branch-0-0', '3|6@branch-0-1', '3|6@left', '3|6@right', 'pass'];
    for (const a of samples) {
      for (const b of samples) {
        const expected = a < b ? -1 : a > b ? 1 : 0;
        expect(Math.sign(compareCodeUnits(a, b))).toBe(expected);
      }
    }
  });
});

describe('policy v3 = code-unit canonical ties', () => {
  it('names the v3 contract and keeps v1 supported', () => {
    expect(FRITZ_POLICY_VERSION).toBe(3);
    expect(FRITZ_POLICY_MIN_SUPPORTED_VERSION).toBe(1);
    expect(getFritzPolicyContract(3)).toBe('fritz-policy-v3-code-unit-canonical-ties');
    expect(getFritzPolicyContract(2)).toBe('fritz-policy-v2-deterministic-canonical-ties');
  });

  afterEach(() => vi.restoreAllMocks());

  it('the v3 Fritz decision does not depend on String.localeCompare', () => {
    // A crossed-hub board with two equivalent open ends → tied strategic plays.
    const board: BoardState = {
      mainLine: [
        { tile: { low: 3, high: 3 }, orientation: 'vertical-normal' },
        { tile: { low: 3, high: 5 }, orientation: 'horizontal-normal' },
      ],
      leftEnd: 3,
      rightEnd: 5,
      leftEndIsDouble: true,
      rightEndIsDouble: false,
      hubDoubles: [{
        hubId: 0,
        laneType: 'mainline',
        laneRef: 'mainline',
        tileIndex: 0,
        mainlineIndex: 0,
        hubValue: 3,
        isCrossed: true,
        leftSideFilled: true,
        rightSideFilled: true,
        branches: [],
      }],
    };
    const game = state([{ low: 3, high: 4 }, { low: 3, high: 6 }], board);
    const input = { version: FRITZ_POLICY_VERSION, state: game, participantId: 'fritz', tier: 'elite' } as const;

    const baseline = chooseOfficialFritzDecisionForVersion(input);

    // Sabotage localeCompare — reverse its result. If the policy still consulted
    // it, the tie-break (and the chosen move) would flip.
    const spy = vi
      .spyOn(String.prototype, 'localeCompare')
      .mockImplementation(function (this: string, that: string) {
        return that < this ? -1 : that > this ? 1 : 0;
      });

    const sabotaged = chooseOfficialFritzDecisionForVersion(input);
    expect(sabotaged).toEqual(baseline);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is a stable golden vector', () => {
    const game = state([{ low: 0, high: 5 }, { low: 1, high: 4 }], null);
    expect(chooseOfficialFritzDecisionForVersion({
      version: 3, state: game, participantId: 'fritz', tier: 'elite',
    })).toEqual({ kind: 'play', tile: { low: 0, high: 5 }, position: 'left' });
  });
});
