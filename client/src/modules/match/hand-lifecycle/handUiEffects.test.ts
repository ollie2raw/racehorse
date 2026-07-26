import { describe, expect, it, vi } from 'vitest';
import { createBotMatch, type BotActionResult } from '../runtime/botEngine.ts';
import { applyBotActionUiEffects } from './handUiEffects.ts';
import type { HandLifecyclePorts } from './types.ts';

function makePorts(): HandLifecyclePorts {
  return {
    invalidateLocalRuns: vi.fn(),
    flashLastPlayed: vi.fn(),
    setSelectedTile: vi.fn(),
    setLastBotChoice: vi.fn(),
    pushToast: vi.fn(),
    showScoreToast: vi.fn(),
    showBoardToast: vi.fn(),
    captureGuidedMatchCandidateNextHand: vi.fn(),
  };
}

describe('applyBotActionUiEffects', () => {
  it('does not show action toasts for player draws', () => {
    const state = createBotMatch(60, 7);
    const ports = makePorts();

    applyBotActionUiEffects(
      {
        state,
        drew: { player: 'you', tile: state.boneyard[0]! },
      } as BotActionResult,
      ports,
      'Fritz',
      true,
    );

    expect(ports.showBoardToast).not.toHaveBeenCalled();
    expect(ports.pushToast).not.toHaveBeenCalled();
  });

  it('does not show action toasts for passes', () => {
    const state = createBotMatch(60, 7);
    const ports = makePorts();

    applyBotActionUiEffects(
      {
        state,
        passed: { player: 'you' },
      } as BotActionResult,
      ports,
      'Fritz',
      true,
    );

    expect(ports.showBoardToast).not.toHaveBeenCalled();
    expect(ports.pushToast).not.toHaveBeenCalled();
  });

  it('leaves Daily Fritz score cues to committed score observation', () => {
    const state = createBotMatch(60, 7);
    const ports = makePorts();

    applyBotActionUiEffects(
      {
        state,
        scored: { player: 'you', points: 5 },
      } as BotActionResult,
      ports,
      'Fritz',
      true,
      true,
    );

    expect(ports.showScoreToast).not.toHaveBeenCalled();
    expect(ports.showBoardToast).not.toHaveBeenCalled();
  });

  it('preserves the existing Play vs Fritz player score cue', () => {
    const state = createBotMatch(60, 7);
    const ports = makePorts();

    applyBotActionUiEffects(
      {
        state,
        scored: { player: 'you', points: 10 },
      } as BotActionResult,
      ports,
      'Fritz',
      true,
      false,
    );

    expect(ports.showScoreToast).toHaveBeenCalledWith('you', 10);
  });
});
