// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useJourneyTrialAttempt, type UseJourneyTrialAttemptArgs } from './useJourneyTrialAttempt.ts';

const trial = (attemptId = 'att-1') => ({
  nodeId: 'ch1-n02',
  nodeTitle: 'Dot’s Table',
  attemptId,
  context: { stageTitle: 'Dot’s Table', rivalName: 'Dot', targetScore: 30, headStartLabel: null },
});

function setup(overrides: Partial<UseJourneyTrialAttemptArgs> = {}) {
  const onSettled = vi.fn();
  const onRematch = vi.fn((previous: string) => `${previous}-rematch`);
  const initial: UseJourneyTrialAttemptArgs = {
    journeyTrial: trial(),
    gameOver: false,
    winnerId: null,
    youScore: 0,
    botScore: 0,
    onSettled,
    onRematch,
    ...overrides,
  };
  const hook = renderHook((props: UseJourneyTrialAttemptArgs) => useJourneyTrialAttempt(props), { initialProps: initial });
  return { ...hook, onSettled, onRematch, initial };
}

describe('useJourneyTrialAttempt', () => {
  it('reports nothing while the match is still being played', () => {
    const { onSettled } = setup();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('reports a win once, when game state reaches game over with the player as winner', () => {
    const { rerender, onSettled, initial } = setup();
    rerender({ ...initial, gameOver: true, winnerId: 'you', youScore: 31, botScore: 12 });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith({ attemptId: 'att-1', nodeId: 'ch1-n02', won: true, finalScore: { you: 31, bot: 12 } });
  });

  it('reports a loss when the opponent wins', () => {
    const { rerender, onSettled, initial } = setup();
    rerender({ ...initial, gameOver: true, winnerId: 'bot' });
    expect(onSettled).toHaveBeenCalledWith({ attemptId: 'att-1', nodeId: 'ch1-n02', won: false, finalScore: { you: 0, bot: 0 } });
  });

  it('does not report twice for the same attempt, however often it re-renders or the callback identity changes', () => {
    const calls = vi.fn();
    const { rerender, initial } = setup({ onSettled: (result) => calls(result) });
    const over = { ...initial, gameOver: true, winnerId: 'you' as const };
    // A fresh callback identity (and a fresh journeyTrial object) on every render re-runs the effect each time.
    rerender({ ...over, onSettled: (result) => calls(result) });
    rerender({ ...over, journeyTrial: trial(), onSettled: (result) => calls(result) });
    rerender({ ...over, journeyTrial: trial(), youScore: 31, botScore: 12, onSettled: (result) => calls(result) });
    rerender({ ...over, onSettled: (result) => calls(result) });
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('never reports for a match that is not a Journey trial', () => {
    const { rerender, onSettled, initial } = setup({ journeyTrial: null });
    rerender({ ...initial, journeyTrial: null, gameOver: true, winnerId: 'you' });
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('does not report a finished game that has no winner', () => {
    const { rerender, onSettled, initial } = setup();
    rerender({ ...initial, gameOver: true, winnerId: null });
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('a rematch moves to a new attempt id and the next game over is reported against it', () => {
    const { result, rerender, onSettled, onRematch, initial } = setup();
    rerender({ ...initial, gameOver: true, winnerId: 'bot' });
    expect(onSettled).toHaveBeenLastCalledWith({ attemptId: 'att-1', nodeId: 'ch1-n02', won: false, finalScore: { you: 0, bot: 0 } });

    let next: string | null = null;
    act(() => {
      next = result.current.beginRematchAttempt(initial.journeyTrial);
    });
    expect(onRematch).toHaveBeenCalledWith('att-1');
    expect(next).toBe('att-1-rematch');
    expect(result.current.getAttemptId()).toBe('att-1-rematch');

    rerender({ ...initial, gameOver: false, winnerId: null }); // fresh match
    expect(onSettled).toHaveBeenCalledTimes(1);
    rerender({ ...initial, gameOver: true, winnerId: 'you' });
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenLastCalledWith({ attemptId: 'att-1-rematch', nodeId: 'ch1-n02', won: true, finalScore: { you: 0, bot: 0 } });
  });

  it('keeps the original attempt if the owner cannot provide a rematch attempt', () => {
    const { result, initial } = setup({ onRematch: vi.fn(() => null) });
    act(() => {
      expect(result.current.beginRematchAttempt(initial.journeyTrial)).toBeNull();
    });
    expect(result.current.getAttemptId()).toBe('att-1');
  });

  it('does nothing on rematch outside a Journey trial', () => {
    const onRematch = vi.fn(() => 'x');
    const { result } = setup({ journeyTrial: null, onRematch });
    expect(result.current.beginRematchAttempt(null)).toBeNull();
    expect(onRematch).not.toHaveBeenCalled();
  });

  it('exposes the current attempt id for exits', () => {
    const { result } = setup();
    expect(result.current.getAttemptId()).toBe('att-1');
  });
});
