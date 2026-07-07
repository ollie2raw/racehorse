import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BotMatchState } from '../bot/botEngine';
import type { PlayStatus } from './dailyPuzzleScreenTypes';
import {
  DailyPuzzleLegacyInPlayView,
  type DailyPuzzleLegacyInPlayActions,
  type DailyPuzzleLegacyInPlayViewModel,
} from './DailyPuzzleLegacyInPlayView';

function makeRuntimeState(): BotMatchState {
  return {
    players: {
      bot: { hand: [], score: 0 },
      you: { hand: [{ low: 1, high: 2 }, { low: 3, high: 4 }], score: 12 },
    },
    board: {
      mainLine: [],
      leftEnd: 3,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    boneyard: [{ low: 0, high: 1 }],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 60,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

function makeViewModel(status: PlayStatus): DailyPuzzleLegacyInPlayViewModel {
  return {
    status,
    isArchiveMode: false,
    formattedPuzzleDate: 'Jul 5, 2026',
    runtimeState: makeRuntimeState(),
    legalMoves: [],
    selectedTile: null,
    lastPlayedTile: null,
    handTileSize: 56,
    handCompactStacked: false,
    playableTileKeys: new Set<string>(),
    solvableWarning: false,
    validation: null,
    completedScore: 12,
    completionSummary: {
      completionMessage: { text: 'Keep practicing!', color: 'rgba(232,245,240,0.85)' },
      modalLeaderboard: [],
    },
    bestPossibleScore: 20,
    movesUsed: 2,
    streakDays: 1,
    currentUserId: null,
  };
}

function makeActions(): DailyPuzzleLegacyInPlayActions {
  return {
    onPositionClick: vi.fn(),
    onSelectTile: vi.fn(),
    onResetAttempt: vi.fn(),
    onBack: vi.fn(),
  };
}

describe('DailyPuzzleLegacyInPlayView', () => {
  it('renders live board shell without post-game overlay while IN_PROGRESS', () => {
    const { container } = render(
      <DailyPuzzleLegacyInPlayView
        confettiCanvasRef={createRef<HTMLCanvasElement>()}
        viewModel={makeViewModel('IN_PROGRESS')}
        actions={makeActions()}
      />,
    );

    expect(container.querySelector('.daily-puzzle-screen')).toBeTruthy();
    expect(container.querySelector('.tray-rail')).toBeTruthy();
    expect(screen.queryByText('PUZZLE COMPLETE')).toBeNull();
  });

  it('renders post-game overlay when status is SOLVED', () => {
    render(
      <DailyPuzzleLegacyInPlayView
        confettiCanvasRef={createRef<HTMLCanvasElement>()}
        viewModel={makeViewModel('SOLVED')}
        actions={makeActions()}
      />,
    );

    expect(screen.getByText('PUZZLE COMPLETE')).toBeTruthy();
    expect(screen.getByText('Keep practicing!')).toBeTruthy();
  });

  it('renders post-game overlay when status is FAILED', () => {
    render(
      <DailyPuzzleLegacyInPlayView
        confettiCanvasRef={createRef<HTMLCanvasElement>()}
        viewModel={makeViewModel('FAILED')}
        actions={makeActions()}
      />,
    );

    expect(screen.getByText('PUZZLE COMPLETE')).toBeTruthy();
  });

  it('wires overlay and HUD reset/back callbacks', () => {
    const actions = makeActions();
    render(
      <DailyPuzzleLegacyInPlayView
        confettiCanvasRef={createRef<HTMLCanvasElement>()}
        viewModel={makeViewModel('SOLVED')}
        actions={actions}
      />,
    );

    const overlayActions = document.querySelector('.rh-result__actions');
    expect(overlayActions).toBeTruthy();
    fireEvent.click(
      overlayActions!.querySelector('.rh-btn-leave') as HTMLButtonElement,
    );
    fireEvent.click(
      overlayActions!.querySelector('.rh-btn-cancel') as HTMLButtonElement,
    );
    expect(actions.onResetAttempt).toHaveBeenCalledTimes(1);
    expect(actions.onBack).toHaveBeenCalledTimes(1);
  });
});