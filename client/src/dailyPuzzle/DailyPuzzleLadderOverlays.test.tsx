import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DailyPuzzleLadderOverlays,
  type DailyPuzzleLadderOverlayActions,
  type DailyPuzzleLadderOverlayFlags,
} from './DailyPuzzleLadderOverlays';
import type { DailyPuzzleCompleteResponse, DailyPuzzleSubmitSlotResponse, DailyPuzzleSlot } from './types';

const emptyFlags: DailyPuzzleLadderOverlayFlags = {
  submitPending: false,
  finalizePending: false,
  slotOverlay: null,
  practiceOverlay: null,
  finalOverlay: null,
};

function makeActions(): DailyPuzzleLadderOverlayActions {
  return {
    exitPlayToHub: vi.fn(),
    onSlotNext: vi.fn(),
    onPracticeReplay: vi.fn(),
    onPracticeNext: vi.fn(),
    onPracticeExitToHub: vi.fn(),
    onShareResult: vi.fn(),
    onFinalHome: vi.fn(),
    onFinalReview: vi.fn(),
    onFinalLeaderboard: vi.fn(),
  };
}

function makeSlotResponse(): DailyPuzzleSubmitSlotResponse {
  return {
    ok: true,
    runDate: '2024-06-01',
    attempt: {
      id: 'attempt-1',
      puzzleDate: '2024-06-01',
      userId: 'user-1',
      username: 'player',
      status: 'started',
      setVersion: 1,
      currentSlotIndex: 1,
      puzzlesCompleted: 1,
      totalScore: 8,
      masterChainScore: 0,
      completedAt: null,
      startedAt: '2024-06-01T00:00:00Z',
      updatedAt: '2024-06-01T00:00:00Z',
      reviewUnlocked: false,
      practiceMode: 'none',
      result: { slots: [] },
    },
    slotResult: {
      id: 'result-1',
      attemptId: 'attempt-1',
      puzzleId: 'slot-1',
      puzzleDate: '2024-06-01',
      userId: 'user-1',
      slotIndex: 1,
      tier: 'quick_line',
      slotTitle: 'Quick Line',
      puzzleType: 'reach_target',
      rawScore: 25,
      awardedPoints: 8,
      bestPossibleScore: 10,
      slotMaxPoints: 10,
      solved: true,
      perfect: false,
      movesUsed: 2,
      elapsedSeconds: 45,
      completedAt: '2024-06-01T12:00:00Z',
      submittedLine: [],
      result: {},
    },
    nextAvailableSlotIndex: 2,
    nextSlot: {
      id: 'slot-2',
      puzzleDate: '2024-06-01',
      slotIndex: 2,
      slotTitle: 'Tactical Setup',
      tier: 'tactical_setup',
      puzzleType: 'reach_target',
      maxMoves: 3,
      targetScore: 30,
      dealSize: 7,
      slotMaxPoints: 15,
      bestPossibleScore: 30,
      startingBoard: { mainLine: [], leftEnd: 0, rightEnd: 0, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] },
      startingHand: [{ low: 1, high: 2 }],
      objectiveType: 'reach_target',
      objectivePayload: {},
    } as DailyPuzzleSlot,
    ladderCompleted: false,
    requiresCompleteCall: false,
    replayed: false,
  };
}

function makeCompleteResponse(): DailyPuzzleCompleteResponse {
  return {
    ok: true,
    runDate: '2024-06-01',
    attempt: {
      id: 'attempt-1',
      puzzleDate: '2024-06-01',
      userId: 'user-1',
      username: 'player',
      status: 'completed',
      setVersion: 1,
      currentSlotIndex: 3,
      puzzlesCompleted: 3,
      totalScore: 42,
      masterChainScore: 12,
      completedAt: '2024-06-01T12:00:00Z',
      startedAt: '2024-06-01T00:00:00Z',
      updatedAt: '2024-06-01T12:00:00Z',
      reviewUnlocked: true,
      practiceMode: 'none',
      result: { slots: [] },
    },
    leaderboardRank: 5,
    leaderboardPreview: [],
    replayed: false,
  };
}

describe('DailyPuzzleLadderOverlays', () => {
  it('renders pending overlay when submitPending is true', () => {
    render(
      <DailyPuzzleLadderOverlays
        flags={{ ...emptyFlags, submitPending: true }}
        currentSlotBreakdown={[]}
        finalLadderShareText=""
        shareDone={false}
        actions={makeActions()}
      />,
    );
    expect(screen.getByLabelText('Submitting puzzle')).toBeTruthy();
    expect(screen.getByText('Submitting puzzle…')).toBeTruthy();
  });

  it('renders finalize pending copy when finalizePending is true', () => {
    render(
      <DailyPuzzleLadderOverlays
        flags={{ ...emptyFlags, finalizePending: true }}
        currentSlotBreakdown={[]}
        finalLadderShareText=""
        shareDone={false}
        actions={makeActions()}
      />,
    );
    expect(screen.getByLabelText('Finalizing ladder')).toBeTruthy();
    expect(screen.getByText('Finalizing ladder…')).toBeTruthy();
  });

  it('renders slot-complete overlay and wires back/next callbacks', () => {
    const actions = makeActions();
    render(
      <DailyPuzzleLadderOverlays
        flags={{
          ...emptyFlags,
          slotOverlay: { response: makeSlotResponse(), rawScore: 25 },
        }}
        currentSlotBreakdown={[]}
        finalLadderShareText=""
        shareDone={false}
        actions={actions}
      />,
    );

    expect(screen.getByLabelText('Puzzle complete')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Ladder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next · Puzzle 2' }));
    expect(actions.exitPlayToHub).toHaveBeenCalledTimes(1);
    expect(actions.onSlotNext).toHaveBeenCalledWith(expect.objectContaining({ slotIndex: 2 }));
  });

  it('renders practice overlay and wires replay callback', () => {
    const actions = makeActions();
    render(
      <DailyPuzzleLadderOverlays
        flags={{
          ...emptyFlags,
          practiceOverlay: {
            slotIndex: 2,
            slotTitle: 'Chain',
            rawScore: 18,
            bestPossible: 20,
          },
        }}
        currentSlotBreakdown={[]}
        finalLadderShareText=""
        shareDone={false}
        actions={actions}
      />,
    );

    expect(screen.getByLabelText('Practice complete')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Replay P2' }));
    expect(actions.onPracticeReplay).toHaveBeenCalledWith(2);
  });

  it('renders final overlay and wires home/review/leaderboard callbacks', () => {
    const actions = makeActions();
    render(
      <DailyPuzzleLadderOverlays
        flags={{
          ...emptyFlags,
          finalOverlay: { response: makeCompleteResponse() },
        }}
        currentSlotBreakdown={[{ slotIndex: 1, label: 'P1', value: '8' }]}
        finalLadderShareText="Share me"
        shareDone={false}
        actions={actions}
      />,
    );

    expect(screen.getByLabelText('Ladder complete')).toBeTruthy();
    expect(screen.getByText('Rank #5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review Ladder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leaderboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share Result' }));
    expect(actions.onFinalHome).toHaveBeenCalledTimes(1);
    expect(actions.onFinalReview).toHaveBeenCalledTimes(1);
    expect(actions.onFinalLeaderboard).toHaveBeenCalledTimes(1);
    expect(actions.onShareResult).toHaveBeenCalledWith('Share me');
  });

  it('can render pending and slot overlays together when both flags are set', () => {
    render(
      <DailyPuzzleLadderOverlays
        flags={{
          submitPending: true,
          finalizePending: false,
          slotOverlay: { response: makeSlotResponse(), rawScore: 25 },
          practiceOverlay: null,
          finalOverlay: null,
        }}
        currentSlotBreakdown={[]}
        finalLadderShareText=""
        shareDone={false}
        actions={makeActions()}
      />,
    );

    expect(screen.getByLabelText('Submitting puzzle')).toBeTruthy();
    expect(screen.getByLabelText('Puzzle complete')).toBeTruthy();
  });
});