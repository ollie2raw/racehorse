// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  chooseOfficialFritzDecision,
  chooseOfficialFritzDecisionForVersion,
} from '@racehorse/game-core';
import { createFixedBotHand } from './botEngine.ts';
import {
  chooseOfficialFritzBotChoice,
  toCoreGameState,
} from './gameCoreAdapter.ts';

describe('game-core browser adapter parity', () => {
  it('returns the same official Fritz move as the shared policy', () => {
    const state = createFixedBotHand(
      { you: 0, bot: 0 },
      1,
      60,
      7,
      {
        player_tiles: [{ low: 1, high: 1 }],
        fritz_tiles: [{ low: 6, high: 6 }, { low: 0, high: 5 }],
        boneyard: [],
        locked: [],
      },
      'bot',
    );
    const coreState = toCoreGameState(state);
    const shared = chooseOfficialFritzDecision({
      state: coreState,
      participantId: 'bot',
      tier: 'standard',
    });
    const adapted = chooseOfficialFritzBotChoice(state, 'standard');

    expect(shared.kind).toBe('play');
    expect(adapted?.move).toMatchObject({
      type: shared.kind,
      tile: shared.kind === 'play' ? shared.tile : undefined,
      position: shared.kind === 'play' ? shared.position : undefined,
    });
  });

  it('uses the attempt-pinned historical policy instead of the current wrapper', () => {
    const state = createFixedBotHand(
      { you: 0, bot: 0 },
      1,
      60,
      7,
      {
        player_tiles: [{ low: 1, high: 1 }],
        fritz_tiles: [{ low: 6, high: 6 }, { low: 0, high: 5 }],
        boneyard: [],
        locked: [],
      },
      'bot',
    );
    const shared = chooseOfficialFritzDecisionForVersion({
      version: 1,
      state: toCoreGameState(state),
      participantId: 'bot',
      tier: 'standard',
    });
    const adapted = chooseOfficialFritzBotChoice(state, 'standard', 1);
    expect(adapted?.move).toMatchObject({
      type: shared.kind,
      tile: shared.kind === 'play' ? shared.tile : undefined,
      position: shared.kind === 'play' ? shared.position : undefined,
    });
  });
});

describe('rule-override config forwarding', () => {
  const dealFixture = {
    player_tiles: [{ low: 1, high: 1 }],
    fritz_tiles: [{ low: 6, high: 6 }, { low: 0, high: 5 }],
    boneyard: [],
    locked: [],
  };

  it('forwards blockedHandRule, endHandBonus, and scoringMultiple overrides onto Config', () => {
    const state = createFixedBotHand({ you: 0, bot: 0 }, 1, 60, 7, dealFixture, 'you', {
      blockedHandRule: 'noScore',
      endHandBonus: 'none',
      scoringMultiple: 1,
    });
    const { config } = toCoreGameState(state);
    expect(config.blockedHandRule).toBe('noScore');
    expect(config.endHandBonus).toBe('none');
    expect(config.scoringMultiple).toBe(1);
  });

  it('defaults blockedHandRule, endHandBonus, and scoringMultiple when no override is given', () => {
    const state = createFixedBotHand({ you: 0, bot: 0 }, 1, 60, 7, dealFixture);
    const { config } = toCoreGameState(state);
    expect(config.blockedHandRule).toBe('lowestPips');
    expect(config.endHandBonus).toBe('sumOpponentPenalties');
    expect(config.scoringMultiple).toBe(5);
  });
});
