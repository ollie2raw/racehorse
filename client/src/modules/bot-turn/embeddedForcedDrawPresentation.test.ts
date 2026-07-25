import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBotMatch, type BotMatchState } from '../match/runtime/botEngine.ts';
import {
  handWithoutTiles,
  listEmbeddedForcedDrawTiles,
  presentEmbeddedForcedDraws,
} from './embeddedForcedDrawPresentation.ts';

function baseState(): BotMatchState {
  return createBotMatch(60, 7);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('listEmbeddedForcedDrawTiles', () => {
  it('reads forced draws from the front of the pre-play boneyard', () => {
    const before = baseState();
    before.boneyard = [
      { low: 1, high: 3 },
      { low: 2, high: 4 },
      { low: 0, high: 0 },
    ];
    const after: BotMatchState = {
      ...before,
      boneyard: [{ low: 0, high: 0 }],
      players: {
        ...before.players,
        bot: {
          ...before.players.bot,
          hand: [...before.players.bot.hand, { low: 1, high: 3 }, { low: 2, high: 4 }],
        },
      },
    };

    expect(listEmbeddedForcedDrawTiles(before, after)).toEqual([
      { low: 1, high: 3 },
      { low: 2, high: 4 },
    ]);
  });
});

describe('handWithoutTiles', () => {
  it('removes one multiset copy of each tile', () => {
    expect(
      handWithoutTiles(
        [
          { low: 1, high: 1 },
          { low: 2, high: 3 },
          { low: 2, high: 3 },
        ],
        [{ low: 2, high: 3 }],
      ),
    ).toEqual([
      { low: 1, high: 1 },
      { low: 2, high: 3 },
    ]);
  });
});

describe('presentEmbeddedForcedDraws', () => {
  it('releases a player immediately after presenting the final drawn tile', async () => {
    vi.useFakeTimers();
    const before = baseState();
    const drawn = [{ low: 1, high: 3 }];
    before.currentPlayer = 'you';
    before.boneyard = [...drawn, { low: 0, high: 0 }];
    const after: BotMatchState = {
      ...before,
      boneyard: [{ low: 0, high: 0 }],
      players: {
        ...before.players,
        you: {
          ...before.players.you,
          hand: [...before.players.you.hand, ...drawn],
        },
      },
    };

    const presentation = presentEmbeddedForcedDraws({
      player: 'you',
      beforePlay: before,
      afterPlay: after,
      drawnTiles: drawn,
      setMatch: vi.fn(),
      onDrawVisualStep: vi.fn(),
      triggerDrawStepAnimation: vi.fn(),
      setDrawSequenceActiveBoth: vi.fn(),
      drawStepMs: 1600,
      isMuted: true,
    });
    let resolved = false;
    void presentation.then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(resolved).toBe(true);
  });

  it('animates each embedded draw before the caller commits final state', async () => {
    const before = baseState();
    before.currentPlayer = 'bot';
    before.boneyard = [
      { low: 1, high: 3 },
      { low: 2, high: 4 },
      { low: 0, high: 0 },
    ];
    const drawn = [
      { low: 1, high: 3 },
      { low: 2, high: 4 },
    ];
    const after: BotMatchState = {
      ...before,
      boneyard: [{ low: 0, high: 0 }],
      players: {
        ...before.players,
        bot: {
          ...before.players.bot,
          hand: [...before.players.bot.hand, ...drawn],
        },
      },
    };

    const setMatch = vi.fn();
    const onDrawVisualStep = vi.fn();
    const triggerDrawStepAnimation = vi.fn();
    const setDrawSequenceActiveBoth = vi.fn();

    await presentEmbeddedForcedDraws({
      player: 'bot',
      beforePlay: before,
      afterPlay: after,
      drawnTiles: drawn,
      setMatch,
      onDrawVisualStep,
      triggerDrawStepAnimation,
      setDrawSequenceActiveBoth,
      drawStepMs: 0,
      isMuted: true,
    });

    expect(setDrawSequenceActiveBoth).toHaveBeenCalledWith(true);
    expect(setDrawSequenceActiveBoth).toHaveBeenCalledWith(false);
    expect(onDrawVisualStep).toHaveBeenCalled();
    expect(triggerDrawStepAnimation).toHaveBeenCalledTimes(2);
    // Post-play board commit + one commit per draw step.
    expect(setMatch).toHaveBeenCalled();
    expect(setMatch.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
