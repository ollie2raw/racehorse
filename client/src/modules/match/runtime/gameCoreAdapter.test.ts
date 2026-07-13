import { describe, expect, it } from 'vitest';
import {
  chooseOfficialFritzDecision,
  createDeterministicRandom,
  getOfficialFritzDecisionSeed,
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
      random: createDeterministicRandom(getOfficialFritzDecisionSeed(coreState)),
    });
    const adapted = chooseOfficialFritzBotChoice(state, 'standard');

    expect(shared.kind).toBe('play');
    expect(adapted?.move).toMatchObject({
      type: shared.kind,
      tile: shared.kind === 'play' ? shared.tile : undefined,
      position: shared.kind === 'play' ? shared.position : undefined,
    });
  });
});
