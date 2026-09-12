// @vitest-environment jsdom
import { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleSprintModal, type PuzzleSprintResult } from './PuzzleSprintModal';
import type { JourneyPuzzle } from './journeyPuzzles';

function makePuzzle(id: string, correct: { high: number; low: number }, wrong: { high: number; low: number }): JourneyPuzzle {
  return {
    nodeId: id,
    eyebrow: 'Puzzle Sprint',
    title: `Sprint puzzle ${id}`,
    scenario: 'Read the board.',
    prompt: 'Pick your play.',
    choices: [],
    correctChoiceId: '',
    explanation: 'That was the right read.',
    rewardLabel: 'Sprint Point',
    boardState: { ends: [3, 5], placedTiles: [{ high: 5, low: 3 }] },
    playerHand: [correct, wrong],
    correctTile: correct,
  };
}

const PUZZLES: JourneyPuzzle[] = [
  makePuzzle('sprint-1', { high: 3, low: 4 }, { high: 6, low: 6 }),
  makePuzzle('sprint-2', { high: 5, low: 5 }, { high: 1, low: 2 }),
  makePuzzle('sprint-3', { high: 0, low: 3 }, { high: 2, low: 2 }),
];

function tapTile(tile: { high: number; low: number }) {
  fireEvent.click(screen.getByRole('button', { name: `Play ${tile.high}-${tile.low}` }));
}

describe('PuzzleSprintModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the first puzzle board and hand when open', () => {
    render(
      <PuzzleSprintModal open puzzles={PUZZLES} timeLimitSec={40} onComplete={() => {}} onExit={() => {}} />,
    );
    expect(screen.getByText('Sprint puzzle sprint-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play 3-4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play 6-6' })).toBeInTheDocument();
  });

  it('advances to the next puzzle after a correct answer and tallies it', () => {
    let result: PuzzleSprintResult | null = null;
    render(
      <PuzzleSprintModal
        open
        puzzles={PUZZLES}
        timeLimitSec={40}
        onComplete={(r) => { result = r; }}
        onExit={() => {}}
      />,
    );
    act(() => { tapTile({ high: 3, low: 4 }); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Sprint puzzle sprint-2')).toBeInTheDocument();
    expect(result).toBeNull();
  });

  it('advances to the next puzzle after a wrong answer without crediting it', () => {
    render(
      <PuzzleSprintModal open puzzles={PUZZLES} timeLimitSec={40} onComplete={() => {}} onExit={() => {}} />,
    );
    act(() => { tapTile({ high: 6, low: 6 }); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Sprint puzzle sprint-2')).toBeInTheDocument();
  });

  it('calls onComplete with the final tally after the last puzzle is answered', () => {
    let result: PuzzleSprintResult | null = null;
    render(
      <PuzzleSprintModal
        open
        puzzles={PUZZLES}
        timeLimitSec={40}
        onComplete={(r) => { result = r; }}
        onExit={() => {}}
      />,
    );
    act(() => { tapTile({ high: 3, low: 4 }); }); // correct
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { tapTile({ high: 1, low: 2 }); }); // wrong
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { tapTile({ high: 0, low: 3 }); }); // correct
    act(() => { vi.advanceTimersByTime(1000); });

    expect(result).toEqual({ correct: 2, total: 3, timedOut: false });
  });

  it('ends the sprint via onComplete when the clock expires mid-puzzle', () => {
    let result: PuzzleSprintResult | null = null;
    render(
      <PuzzleSprintModal
        open
        puzzles={PUZZLES}
        timeLimitSec={5}
        onComplete={(r) => { result = r; }}
        onExit={() => {}}
      />,
    );
    act(() => { tapTile({ high: 3, low: 4 }); }); // correct, puzzle 2 of 3
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(6000); }); // clock runs out before answering puzzle 2

    expect(result).toEqual({ correct: 1, total: 3, timedOut: true });
  });

  it('calls onExit and not onComplete when the player leaves early', () => {
    const onComplete = vi.fn();
    const onExit = vi.fn();
    render(
      <PuzzleSprintModal open puzzles={PUZZLES} timeLimitSec={40} onComplete={onComplete} onExit={onExit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('resets its progress when reopened with a fresh puzzle set', () => {
    const { rerender } = render(
      <PuzzleSprintModal open={false} puzzles={PUZZLES} timeLimitSec={40} onComplete={() => {}} onExit={() => {}} />,
    );
    rerender(
      <PuzzleSprintModal open puzzles={PUZZLES} timeLimitSec={40} onComplete={() => {}} onExit={() => {}} />,
    );
    expect(screen.getByText('Sprint puzzle sprint-1')).toBeInTheDocument();
  });
});
