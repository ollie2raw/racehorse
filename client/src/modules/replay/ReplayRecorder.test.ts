import { describe, expect, it } from 'vitest';
import { ReplayRecorder } from './ReplayRecorder.ts';

describe('ReplayRecorder', () => {
  it('assigns monotonic move numbers per hand', () => {
    const recorder = new ReplayRecorder();
    recorder.recordMove({
      player: 'you',
      action: 'place',
      boardEnds: [3, 5],
      handBefore: [],
      validMoves: [],
      pipDelta: 0,
      pointsScored: 0,
      boardState: [],
      boardRenderState: null,
      handSnapshot: [],
      engineBestMove: null,
    }, 1);
    recorder.recordMove({
      player: 'opponent',
      action: 'pass',
      boardEnds: [3, 5],
      handBefore: [],
      validMoves: [],
      pipDelta: 0,
      pointsScored: 0,
      boardState: [],
      boardRenderState: null,
      handSnapshot: [],
      engineBestMove: null,
    }, 1);
    const log = recorder.getMoveLog();
    expect(log).toHaveLength(2);
    expect(log[0]?.moveNumber).toBe(1);
    expect(log[1]?.moveNumber).toBe(2);
    expect(log[1]?.handNumber).toBe(1);
  });
});