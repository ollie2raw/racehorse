import { describe, expect, it } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { mergePlayerDrawPassTracking } from './applyPlayerActionResult.ts';

describe('mergePlayerDrawPassTracking', () => {
  it('returns adjusted state unchanged when no player draw or pass', () => {
    const match = createBotMatch(60, 7);
    const next = { ...match, currentPlayer: 'bot' as const };
    const result = mergePlayerDrawPassTracking(match, next, { state: next });
    expect(result).toBe(next);
  });

  it('tracks opponent draw count when the player draws', () => {
    const match = createBotMatch(60, 7);
    const drewTile = { low: 1, high: 2 };
    const next = {
      ...match,
      players: {
        ...match.players,
        you: {
          ...match.players.you,
          hand: [...match.players.you.hand, drewTile],
        },
      },
      boneyard: match.boneyard.slice(1),
    };
    const merged = mergePlayerDrawPassTracking(match, next, {
      state: next,
      drew: { player: 'you', tile: drewTile },
    });
    expect(merged.opponentDrawCount).toBe((match.opponentDrawCount ?? 0) + 1);
  });
});