
import cron from 'node-cron';
import { decayInactivePlayers, processAllPendingRatingGames } from './periodService';
import { childLogger } from '../logger';

const log = childLogger('ranking-cron');

export async function runWeeklyRankingMaintenance(): Promise<{
  processedGames: number;
  gameErrors: number;
  processedDecay: number;
  decayErrors: number;
}> {
  log.info('starting weekly ranking maintenance');
  const pendingResult = await processAllPendingRatingGames();
  log.info({ processed: pendingResult.processed }, 'processed missed ranked game updates');
  if (pendingResult.errors.length > 0) {
    log.error({ errors: pendingResult.errors }, 'rating processing errors');
  }

  const decayResult = await decayInactivePlayers();
  log.info({ processed: decayResult.processed }, 'processed RD decay for inactive players');
  if (decayResult.errors.length > 0) {
    log.error({ errors: decayResult.errors }, 'RD decay errors');
  }

  return {
    processedGames: pendingResult.processed,
    gameErrors: pendingResult.errors.length,
    processedDecay: decayResult.processed,
    decayErrors: decayResult.errors.length,
  };
}

/**
 * In-process scheduling only works on an always-on host. On Vercel Fluid
 * Compute, functions scale to zero between requests, so this loop is not
 * guaranteed to fire — the /api/cron/weekly-ranking-maintenance route +
 * vercel.json "crons" entry is the source of truth there. Keep this for
 * local dev and any traditional always-on deployment.
 */
export function startRankingCron() {
  if (process.env.VERCEL) {
    log.info('skipping in-process ranking cron on Vercel — driven by vercel.json crons instead');
    return;
  }
  // Schedule: every Sunday at midnight UTC ('0 0 * * 0')
  cron.schedule(
    '0 0 * * 0',
    () => {
      runWeeklyRankingMaintenance().catch((err) => {
        log.error({ err }, 'failed to run weekly ranking maintenance');
      });
    },
    { timezone: 'UTC' },
  );
  log.info('ranking cron scheduled (Sundays at 00:00 UTC) for missed-game catch-up and RD decay');
}
