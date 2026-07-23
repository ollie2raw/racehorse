import { describe, expect, it } from 'vitest';
import { buildDailyFritzTranscript } from './dailyFritzTranscript';
import type { MoveEntry } from '../game/moveLogger';

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

describe('Daily Fritz transcript adapter', () => {
  it('projects only current-hand public commands in stable order', () => {
    const moveLog: MoveEntry[] = [
      { ...base, moveNumber: 1, handNumber: 1, player: 'you', action: 'pass' },
      { ...base, moveNumber: 2, handNumber: 2, player: 'you', action: 'place', tile: [6, 6], position: 'left' },
      { ...base, moveNumber: 3, handNumber: 2, player: 'opponent', action: 'draw' },
    ];
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge', attemptId: 'attempt', gameNumber: 1, handIndex: 1, handNumber: 2, moveLog,
    });
    expect(transcript.actions).toEqual([
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 6, high: 6 }, position: 'left' },
      { sequence: 1, actor: 'fritz', kind: 'draw' },
    ]);
    expect(JSON.stringify(transcript)).not.toContain('handBefore');
  });

  it('preserves one transcript draw action per drawn tile', () => {
    const moveLog: MoveEntry[] = [
      { ...base, moveNumber: 1, handNumber: 1, player: 'you', action: 'place', tile: [2, 4], position: 'left' },
      { ...base, moveNumber: 2, handNumber: 1, player: 'opponent', action: 'draw' },
      { ...base, moveNumber: 3, handNumber: 1, player: 'opponent', action: 'draw' },
      { ...base, moveNumber: 4, handNumber: 1, player: 'opponent', action: 'place', tile: [2, 5], position: 'left' },
    ];
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge', attemptId: 'attempt', gameNumber: 1, handIndex: 0, handNumber: 1, moveLog,
    });
    expect(transcript.actions).toEqual([
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 2, high: 4 }, position: 'left' },
      { sequence: 1, actor: 'fritz', kind: 'draw' },
      { sequence: 2, actor: 'fritz', kind: 'draw' },
      { sequence: 3, actor: 'fritz', kind: 'play', tile: { low: 2, high: 5 }, position: 'left' },
    ]);
  });

  it('fails closed when a play lacks canonical evidence', () => {
    expect(() => buildDailyFritzTranscript({
      challengeId: 'challenge', attemptId: 'attempt', gameNumber: 1, handIndex: 0, handNumber: 1,
      moveLog: [{ ...base, moveNumber: 1, handNumber: 1, player: 'you', action: 'place', tile: [1, 2] }],
    })).toThrow(/placement/i);
  });
});
