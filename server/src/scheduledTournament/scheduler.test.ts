import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchTournamentsByStatus: vi.fn(),
  openRegistration: vi.fn(),
  closeRegistrationAndStart: vi.fn(),
  dispatchScheduledStartMatches: vi.fn(),
  reconcileExpiredReadyMatches: vi.fn(),
  cancelTournament: vi.fn(),
  supabaseFetch: vi.fn(),
}));

vi.mock('./persistence', () => ({
  fetchTournamentsByStatus: (...args: unknown[]) => mocks.fetchTournamentsByStatus(...args),
}));

vi.mock('./engine', () => ({
  openRegistration: (...args: unknown[]) => mocks.openRegistration(...args),
  closeRegistrationAndStart: (...args: unknown[]) => mocks.closeRegistrationAndStart(...args),
  reconcileExpiredReadyMatches: (...args: unknown[]) => mocks.reconcileExpiredReadyMatches(...args),
  dispatchScheduledStartMatches: (...args: unknown[]) => mocks.dispatchScheduledStartMatches(...args),
  cancelTournament: (...args: unknown[]) => mocks.cancelTournament(...args),
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => mocks.supabaseFetch(...args),
}));

describe('startTournamentScheduler stale cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T03:30:00.000Z'));
    vi.clearAllMocks();
    mocks.fetchTournamentsByStatus.mockImplementation(async (statuses: string[]) => {
      if (statuses.includes('upcoming') || statuses.includes('registration_open')) return [];
      if (statuses.includes('in_progress')) {
        return [{
          id: 'tour-stale',
          scheduled_start: '2026-05-15T00:00:00.000Z',
          registration_open_at: '2026-05-14T23:30:00.000Z',
          registration_close_at: '2026-05-14T23:58:00.000Z',
          status: 'in_progress',
          format: 'single_elimination',
          win_target: 30,
          max_players: 8,
          winner_id: null,
          created_at: '2026-05-14T00:00:00.000Z',
        }];
      }
      return [];
    });
    mocks.supabaseFetch.mockResolvedValue(undefined);
  });

  it('cancels stale in-progress tournaments instead of dispatching them', async () => {
    const { startTournamentScheduler, stopTournamentScheduler } = await import('./scheduler');
    const io = { emit: vi.fn() } as any;

    startTournamentScheduler(io);
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.cancelTournament).toHaveBeenCalledWith(io, 'tour-stale');
    expect(mocks.dispatchScheduledStartMatches).not.toHaveBeenCalled();
    stopTournamentScheduler();
  });
});
