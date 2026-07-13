export const DAILY_FRITZ_RULES_VERSION = 2;
export const DAILY_FRITZ_SEED_VERSION = 1;
export const DAILY_FRITZ_TIME_ZONE = 'America/Los_Angeles';
export function buildDailyFritzChallengeId(runDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new Error('Invalid Daily Fritz run date.');
  return `daily-fritz:${runDate}:r${DAILY_FRITZ_RULES_VERSION}:s${DAILY_FRITZ_SEED_VERSION}`;
}
