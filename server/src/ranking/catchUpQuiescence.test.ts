import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFenceRequest, jsonResponse, newFenceStore } from '../../test/support/cutoverFenceStub';
// The fence is exercised through a stubbed fetch, but supabaseFetch still needs a non-empty URL and key to build the request.
// Inert placeholders are enough (nothing leaves the process); declared here so the test never depends on an ambient server/.env.
// Must run before the config module is first imported (hoisted), like ratingCutoverGate.test.ts.
const restoreInertEnv = vi.hoisted(() => {
  const set: string[] = [];
  for (const [key, value] of [['SUPABASE_URL', 'http://127.0.0.1:54321'], ['SUPABASE_SERVICE_KEY', 'inert-test-service-key']] as const) {
    if (!process.env[key]) { process.env[key] = value; set.push(key); }
  }
  // Remove only what this file added, so it cannot mask a different test that wrongly relies on ambient env.
  return () => { for (const key of set) delete process.env[key]; };
});
const { work } = vi.hoisted(() => ({ work: vi.fn() }));
vi.mock('./periodService', () => ({ processAllPendingRatingGames: work, decayInactivePlayers: vi.fn() }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
const barrier = () => { let release!: () => void; const promise = new Promise<void>((r) => { release = r; }); return { promise, release }; };
let store: ReturnType<typeof newFenceStore>;
let gate: typeof import('./ratingCutoverGate');
let cron: typeof import('./cron');
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); store = newFenceStore();
  vi.stubGlobal('fetch', vi.fn(async (input, init) => handleFenceRequest(store, String(input), init) ?? jsonResponse([], 404)));
  gate = await import('./ratingCutoverGate'); gate.setLegacyRatingWritersEnforcedForTests(true); cron = await import('./cron');
  work.mockReset().mockResolvedValue({ processed: 0, errors: [] });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function tick() { await vi.advanceTimersByTimeAsync(cron.RANKING_CATCHUP_BOOT_DELAY_MS); }
describe('exact scheduled catch-up admission and drain', () => {
  it.each([false, true])('counts DB-latency-blocked work and releases after row failure=%s', async (fail) => {
    const entered = barrier(); const db = barrier(); let receipts = 0;
    work.mockImplementation(async () => { entered.release(); await db.promise; if (fail) throw Error('row failure'); receipts++; return { processed: 1, errors: [] }; });
    cron.startRankingCron(); await tick(); await entered.promise;
    await gate.setRatingCutoverQuiesced(true, 'test');
    expect(await gate.getRatingCutoverStatus()).toMatchObject({ completionsInFlight: 1, readyForExpand: false });
    db.release(); await vi.advanceTimersByTimeAsync(0);
    expect((await gate.getRatingCutoverStatus()).readyForExpand).toBe(true);
    const atDrain = receipts;
    await vi.advanceTimersByTimeAsync(cron.RANKING_CATCHUP_INTERVAL_MS * 2);
    expect(receipts).toBe(atDrain); expect(work).toHaveBeenCalledTimes(1);
  });
  it('closed before boot blocks work; explicit resume admits future callbacks', async () => {
    await gate.setRatingCutoverQuiesced(true, null); cron.startRankingCron(); await tick();
    expect(work).not.toHaveBeenCalled(); expect((await gate.getRatingCutoverStatus()).readyForExpand).toBe(true);
    await gate.setRatingCutoverQuiesced(false, null);
    await vi.advanceTimersByTimeAsync(cron.RANKING_CATCHUP_INTERVAL_MS);
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('a captured open-fence read concurrent with quiesce is counted before admission resolves', async () => {
    const read = barrier(); const observed = barrier(); let first = true;
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const response = handleFenceRequest(store, String(input), init) ?? jsonResponse([], 404);
      if ((init?.method ?? 'GET') === 'GET' && first) { first = false; observed.release(); await read.promise; }
      return response;
    }));
    const db = barrier(); work.mockImplementation(async () => { await db.promise; return { processed: 1, errors: [] }; });
    cron.startRankingCron(); await tick(); await observed.promise;
    await gate.setRatingCutoverQuiesced(true, null);
    expect(await gate.getRatingCutoverStatus()).toMatchObject({ completionsInFlight: 1, readyForExpand: false });
    read.release(); await vi.advanceTimersByTimeAsync(0);
    expect((await gate.getRatingCutoverStatus()).readyForExpand).toBe(false);
    db.release(); await vi.advanceTimersByTimeAsync(0);
    expect((await gate.getRatingCutoverStatus()).readyForExpand).toBe(true);
  });
});
afterAll(restoreInertEnv);
