import { childLogger } from '../logger';

import cron from 'node-cron';
import { decayInactivePlayers, processAllPendingRatingGames } from './periodService';

const log = childLogger('ranking:cron');

export function startRankingCron() {
  // Schedule: every Sunday at midnight UTC ('0 0 * * 0')
  cron.schedule('0 0 * * 0', async () => {
    log.info('starting weekly ranking maintenance');
    try {
      const pendingResult = await processAllPendingRatingGames();
      log.info({ processed: pendingResult.processed }, 'processed missed ranked game updates');
      if (pendingResult.errors.length > 0) {
        log.error({ errors: pendingResult.errors, count: pendingResult.errors.length }, 'rating processing errors');
      }

      const decayResult = await decayInactivePlayers();
      log.info({ processed: decayResult.processed }, 'processed RD decay for inactive players');
      if (decayResult.errors.length > 0) {
        log.error({ errors: decayResult.errors, count: decayResult.errors.length }, 'RD decay errors');
      }
    } catch (err) {
      log.error({ err }, 'failed to run weekly ranking maintenance');
    }
  }, {
    timezone: "UTC"
  });
  log.info('Ranking cron scheduled (Sundays at 00:00 UTC) for missed-game catch-up and RD decay');
}
