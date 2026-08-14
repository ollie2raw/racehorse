// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MoveEntry } from '../game/moveLogger.ts';
import {
  canonicalizeDailyFritzMoveLog,
  isDuplicateDailyFritzActionEvidence,
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

  it('rejects only an immediately duplicated draw from the same pre-action state', () => {
    const firstDraw: MoveEntry = {
      ...base,
      moveNumber: 1,
      handNumber: 3,
      player: 'you',
      action: 'draw',
      handBefore: [[2, 6]],
    };
    expect(isDuplicateDailyFritzActionEvidence(
      [firstDraw],
      { ...base, player: 'you', action: 'draw', handBefore: [[2, 6]] },
      3,
    )).toBe(true);
    expect(isDuplicateDailyFritzActionEvidence(
      [firstDraw],
      { ...base, player: 'you', action: 'draw', handBefore: [[2, 6], [5, 5]] },
      3,
    )).toBe(false);
  });

  it('preserves a legitimate multi-draw chain while canonicalizing duplicate capture', () => {
    const log: MoveEntry[] = [
      { ...base, moveNumber: 1, handNumber: 3, player: 'you', action: 'draw', handBefore: [[2, 6]] },
      { ...base, moveNumber: 2, handNumber: 3, player: 'you', action: 'draw', handBefore: [[2, 6]] },
      { ...base, moveNumber: 3, handNumber: 3, player: 'you', action: 'draw', handBefore: [[2, 6], [0, 1]] },
    ];
    expect(canonicalizeDailyFritzMoveLog(log).map((entry) => entry.moveNumber)).toEqual([1, 3]);
  });

  it('preserves repeated legacy draws when pre-action evidence is unavailable', () => {
    const log: MoveEntry[] = [
      { ...base, moveNumber: 1, handNumber: 3, player: 'opponent', action: 'draw' },
      { ...base, moveNumber: 2, handNumber: 3, player: 'opponent', action: 'draw' },
    ];
    expect(canonicalizeDailyFritzMoveLog(log).map((entry) => entry.moveNumber)).toEqual([1, 2]);
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

  it('orders resumed evidence by recorder move number before verification', () => {
    const log: MoveEntry[] = [
      { ...base, moveNumber: 3, handNumber: 1, player: 'you', action: 'pass' },
      { ...base, moveNumber: 1, handNumber: 1, player: 'you', action: 'pass' },
      { ...base, moveNumber: 2, handNumber: 1, player: 'opponent', action: 'pass' },
    ];
    expect(canonicalizeDailyFritzMoveLog(log).map((entry) => entry.moveNumber))
      .toEqual([1, 2, 3]);
  });
});
