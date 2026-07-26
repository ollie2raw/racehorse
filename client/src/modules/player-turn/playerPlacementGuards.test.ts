import { describe, expect, it } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { getPlacementClickBlockReason } from './playerPlacementGuards.ts';

describe('getPlacementClickBlockReason', () => {
  it('blocks a second placement while the first click is being committed', () => {
    const match = createBotMatch(60, 7);
    const selectedTile = match.players.you.hand[0]!;

    expect(
      getPlacementClickBlockReason(match, selectedTile, true, true),
    ).toBe('placement-in-flight');
  });

  it('allows the selected legal placement when no action is in flight', () => {
    const match = createBotMatch(60, 7);
    const selectedTile = match.players.you.hand[0]!;

    expect(
      getPlacementClickBlockReason(match, selectedTile, true, false),
    ).toBeNull();
  });
});
