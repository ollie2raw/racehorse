import { describe, expect, it } from 'vitest';
import type { ReviewPrincipalVariationStep } from '@racehorse/game-core/review';
import { describePrincipalVariationStep, stepPrincipalVariationBoards } from './reviewPrincipalVariationBoard';

function playStep(
  actor: ReviewPrincipalVariationStep['actor'],
  low: number,
  high: number,
  position: string,
  immediatePoints = 0,
): ReviewPrincipalVariationStep {
  return { actor, action: { kind: 'play', tile: { low, high }, position: position as never }, immediatePoints };
}

function passStep(actor: ReviewPrincipalVariationStep['actor']): ReviewPrincipalVariationStep {
  return { actor, action: { kind: 'pass' }, immediatePoints: 0 };
}

describe('stepPrincipalVariationBoards -- the honest empty-PV case', () => {
  it('returns a single-element array containing only the pre-move board when steps is empty -- today\'s reality for every solver tier', () => {
    const preMoveBoard = null;
    const boards = stepPrincipalVariationBoards(preMoveBoard, []);
    expect(boards).toHaveLength(1);
    expect(boards[0]).toBe(preMoveBoard);
  });

  it('an empty steps array against a real, non-null pre-move board still returns just that board, unchanged', () => {
    const preMoveBoard = stepPrincipalVariationBoards(null, [playStep('reviewed-player', 3, 4, 'left')])[1]!;
    const boards = stepPrincipalVariationBoards(preMoveBoard, []);
    expect(boards).toHaveLength(1);
    expect(boards[0]).toBe(preMoveBoard);
  });
});

describe('stepPrincipalVariationBoards -- synthetic non-empty fixture, stepping mechanics', () => {
  it('steps through a real 3-move line: play, play, pass', () => {
    const steps: ReviewPrincipalVariationStep[] = [
      playStep('reviewed-player', 3, 4, 'left'),
      playStep('opponent', 4, 5, 'right', 9),
      passStep('reviewed-player'),
    ];
    const boards = stepPrincipalVariationBoards(null, steps);

    expect(boards).toHaveLength(4);
    expect(boards[0]).toBeNull();

    // Step 1: first tile placed on an empty board.
    expect(boards[1]).not.toBeNull();
    expect(boards[1]!.mainLine).toHaveLength(1);
    expect(boards[1]!.leftEnd).toBe(3);
    expect(boards[1]!.rightEnd).toBe(4);

    // Step 2: extends the line on the matching open end.
    expect(boards[2]!.mainLine).toHaveLength(2);
    expect(boards[2]!.rightEnd).toBe(5);

    // Step 3 (pass): board is unchanged -- same reference carried forward.
    expect(boards[3]).toBe(boards[2]);
  });

  it('a play step in the middle of an otherwise pass/draw-only line still updates the board correctly', () => {
    const steps: ReviewPrincipalVariationStep[] = [
      passStep('reviewed-player'),
      playStep('opponent', 1, 1, 'left'),
      { actor: 'reviewed-player', action: { kind: 'draw' }, immediatePoints: 0 },
    ];
    const boards = stepPrincipalVariationBoards(null, steps);
    expect(boards).toHaveLength(4);
    expect(boards[1]).toBeNull(); // pass -- unchanged from null pre-move board
    expect(boards[2]!.mainLine).toHaveLength(1); // the play step
    expect(boards[3]).toBe(boards[2]); // draw -- unchanged again
  });
});

describe('describePrincipalVariationStep -- honest, data-only labels', () => {
  it('describes a play step with the real tile, position, and points', () => {
    expect(describePrincipalVariationStep(playStep('reviewed-player', 3, 4, 'left', 6), 'Fritz')).toBe(
      'You play 3-4 at left (+6)',
    );
  });

  it('describes an opponent play step using the real opponent label', () => {
    expect(describePrincipalVariationStep(playStep('opponent', 5, 6, 'right'), 'Fritz')).toBe('Fritz play 5-6 at right');
  });

  it('describes pass and draw steps without a fabricated tile', () => {
    expect(describePrincipalVariationStep(passStep('reviewed-player'), 'Fritz')).toBe('You pass');
    expect(describePrincipalVariationStep({ actor: 'opponent', action: { kind: 'draw' }, immediatePoints: 0 }, 'Fritz')).toBe(
      'Fritz draw',
    );
  });
});
