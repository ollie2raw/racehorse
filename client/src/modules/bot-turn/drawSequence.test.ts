import { describe, expect, it, vi } from 'vitest';
import { createBotMatch, type BotMatchState } from '../match/runtime/botEngine.ts';
import { createRunDrawSequence } from './drawSequence.ts';

function stateNeedingDraw(player: 'you' | 'bot'): BotMatchState {
  const base = createBotMatch(60, 7);
  return {
    ...base,
    board: {
      mainLine: [
        { tile: { low: 1, high: 2 }, orientation: 'horizontal-normal' },
      ],
      leftEnd: 1,
      rightEnd: 2,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    players: {
      you: {
        ...base.players.you,
        hand: player === 'you'
          ? [{ low: 5, high: 5 }, { low: 4, high: 4 }]
          : [{ low: 3, high: 3 }],
      },
      bot: {
        ...base.players.bot,
        hand: player === 'bot'
          ? [{ low: 5, high: 5 }, { low: 4, high: 4 }]
          : [{ low: 3, high: 3 }],
      },
    },
    boneyard: [{ low: 1, high: 3 }, { low: 2, high: 6 }, { low: 0, high: 0 }],
    currentPlayer: player,
    handOpen: true,
  };
}

describe('createRunDrawSequence visual steps', () => {
  it('does not commit match identity for bot draws; uses onDrawVisualStep instead', async () => {
    const setMatch = vi.fn();
    const onDrawVisualStep = vi.fn();
    const triggerDrawStepAnimation = vi.fn();
    const isLocalRunCurrent = vi.fn(() => true);

    const run = createRunDrawSequence({
      setMatch,
      onDrawVisualStep,
      isMuted: true,
      isLocalRunCurrent,
      triggerDrawStepAnimation,
      drawStepMs: 0,
    });

    const result = await run(stateNeedingDraw('bot'), 'bot');
    expect(result.state.players.bot.hand.length).toBeGreaterThan(2);
    expect(setMatch).not.toHaveBeenCalled();
    expect(onDrawVisualStep).toHaveBeenCalled();
    expect(onDrawVisualStep.mock.calls.every((call) => call[0] === 'bot')).toBe(true);
  });

  it('still commits match for player draws so the face-up tray updates', async () => {
    const setMatch = vi.fn();
    const onDrawVisualStep = vi.fn();
    const triggerDrawStepAnimation = vi.fn();
    const isLocalRunCurrent = vi.fn(() => true);

    const run = createRunDrawSequence({
      setMatch,
      onDrawVisualStep,
      isMuted: true,
      isLocalRunCurrent,
      triggerDrawStepAnimation,
      drawStepMs: 0,
    });

    await run(stateNeedingDraw('you'), 'you');
    expect(setMatch).toHaveBeenCalled();
    expect(onDrawVisualStep).toHaveBeenCalled();
  });
});
