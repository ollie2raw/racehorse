// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBotMatch, type BotActionResult } from '../runtime/botEngine.ts';
import { applyBotActionUiEffects } from './handUiEffects.ts';
import type { HandLifecyclePorts } from './types.ts';
import {
  armTileImpact,
  claimTileImpact,
  landTileImpact,
  resetTileImpactForTests,
  setTileFlightActive,
} from '../../../utils/tileImpact.ts';

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

describe('the player score chip lands with the tile', () => {
  beforeEach(() => {
    resetTileImpactForTests();
  });
  afterEach(() => {
    resetTileImpactForTests();
  });

  it('holds the chip until the tile has landed, so chip, clack and ping arrive together', () => {
    setTileFlightActive(true);
    const ports = makePorts();
    armTileImpact(() => {}); // the player's move armed its impact before the state applied
    claimTileImpact(600); // ...and its flight claimed it

    applyBotActionUiEffects(
      { state: createBotMatch(60, 7), scored: { player: 'you', points: 10 } } as BotActionResult,
      ports,
      'Fritz',
      true,
      false,
    );
    expect(ports.showScoreToast).not.toHaveBeenCalled(); // the tile is still in the air

    landTileImpact();
    expect(ports.showScoreToast).toHaveBeenCalledWith('you', 10);
  });

  it('shows the chip at once when no tile is in flight', () => {
    const ports = makePorts();
    applyBotActionUiEffects(
      { state: createBotMatch(60, 7), scored: { player: 'you', points: 5 } } as BotActionResult,
      ports,
      'Fritz',
      true,
      false,
    );
    expect(ports.showScoreToast).toHaveBeenCalledWith('you', 5);
  });
});
