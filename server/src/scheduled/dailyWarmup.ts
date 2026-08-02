import { dailyFritzRunCache, ensureDailyFritzRunForDate } from '../http/stores/dailyFritzStore';
import { buildDailyFritzPublishedChallenge } from '../dailyFritzPublishedChallenge';
import { publishDailyFritzChallenge } from '../http/stores/dailyFritzPublishedChallengeStore';
import { ensureDailyPuzzleLadderForDate } from '../seedDailyPuzzleLadder';
import { getNextPacificWarmupAt, getPacificDateKeyDaysFromNow } from '../shared/pacificDate';
import { isDailyFritzTransactionalAuthorityEnabled } from '../dailyFritzAuthorityFeature';

export function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** Off by default in production; set ENABLE_STARTUP_FRITZ_WARMUP=true to run on boot. */
export function isStartupDailyFritzWarmupEnabled(): boolean {
  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_FRITZ_WARMUP);
}

/** Off by default in production; set ENABLE_STARTUP_PUZZLE_WARMUP=true to run on boot. */
export function isStartupDailyPuzzleWarmupEnabled(): boolean {
  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_PUZZLE_WARMUP);
}

async function warmDailyFritzRuns(reason: 'startup' | 'scheduled', runDates: string[]): Promise<void> {
  const startedAt = Date.now();
  console.log('[daily-fritz-warmup] start', {
    reason,
    runDates,
  });
  try {
    const results = await Promise.all(
      runDates.map(async (runDate) => {
        const beforeCached = dailyFritzRunCache.has(runDate);
        const warmedStartedAt = Date.now();
        const run = await ensureDailyFritzRunForDate(runDate);
        const published = run && isDailyFritzTransactionalAuthorityEnabled()
          ? await publishDailyFritzChallenge(buildDailyFritzPublishedChallenge({
              runDate: run.runDate,
              fritzTier: run.fritzTier,
              dealSize: run.dealSize,
              winningScore: run.winningScore,
              publishedAt: run.generatedAt,
            }))
          : null;
        return {
          runDate,
          ms: Date.now() - warmedStartedAt,
          beforeCached,
          afterCached: dailyFritzRunCache.has(runDate),
          status: run?.status ?? null,
          challengeId: published?.challengeId ?? null,
          challengeDigest: published?.contentDigest ?? null,
        };
      }),
    );
    console.log('[daily-fritz-warmup] success', {
      reason,
      totalMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    console.warn('[daily-fritz-warmup] error', {
      reason,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function scheduleDailyFritzWarmup(): void {
  const nextWarmupAt = getNextPacificWarmupAt(0, 2);
  const delayMs = Math.max(1000, nextWarmupAt.getTime() - Date.now());
  setTimeout(async () => {
    await warmDailyFritzRuns('scheduled', [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)]);
    scheduleDailyFritzWarmup();
  }, delayMs);
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function warmDailyPuzzleLadders(reason: 'startup' | 'scheduled', runDates: string[]): Promise<void> {
  const startedAt = Date.now();
  console.log('[daily-puzzle-ladder-warmup] start', { reason, runDates });
  try {
    const results: Array<{ runDate: string; ms: number; outcome: 'skipped' | 'seeded' | 'failed' }> = [];
    for (const runDate of runDates) {
      await yieldEventLoop();
      const slotStartedAt = Date.now();
      const outcome = await ensureDailyPuzzleLadderForDate(runDate, { force: false, purpose: reason });
      results.push({ runDate, ms: Date.now() - slotStartedAt, outcome });
    }
    console.log('[daily-puzzle-ladder-warmup] success', {
      reason,
      totalMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    console.warn('[daily-puzzle-ladder-warmup] error', {
      reason,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function scheduleDailyPuzzleLadderWarmup(): void {
  const nextWarmupAt = getNextPacificWarmupAt(0, 2);
  const delayMs = Math.max(1000, nextWarmupAt.getTime() - Date.now());
  setTimeout(async () => {
    await warmDailyPuzzleLadders('scheduled', [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)]);
    scheduleDailyPuzzleLadderWarmup();
  }, delayMs);
}

const STARTUP_DAILY_WARMUP_DELAY_MS = 12_000;

/** Optional startup warmups (off unless ENABLE_STARTUP_*_WARMUP=true). */
export function scheduleStartupDailyWarmups(): void {
  const startupWarmupDates = [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)];
  setTimeout(() => {
    if (isStartupDailyFritzWarmupEnabled()) {
      void warmDailyFritzRuns('startup', startupWarmupDates).catch((err) => {
        console.warn('[daily-fritz-warmup] startup failed', err instanceof Error ? err.message : err);
      });
    } else {
      console.log('[daily-fritz-warmup] skipped on startup', {
        hint: 'Set ENABLE_STARTUP_FRITZ_WARMUP=true to enable',
      });
    }
    if (isStartupDailyPuzzleWarmupEnabled()) {
      void warmDailyPuzzleLadders('startup', startupWarmupDates).catch((err) => {
        console.warn(
          '[daily-puzzle-ladder-warmup] startup failed',
          err instanceof Error ? err.message : err,
        );
      });
    } else {
      console.log('[daily-puzzle-ladder-warmup] skipped on startup', {
        hint: 'Set ENABLE_STARTUP_PUZZLE_WARMUP=true to enable',
      });
    }
  }, STARTUP_DAILY_WARMUP_DELAY_MS);
}
