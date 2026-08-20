import { describe, expect, it } from 'vitest';
import type { DailyFritzTranscriptAction } from '@racehorse/game-core';
import {
  isPostPlayRecoveryMoveLogEntry,
  stripPostPlayRecoveryTranscriptActions,
} from './dailyFritzPostPlayRecovery.ts';
import { canonicalizeDailyFritzMoveLog } from './dailyFritzMoveEvidence.ts';
import type { MoveEntry } from '../game/moveLogger.ts';

const base = {
  boardEnds: [-1, -1] as [number, number],
  handBefore: [] as MoveEntry['handBefore'],
  validMoves: [] as MoveEntry['validMoves'],
  pipDelta: 0,
  pointsScored: 0,
  boardState: [] as MoveEntry['boardState'],
  boardRenderState: null,
  handSnapshot: [] as MoveEntry['handSnapshot'],
  engineBestMove: null,
};

describe('stripPostPlayRecoveryTranscriptActions', () => {
  it('drops draw immediately after the same actor play and resequences', () => {
    const actions: DailyFritzTranscriptAction[] = [
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 1, high: 5 }, position: 'right' },
      { sequence: 1, actor: 'player', kind: 'draw' },
      { sequence: 2, actor: 'player', kind: 'play', tile: { low: 1, high: 6 }, position: 'left' },
      { sequence: 3, actor: 'fritz', kind: 'draw' },
    ];
    expect(stripPostPlayRecoveryTranscriptActions(actions)).toEqual([
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 1, high: 5 }, position: 'right' },
      { sequence: 1, actor: 'player', kind: 'play', tile: { low: 1, high: 6 }, position: 'left' },
      { sequence: 2, actor: 'fritz', kind: 'draw' },
    ]);
  });

  it('keeps an explicit pass after a play (empty-boneyard extra turn)', () => {
    const actions: DailyFritzTranscriptAction[] = [
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 1, high: 1 }, position: 'left' },
      { sequence: 1, actor: 'player', kind: 'pass' },
      { sequence: 2, actor: 'fritz', kind: 'pass' },
    ];
    expect(stripPostPlayRecoveryTranscriptActions(actions)).toEqual(actions);
  });
});

describe('canonicalizeDailyFritzMoveLog post-play recovery', () => {
  it('drops draw after place by the same player in the same hand', () => {
    const moveLog: MoveEntry[] = [
      {
        ...base,
        moveNumber: 1,
        handNumber: 7,
        action: 'place',
        player: 'you',
        tile: [1, 5],
        position: 'right',
        handBefore: [[1, 5]],
      },
      {
        ...base,
        moveNumber: 2,
        handNumber: 7,
        action: 'draw',
        player: 'you',
        handBefore: [[2, 2]],
        boardEnds: [5, 5],
      },
      {
        ...base,
        moveNumber: 3,
        handNumber: 7,
        action: 'place',
        player: 'you',
        tile: [1, 6],
        position: 'left',
        handBefore: [[1, 6]],
        boardEnds: [5, 5],
      },
    ];
    expect(isPostPlayRecoveryMoveLogEntry(moveLog[0], moveLog[1])).toBe(true);
    const canonical = canonicalizeDailyFritzMoveLog(moveLog);
    expect(canonical.map((entry) => entry.action)).toEqual(['place', 'place']);
  });
});
