// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildLogicalActionSignature,
  resolveLogicalActionRequestId,
  shouldClearLogicalActionForState,
} from './gameplayActionIdentity';
import type { GameState } from '../../../types';

const baseState: GameState = {
  config: { scoringMultiple: 5, winningScore: 60 },
  playerIds: ['p1', 'p2'],
  players: {
    p1: { id: 'p1', hand: [{ low: 1, high: 2 }], score: 0 },
    p2: { id: 'p2', hand: [], score: 0 },
  },
  board: null,
  boneyard: [],
  deadTiles: [],
  currentPlayerIndex: 0,
  handNumber: 1,
  handOpen: true,
  handOver: false,
  gameOver: false,
  winnerId: null,
  consecutivePasses: 0,
  sequence: 10,
};

describe('gameplayActionIdentity', () => {
  it('reuses the same requestId for an unresolved logical PASS retry', () => {
    const signature = buildLogicalActionSignature({
      kind: 'pass',
      roomCode: 'room1',
      playerId: 'p1',
      baselineSequence: 10,
      handNumber: 1,
    });
    const first = resolveLogicalActionRequestId({
      current: null,
      kind: 'pass',
      roomCode: 'room1',
      playerId: 'p1',
      baselineSequence: 10,
      handNumber: 1,
      signature,
    });
    const retry = resolveLogicalActionRequestId({
      current: { ...first, uncertain: true },
      kind: 'pass',
      roomCode: 'ROOM1',
      playerId: 'p1',
      baselineSequence: 10,
      handNumber: 1,
      signature,
    });

    expect(retry.requestId).toBe(first.requestId);
  });

  it('does not reuse a stale MOVE requestId after the turn sequence advances', () => {
    const signature = buildLogicalActionSignature({
      kind: 'move',
      roomCode: 'room1',
      playerId: 'p1',
      baselineSequence: 10,
      handNumber: 1,
      tile: { low: 1, high: 2 },
      position: 'right',
    });
    const first = resolveLogicalActionRequestId({
      current: null,
      kind: 'move',
      roomCode: 'room1',
      playerId: 'p1',
      baselineSequence: 10,
      handNumber: 1,
      signature,
    });

    expect(shouldClearLogicalActionForState(first, { ...baseState, sequence: 11 }, 'ROOM1')).toBe(true);
    expect(shouldClearLogicalActionForState(first, { ...baseState, handOver: true }, 'ROOM1')).toBe(true);
    expect(shouldClearLogicalActionForState(first, { ...baseState, handNumber: 2 }, 'ROOM1')).toBe(true);
    expect(shouldClearLogicalActionForState(first, baseState, 'ROOM2')).toBe(true);
  });
});
