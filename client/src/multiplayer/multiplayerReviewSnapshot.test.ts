import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { captureMultiplayerReviewSnapshot } from './multiplayerReviewSnapshot';

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    config: { scoringMultiple: 5, winningScore: 60 },
    playerIds: ['you-socket', 'opponent-socket'],
    players: {
      'you-socket': { id: 'you-socket', hand: [{ low: 1, high: 2 }], score: 7 },
      'opponent-socket': { id: 'opponent-socket', hand: [], score: 3 },
    },
    handCounts: { 'you-socket': 1, 'opponent-socket': 6 },
    board: {
      mainLine: [{ tile: { low: 6, high: 6 }, orientation: 'horizontal-normal' }],
      leftEnd: 6,
      rightEnd: 6,
      leftEndIsDouble: true,
      rightEndIsDouble: true,
      hubDoubles: [],
    },
    boneyard: [{ low: 4, high: 5 }, { low: 3, high: 4 }, { low: 2, high: 3 }, { low: 1, high: 4 }],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 2,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 8,
    ...overrides,
  };
}

describe('captureMultiplayerReviewSnapshot', () => {
  it.each([
    [{ kind: 'play', tile: { low: 1, high: 2 }, position: 'left' }],
    [{ kind: 'draw' }],
    [{ kind: 'pass' }],
  ] as const)('captures an accepted %s decision with public-only state', (action) => {
    const effectiveAction = action.kind === 'play'
      ? { kind: 'play' as const, tile: { low: 6, high: 1 }, position: 'left' as const }
      : action;
    const testState = action.kind === 'play'
      ? state({ players: { ...state().players, 'you-socket': { id: 'you-socket', hand: [{ low: 6, high: 1 }], score: 7 } } })
      : action.kind === 'pass'
        ? state({ boneyard: [] })
        : state();
    const snapshot = captureMultiplayerReviewSnapshot({
      state: testState,
      actorId: 'you-socket',
      action: effectiveAction,
      sessionId: 'mp-review:ROOM',
      gameId: 'ROOM',
      actionNumber: 9,
    });

    expect(snapshot.identifiers).toMatchObject({
      mode: 'multiplayer',
      actorId: 'you-socket',
      opponentId: 'opponent-socket',
      handNumber: 2,
      turnSequence: 8,
    });
    expect(snapshot.actualAction).toEqual(effectiveAction);
    expect(snapshot.preAction.actorHand).toEqual(testState.players['you-socket'].hand);
    expect(snapshot.preAction.opponentTileCount).toBe(6);
    expect(snapshot.preAction.boneyard.physicalCount).toBe(testState.boneyard.length);
    expect(JSON.stringify(snapshot)).not.toContain('opponent-private-tile');
  });

  it('rejects a non-current actor rather than capturing a misleading snapshot', () => {
    expect(() => captureMultiplayerReviewSnapshot({
      state: state({ currentPlayerIndex: 1 }),
      actorId: 'you-socket',
      action: { kind: 'pass' },
      sessionId: 'session',
      gameId: 'game',
      actionNumber: 1,
    })).toThrow(/current player/i);
  });
});
