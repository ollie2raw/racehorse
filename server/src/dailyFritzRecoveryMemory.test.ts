import { afterEach, describe, expect, it, vi } from 'vitest';
const fetchMock = vi.hoisted(() => vi.fn(() => { throw new Error('Network persistence is forbidden in this test'); }));
vi.mock('./supabaseUtils', () => ({ supabaseFetch: fetchMock }));
vi.mock('./http/stores/dailyFritzEventStore', () => ({ recordDailyFritzEvent: vi.fn().mockResolvedValue(undefined) }));
import { createDailyFritzAttempt, getDailyFritzAttemptById, upsertDailyFritzAttempt } from './http/stores/dailyFritzStore';
import { recoverStrandedDailyFritzAttempts, resetDailyFritzRecoveryScanForTests } from './dailyFritzStrandedRecovery';

describe('local memory persistence recovery', () => {
  afterEach(() => { vi.unstubAllEnvs(); resetDailyFritzRecoveryScanForTests(); });
  it('preserves incomplete persisted state and finalizes a complete set exactly once without network access', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DAILY_FRITZ_MEMORY_STORE', '1');
    vi.stubEnv('DAILY_FRITZ_TRANSACTIONAL_COMMANDS', 'false');
    resetDailyFritzRecoveryScanForTests();
    const incomplete = await createDailyFritzAttempt('2026-09-01', 'memory-resume');
    incomplete.startedAt = '2026-09-01T00:00:00Z';
    incomplete.result = { version: 2, format: 'best_of_3', games: [], active_checkpoint: { checkpointRevision: 3 } };
    await upsertDailyFritzAttempt(incomplete);
    const before = structuredClone(incomplete);
    const complete = await createDailyFritzAttempt('2026-09-01', 'memory-complete');
    complete.startedAt = incomplete.startedAt;
    complete.result = { version: 2, format: 'best_of_3', games: [1, 2].map((gameNumber) => ({ gameNumber, seed: 'seed', playerScore: 60, fritzScore: 20, playerWon: true, pointDiff: 40, completedAt: '2026-09-01T00:10:00Z' })) };
    await upsertDailyFritzAttempt(complete);
    expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(1);
    expect(await getDailyFritzAttemptById(incomplete.id, incomplete.userId)).toEqual(before);
    const saved = await getDailyFritzAttemptById(complete.id, complete.userId);
    expect(saved).toMatchObject({ status: 'completed', finalScore: 2, opponentScore: 0, won: true });
    expect(saved?.result?.verification_status).toBe('legacy_unverified');
    for (let run = 0; run < 3; run += 1) expect((await recoverStrandedDailyFritzAttempts()).finalized).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
