import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ stop: vi.fn(), catchup: vi.fn(), decay: vi.fn(), fetch: vi.fn(), weekly: null as null | (() => Promise<void>) }));
vi.mock('node-cron', () => ({ default: { schedule: (_cron: string, callback: () => Promise<void>) => { f.weekly = callback; return { stop: f.stop }; } } }));
vi.mock('../ranking/periodService', () => ({ processAllPendingRatingGames: f.catchup, decayInactivePlayers: f.decay }));
vi.mock('../supabaseUtils', () => ({ supabaseFetch: f.fetch, isSupabaseTimeoutError: () => false }));
vi.mock('../ranking/ratingCutoverGate', () => ({ withRatingCompletion: (_n: string, task: () => unknown) => task(), isRatingCutoverQuiescedError: () => false, beginDecayRun: async () => ({ end() {} }) }));
beforeEach(async () => { (await import('./processLifecycle')).resetProcessLifecycleForTests(); vi.resetModules(); vi.useFakeTimers(); f.stop.mockClear(); f.catchup.mockReset().mockResolvedValue({ processed: 0, errors: [] }); f.fetch.mockReset().mockResolvedValue([]); });
afterEach(async () => { (await import('./processLifecycle')).resetProcessLifecycleForTests(); vi.useRealTimers(); });
// resetModules also reloads the lifecycle singleton: import schedulers and gate
// from the same module graph inside each test.
describe('actual scheduler shutdown wiring', () => {
  it('cancels ranking boot/interval/weekly admission before their first reads', async () => {
    const gate = await import('./processLifecycle'); const cron = await import('../ranking/cron');
    cron.startRankingCron(); gate.closeProcessAdmission(); await vi.advanceTimersByTimeAsync(20 * 60_000); await f.weekly?.();
    expect(f.catchup).not.toHaveBeenCalled(); expect(f.stop).toHaveBeenCalledOnce();
  });
  it('retains an admitted ranking catchup until its DB work settles', async () => {
    const gate = await import('./processLifecycle'); const cron = await import('../ranking/cron');
    let release!: (value: unknown) => void; f.catchup.mockImplementation(() => new Promise((r) => { release = r; }));
    cron.startRankingCron(); await vi.advanceTimersByTimeAsync(20_000); gate.closeProcessAdmission();
    expect(gate.activeProcessWork()).toContain('ranking'); let drained = false; const drain = gate.drainProcessWork().then(() => { drained = true; });
    expect(drained).toBe(false); release({ processed: 1, errors: [] }); await drain;
    await vi.advanceTimersByTimeAsync(20 * 60_000); expect(f.catchup).toHaveBeenCalledTimes(1);
  });
  it('cancels Daily Fritz boot and periodic scans after closing', async () => {
    const gate = await import('./processLifecycle'); const fritz = await import('../dailyFritzStrandedRecovery');
    fritz.scheduleStrandedDailyFritzRecovery(); gate.closeProcessAdmission(); await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('waits for an already admitted Daily Fritz scan and starts no second scan', async () => {
    const gate = await import('./processLifecycle'); const fritz = await import('../dailyFritzStrandedRecovery');
    let release!: (value: unknown) => void; f.fetch.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    fritz.scheduleStrandedDailyFritzRecovery(); await vi.advanceTimersByTimeAsync(20_000); gate.closeProcessAdmission();
    expect(gate.activeProcessWork()).toContain('daily-fritz-recovery'); release([]); await gate.drainProcessWork();
    await vi.advanceTimersByTimeAsync(20 * 60_000); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
