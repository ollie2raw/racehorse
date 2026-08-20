import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DailyFritzCompleteResponse,
  DailyFritzSetResult,
  DailyFritzStartResponse,
  DailyFritzTodayResponse,
} from './api';
import { useDailyFritzRunController } from './useDailyFritzRunController';

const apiMocks = vi.hoisted(() => ({
  buildDailyFritzCompletionHash: vi.fn(),
  completeDailyFritz: vi.fn(),
  recordDailyFritzTelemetry: vi.fn(),
  startDailyFritz: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(),
  ...apiMocks,
}));

const setResult: DailyFritzSetResult = {
  version: 2,
  format: 'best_of_3',
  playerGamesWon: 2,
  fritzGamesWon: 1,
  totalPointDiff: 22,
  setWinner: 'player',
  games: [
    { gameNumber: 1, seed: 'g1', playerWon: true, playerScore: 60, fritzScore: 40, pointDiff: 20, movesUsed: 10, handsPlayed: 3, completedAt: '2026-08-09T10:00:00.000Z' },
    { gameNumber: 2, seed: 'g2', playerWon: false, playerScore: 42, fritzScore: 60, pointDiff: -18, movesUsed: 11, handsPlayed: 4, completedAt: '2026-08-09T10:10:00.000Z' },
    { gameNumber: 3, seed: 'g3', playerWon: true, playerScore: 60, fritzScore: 40, pointDiff: 20, movesUsed: 9, handsPlayed: 3, completedAt: '2026-08-09T10:20:00.000Z' },
  ],
};

function today(overrides: Partial<DailyFritzTodayResponse> = {}): DailyFritzTodayResponse {
  return {
    ok: true,
    run_date: '2026-08-09',
    challenge_id: 'daily-fritz:2026-08-09',
    fritz_tier: 'elite',
    deal_size: 7,
    winning_score: 60,
    attempt_status: 'started',
    authority_revision: 14,
    current_game_number: null,
    needs_completion: true,
    streak: 2,
    result: null,
    set_result: setResult,
    rank: null,
    leaderboard_preview: [],
    ...overrides,
  };
}

function started(overrides: Partial<DailyFritzStartResponse> = {}): DailyFritzStartResponse {
  return {
    ok: true,
    attempt_id: 'attempt-1',
    verified_match_id: 'verified-1',
    authority_revision: 14,
    run_date: '2026-08-09',
    challenge_id: 'daily-fritz:2026-08-09',
    current_hand_index: 3,
    current_game_number: null,
    needs_completion: true,
    set_result: setResult,
    fritz_tier: 'elite',
    deal_size: 7,
    winning_score: 60,
    first_hand: {
      player_tiles: [{ low: 0, high: 0 }],
      fritz_tiles: [{ low: 1, high: 1 }],
      boneyard: [],
      locked: [],
    },
    draw_winner: 'you',
    draw_player_tile: { low: 0, high: 1 },
    draw_fritz_tile: { low: 0, high: 2 },
    ...overrides,
  };
}

describe('Daily Fritz authoritative resume fallthroughs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.buildDailyFritzCompletionHash.mockResolvedValue('completion-hash');
    apiMocks.recordDailyFritzTelemetry.mockResolvedValue(undefined);
  });

  it('automatically resumes a committed set receipt through /start and /complete to the final result overlay', async () => {
    let resolveCompletion!: (value: DailyFritzCompleteResponse) => void;
    apiMocks.startDailyFritz.mockResolvedValue(started());
    apiMocks.completeDailyFritz.mockReturnValue(new Promise((resolve) => {
      resolveCompletion = resolve;
    }));
    const refreshToday = vi.fn().mockResolvedValue(undefined);
    const setHubError = vi.fn();

    const { result } = renderHook(() => useDailyFritzRunController({
      today: today(),
      hubError: null,
      setHubError,
      refreshToday,
    }));

    await waitFor(() => expect(apiMocks.startDailyFritz).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.setOverlay?.kind).toBe('finalizing'));
    expect(result.current.hasEmbeddedMatch).toBe(true);
    expect(apiMocks.completeDailyFritz).toHaveBeenCalledOnce();
    expect(refreshToday).not.toHaveBeenCalled();

    await act(async () => {
      resolveCompletion({ ok: true, authority_revision: 15, rank: 4, leaderboard_preview: [] });
    });

    await waitFor(() => expect(result.current.setOverlay?.kind).toBe('final'));
    expect(result.current.hasEmbeddedMatch).toBe(true);
    expect(result.current.setOverlay).toMatchObject({ kind: 'final', rank: 4 });
    expect(setHubError).toHaveBeenCalledWith(null);
  });

  it('resumes an active or newly committed game only after the player chooses Resume and opens the server hand', async () => {
    apiMocks.startDailyFritz.mockResolvedValue(started({
      current_game_number: 2,
      current_hand_index: 0,
      authority_revision: 9,
      needs_completion: false,
      set_result: { ...setResult, playerGamesWon: 1, fritzGamesWon: 0, setWinner: undefined, games: [setResult.games[0]!] },
    }));
    const { result } = renderHook(() => useDailyFritzRunController({
      today: today({ current_game_number: 2, needs_completion: false, set_result: null }),
      hubError: null,
      setHubError: vi.fn(),
      refreshToday: vi.fn().mockResolvedValue(undefined),
    }));

    await act(async () => {});
    expect(apiMocks.startDailyFritz).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.continueSet();
    });

    expect(result.current.hasEmbeddedMatch).toBe(true);
    expect(result.current.dailyFritzPackageForMatch).toMatchObject({
      current_game_number: 2,
      current_hand_index: 0,
      authority_revision: 9,
    });
  });

  it('shows the between-games overlay on /start resume instead of dropping into the next game', async () => {
    const betweenSet = {
      ...setResult,
      playerGamesWon: 1,
      fritzGamesWon: 0,
      setWinner: undefined,
      games: [setResult.games[0]!],
    };
    const betweenStart = started({
      next_action: 'between_games',
      current_game_number: 2,
      current_hand_index: 0,
      needs_completion: false,
      set_result: betweenSet,
    });
    apiMocks.startDailyFritz.mockResolvedValue(betweenStart);
    const { result } = renderHook(() => useDailyFritzRunController({
      today: today({
        current_game_number: 2,
        needs_completion: false,
        next_action: 'between_games',
        set_result: betweenSet,
      }),
      hubError: null,
      setHubError: vi.fn(),
      refreshToday: vi.fn().mockResolvedValue(undefined),
    }));

    await act(async () => {
      await result.current.continueSet();
    });

    expect(result.current.hasEmbeddedMatch).toBe(true);
    expect(result.current.setOverlay).toMatchObject({
      kind: 'between',
      nextGameNumber: 2,
      completedGame: { gameNumber: 1, playerScore: 60, fritzScore: 40 },
      setResult: { playerGamesWon: 1, fritzGamesWon: 0 },
    });

    await act(async () => {
      await result.current.continueSet();
    });

    expect(apiMocks.startDailyFritz).toHaveBeenCalledTimes(2);
    expect(result.current.setOverlay).toBeNull();
    expect(result.current.hasEmbeddedMatch).toBe(true);
    expect(result.current.dailyFritzPackageForMatch).toMatchObject({
      current_game_number: 2,
      current_hand_index: 0,
    });
  });

  it('does not replay /start or /complete after /complete committed and /today is already completed', async () => {
    renderHook(() => useDailyFritzRunController({
      today: today({ attempt_status: 'completed', needs_completion: false }),
      hubError: null,
      setHubError: vi.fn(),
      refreshToday: vi.fn().mockResolvedValue(undefined),
    }));

    await act(async () => {});
    expect(apiMocks.startDailyFritz).not.toHaveBeenCalled();
    expect(apiMocks.completeDailyFritz).not.toHaveBeenCalled();
  });
});
