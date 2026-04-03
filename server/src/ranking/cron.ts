
import cron from 'node-cron';
import { decayInactivePlayers, processAllPendingRatingGames } from './periodService';

export function startRankingCron() {
  // Schedule: every Sunday at midnight UTC ('0 0 * * 0')
  cron.schedule('0 0 * * 0', async () => {
    console.log('Starting weekly ranking maintenance...');
    try {
      const pendingResult = await processAllPendingRatingGames();
      console.log(`Processed ${pendingResult.processed} missed ranked game updates`);
      if (pendingResult.errors.length > 0) {
        console.error(`Encountered ${pendingResult.errors.length} rating processing errors:`, pendingResult.errors);
      }

      const decayResult = await decayInactivePlayers();
      console.log(`Processed RD decay for ${decayResult.processed} inactive players`);
      if (decayResult.errors.length > 0) {
        console.error(`Encountered ${decayResult.errors.length} RD decay errors:`, decayResult.errors);
      }
    } catch (err) {
      console.error('Failed to run weekly ranking maintenance:', err);
    }
  }, {
    timezone: "UTC"
  });
  console.log('Ranking cron scheduled (Sundays at 00:00 UTC) for missed-game catch-up and RD decay');
}
