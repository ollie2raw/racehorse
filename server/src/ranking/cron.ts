
import cron from 'node-cron';
import { processAllRatingPeriods } from './periodService';

export function startRankingCron() {
  // Schedule: every Sunday at midnight UTC ('0 0 * * 0')
  cron.schedule('0 0 * * 0', async () => {
    console.log('Starting weekly rating period processing...');
    try {
      const result = await processAllRatingPeriods();
      console.log(`Rating period processed: ${result.processed} players updated`);
      if (result.errors.length > 0) {
        console.error(`Encountered ${result.errors.length} errors during processing:`, result.errors);
      }
    } catch (err) {
      console.error('Failed to process rating periods:', err);
    }
  }, {
    timezone: "UTC"
  });
  console.log('Ranking cron scheduled (Sundays at 00:00 UTC)');
}
