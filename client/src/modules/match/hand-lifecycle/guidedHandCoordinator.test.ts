// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createBotMatch } from '../runtime/botEngine.ts';
import { planLocalHandAdvance } from './guidedHandCoordinator.ts';

describe('planLocalHandAdvance', () => {
  it('returns null when the hand is not over', () => {
    const match = createBotMatch(60, 7);
    expect(
      planLocalHandAdvance(match, { isAuthoringMode: false, isGuidedMode: false, frozenLesson: null }),
    ).toBeNull();
  });

  it('deals the next hand when handOver and not gameOver', () => {
    const match = {
      ...createBotMatch(60, 7),
      handOver: true,
      handNumber: 2,
    };
    const plan = planLocalHandAdvance(match, {
      isAuthoringMode: false,
      isGuidedMode: false,
      frozenLesson: null,
    });
    expect(plan).not.toBeNull();
    expect(plan!.nextState.handNumber).toBe(3);
    expect(plan!.nextState.handOver).toBe(false);
    expect(plan!.nextState.opponentPassedOnEnds).toEqual([]);
  });
});