import { childLogger } from '../logger';
import { dailyFritzRunCache, ensureDailyFritzRunForDate } from '../http/stores/dailyFritzStore';
import { buildDailyFritzPublishedChallenge } from '../dailyFritzPublishedChallenge';
import { publishDailyFritzChallenge } from '../http/stores/dailyFritzPublishedChallengeStore';
import { getNextPacificWarmupAt, getPacificDateKeyDaysFromNow } from '../shared/pacificDate';
import { isDailyFritzTransactionalAuthorityEnabled } from '../dailyFritzAuthorityFeature';

const log = childLogger('daily-warmup');

export function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** Off by default in production; set ENABLE_STARTUP_FRITZ_WARMUP=true to run on boot. */
export function isStartupDailyFritzWarmupEnabled(): boolean {
  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_FRITZ_WARMUP);
}

async function warmDailyFritzRuns(reason: 'startup' | 'scheduled', runDates: string[]): Promise<void> {
  const startedAt = Date.now();
  log.info({
    reason,
    runDates,
  }, 'start');
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
    log.info({
      reason,
      totalMs: Date.now() - startedAt,
      results,
    }, 'success');
  } catch (error) {
    log.warn({
      reason,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }, 'error');
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

const STARTUP_DAILY_WARMUP_DELAY_MS = 12_000;

/** Optional startup warmup (off unless ENABLE_STARTUP_FRITZ_WARMUP=true). */
export function scheduleStartupDailyWarmups(): void {
  const startupWarmupDates = [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)];
  setTimeout(() => {
    if (isStartupDailyFritzWarmupEnabled()) {
      void warmDailyFritzRuns('startup', startupWarmupDates).catch((err) => {
        log.warn('[daily-fritz-warmup] startup failed', err instanceof Error ? err.message : err);
      });
    } else {
      log.info({
        hint: 'Set ENABLE_STARTUP_FRITZ_WARMUP=true to enable',
      }, 'skipped on startup');
    }
  }, STARTUP_DAILY_WARMUP_DELAY_MS);
}
