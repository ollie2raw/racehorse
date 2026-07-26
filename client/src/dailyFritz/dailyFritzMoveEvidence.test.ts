import { describe, expect, it } from 'vitest';
import type { MoveEntry } from '../game/moveLogger.ts';
import {
  canonicalizeDailyFritzMoveLog,
  isDuplicateDailyFritzPlacement,
} from './dailyFritzMoveEvidence.ts';

const base = {
  boardEnds: [-1, -1] as [number, number],
  handBefore: [],
  validMoves: [],
  pipDelta: 0,
  pointsScored: 0,
  boardState: [],
  boardRenderState: null,
  handSnapshot: [],
  engineBestMove: null,
};

function placement(
  moveNumber: number,
  handNumber: number,
  player: MoveEntry['player'],
  tile: [number, number],
): MoveEntry {
  return {
    ...base,
    moveNumber,
    handNumber,
    player,
    action: 'place',
    tile,
    position: 'left',
  };
}

describe('Daily Fritz move evidence', () => {
  it('rejects a repeated placement for the same actor and hand', () => {
    const existing = placement(1, 1, 'you', [0, 5]);
    expect(isDuplicateDailyFritzPlacement(
      [existing],
      { action: 'place', player: 'you', tile: [5, 0] },
      1,
    )).toBe(true);
  });

  it('allows repeated draws and the same tile in a later hand', () => {
    const existing = placement(1, 1, 'you', [0, 5]);
    expect(isDuplicateDailyFritzPlacement(
      [existing],
      { action: 'draw', player: 'you' },
      1,
    )).toBe(false);
    expect(isDuplicateDailyFritzPlacement(
      [existing],
      { action: 'place', player: 'you', tile: [0, 5] },
      2,
    )).toBe(false);
  });

  it('canonicalizes separated stale placement captures without removing legal actions', () => {
    const log: MoveEntry[] = [
      placement(1, 1, 'you', [0, 5]),
      { ...base, moveNumber: 2, handNumber: 1, player: 'opponent', action: 'draw' },
      placement(3, 1, 'you', [0, 5]),
      placement(4, 2, 'you', [0, 5]),
    ];
    expect(canonicalizeDailyFritzMoveLog(log).map((entry) => entry.moveNumber))
      .toEqual([1, 2, 4]);
  });
});
