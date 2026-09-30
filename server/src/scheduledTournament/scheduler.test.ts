import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchTournamentsByStatus: vi.fn(),
  openRegistration: vi.fn(),
  closeRegistrationAndStart: vi.fn(),
  dispatchScheduledStartMatches: vi.fn(),
  reconcileExpiredReadyMatches: vi.fn(),
  cancelTournament: vi.fn(),
  supabaseFetch: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  captureMessage: (...args: unknown[]) => mocks.captureMessage(...args),
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

    expect(mocks.cancelTournament).toHaveBeenCalledWith(io, 'tour-stale', undefined, 'active_window_expired');
    expect(mocks.dispatchScheduledStartMatches).not.toHaveBeenCalled();
    stopTournamentScheduler();
  });

  it('does not tick when TOURNAMENT_SCHEDULER_ENABLED=false (D-7 singleton gate)', async () => {
    process.env.TOURNAMENT_SCHEDULER_ENABLED = 'false';
    try {
      const { startTournamentScheduler, stopTournamentScheduler } = await import('./scheduler');
      const io = { emit: vi.fn() } as any;

      startTournamentScheduler(io);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mocks.fetchTournamentsByStatus).not.toHaveBeenCalled();
      expect(mocks.reconcileExpiredReadyMatches).not.toHaveBeenCalled();
      expect(mocks.cancelTournament).not.toHaveBeenCalled();
      expect(mocks.supabaseFetch).not.toHaveBeenCalled();
      stopTournamentScheduler();
    } finally {
      delete process.env.TOURNAMENT_SCHEDULER_ENABLED;
    }
  });
});

// Q9 / review C1: a tournament whose bracket cannot be created used to be
// retried every 30 s forever, stuck in registration_open with no signal.
describe('closeRegistrationWithEscalation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('retries quietly below the threshold, then alerts once and cancels with a reason', async () => {
    const { closeRegistrationWithEscalation, CLOSE_START_MAX_CONSECUTIVE_FAILURES } = await import('./scheduler');
    const io = { emit: vi.fn() } as any;
    const failures = new Map<string, number>();
    mocks.closeRegistrationAndStart.mockRejectedValue(new Error('Tournament caps at 8 players'));

    for (let i = 1; i < CLOSE_START_MAX_CONSECUTIVE_FAILURES; i += 1) {
      const result = await closeRegistrationWithEscalation(io, 'tour-stuck', failures);
      expect(result).toEqual({ started: false, reason: 'close_start_failed' });
    }
    expect(mocks.captureMessage).not.toHaveBeenCalled();
    expect(mocks.cancelTournament).not.toHaveBeenCalled();

    const final = await closeRegistrationWithEscalation(io, 'tour-stuck', failures);
    expect(final).toEqual({ started: false, reason: 'cancelled_after_failures', cancelled: true });
    expect(mocks.captureMessage).toHaveBeenCalledTimes(1);
    expect(mocks.captureMessage.mock.calls[0][1]).toMatchObject({
      level: 'error',
      fingerprint: ['tournament-close-start-failed', 'tour-stuck'],
      tags: { tournament_alert: 'close_start_failed', error_code: 'Tournament caps at 8 players' },
    });
    expect(mocks.cancelTournament).toHaveBeenCalledWith(
      io, 'tour-stuck', undefined, 'bracket_generation_failed:Tournament caps at 8 players',
    );
    expect(failures.has('tour-stuck')).toBe(false);
  });

  it('a success resets the count, so only consecutive failures escalate', async () => {
    const { closeRegistrationWithEscalation, CLOSE_START_MAX_CONSECUTIVE_FAILURES } = await import('./scheduler');
    const io = { emit: vi.fn() } as any;
    const failures = new Map<string, number>();
    for (let i = 1; i < CLOSE_START_MAX_CONSECUTIVE_FAILURES; i += 1) {
      mocks.closeRegistrationAndStart.mockRejectedValueOnce(new Error('transient'));
      await closeRegistrationWithEscalation(io, 'tour-flaky', failures);
    }
    mocks.closeRegistrationAndStart.mockResolvedValueOnce({ started: true });
    expect(await closeRegistrationWithEscalation(io, 'tour-flaky', failures)).toEqual({ started: true });
    expect(failures.has('tour-flaky')).toBe(false);

    mocks.closeRegistrationAndStart.mockRejectedValueOnce(new Error('transient'));
    await closeRegistrationWithEscalation(io, 'tour-flaky', failures);
    expect(mocks.cancelTournament).not.toHaveBeenCalled();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });

  it('one stuck tournament does not stop the tick from starting the next one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:00:00.000Z'));
    const due = (id: string) => ({
      id,
      scheduled_start: '2026-05-15T00:00:00.000Z',
      registration_open_at: '2026-05-14T23:30:00.000Z',
      registration_close_at: '2026-05-14T23:58:00.000Z',
      status: 'registration_open',
      format: '7-tile',
      win_target: 30,
      max_players: 8,
      winner_id: null,
      created_at: '2026-05-14T00:00:00.000Z',
    });
    mocks.fetchTournamentsByStatus.mockImplementation(async (statuses: string[]) =>
      statuses.includes('registration_open') ? [due('tour-a'), due('tour-b')] : []);
    mocks.closeRegistrationAndStart.mockImplementation(async (_io: unknown, id: string) => {
      if (id === 'tour-a') throw new Error('boom');
      return { started: true };
    });
    mocks.supabaseFetch.mockResolvedValue(undefined);
    const { startTournamentScheduler, stopTournamentScheduler } = await import('./scheduler');
    startTournamentScheduler({ emit: vi.fn() } as any);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.closeRegistrationAndStart).toHaveBeenCalledWith(expect.anything(), 'tour-b');
    stopTournamentScheduler();
    vi.useRealTimers();
  });
});
