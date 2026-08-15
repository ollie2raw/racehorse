import { describe, expect, it, vi } from 'vitest';
import { buildDailyFritzSetOverlayViewModel } from './buildDailyFritzSetOverlayViewModel';
import type { DailyFritzSetResult, DailyFritzSetGameResult } from './api';

const completedGame: DailyFritzSetGameResult = {
  gameNumber: 1,
  seed: 'seed-1',
  playerWon: true,
  playerScore: 60,
  fritzScore: 30,
  pointDiff: 30,
  movesUsed: 12,
  handsPlayed: 4,
  completedAt: '2026-07-05T12:00:00.000Z',
};

const setResult: DailyFritzSetResult = {
  version: 2,
  format: 'best_of_3',
  playerGamesWon: 1,
  fritzGamesWon: 0,
  totalPointDiff: 30,
  games: [completedGame],
  run_date: '2026-07-05',
};

function makeActions() {
  return {
    continueSet: vi.fn(),
    submitCompletedGame: vi.fn(),
    closeEmbeddedRun: vi.fn(),
    loadToday: vi.fn(),
    openLeaderboardForRunDate: vi.fn(),
    clearOverlay: vi.fn(),
    retryFinalSubmission: vi.fn(),
    startPractice: vi.fn(),
  };
}

describe('buildDailyFritzSetOverlayViewModel', () => {
  it('builds saving overlay as disabled wait state', () => {
    const vm = buildDailyFritzSetOverlayViewModel(
      {
        kind: 'saving',
        completedGame,
        message: 'Saving Game 1…',
      },
      makeActions(),
      {},
    );
    expect(vm.kind).toBe('saving');
    expect(vm.primaryDisabled).toBe(true);
    expect(vm.gameScoreValue).toBe('60–30');
  });

  it('builds between overlay with next game primary label', () => {
    const vm = buildDailyFritzSetOverlayViewModel(
      {
        kind: 'between',
        completedGame,
        setResult,
        nextGameNumber: 2,
      },
      makeActions(),
      {},
    );
    expect(vm.kind).toBe('between');
    expect(vm.primaryLabel).toBe('Start Game 2');
    expect(vm.tracker).toHaveLength(3);
  });

  it('wires record-error retry to submitCompletedGame', () => {
    const actions = makeActions();
    const game = {
      winner: 'you' as const,
      yourScore: 60,
      botScore: 30,
      movesUsed: 12,
      handsPlayed: 4,
      currentHandIndex: 3,
      moveLog: null,
    };
    const vm = buildDailyFritzSetOverlayViewModel(
      {
        kind: 'record-error',
        completedGame,
        message: 'Save failed',
        error: 'network',
        game,
      },
      actions,
      {},
    );
    vm.onPrimary();
    expect(actions.submitCompletedGame).toHaveBeenCalledWith(game);
  });

  it('keeps completed submission retryable without discarding the result', () => {
    const actions=makeActions();const vm=buildDailyFritzSetOverlayViewModel({kind:'final-error',completedGame,setResult:{...setResult,setWinner:'player'},error:'offline',currentHandIndex:3},actions,{});
    expect(vm.primaryLabel).toBe('Retry submission');expect(vm.errorMessage).toBe('offline');vm.onPrimary();expect(actions.retryFinalSubmission).toHaveBeenCalledOnce();
  });

  it('does not offer practice from the verified final result', () => {
    const actions=makeActions();const vm=buildDailyFritzSetOverlayViewModel({kind:'final',completedGame,setResult:{...setResult,setWinner:'player',playerGamesWon:2},rank:4,canViewLeaderboard:true},actions,{});
    expect(vm.primaryLabel).toBe('View Leaderboard');expect(vm.secondaryLabel).toBeNull();expect(vm.tertiaryLabel).toBe('Return Home');
  });

  it('shows the published 2–0 set score for a game-1 player skunk', () => {
    const skunkGame = { ...completedGame, fritzScore: 20, pointDiff: 40, skunk: true, skunkBy: 'player' as const };
    const vm = buildDailyFritzSetOverlayViewModel(
      {
        kind: 'final',
        completedGame: skunkGame,
        setResult: {
          ...setResult,
          games: [skunkGame],
          playerGamesWon: 2,
          fritzGamesWon: 0,
          setWinner: 'player',
          hasSkunk: true,
          instantSkunk: true,
          skunkGameNumber: 1,
          skunkBy: 'player',
        },
        rank: 1,
        canViewLeaderboard: true,
      },
      makeActions(),
      {},
    );

    expect(vm.setScoreValue).toBe('2–0');
    expect(vm.subheadline).toContain('2–0');
  });
});
