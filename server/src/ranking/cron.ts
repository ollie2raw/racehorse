import { childLogger } from '../logger';

import cron from 'node-cron';
import { decayInactivePlayers, processAllPendingRatingGames } from './periodService';

const log = childLogger('ranking:cron');

/**
 * RK-6 (HARDENING_PLAN §8.3): unlike every other reaper in this codebase
 * (daily-fritz stranded recovery, the tournament reconciler, the matchmaking
 * reservation sweeper), the weekly ranking cron had nothing re-triggering
 * `processAllPendingRatingGames()` between Sunday runs. Render free tier
 * restarts are routine (§1.3 T-17/T-18); a game whose inline rating
 * application failed just before a restart sat `rating_after: null` —
 * reading as unranked — for up to 7 days. This is the periodic catch-up half
 * of the fix; the boot sweep below is the other half.
 *
 * Cadence matches the daily-fritz reaper's class (`DAILY_FRITZ_STRANDED_RECOVERY_INTERVAL_MS`):
 * frequent enough that a restart's damage window is minutes, not days, cheap
 * enough (one paged read of `ranked_games` when the backlog is empty, the
 * common case) to run this often.
 */
export const RANKING_CATCHUP_INTERVAL_MS = 15 * 60_000;

/** Boot sweep delay — after the daily warmups have had a chance to run, same margin as the daily-fritz reaper's boot delay. */
export const RANKING_CATCHUP_BOOT_DELAY_MS = 20_000;

/**
 * Re-processes any `ranked_games` row still missing `rating_after`. Safe to
 * call repeatedly and concurrently with itself: each game's rating update is
 * committed by a single atomic RPC (`commit_glicko_game_update`, one Postgres
 * function call = one transaction) that also stamps `rating_after` on that
 * row, and every sweep re-reads `rating_after=is.null` fresh — so a sweep
 * interrupted mid-run (process restart, deploy) leaves no partial state:
 * games already committed are already excluded from the next sweep's query,
 * and games not yet reached are untouched and picked up next time. Nothing
 * here can double-apply a rating change.
 */
async function runPendingRatingCatchUp(source: 'boot' | 'periodic' | 'weekly'): Promise<void> {
  try {
    const pendingResult = await processAllPendingRatingGames();
    if (pendingResult.processed > 0 || pendingResult.errors.length > 0 || source === 'weekly') {
      log.info({ source, processed: pendingResult.processed }, 'processed missed ranked game updates');
    }
    if (pendingResult.errors.length > 0) {
      log.error({ source, errors: pendingResult.errors, count: pendingResult.errors.length }, 'rating processing errors');
    }
  } catch (err) {
    log.error({ source, err }, 'pending-rating catch-up sweep failed');
  }
}

let scheduled = false;

/** Weekly maintenance (Sundays 00:00 UTC) + boot sweep + periodic catch-up. Safe to call once at server start. */
export function startRankingCron() {
  if (scheduled) return;
  scheduled = true;

  // Schedule: every Sunday at midnight UTC ('0 0 * * 0')
  cron.schedule('0 0 * * 0', async () => {
    log.info('starting weekly ranking maintenance');
    await runPendingRatingCatchUp('weekly');
    try {
      const decayResult = await decayInactivePlayers();
      log.info({ processed: decayResult.processed }, 'processed RD decay for inactive players');
      if (decayResult.errors.length > 0) {
        log.error({ errors: decayResult.errors, count: decayResult.errors.length }, 'RD decay errors');
      }
    } catch (err) {
      log.error({ err }, 'failed to run weekly RD decay');
    }
  }, {
    timezone: "UTC"
  });

  // RK-6: boot sweep + periodic catch-up so a pending game doesn't wait for Sunday.
  setTimeout(() => {
    void runPendingRatingCatchUp('boot');
  }, RANKING_CATCHUP_BOOT_DELAY_MS);
  setInterval(() => {
    void runPendingRatingCatchUp('periodic');
  }, RANKING_CATCHUP_INTERVAL_MS);

  log.info(
    { catchupIntervalMs: RANKING_CATCHUP_INTERVAL_MS, bootDelayMs: RANKING_CATCHUP_BOOT_DELAY_MS },
    'Ranking cron scheduled (Sundays at 00:00 UTC for RD decay; pending-game catch-up at boot + every 15 min)',
  );
}
