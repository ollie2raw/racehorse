// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DailyPuzzleLadderHubView,
  type LadderHubActions,
  type LadderHubViewModel,
} from './DailyPuzzleLadderHubView';
import { buildLadderSlotRows } from './ladderSlotRowViewModel';
import type { DailyPuzzleSlot } from './types';

const hubSlots: DailyPuzzleSlot[] = [
  {
    id: 'slot-1',
    puzzleDate: '2026-07-05',
    slotIndex: 1,
    slotTitle: 'Quick Line',
    tier: 'quick_line',
    puzzleType: 'reach_target',
    maxMoves: 3,
    targetScore: 20,
    dealSize: 7,
    slotMaxPoints: 10,
    bestPossibleScore: 20,
    startingBoard: {
      mainLine: [],
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    startingHand: [{ low: 1, high: 2 }],
    objectiveType: 'reach_target',
    objectivePayload: {},
  },
  {
    id: 'slot-2',
    puzzleDate: '2026-07-05',
    slotIndex: 2,
    slotTitle: 'Tactical Setup',
    tier: 'tactical_setup',
    puzzleType: 'reach_target',
    maxMoves: 3,
    targetScore: 30,
    dealSize: 7,
    slotMaxPoints: 15,
    bestPossibleScore: 30,
    startingBoard: {
      mainLine: [],
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    startingHand: [{ low: 3, high: 4 }],
    objectiveType: 'reach_target',
    objectivePayload: {},
  },
  {
    id: 'slot-3',
    puzzleDate: '2026-07-05',
    slotIndex: 3,
    slotTitle: 'Master Chain',
    tier: 'master_chain',
    puzzleType: 'one_turn_high_score',
    maxMoves: 1,
    targetScore: 0,
    dealSize: 7,
    slotMaxPoints: 20,
    bestPossibleScore: 40,
    startingBoard: {
      mainLine: [],
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    startingHand: [{ low: 5, high: 6 }],
    objectiveType: 'one_turn_high_score',
    objectivePayload: {},
  },
];

function makeViewModel(overrides: Partial<LadderHubViewModel> = {}): LadderHubViewModel {
  return {
    labels: {
      showNav: true,
      isLadderComplete: false,
      ladderStateLabel: 'Ready to start',
      primaryLabel: 'Start Daily Ladder',
      trustLine: 'Leaderboard updates after a scored run.',
    },
    runDate: '2026-07-05',
    attemptTotalScore: 0,
    streakDisplay: 3,
    ladderTotalPoints: 1500,
    ladderSlotRows: buildLadderSlotRows({
      hubSlots,
      completedSlots: [],
      attemptStatus: undefined,
      nextSlotIndex: null,
    }),
    heroSrc: null,
    hubError: null,
    hubLadderShareText: '',
    shareDone: false,
    startPending: false,
    finalizePending: false,
    ...overrides,
  };
}

function makeActions(): LadderHubActions {
  return {
    onBack: vi.fn(),
    onNavigate: vi.fn(),
    onOpenAuth: vi.fn(),
    onOpenAccount: vi.fn(),
    onStartScored: vi.fn(),
    onStartPractice: vi.fn(),
    onOpenLeaderboard: vi.fn(),
    onShareResult: vi.fn(),
  };
}

describe('DailyPuzzleLadderHubView', () => {
  it('renders hub shell with progress overview and slot rows', () => {
    const { container } = render(
      <DailyPuzzleLadderHubView
        overlays={<div data-testid="overlays-stub" />}
        viewModel={makeViewModel()}
        actions={makeActions()}
      />,
    );

    expect(container.querySelector('.dpl-ladder-hub')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Daily Ladder', level: 1 })).toBeTruthy();
    expect(screen.getAllByText('1500 pts').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('3 days')).toBeTruthy();
    expect(screen.getByLabelText('Ladder progress')).toBeTruthy();
    expect(screen.getByTestId('overlays-stub')).toBeTruthy();
  });

  it('wires start scored and back callbacks', () => {
    const actions = makeActions();
    render(
      <DailyPuzzleLadderHubView
        overlays={null}
        viewModel={makeViewModel()}
        actions={actions}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Start Daily Ladder/i }));
    fireEvent.click(screen.getByRole('button', { name: /Back to home/i }));
    expect(actions.onStartScored).toHaveBeenCalledTimes(1);
    expect(actions.onBack).toHaveBeenCalledTimes(1);
  });

  it('wires leaderboard and practice callbacks when ladder is complete', () => {
    const actions = makeActions();
    render(
      <DailyPuzzleLadderHubView
        overlays={null}
        viewModel={makeViewModel({
          labels: {
            showNav: false,
            isLadderComplete: true,
            ladderStateLabel: 'Completed',
            primaryLabel: 'Practice Mode',
            trustLine: 'Practice any puzzle after your scored run.',
          },
          hubLadderShareText: 'Share me',
        })}
        actions={actions}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Practice Mode/i }));
    fireEvent.click(screen.getByRole('button', { name: 'View Leaderboard →' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share Result' }));
    fireEvent.click(screen.getByRole('button', { name: 'Puzzle 1' }));
    // Slot 2's stored title is now the canonical step identity, so the row
    // renders 'Tactical Setup' rather than the Puzzle N fallback.
    fireEvent.click(screen.getByRole('button', { name: 'Tactical Setup' }));

    expect(actions.onOpenLeaderboard).toHaveBeenCalledTimes(1);
    expect(actions.onShareResult).toHaveBeenCalledWith('Share me');
    expect(actions.onStartPractice).toHaveBeenCalledWith(1);
    expect(actions.onStartPractice).toHaveBeenCalledWith(2);
  });

  it('shows hub error and share-done state', () => {
    render(
      <DailyPuzzleLadderHubView
        overlays={null}
        viewModel={makeViewModel({
          labels: {
            showNav: false,
            isLadderComplete: true,
            ladderStateLabel: 'Completed',
            primaryLabel: 'Practice Mode',
            trustLine: 'Practice any puzzle after your scored run.',
          },
          hubError: 'Unable to start today’s ladder.',
          hubLadderShareText: 'Share me',
          shareDone: true,
        })}
        actions={makeActions()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to start today’s ladder.');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});
