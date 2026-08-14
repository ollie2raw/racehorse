// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createBotMatch, type BotActionResult } from '../match/runtime/botEngine.ts';
import type { BotChoice } from '../fritz/botHeuristics.ts';
import { completeBotTurnAction } from './botActionCompletion.ts';
import { collectBotTurnSnapshot } from './botMoveSnapshot.ts';
import type { BotTurnPorts } from './types.ts';

function makePorts(appendMove: BotTurnPorts['appendMove']): BotTurnPorts {
  return {
    applyAndNotify: vi.fn(),
    appendMove,
    appendGhostMove: vi.fn(),
    captureGuidedMatchCandidateAction: vi.fn(),
    flashLastPlayed: vi.fn(),
    setSelectedTile: vi.fn(),
    setDrawSequenceActiveBoth: vi.fn(),
    setLastBotChoice: vi.fn(),
    setGhostPlayedTile: vi.fn(),
    showBoardToast: vi.fn(),
    clearBoardToast: vi.fn(),
  };
}

function makeChoice(match: ReturnType<typeof createBotMatch>): BotChoice {
  return {
    move: { type: 'play', tile: match.players.bot.hand[0]!, position: 'left' },
    score: 0,
    breakdown: {
      immediate: 0,
      doubleBias: 0,
      mobility: 0,
      denial: 0,
      unload: 0,
      replyRisk: 0,
    },
  };
}

function completeInput(
  match: ReturnType<typeof createBotMatch>,
  ports: BotTurnPorts,
  overrides: Partial<Parameters<typeof completeBotTurnAction>[0]> = {},
): Parameters<typeof completeBotTurnAction>[0] {
  const snapshot = collectBotTurnSnapshot(match);
  return {
    ports,
    matchRef: { current: match },
    result: { state: match } as BotActionResult,
    workingHandNumber: match.handNumber,
    snapshot,
    chosen: makeChoice(match),
    ghostChosen: null,
    playedTileForHighlight: null,
    isGhostMode: false,
    isDailyFritzMode: true,
    moveCounter: 1,
    setBotChainPaused: vi.fn(),
    ...overrides,
  };
}

describe('completeBotTurnAction', () => {
  it('does not log or apply a result after the hand has become stale', () => {
    const resultState = createBotMatch(60, 7);
    const liveState = { ...resultState, handOver: true };
    const appendMove = vi.fn<BotTurnPorts['appendMove']>();
    const ports = makePorts(appendMove);

    const applied = completeBotTurnAction(
      completeInput(resultState, ports, {
        matchRef: { current: liveState },
        result: { state: resultState } as BotActionResult,
      }),
    );

    expect(applied).toBe(false);
    expect(appendMove).not.toHaveBeenCalled();
    expect(ports.applyAndNotify).not.toHaveBeenCalled();
  });

  it('does not log or apply a result produced for an older hand', () => {
    const resultState = createBotMatch(60, 7);
    const liveState = { ...resultState, handNumber: resultState.handNumber + 1 };
    const appendMove = vi.fn<BotTurnPorts['appendMove']>();
    const ports = makePorts(appendMove);

    const applied = completeBotTurnAction(
      completeInput(resultState, ports, {
        matchRef: { current: liveState },
        result: { state: resultState } as BotActionResult,
      }),
    );

    expect(applied).toBe(false);
    expect(appendMove).not.toHaveBeenCalled();
    expect(ports.applyAndNotify).not.toHaveBeenCalled();
  });

  it('surfaces action failures without logging or applying them', () => {
    const match = createBotMatch(60, 7);
    const appendMove = vi.fn<BotTurnPorts['appendMove']>();
    const ports = makePorts(appendMove);

    const applied = completeBotTurnAction(
      completeInput(match, ports, {
        result: {
          state: match,
          error: { code: 'core_play_rejected', message: 'Move failed.' },
        },
      }),
    );

    expect(applied).toBe(false);
    expect(ports.showBoardToast).toHaveBeenCalledWith('Move failed.', 'bot');
    expect(appendMove).not.toHaveBeenCalled();
    expect(ports.applyAndNotify).not.toHaveBeenCalled();
  });

  it('logs one draw entry per tile for Daily Fritz multi-draw turns', () => {
    const match = createBotMatch(60, 7);
    const appendMove = vi.fn<BotTurnPorts['appendMove']>();
    const ports = makePorts(appendMove);

    const applied = completeBotTurnAction(
      completeInput(match, ports, {
        drew: true,
        drawCount: 3,
        chosen: null,
        playedTileForHighlight: null,
      }),
    );

    expect(applied).toBe(true);
    expect(appendMove).toHaveBeenCalledTimes(3);
    expect(appendMove.mock.calls.every((call) => call[0].action === 'draw')).toBe(true);
    expect(appendMove.mock.calls.every((call) => call[1] === match.handNumber)).toBe(true);
  });

  it('collapses multi-draws to one move-log entry outside Daily Fritz', () => {
    const match = createBotMatch(60, 7);
    const appendMove = vi.fn<BotTurnPorts['appendMove']>();
    const ports = makePorts(appendMove);

    const applied = completeBotTurnAction(
      completeInput(match, ports, {
        isDailyFritzMode: false,
        drew: true,
        drawCount: 3,
        chosen: null,
        playedTileForHighlight: null,
      }),
    );

    expect(applied).toBe(true);
    expect(appendMove).toHaveBeenCalledTimes(1);
    expect(appendMove.mock.calls[0]?.[0].action).toBe('draw');
    expect(appendMove.mock.calls[0]?.[1]).toBe(match.handNumber);
  });
});
