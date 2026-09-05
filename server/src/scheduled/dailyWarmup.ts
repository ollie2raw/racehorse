import { childLogger } from '../logger';
import { dailyFritzRunCache, ensureDailyFritzRunForDate } from '../http/stores/dailyFritzStore';
import { buildDailyFritzPublishedChallenge } from '../dailyFritzPublishedChallenge';
import {
  getDailyFritzPublishedChallenge,
  publishDailyFritzChallenge,
} from '../http/stores/dailyFritzPublishedChallengeStore';
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

export type DailyFritzWarmupResult = {
  runDate: string;
  ms: number;
  beforeCached: boolean;
  afterCached: boolean;
  status: string | null;
  challengeId: string | null;
  challengeDigest: string | null;
  /**
   * 'published' — this warmup created the published-challenge row.
   * 'reused'    — a row already existed (pre-generated on an earlier run) and was
   *              left untouched; this is the guard against re-publishing a frozen
   *              row under drifted version constants (see below).
   * 'skipped'   — transactional authority disabled, or no run row.
   */
  publish: 'published' | 'reused' | 'skipped';
};

/**
 * Warm a single run date: ensure its `daily_fritz_runs` row exists, then ensure
 * its published-challenge row exists — reusing an already-published row rather
 * than re-deriving and re-publishing it.
 *
 * The reuse guard mirrors `dailyFritzStartRoute.ts` (`f37cf0ef`). `daily_fritz_
 * published_challenges` rows are immutable and content-addressed; the warmup runs
 * for [today, tomorrow] every night, so it re-visits each date at least twice. If
 * a version constant (`FRITZ_POLICY_VERSION`, a verifier/protocol version) is
 * bumped between the run that first published a date and a later run, a blind
 * `publishDailyFritzChallenge` rebuilds the package under the new constants and
 * `publish_daily_fritz_challenge` raises `daily_fritz_challenge_identity_conflict`
 * against the frozen row — the exact DF-STALE-1 failure, here surfacing as a
 * warmup error that (pre-`Promise.allSettled`) also skipped the sibling date.
 * Fetching the existing row first and reusing it as-is removes that failure mode.
 *
 * Throws on a genuine failure (run generation error, an unexpected publish
 * conflict on a not-yet-published date). Callers isolate dates from each other.
 */
export async function warmOneDailyFritzRun(runDate: string): Promise<DailyFritzWarmupResult> {
  const startedAt = Date.now();
  const beforeCached = dailyFritzRunCache.has(runDate);
  const run = await ensureDailyFritzRunForDate(runDate);

  let publish: DailyFritzWarmupResult['publish'] = 'skipped';
  let challengeId: string | null = null;
  let challengeDigest: string | null = null;

  if (run && isDailyFritzTransactionalAuthorityEnabled()) {
    const built = buildDailyFritzPublishedChallenge({
      runDate: run.runDate,
      fritzTier: run.fritzTier,
      dealSize: run.dealSize,
      winningScore: run.winningScore,
      publishedAt: run.generatedAt,
    });
    const existing = await getDailyFritzPublishedChallenge(built.challengeId);
    if (existing) {
      publish = 'reused';
      challengeId = existing.challengeId;
      challengeDigest = existing.contentDigest;
    } else {
      const published = await publishDailyFritzChallenge(built);
      publish = 'published';
      challengeId = published.challengeId;
      challengeDigest = published.contentDigest;
    }
  }

  return {
    runDate,
    ms: Date.now() - startedAt,
    beforeCached,
    afterCached: dailyFritzRunCache.has(runDate),
    status: run?.status ?? null,
    challengeId,
    challengeDigest,
    publish,
  };
}

export async function warmDailyFritzRuns(
  reason: 'startup' | 'scheduled',
  runDates: string[],
): Promise<void> {
  const startedAt = Date.now();
  log.info({ reason, runDates }, 'start');

  // Promise.allSettled, not Promise.all: a failure on one date (e.g. today) must
  // not skip pre-generation of the other (tomorrow) — a missing tomorrow row is
  // exactly what strands the next day's /start calls.
  const settled = await Promise.allSettled(runDates.map((runDate) => warmOneDailyFritzRun(runDate)));

  const results = settled.map((outcome, index) =>
    outcome.status === 'fulfilled'
      ? { ...outcome.value, ok: true as const }
      : {
          runDate: runDates[index],
          ok: false as const,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    log.warn({ reason, totalMs: Date.now() - startedAt, results }, 'partial');
  } else {
    log.info({ reason, totalMs: Date.now() - startedAt, results }, 'success');
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
