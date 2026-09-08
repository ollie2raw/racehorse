import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// RK-6 (HARDENING_PLAN §8.3): the weekly ranking cron had nothing
// re-triggering `processAllPendingRatingGames()` between Sunday runs, unlike
// every other reaper in this codebase. These tests pin the boot sweep +
// periodic catch-up that closes that gap — a row inserted between scheduled
// runs must not have to wait for Sunday.

const { processAllPendingRatingGamesMock, decayInactivePlayersMock } = vi.hoisted(() => ({
  processAllPendingRatingGamesMock: vi.fn(),
  decayInactivePlayersMock: vi.fn(),
}));

vi.mock('./periodService', () => ({
  processAllPendingRatingGames: processAllPendingRatingGamesMock,
  decayInactivePlayers: decayInactivePlayersMock,
}));

// node-cron's `schedule()` sets up its own real-clock trigger unrelated to
// the boot/interval sweep under test here; mocking it keeps the fake-timer
// clock the only clock in play and avoids a dangling real timer past the test.
const cronScheduleMock = vi.fn();
vi.mock('node-cron', () => ({
  default: { schedule: cronScheduleMock },
}));

describe('startRankingCron — RK-6 boot + periodic catch-up', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    processAllPendingRatingGamesMock.mockReset().mockResolvedValue({ processed: 0, errors: [] });
    decayInactivePlayersMock.mockReset().mockResolvedValue({ processed: 0, errors: [] });
    cronScheduleMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a catch-up sweep at boot, before the first interval tick', async () => {
    const { startRankingCron, RANKING_CATCHUP_BOOT_DELAY_MS } = await import('./cron');
    startRankingCron();

    expect(processAllPendingRatingGamesMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RANKING_CATCHUP_BOOT_DELAY_MS);

    expect(processAllPendingRatingGamesMock).toHaveBeenCalledTimes(1);
  });

  it('processes a mid-week pending game without waiting for the Sunday cron — the RK-6 gap', async () => {
    const { startRankingCron, RANKING_CATCHUP_BOOT_DELAY_MS, RANKING_CATCHUP_INTERVAL_MS } = await import('./cron');
    startRankingCron();

    // Boot sweep finds nothing pending yet.
    await vi.advanceTimersByTimeAsync(RANKING_CATCHUP_BOOT_DELAY_MS);
    expect(processAllPendingRatingGamesMock).toHaveBeenCalledTimes(1);

    // A game is now stuck at rating_after: null — e.g. inline processing
    // failed just before a Render restart, mid-week, days before Sunday.
    processAllPendingRatingGamesMock.mockResolvedValue({ processed: 1, errors: [] });

    // The next periodic tick — not the weekly cron.schedule callback, which
    // is mocked out and never fires in this test — picks it up.
    await vi.advanceTimersByTimeAsync(RANKING_CATCHUP_INTERVAL_MS);

    expect(processAllPendingRatingGamesMock).toHaveBeenCalledTimes(2);
    // Weekly-only maintenance (RD decay) is untouched by the catch-up path.
    expect(decayInactivePlayersMock).not.toHaveBeenCalled();
  });

  it('keeps sweeping periodically after the boot sweep', async () => {
    const { startRankingCron, RANKING_CATCHUP_BOOT_DELAY_MS, RANKING_CATCHUP_INTERVAL_MS } = await import('./cron');
    startRankingCron();

    await vi.advanceTimersByTimeAsync(RANKING_CATCHUP_BOOT_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RANKING_CATCHUP_INTERVAL_MS * 3);

    // 1 boot sweep + 3 periodic ticks.
    expect(processAllPendingRatingGamesMock).toHaveBeenCalledTimes(4);
  });

  it('logs the error and keeps the interval alive when a sweep throws', async () => {
    const { startRankingCron, RANKING_CATCHUP_BOOT_DELAY_MS, RANKING_CATCHUP_INTERVAL_MS } = await import('./cron');
    processAllPendingRatingGamesMock.mockRejectedValueOnce(new Error('boom'));
    startRankingCron();

    await vi.advanceTimersByTimeAsync(RANKING_CATCHUP_BOOT_DELAY_MS);
    expect(processAllPendingRatingGamesMock).toHaveBeenCalledTimes(1);

    processAllPendingRatingGamesMock.mockResolvedValue({ processed: 0, errors: [] });
    await vi.advanceTimersByTimeAsync(RANKING_CATCHUP_INTERVAL_MS);

    expect(processAllPendingRatingGamesMock).toHaveBeenCalledTimes(2);
  });

  it('registers the weekly Sunday schedule alongside the catch-up sweeps', async () => {
    const { startRankingCron } = await import('./cron');
    startRankingCron();

    expect(cronScheduleMock).toHaveBeenCalledTimes(1);
    expect(cronScheduleMock).toHaveBeenCalledWith('0 0 * * 0', expect.any(Function), { timezone: 'UTC' });
  });

  it('is idempotent — calling it twice does not double-schedule', async () => {
    const { startRankingCron, RANKING_CATCHUP_BOOT_DELAY_MS } = await import('./cron');
    startRankingCron();
    startRankingCron();

    await vi.advanceTimersByTimeAsync(RANKING_CATCHUP_BOOT_DELAY_MS);

    expect(cronScheduleMock).toHaveBeenCalledTimes(1);
    expect(processAllPendingRatingGamesMock).toHaveBeenCalledTimes(1);
  });
});
