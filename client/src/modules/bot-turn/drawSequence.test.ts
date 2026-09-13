// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.useRealTimers();
});

describe('createRunDrawSequence visual steps', () => {
  it('returns immediately once a player draw produces a playable tile', async () => {
    vi.useFakeTimers();
    const setMatch = vi.fn();
    const run = createRunDrawSequence({
      setMatch,
      onDrawVisualStep: vi.fn(),
      isMuted: true,
      isLocalRunCurrent: vi.fn(() => true),
      triggerDrawStepAnimation: vi.fn(),
      drawStepMs: 1600,
    });

    const sequence = run(stateNeedingDraw('you'), 'you');
    let resolved = false;
    void sequence.then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(setMatch).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(true);
  });

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

function stateForcedPass(player: 'you' | 'bot'): BotMatchState {
  const base = createBotMatch(60, 7);
  return {
    ...base,
    board: {
      mainLine: [{ tile: { low: 6, high: 6 }, orientation: 'horizontal-normal' }],
      leftEnd: 6,
      rightEnd: 6,
      leftEndIsDouble: true,
      rightEndIsDouble: true,
      hubDoubles: [],
    },
    players: {
      you: {
        ...base.players.you,
        hand: player === 'you' ? [{ low: 1, high: 1 }] : [{ low: 3, high: 3 }],
      },
      bot: {
        ...base.players.bot,
        hand: player === 'bot' ? [{ low: 2, high: 2 }] : [{ low: 4, high: 4 }],
      },
    },
    // Locked boneyard — cannot draw, must pass.
    boneyard: [{ low: 0, high: 0 }, { low: 5, high: 5 }],
    deadTiles: [{ low: 0, high: 0 }, { low: 5, high: 5 }],
    currentPlayer: player,
    handOpen: true,
    handNumber: 2,
    turnIndex: 7,
    reviewMissingPipObservations: [],
  };
}

describe('createRunDrawSequence missing-pip observations (A1)', () => {
  function makeRun() {
    return createRunDrawSequence({
      setMatch: vi.fn(),
      onDrawVisualStep: vi.fn(),
      isMuted: true,
      isLocalRunCurrent: vi.fn(() => true),
      triggerDrawStepAnimation: vi.fn(),
      drawStepMs: 0,
    });
  }

  it('records drew_past_open_end for the player on draw-until', async () => {
    const result = await makeRun()(stateNeedingDraw('you'), 'you');
    const rows = result.state.reviewMissingPipObservations ?? [];
    expect(rows.some((row) => row.actorId === 'you' && row.reason === 'drew_past_open_end')).toBe(true);
    expect(rows.find((row) => row.actorId === 'you')?.openEnds).toEqual(expect.arrayContaining([1, 2]));
  });

  it('records drew_past_open_end for the bot on draw-until', async () => {
    const result = await makeRun()(stateNeedingDraw('bot'), 'bot');
    const rows = result.state.reviewMissingPipObservations ?? [];
    expect(rows.some((row) => row.actorId === 'bot' && row.reason === 'drew_past_open_end')).toBe(true);
  });

  it('records passed_on_open_end for both actors when forced to pass', async () => {
    const youPass = await makeRun()(stateForcedPass('you'), 'you');
    expect(youPass.passed?.player).toBe('you');
    expect(youPass.state.reviewMissingPipObservations).toEqual([
      expect.objectContaining({
        actorId: 'you',
        reason: 'passed_on_open_end',
        openEnds: [6],
      }),
    ]);

    const botPass = await makeRun()(stateForcedPass('bot'), 'bot');
    expect(botPass.passed?.player).toBe('bot');
    expect(botPass.state.reviewMissingPipObservations).toEqual([
      expect.objectContaining({
        actorId: 'bot',
        reason: 'passed_on_open_end',
        openEnds: [6],
      }),
    ]);
  });
});
