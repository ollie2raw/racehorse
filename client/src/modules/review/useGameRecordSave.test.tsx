// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoveEntry } from '../../game/moveLogger.ts';
import { GAME_RECORD_SETTLE_MS, useGameRecordSave } from './useGameRecordSave.ts';

const saveGameRecord = vi.fn();
vi.mock('./gameRecord.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gameRecord.ts')>()),
  saveGameRecord: (...args: unknown[]) => saveGameRecord(...args),
}));

function entry(moveNumber: number): MoveEntry {
  return {
    moveNumber, handNumber: 1, player: 'you', action: 'place', tile: [1, 1], position: 'left', boardEnds: [1, 1],
    handBefore: [], validMoves: [], pipDelta: 0, pointsScored: 0, boardState: [], boardRenderState: null,
    handSnapshot: [], engineBestMove: null,
  };
}

const finished = {
  gameOver: true, winnerId: 'you' as const, dealSize: 7 as const, dealSeed: 'seed', matchStarter: 'you' as const,
  players: { you: { score: 61 }, bot: { score: 40 } },
} as never;
const live = { ...(finished as object), gameOver: false } as never;

function setup(initial: { match: never; moveLog: MoveEntry[]; enabled?: boolean }) {
  return renderHook((props) => useGameRecordSave({
    enabled: props.enabled ?? true,
    match: props.match,
    moveLog: props.moveLog,
    sourceMatchId: 'src-1',
    localMatchId: 'local-1',
    fritzTier: 'elite',
    winningScore: 60,
  }), { initialProps: initial });
}

describe('useGameRecordSave', () => {
  beforeEach(() => { vi.useFakeTimers(); saveGameRecord.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it('does nothing while the game is still being played', () => {
    setup({ match: live, moveLog: [entry(1), entry(2)] });
    vi.advanceTimersByTime(GAME_RECORD_SETTLE_MS * 3);
    expect(saveGameRecord).not.toHaveBeenCalled();
  });

  it('saves once, after the move log has settled following game over', () => {
    setup({ match: finished, moveLog: [entry(1), entry(2)] });
    vi.advanceTimersByTime(GAME_RECORD_SETTLE_MS - 1);
    expect(saveGameRecord).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(saveGameRecord).toHaveBeenCalledTimes(1);
    expect(saveGameRecord.mock.calls[0]?.[0]).toMatchObject({
      sourceMatchId: 'src-1', localMatchId: 'local-1', dealSeed: 'seed', result: { you: 61, opponent: 40, winner: 'you' },
    });
  });

  it('waits for a late final action: the record is never saved short of it', () => {
    const { rerender } = setup({ match: finished, moveLog: [entry(1), entry(2)] });
    vi.advanceTimersByTime(GAME_RECORD_SETTLE_MS - 100);
    rerender({ match: finished, moveLog: [entry(1), entry(2), entry(3)] });
    vi.advanceTimersByTime(GAME_RECORD_SETTLE_MS - 100);
    expect(saveGameRecord).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(saveGameRecord).toHaveBeenCalledTimes(1);
    expect((saveGameRecord.mock.calls[0]?.[0] as { moves: unknown[] }).moves).toHaveLength(3);
  });

  it('never saves the same game twice', () => {
    const { rerender } = setup({ match: finished, moveLog: [entry(1)] });
    vi.advanceTimersByTime(GAME_RECORD_SETTLE_MS);
    rerender({ match: finished, moveLog: [entry(1)] });
    vi.advanceTimersByTime(GAME_RECORD_SETTLE_MS * 3);
    expect(saveGameRecord).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled (not a standard Play vs Fritz game, or signed out)', () => {
    setup({ match: finished, moveLog: [entry(1)], enabled: false });
    vi.advanceTimersByTime(GAME_RECORD_SETTLE_MS * 3);
    expect(saveGameRecord).not.toHaveBeenCalled();
  });
});
